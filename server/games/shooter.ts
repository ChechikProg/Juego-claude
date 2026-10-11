import { CRATE_LOOT, SH, SH_MAPS, WEAPONS, platformAt, type Platform } from '../../shared/shooter';
import type { ShBullet, ShCrate, ShFighter, ShFx, ShKill, ShNade, ShWeapon, ShooterView } from '../../shared/types';
import { rnd, rndInt, weightedIndex } from '../util';
import type { GameContext, GameModule } from './kit';

const FX_TTL = 900;
const FEED_MAX = 6;
const DUMMIES = 3;

interface Fighter extends ShFighter {
  input: { left: boolean; right: boolean; fire: boolean };
  jumpQueued: boolean;
  nadeQueued: boolean;
  dropUntil: number;
  jumps: number;
  stunUntil: number;
  combo: number;
  lastHitBy: string | null;
  lastHitAt: number;
  /** plataforma en la que está parado (para que lo lleve si se mueve) */
  standing: number;
  nadeBonus: number;
  dummy: boolean;
}

interface Bullet extends ShBullet {
  bornAt: number;
  ttl: number;
  knock: number;
}

interface Nade extends ShNade {
  resting: number;
}

interface Crate extends ShCrate {
  vy: number;
  bornAt: number;
  standing: number;
}

interface ShState {
  stage: 'countdown' | 'live' | 'done';
  until: number;
  endsAt: number;
  map: number;
  clock0: number;
  solo: boolean;
  fighters: Map<string, Fighter>;
  bullets: Bullet[];
  nades: Nade[];
  crates: Crate[];
  nextCrateAt: number;
  fx: ShFx[];
  feed: ShKill[];
  seq: number;
  outCount: number;
  lastTick: number;
  /** posición de cada plataforma en el tick anterior */
  plat: { x: number; y: number }[];
  platPrev: { x: number; y: number }[];
}

function newFighter(id: string, lives: number, dummy = false): Fighter {
  return {
    playerId: id,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    face: 1,
    alive: false,
    lives,
    respawnAt: 0,
    shieldUntil: 0,
    weapon: 'pistol',
    ammo: -1,
    readyAt: 0,
    nadeReadyAt: 0,
    kills: 0,
    deaths: 0,
    place: null,
    grounded: false,
    hitAt: 0,
    input: { left: false, right: false, fire: false },
    jumpQueued: false,
    nadeQueued: false,
    dropUntil: 0,
    jumps: 0,
    stunUntil: 0,
    combo: 0,
    lastHitBy: null,
    lastHitAt: 0,
    standing: -1,
    nadeBonus: 0,
    dummy,
  };
}

export const shooter: GameModule<ShState> = {
  id: 'shooter',
  tickHz: SH.TICK_HZ,

  create(ctx) {
    const lives = Math.max(1, Math.min(6, ctx.config.shooterLives || 3));
    const roster = ctx.players();
    const map = rndInt(0, SH_MAPS.length);
    const s: ShState = {
      stage: 'countdown',
      until: 0,
      endsAt: 0,
      map,
      clock0: 0,
      solo: roster.length <= 1,
      fighters: new Map(),
      bullets: [],
      nades: [],
      crates: [],
      nextCrateAt: 0,
      fx: [],
      feed: [],
      seq: 1,
      outCount: 0,
      lastTick: 0,
      plat: [],
      platPrev: [],
    };
    for (const p of roster) s.fighters.set(p.id, newFighter(p.id, lives));
    // En solitario hay muñecos de práctica para revolear.
    if (s.solo) for (let i = 1; i <= DUMMIES; i++) s.fighters.set(`dummy-${i}`, newFighter(`dummy-${i}`, 99, true));
    updatePlatforms(s, 0);
    s.platPrev = s.plat.map((p) => ({ ...p }));
    for (const f of s.fighters.values()) spawn(s, f, 0, true);
    return s;
  },

  start(ctx, s) {
    const now = ctx.now();
    s.stage = 'countdown';
    s.until = now + SH.COUNTDOWN_MS;
    s.endsAt = s.until + (s.solo ? SH.SOLO_MS : SH.MATCH_MS);
    s.clock0 = s.until;
    s.lastTick = now;
    ctx.push();
  },

  event(ctx, s, playerId, type, data) {
    const f = s.fighters.get(playerId);
    if (!f || f.dummy) return;
    const d = (data ?? {}) as { down?: unknown };
    const down = d.down !== false;
    switch (type) {
      case 'left':
        f.input.left = down;
        if (down) f.face = -1;
        return;
      case 'right':
        f.input.right = down;
        if (down) f.face = 1;
        return;
      case 'fire':
        f.input.fire = down;
        return;
      case 'jump':
        if (s.stage === 'live') f.jumpQueued = true;
        return;
      case 'drop':
        f.dropUntil = ctx.now() + SH.DROP_MS;
        return;
      case 'nade':
        if (s.stage === 'live') f.nadeQueued = true;
        return;
      case 'stop':
        f.input = { left: false, right: false, fire: false };
        return;
    }
  },

  tick(ctx, s, _dt, now) {
    if (s.stage === 'countdown') {
      if (now >= s.until) {
        s.stage = 'live';
        s.lastTick = now;
        s.nextCrateAt = now + rndInt(SH.CRATE_EVERY[0], SH.CRATE_EVERY[1]);
        for (const f of s.fighters.values()) f.shieldUntil = now + 600;
        ctx.push();
      }
      return;
    }
    if (s.stage !== 'live') return;

    const dt = Math.min(0.05, (now - s.lastTick) / 1000);
    s.lastTick = now;
    if (dt <= 0) return;

    updatePlatforms(s, now - s.clock0);

    for (const f of s.fighters.values()) stepFighter(s, f, dt, now);
    collideFighters(s);
    for (const f of s.fighters.values()) checkFall(ctx, s, f, now);
    stepBullets(s, dt, now);
    stepNades(s, dt, now);
    stepCrates(s, dt, now);

    if (s.fx.length && now - s.fx[0].at > FX_TTL) s.fx = s.fx.filter((f) => now - f.at <= FX_TTL);

    const contenders = [...s.fighters.values()].filter((f) => !f.dummy && f.lives > 0);
    const enough = s.solo ? contenders.length === 0 : contenders.length <= 1;
    if (enough || now >= s.endsAt) {
      finish(ctx, s);
      return;
    }
    ctx.push();
  },

  leave(ctx, s, playerId) {
    const f = s.fighters.get(playerId);
    if (!f) return;
    f.input = { left: false, right: false, fire: false };
    // El que se va no bloquea el final: queda afuera con lo que tenía.
    if (f.lives > 0 && s.stage !== 'done') {
      f.lives = 0;
      f.alive = false;
      f.place = [...s.fighters.values()].filter((x) => !x.dummy && x.lives > 0).length + 1;
      s.outCount += 1;
    }
    ctx.push();
  },

  view(ctx, s): ShooterView {
    const r1 = (n: number) => Math.round(n * 10) / 10;
    return {
      stage: s.stage,
      t: ctx.now(),
      until: s.stage === 'countdown' ? s.until : s.endsAt,
      map: s.map,
      clock0: s.clock0,
      fighters: [...s.fighters.values()].map(
        (f): ShFighter => ({
          playerId: f.playerId,
          x: r1(f.x),
          y: r1(f.y),
          vx: r1(f.vx),
          vy: r1(f.vy),
          face: f.face,
          alive: f.alive,
          lives: f.dummy ? -1 : f.lives,
          respawnAt: f.respawnAt,
          shieldUntil: f.shieldUntil,
          weapon: f.weapon,
          ammo: f.ammo,
          readyAt: f.readyAt,
          nadeReadyAt: f.nadeBonus > 0 ? 0 : f.nadeReadyAt,
          kills: f.kills,
          deaths: f.deaths,
          place: f.place,
          grounded: f.grounded,
          hitAt: f.hitAt,
        }),
      ),
      bullets: s.bullets.map((b) => ({ id: b.id, x: r1(b.x), y: r1(b.y), vx: r1(b.vx), vy: r1(b.vy), owner: b.owner, kind: b.kind })),
      nades: s.nades.map((n) => ({ id: n.id, x: r1(n.x), y: r1(n.y), vx: r1(n.vx), vy: r1(n.vy), owner: n.owner, boomAt: n.boomAt })),
      crates: s.crates.map((c) => ({ id: c.id, x: r1(c.x), y: r1(c.y), weapon: c.weapon, landed: c.landed })),
      fx: s.fx,
      feed: s.feed,
    };
  },
};

/* ── mundo ────────────────────────────────────────────────────────────────── */

function platforms(s: ShState): Platform[] {
  return SH_MAPS[s.map].platforms;
}

function updatePlatforms(s: ShState, t: number): void {
  s.platPrev = s.plat.length ? s.plat : platforms(s).map((p) => platformAt(p, t));
  s.plat = platforms(s).map((p) => platformAt(p, t));
}

/** Reaparece arriba de una plataforma fija, lo más lejos posible de los demás. */
function spawn(s: ShState, f: Fighter, now: number, initial = false): void {
  const list = platforms(s)
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => !p.period);
  const others = [...s.fighters.values()].filter((o) => o !== f && o.alive);
  let best = { x: SH.W / 2, y: list[0]?.p.y ?? 600, i: list[0]?.i ?? 0 };
  let bestScore = -Infinity;
  for (let k = 0; k < 18; k++) {
    const { p, i } = list[rndInt(0, list.length)];
    const x = p.x + 30 + rnd() * Math.max(1, p.w - 60);
    let near = Infinity;
    for (const o of others) near = Math.min(near, Math.hypot(o.x - x, o.y - p.y));
    const score = Math.min(near, 500) + rnd() * 60;
    if (score > bestScore) {
      bestScore = score;
      best = { x, y: p.y, i };
    }
  }
  f.x = best.x;
  f.y = best.y;
  f.vx = 0;
  f.vy = 0;
  f.alive = true;
  f.grounded = true;
  f.standing = best.i;
  f.jumps = 0;
  f.stunUntil = 0;
  f.combo = 0;
  f.lastHitBy = null;
  f.weapon = 'pistol';
  f.ammo = -1;
  f.nadeBonus = 0;
  f.face = f.x < SH.W / 2 ? 1 : -1;
  f.shieldUntil = now + SH.SHIELD_MS;
  if (!initial) addFx(s, 'spawn', f.x, f.y - SH.HEIGHT / 2, now, f.playerId);
}

function stepFighter(s: ShState, f: Fighter, dt: number, now: number): void {
  if (!f.alive) {
    if (f.lives > 0 && now >= f.respawnAt) spawn(s, f, now);
    return;
  }

  // Lo lleva la plataforma en la que está parado.
  if (f.grounded && f.standing >= 0) {
    const cur = s.plat[f.standing];
    const prev = s.platPrev[f.standing];
    if (cur && prev) {
      f.x += cur.x - prev.x;
      f.y = cur.y;
    }
  }

  const stunned = now < f.stunUntil;
  const dir = f.dummy ? 0 : (f.input.right ? 1 : 0) - (f.input.left ? 1 : 0);
  if (dir !== 0) f.face = dir as -1 | 1;

  if (dir !== 0) {
    const accel = f.grounded ? SH.ACCEL_GROUND : SH.ACCEL_AIR;
    // Contra el empujón se puede hacer fuerza, pero no se frena de golpe.
    const k = stunned ? 0.45 : 1;
    if (dir * f.vx < SH.RUN) f.vx = clampToward(f.vx, dir * SH.RUN, accel * k * dt);
  } else if (f.grounded && !stunned) {
    f.vx = clampToward(f.vx, 0, SH.FRICTION * dt);
  }
  if (stunned) {
    f.vx *= Math.exp(-SH.KNOCK_DRAG * dt);
  } else if (Math.abs(f.vx) > SH.RUN) {
    f.vx = Math.sign(f.vx) * Math.max(SH.RUN, Math.abs(f.vx) - (f.grounded ? 2600 : 1100) * dt);
  }

  if (f.jumpQueued) {
    f.jumpQueued = false;
    if (f.grounded) {
      f.vy = -SH.JUMP_V;
      f.jumps = 1;
      f.grounded = false;
      addFx(s, 'jump', f.x, f.y, now, f.playerId);
    } else if (f.jumps < 2) {
      f.vy = Math.min(f.vy, -SH.DOUBLE_JUMP_V);
      f.jumps = 2;
      addFx(s, 'jump', f.x, f.y, now, f.playerId);
    }
  }

  // Si lo bajan de una plataforma, se cae.
  if (f.grounded && now < f.dropUntil) {
    f.grounded = false;
    f.jumps = Math.max(f.jumps, 1);
  }

  f.vy = Math.min(SH.MAX_FALL, f.vy + SH.GRAVITY * dt);
  const prevY = f.y;
  f.x += f.vx * dt;
  f.y += f.vy * dt;

  // Aterrizaje en plataformas (sólo bajando y desde arriba).
  const wasGrounded = f.grounded;
  f.grounded = false;
  if (f.vy >= 0 && now >= f.dropUntil) {
    const list = platforms(s);
    for (let i = 0; i < list.length; i++) {
      const p = s.plat[i];
      const pp = s.platPrev[i] ?? p;
      const w = list[i].w;
      if (f.x < p.x - SH.HALF_W + 4 || f.x > p.x + w + SH.HALF_W - 4) continue;
      const top = p.y;
      if (prevY <= Math.max(pp.y, top) + 2 && f.y >= top) {
        f.y = top;
        f.vy = 0;
        f.grounded = true;
        f.jumps = 0;
        f.standing = i;
        break;
      }
    }
  }
  if (!f.grounded) f.standing = -1;
  if (wasGrounded && !f.grounded && f.jumps === 0) f.jumps = 1;

  // Armas.
  if (f.input.fire && !f.dummy && now >= f.readyAt) fire(s, f, now);
  if (f.nadeQueued) {
    f.nadeQueued = false;
    throwNade(s, f, now);
  }
}

function clampToward(v: number, target: number, step: number): number {
  if (v < target) return Math.min(target, v + step);
  return Math.max(target, v - step);
}

/** Empujoncito entre jugadores para que no se superpongan. */
function collideFighters(s: ShState): void {
  const list = [...s.fighters.values()].filter((f) => f.alive);
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      if (Math.abs(a.y - b.y) > SH.HEIGHT * 0.8) continue;
      const dx = b.x - a.x;
      const min = SH.HALF_W * 2 - 4;
      if (Math.abs(dx) >= min) continue;
      const push = (min - Math.abs(dx)) / 2;
      const dir = Math.sign(dx) || (rnd() < 0.5 ? -1 : 1);
      a.x -= dir * push * 0.5;
      b.x += dir * push * 0.5;
    }
  }
}

function checkFall(ctx: GameContext, s: ShState, f: Fighter, now: number): void {
  if (!f.alive) return;
  const out =
    f.y > SH.H + SH.KILL_BELOW ||
    f.x < -SH.KILL_MARGIN_X ||
    f.x > SH.W + SH.KILL_MARGIN_X ||
    f.y < -SH.KILL_ABOVE;
  if (!out) return;

  f.alive = false;
  f.deaths += 1;
  f.input.fire = false;
  addFx(s, 'fall', Math.max(0, Math.min(SH.W, f.x)), Math.max(0, Math.min(SH.H, f.y)), now, f.playerId, f.x < 0 ? -1 : f.x > SH.W ? 1 : 0);

  const killer = f.lastHitBy && now - f.lastHitAt <= SH.CREDIT_MS && f.lastHitBy !== f.playerId ? f.lastHitBy : null;
  if (killer) {
    const k = s.fighters.get(killer);
    if (k && !k.dummy) k.kills += 1;
  }
  s.feed.unshift({ id: s.seq++, killer, victim: f.playerId, at: now });
  if (s.feed.length > FEED_MAX) s.feed.length = FEED_MAX;

  if (!f.dummy) f.lives -= 1;
  if (f.lives > 0) {
    f.respawnAt = now + SH.RESPAWN_MS;
  } else {
    f.place = [...s.fighters.values()].filter((x) => !x.dummy && x.lives > 0).length + 1;
    s.outCount += 1;
    const pl = ctx.player(f.playerId);
    if (pl && !s.solo) ctx.toast(null, `☠️ ${pl.name} se quedó sin vidas`, 'info');
  }
}

/* ── armas ────────────────────────────────────────────────────────────────── */

function fire(s: ShState, f: Fighter, now: number): void {
  const weapon: ShWeapon = f.weapon === 'nades' ? 'pistol' : f.weapon;
  const def = WEAPONS[weapon];
  f.readyAt = now + def.cooldown;
  const gx = f.x + f.face * (SH.HALF_W + 10);
  const gy = f.y - SH.HEIGHT * 0.55;
  for (let i = 0; i < def.pellets; i++) {
    const spread = def.pellets > 1 ? -def.spread / 2 + (def.spread * i) / (def.pellets - 1) : (rnd() - 0.5) * def.spread;
    const speed = def.speed * (def.pellets > 1 ? 0.9 + rnd() * 0.2 : 1);
    s.bullets.push({
      id: s.seq++,
      x: gx,
      y: gy,
      vx: Math.cos(spread) * speed * f.face,
      vy: Math.sin(spread) * speed,
      owner: f.playerId,
      kind: weapon,
      bornAt: now,
      ttl: def.ttl,
      knock: def.knock,
    });
  }
  if (def.recoil) {
    f.vx -= f.face * def.recoil;
    if (def.recoil > 100) f.stunUntil = Math.max(f.stunUntil, now + 140);
  }
  addFx(s, 'shot', gx, gy, now, f.playerId, f.face, weapon);

  if (f.ammo > 0) {
    f.ammo -= 1;
    if (f.ammo === 0) {
      f.weapon = 'pistol';
      f.ammo = -1;
    }
  }
}

function throwNade(s: ShState, f: Fighter, now: number): void {
  if (!f.alive) return;
  if (s.nades.some((n) => n.owner === f.playerId) && f.nadeBonus <= 0) return;
  if (f.nadeBonus > 0) f.nadeBonus -= 1;
  else if (now < f.nadeReadyAt) return;
  else f.nadeReadyAt = now + SH.NADE_COOLDOWN;
  if (f.weapon === 'nades' && f.nadeBonus <= 0) {
    f.weapon = 'pistol';
    f.ammo = -1;
  } else if (f.weapon === 'nades') {
    f.ammo = f.nadeBonus;
  }
  s.nades.push({
    id: s.seq++,
    x: f.x + f.face * 12,
    y: f.y - SH.HEIGHT * 0.7,
    vx: f.face * SH.NADE_THROW_X + f.vx * 0.35,
    vy: -SH.NADE_THROW_Y + Math.min(0, f.vy) * 0.2,
    owner: f.playerId,
    boomAt: now + SH.NADE_FUSE,
    resting: -1,
  });
  addFx(s, 'toss', f.x, f.y, now, f.playerId);
}

/** Aplica un empujón. Devuelve false si el escudo lo absorbió. */
function knock(f: Fighter, kx: number, ky: number, by: string, now: number): boolean {
  if (!f.alive || now < f.shieldUntil) return false;
  if (now - f.lastHitAt > SH.COMBO_WINDOW) f.combo = 0;
  const mult = Math.min(SH.COMBO_MAX, 1 + f.combo * SH.COMBO_STEP);
  f.combo += 1;
  f.vx += kx * mult;
  f.vy = Math.min(f.vy, 0) + ky * mult;
  if (ky < -60) f.grounded = false;
  const power = Math.hypot(kx, ky) * mult;
  f.stunUntil = Math.max(f.stunUntil, now + 220 + power * 0.28);
  f.lastHitBy = by;
  f.lastHitAt = now;
  f.hitAt = now;
  return true;
}

function stepBullets(s: ShState, dt: number, now: number): void {
  const fighters = [...s.fighters.values()];
  const dead = new Set<number>();
  for (const b of s.bullets) {
    if (b.ttl && now - b.bornAt > b.ttl) {
      dead.add(b.id);
      continue;
    }
    const x0 = b.x;
    const y0 = b.y;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (b.x < -200 || b.x > SH.W + 200 || b.y < -400 || b.y > SH.H + 300) {
      dead.add(b.id);
      continue;
    }
    // Barrido: probamos varios puntos del tramo para no atravesar a nadie.
    const steps = Math.max(1, Math.ceil(Math.abs(b.x - x0) / 12));
    for (let k = 1; k <= steps && !dead.has(b.id); k++) {
      const px = x0 + ((b.x - x0) * k) / steps;
      const py = y0 + ((b.y - y0) * k) / steps;
      for (const f of fighters) {
        if (!f.alive || f.playerId === b.owner) continue;
        if (px < f.x - SH.HALF_W - 3 || px > f.x + SH.HALF_W + 3) continue;
        if (py < f.y - SH.HEIGHT - 3 || py > f.y + 3) continue;
        dead.add(b.id);
        const dir = Math.sign(b.vx) || 1;
        if (knock(f, dir * b.knock, -b.knock * 0.2, b.owner, now)) {
          addFx(s, 'hit', px, py, now, f.playerId, dir, b.kind);
        }
        break;
      }
    }
  }
  if (dead.size) s.bullets = s.bullets.filter((b) => !dead.has(b.id));
}

function stepNades(s: ShState, dt: number, now: number): void {
  const list = platforms(s);
  for (let i = s.nades.length - 1; i >= 0; i--) {
    const n = s.nades[i];
    if (now >= n.boomAt) {
      explode(s, n, now);
      s.nades.splice(i, 1);
      continue;
    }
    if (n.resting >= 0) {
      const cur = s.plat[n.resting];
      const prev = s.platPrev[n.resting];
      n.x += cur.x - prev.x;
      n.y = cur.y - SH.NADE_R;
      n.vx = clampToward(n.vx, 0, 900 * dt);
      n.x += n.vx * dt;
      const w = list[n.resting].w;
      if (n.x < cur.x || n.x > cur.x + w) n.resting = -1;
      continue;
    }
    const prevY = n.y;
    n.vy += SH.NADE_GRAVITY * dt;
    n.x += n.vx * dt;
    n.y += n.vy * dt;
    if (n.vy > 0) {
      for (let k = 0; k < list.length; k++) {
        const p = s.plat[k];
        const pp = s.platPrev[k] ?? p;
        if (n.x < p.x || n.x > p.x + list[k].w) continue;
        if (prevY + SH.NADE_R <= pp.y + 1 && n.y + SH.NADE_R >= p.y) {
          n.y = p.y - SH.NADE_R;
          if (n.vy < 220) {
            n.vy = 0;
            n.resting = k;
          } else {
            n.vy = -n.vy * 0.42;
            n.vx *= 0.7;
          }
          break;
        }
      }
    }
    if (n.y > SH.H + 300) s.nades.splice(i, 1);
  }
}

function explode(s: ShState, n: Nade, now: number): void {
  addFx(s, 'boom', n.x, n.y, now, n.owner);
  for (const f of s.fighters.values()) {
    if (!f.alive) continue;
    const cx = f.x;
    const cy = f.y - SH.HEIGHT / 2;
    const dx = cx - n.x;
    const dy = cy - n.y;
    const d = Math.hypot(dx, dy);
    if (d > SH.NADE_RADIUS) continue;
    const fall = Math.pow(1 - d / SH.NADE_RADIUS, 0.7);
    const force = 260 + SH.NADE_FORCE * fall;
    const nx = d > 1 ? dx / d : f.face;
    const ny = d > 1 ? dy / d : 0;
    // Siempre un poco hacia arriba: así el golpe saca de la plataforma.
    if (knock(f, nx * force, Math.min(-220, ny * force - force * 0.35), n.owner, now)) {
      addFx(s, 'hit', cx, cy, now, f.playerId, Math.sign(nx) || 1, 'nades');
    }
  }
}

function stepCrates(s: ShState, dt: number, now: number): void {
  const list = platforms(s);
  if (now >= s.nextCrateAt) {
    s.nextCrateAt = now + rndInt(SH.CRATE_EVERY[0], SH.CRATE_EVERY[1]);
    if (s.crates.length < SH.CRATE_MAX) {
      const fixed = list.map((p, i) => ({ p, i })).filter(({ p }) => !p.period);
      const { p } = fixed[rndInt(0, fixed.length)];
      const weapon = CRATE_LOOT[weightedIndex(CRATE_LOOT.map(([, w]) => w))][0];
      s.crates.push({
        id: s.seq++,
        x: p.x + 30 + rnd() * Math.max(1, p.w - 60),
        y: -60,
        vy: 0,
        weapon,
        landed: false,
        bornAt: now,
        standing: -1,
      });
      addFx(s, 'crate', 0, 0, now);
    }
  }

  for (let i = s.crates.length - 1; i >= 0; i--) {
    const c = s.crates[i];
    if (now - c.bornAt > SH.CRATE_TTL) {
      s.crates.splice(i, 1);
      continue;
    }
    if (c.standing >= 0) {
      const cur = s.plat[c.standing];
      const prev = s.platPrev[c.standing];
      c.x += cur.x - prev.x;
      c.y = cur.y;
    } else {
      const prevY = c.y;
      // Cae en paracaídas: despacito.
      c.vy = Math.min(260, c.vy + 900 * dt);
      c.y += c.vy * dt;
      for (let k = 0; k < list.length; k++) {
        const p = s.plat[k];
        const pp = s.platPrev[k] ?? p;
        if (c.x < p.x + 4 || c.x > p.x + list[k].w - 4) continue;
        if (prevY <= pp.y + 1 && c.y >= p.y) {
          c.y = p.y;
          c.landed = true;
          c.standing = k;
          break;
        }
      }
      if (c.y > SH.H + 200) {
        s.crates.splice(i, 1);
        continue;
      }
    }

    // ¿Alguien la agarró?
    for (const f of s.fighters.values()) {
      if (!f.alive || f.dummy) continue;
      if (Math.abs(f.x - c.x) > SH.HALF_W + SH.CRATE_SIZE / 2) continue;
      if (f.y < c.y - SH.CRATE_SIZE - 4 || f.y - SH.HEIGHT > c.y + 2) continue;
      const def = WEAPONS[c.weapon];
      if (c.weapon === 'nades') {
        f.nadeBonus = def.ammo;
        f.weapon = 'nades';
        f.ammo = def.ammo;
      } else {
        f.weapon = c.weapon;
        f.ammo = def.ammo;
      }
      addFx(s, 'pickup', c.x, c.y - SH.CRATE_SIZE / 2, now, f.playerId, 0, c.weapon);
      s.crates.splice(i, 1);
      break;
    }
  }
}

function addFx(s: ShState, kind: ShFx['kind'], x: number, y: number, at: number, playerId?: string, dir?: number, weapon?: ShWeapon): void {
  s.fx.push({ id: s.seq++, kind, x: Math.round(x), y: Math.round(y), at, playerId, dir, weapon });
  if (s.fx.length > 40) s.fx.shift();
}

function finish(ctx: GameContext, s: ShState): void {
  if (s.stage === 'done') return;
  s.stage = 'done';

  // Los que siguen vivos se ordenan por vidas y después por bajas.
  const real = [...s.fighters.values()].filter((f) => !f.dummy);
  const standing = real.filter((f) => f.lives > 0).sort((a, b) => b.lives - a.lives || b.kills - a.kills);
  standing.forEach((f, i) => {
    f.place = i + 1;
  });
  const n = real.length;
  ctx.push();
  ctx.finish(
    ctx.players().map((p) => {
      const f = s.fighters.get(p.id);
      if (!f) return { playerId: p.id, value: 0, label: '—' };
      const place = f.place ?? n;
      const value = s.solo ? f.kills : (n - place) * 3 + f.kills * 2;
      return {
        playerId: p.id,
        value,
        label: s.solo ? `${f.kills} bajas` : `${place}º · ${f.kills} baja${f.kills === 1 ? '' : 's'}`,
      };
    }),
  );
}
