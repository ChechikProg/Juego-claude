import {
  POWER,
  POWERUPS,
  POWER_KINDS,
  TANK,
  TANK_H,
  TANK_W,
  buildMaze,
  cellCenter,
  circleHitsWall,
  pushOutOfWalls,
  steerToward,
  stepShot,
  type Wall,
} from '../../shared/tanque';
import type {
  TankBullet,
  TankFx,
  TankKill,
  TankMine,
  TankPowerKind,
  TankPowerup,
  TankPublic,
  TankWeapon,
  TanqueView,
} from '../../shared/types';
import { pick, rndInt } from '../util';
import type { GameContext, GameModule } from './kit';

const COUNTDOWN_MS = 3200;
const FX_TTL = 900;
const FEED_MAX = 6;

interface Tank {
  playerId: string;
  x: number;
  y: number;
  a: number;
  ta: number;
  /** si nunca apuntó con el mouse, la torreta sigue al casco */
  aimed: boolean;
  alive: boolean;
  respawnAt: number;
  shieldUntil: number;
  readyAt: number;
  input: { move: number; turn: number };
  fireQueued: boolean;
  weapon: TankWeapon | null;
  ammo: number;
  armorUntil: number;
  speedUntil: number;
}

interface Bullet extends TankBullet {
  bornAt: number;
  ttl: number;
  /** el rayo atraviesa tanques: no mata dos veces al mismo */
  hit?: Set<string>;
}

type KillHow = TankKill['how'];

interface TqState {
  stage: 'countdown' | 'live' | 'done';
  until: number;
  endsAt: number;
  seed: number;
  walls: Wall[];
  tanks: Map<string, Tank>;
  /** puntos: se guardan aparte para que sobrevivan a una desconexión */
  score: Map<string, { score: number; kills: number; deaths: number }>;
  bullets: Bullet[];
  bulletSeq: number;
  powerups: TankPowerup[];
  mines: TankMine[];
  nextPowerAt: number;
  fx: TankFx[];
  fxSeq: number;
  feed: TankKill[];
  feedSeq: number;
  lastTick: number;
}

function stats(s: TqState, id: string): { score: number; kills: number; deaths: number } {
  let st = s.score.get(id);
  if (!st) {
    st = { score: 0, kills: 0, deaths: 0 };
    s.score.set(id, st);
  }
  return st;
}

/** Busca una celda lejos de los tanques vivos. */
function spawnPoint(s: TqState, except?: string): { x: number; y: number } {
  const others = [...s.tanks.values()].filter((t) => t.alive && t.playerId !== except);
  let best = cellCenter(0, 0);
  let bestDist = -1;
  for (let i = 0; i < 40; i++) {
    const p = cellCenter(rndInt(0, TANK.COLS), rndInt(0, TANK.ROWS));
    let near = Infinity;
    for (const o of others) near = Math.min(near, Math.hypot(o.x - p.x, o.y - p.y));
    if (near > TANK.CELL * 2.6) return p;
    if (near > bestDist) {
      bestDist = near;
      best = p;
    }
  }
  return best;
}

function placeTank(s: TqState, t: Tank, now: number): void {
  const p = spawnPoint(s, t.playerId);
  t.x = p.x;
  t.y = p.y;
  t.a = (rndInt(0, 4) * Math.PI) / 2;
  if (!t.aimed) t.ta = t.a;
  t.alive = true;
  t.shieldUntil = now + TANK.SHIELD_MS;
  t.readyAt = now + 300;
}

function newTank(playerId: string): Tank {
  return {
    playerId,
    x: 0,
    y: 0,
    a: 0,
    ta: 0,
    aimed: false,
    alive: false,
    respawnAt: 0,
    shieldUntil: 0,
    readyAt: 0,
    input: { move: 0, turn: 0 },
    fireQueued: false,
    weapon: null,
    ammo: 0,
    armorUntil: 0,
    speedUntil: 0,
  };
}

export const tanque: GameModule<TqState> = {
  id: 'tanque',
  tickHz: TANK.TICK_HZ,

  create(ctx) {
    const seed = rndInt(1, 2 ** 31 - 1);
    const s: TqState = {
      stage: 'countdown',
      until: 0,
      endsAt: 0,
      seed,
      walls: buildMaze(seed),
      tanks: new Map(),
      score: new Map(),
      bullets: [],
      bulletSeq: 1,
      powerups: [],
      mines: [],
      nextPowerAt: 0,
      fx: [],
      fxSeq: 1,
      feed: [],
      feedSeq: 1,
      lastTick: 0,
    };
    for (const p of ctx.players()) {
      const t = newTank(p.id);
      s.tanks.set(p.id, t);
      stats(s, p.id);
      placeTank(s, t, 0);
    }
    return s;
  },

  start(ctx, s) {
    const seconds = Math.max(60, Math.min(600, ctx.config.tanqueSeconds || 180));
    s.stage = 'countdown';
    s.until = ctx.now() + COUNTDOWN_MS;
    s.endsAt = s.until + seconds * 1000;
    s.lastTick = ctx.now();
    ctx.push();
  },

  event(ctx, s, playerId, type, data) {
    const t = s.tanks.get(playerId);
    if (!t) return;
    const d = (data ?? {}) as { move?: unknown; turn?: unknown; a?: unknown };

    switch (type) {
      case 'input': {
        const m = Math.sign(Number(d.move) || 0);
        const r = Math.sign(Number(d.turn) || 0);
        t.input.move = m;
        t.input.turn = r;
        return;
      }
      case 'aim': {
        const a = Number(d.a);
        if (!Number.isFinite(a)) return;
        t.ta = a;
        t.aimed = true;
        return;
      }
      case 'fire':
        if (s.stage === 'live') t.fireQueued = true;
        return;
    }
    void ctx;
  },

  tick(ctx, s, _dtMs, now) {
    if (s.stage === 'countdown') {
      if (now >= s.until) {
        s.stage = 'live';
        s.until = s.endsAt;
        s.lastTick = now;
        s.nextPowerAt = now + POWER.FIRST_SPAWN;
        for (const t of s.tanks.values()) t.shieldUntil = now + 600;
        ctx.push();
      }
      return;
    }
    if (s.stage !== 'live') return;

    const dt = Math.min(0.05, (now - s.lastTick) / 1000);
    s.lastTick = now;
    if (dt <= 0) return;

    const tanks = [...s.tanks.values()];

    /* ── power-ups: aparecen, vencen y se agarran ── */
    spawnPowerups(s, now);

    /* ── tanques ── */
    for (const t of tanks) {
      if (!t.alive) {
        if (now >= t.respawnAt) {
          placeTank(s, t, now);
          addFx(s, 'spawn', t.x, t.y, now, t.playerId);
        }
        continue;
      }

      const fast = now < t.speedUntil;
      t.a += t.input.turn * TANK.TURN * (fast ? POWER.TURN_MULT : 1) * dt;
      const base = t.input.move >= 0 ? TANK.SPEED : TANK.SPEED * TANK.REVERSE;
      const speed = base * (fast ? POWER.SPEED_MULT : 1);
      t.x += Math.cos(t.a) * t.input.move * speed * dt;
      t.y += Math.sin(t.a) * t.input.move * speed * dt;
      pushOutOfWalls(t, TANK.TANK_R, s.walls);
      t.x = Math.max(TANK.TANK_R, Math.min(TANK_W - TANK.TANK_R, t.x));
      t.y = Math.max(TANK.TANK_R, Math.min(TANK_H - TANK.TANK_R, t.y));
      if (!t.aimed) t.ta = t.a;

      pickPowerups(s, t, now);

      if (t.fireQueued) {
        t.fireQueued = false;
        if (now >= t.readyAt) fire(s, t, now);
      }
    }

    /* ── choques entre tanques ── */
    for (let i = 0; i < tanks.length; i++) {
      for (let j = i + 1; j < tanks.length; j++) {
        const a = tanks[i];
        const b = tanks[j];
        if (!a.alive || !b.alive) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 0.001;
        const min = TANK.TANK_R * 2;
        if (dist >= min) continue;
        const push = (min - dist) / 2;
        a.x -= (dx / dist) * push;
        a.y -= (dy / dist) * push;
        b.x += (dx / dist) * push;
        b.y += (dy / dist) * push;
        pushOutOfWalls(a, TANK.TANK_R, s.walls);
        pushOutOfWalls(b, TANK.TANK_R, s.walls);
      }
    }

    stepBullets(s, tanks, dt, now);
    stepMines(s, tanks, now);

    if (s.fx.length && now - s.fx[0].at > FX_TTL) s.fx = s.fx.filter((f) => now - f.at <= FX_TTL);

    if (now >= s.endsAt) {
      finish(ctx, s);
      return;
    }
    ctx.push();
  },

  leave(ctx, s, playerId) {
    s.tanks.delete(playerId);
    ctx.push();
  },

  rejoin(ctx, s, playerId) {
    if (s.tanks.has(playerId) || s.stage === 'done') return;
    if (!ctx.player(playerId)) return;
    const t = newTank(playerId);
    stats(s, playerId);
    s.tanks.set(playerId, t);
    placeTank(s, t, ctx.now());
    ctx.push();
  },

  view(ctx, s): TanqueView {
    const tanks: TankPublic[] = [];
    for (const t of s.tanks.values()) {
      const st = stats(s, t.playerId);
      tanks.push({
        playerId: t.playerId,
        x: Math.round(t.x * 10) / 10,
        y: Math.round(t.y * 10) / 10,
        a: Math.round(t.a * 1000) / 1000,
        ta: Math.round(t.ta * 1000) / 1000,
        alive: t.alive,
        respawnAt: t.respawnAt,
        shieldUntil: t.shieldUntil,
        readyAt: t.readyAt,
        score: st.score,
        kills: st.kills,
        deaths: st.deaths,
        weapon: t.weapon,
        ammo: t.ammo,
        armorUntil: t.armorUntil,
        speedUntil: t.speedUntil,
      });
    }
    return {
      stage: s.stage,
      t: ctx.now(),
      until: s.stage === 'countdown' ? s.until : s.endsAt,
      seed: s.seed,
      tanks,
      bullets: s.bullets.map((b) => ({
        id: b.id,
        x: Math.round(b.x * 10) / 10,
        y: Math.round(b.y * 10) / 10,
        vx: Math.round(b.vx * 10) / 10,
        vy: Math.round(b.vy * 10) / 10,
        owner: b.owner,
        kind: b.kind,
      })),
      powerups: s.powerups,
      mines: s.mines,
      fx: s.fx,
      feed: s.feed,
    };
  },
};

/* ── power-ups ────────────────────────────────────────────────────────────── */

function spawnPowerups(s: TqState, now: number): void {
  if (s.powerups.some((p) => now >= p.until)) s.powerups = s.powerups.filter((p) => now < p.until);
  if (now < s.nextPowerAt) return;
  const [lo, hi] = POWER.SPAWN_EVERY;
  s.nextPowerAt = now + rndInt(lo, hi);

  const max = Math.min(POWER.MAX_CAP, POWER.MAX_BASE + Math.floor(s.tanks.size / POWER.MAX_PER_PLAYERS));
  if (s.powerups.length >= max) return;

  // Una celda libre: sin tanques cerca y sin otro power-up ni mina encima.
  for (let tries = 0; tries < 30; tries++) {
    const p = cellCenter(rndInt(0, TANK.COLS), rndInt(0, TANK.ROWS));
    const tooClose =
      [...s.tanks.values()].some((t) => t.alive && Math.hypot(t.x - p.x, t.y - p.y) < TANK.CELL * 1.4) ||
      s.powerups.some((o) => Math.hypot(o.x - p.x, o.y - p.y) < TANK.CELL * 0.5) ||
      s.mines.some((m) => Math.hypot(m.x - p.x, m.y - p.y) < TANK.CELL * 0.5);
    if (tooClose) continue;
    s.powerups.push({ id: s.bulletSeq++, kind: pick(POWER_KINDS), x: p.x, y: p.y, until: now + POWER.TTL });
    return;
  }
}

function pickPowerups(s: TqState, t: Tank, now: number): void {
  const reach = POWER.PICK_R + TANK.TANK_R * 0.5;
  for (let i = s.powerups.length - 1; i >= 0; i--) {
    const p = s.powerups[i];
    if (Math.hypot(p.x - t.x, p.y - t.y) > reach) continue;
    s.powerups.splice(i, 1);
    applyPower(t, p.kind, now);
    addFx(s, 'pickup', p.x, p.y, now, t.playerId, p.kind);
  }
}

function applyPower(t: Tank, kind: TankPowerKind, now: number): void {
  if (kind === 'shield') {
    t.armorUntil = now + POWER.SHIELD_MS;
  } else if (kind === 'speed') {
    t.speedUntil = now + POWER.SPEED_MS;
  } else {
    // Un arma nueva reemplaza a la anterior; si es la misma, suma cargas.
    t.ammo = t.weapon === kind ? t.ammo + POWERUPS[kind].ammo : POWERUPS[kind].ammo;
    t.weapon = kind;
  }
}

/* ── disparos ─────────────────────────────────────────────────────────────── */

function fire(s: TqState, t: Tank, now: number): void {
  const weapon = t.weapon;
  if (!weapon) {
    // Bala común: con tope de balas propias en pantalla.
    const mine = s.bullets.filter((b) => b.owner === t.playerId && b.kind === 'normal').length;
    if (mine >= TANK.MAX_BULLETS) return;
    t.readyAt = now + TANK.COOLDOWN;
    if (shoot(s, t, t.ta, 'normal', TANK.BULLET_SPEED, TANK.BULLET_TTL, now)) addFx(s, 'shot', t.x, t.y, now, t.playerId);
    return;
  }

  let used = false;
  if (weapon === 'triple') {
    for (const off of [-POWER.TRIPLE_SPREAD, 0, POWER.TRIPLE_SPREAD]) {
      if (shoot(s, t, t.ta + off, 'normal', TANK.BULLET_SPEED, TANK.BULLET_TTL, now)) used = true;
    }
    if (used) addFx(s, 'shot', t.x, t.y, now, t.playerId);
  } else if (weapon === 'homing') {
    used = shoot(s, t, t.ta, 'missile', POWER.MISSILE_SPEED, POWER.MISSILE_TTL, now);
    if (used) addFx(s, 'missile', t.x, t.y, now, t.playerId);
  } else if (weapon === 'laser') {
    used = shoot(s, t, t.ta, 'laser', POWER.LASER_SPEED, POWER.LASER_TTL, now);
    if (used) addFx(s, 'laser', t.x, t.y, now, t.playerId);
  } else if (weapon === 'mine') {
    used = plantMine(s, t, now);
  }
  if (!used) return;
  t.readyAt = now + TANK.COOLDOWN * (weapon === 'laser' ? 1.6 : 1);
  t.ammo -= 1;
  if (t.ammo <= 0) {
    t.weapon = null;
    t.ammo = 0;
  }
}

/** Dispara desde el centro y recorre el caño con el paso de bala: si hay una pared pegada, rebota bien. */
function shoot(s: TqState, t: Tank, angle: number, kind: TankBullet['kind'], speed: number, ttl: number, now: number): boolean {
  const b: Bullet = {
    id: s.bulletSeq++,
    x: t.x,
    y: t.y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    owner: t.playerId,
    kind,
    bornAt: now,
    ttl,
    hit: kind === 'laser' ? new Set([t.playerId]) : undefined,
  };
  const barrel = TANK.TANK_R + 6;
  const step = 3 / speed;
  for (let d = 0; d < barrel; d += 3) stepShot(b, step, s.walls);
  if (kind !== 'laser' && circleHitsWall(b.x, b.y, TANK.BULLET_R, s.walls)) return false;
  s.bullets.push(b);
  return true;
}

function plantMine(s: TqState, t: Tank, now: number): boolean {
  if (s.mines.filter((m) => m.owner === t.playerId).length >= POWER.MINE_MAX) return false;
  // Detrás del tanque; si ahí hay pared, debajo del tanque.
  let x = t.x - Math.cos(t.a) * (TANK.TANK_R + 12);
  let y = t.y - Math.sin(t.a) * (TANK.TANK_R + 12);
  if (circleHitsWall(x, y, 8, s.walls)) {
    x = t.x;
    y = t.y;
  }
  s.mines.push({ id: s.bulletSeq++, x, y, owner: t.playerId, armedAt: now + POWER.MINE_ARM_MS, fuseAt: now + POWER.MINE_FUSE_MS });
  addFx(s, 'mine', x, y, now, t.playerId);
  return true;
}

function stepBullets(s: TqState, tanks: Tank[], dt: number, now: number): void {
  const steps = Math.max(1, Math.round(dt / TANK.BULLET_STEP));
  const sub = dt / steps;
  const dead = new Set<number>();

  for (const b of s.bullets) {
    if (now - b.bornAt > b.ttl || b.x < -40 || b.y < -40 || b.x > TANK_W + 40 || b.y > TANK_H + 40) {
      dead.add(b.id);
      continue;
    }
    // El misil busca al enemigo vivo más cercano (nunca al que lo tiró).
    const target = b.kind === 'missile' ? nearestEnemy(tanks, b, now) : null;

    let bounced = false;
    for (let k = 0; k < steps && !dead.has(b.id); k++) {
      if (target) steerToward(b, target.x, target.y, POWER.MISSILE_TURN, sub);
      if (stepShot(b, sub, s.walls)) bounced = true;

      for (const t of tanks) {
        if (!t.alive) continue;
        if (b.hit?.has(t.playerId)) continue;
        if (t.playerId === b.owner && now - b.bornAt < TANK.OWNER_GRACE) continue;
        const r = TANK.TANK_R + TANK.BULLET_R - 2;
        if ((t.x - b.x) ** 2 + (t.y - b.y) ** 2 > r * r) continue;
        // El rayo sigue de largo; lo demás se rompe contra el tanque.
        if (b.kind === 'laser') b.hit?.add(t.playerId);
        else dead.add(b.id);
        hit(s, t, b.owner, b.kind, now);
        if (b.kind !== 'laser') break;
      }

      // Una bala que toca una mina armada la hace volar.
      if (!dead.has(b.id) && b.kind !== 'laser') {
        const m = s.mines.find((mm) => now >= mm.armedAt && Math.hypot(mm.x - b.x, mm.y - b.y) < 12);
        if (m) {
          m.fuseAt = now;
          dead.add(b.id);
        }
      }
    }
    if (bounced && !dead.has(b.id)) addFx(s, 'bounce', b.x, b.y, now);
  }
  if (dead.size) s.bullets = s.bullets.filter((b) => !dead.has(b.id));
}

function nearestEnemy(tanks: Tank[], b: Bullet, now: number): Tank | null {
  let best: Tank | null = null;
  let bestD = Infinity;
  for (const t of tanks) {
    if (!t.alive || t.playerId === b.owner || now < t.shieldUntil) continue;
    const d = Math.hypot(t.x - b.x, t.y - b.y);
    if (d < bestD) {
      best = t;
      bestD = d;
    }
  }
  return best;
}

/* ── minas ────────────────────────────────────────────────────────────────── */

function stepMines(s: TqState, tanks: Tank[], now: number): void {
  if (!s.mines.length) return;
  // Pisadas por un enemigo: explotan ahora.
  for (const m of s.mines) {
    if (now < m.armedAt || m.fuseAt <= now) continue;
    for (const t of tanks) {
      if (!t.alive || t.playerId === m.owner) continue;
      if (Math.hypot(t.x - m.x, t.y - m.y) < POWER.MINE_TRIGGER_R) {
        m.fuseAt = now;
        break;
      }
    }
  }
  // Las que explotan pueden encadenar a otras (vuelan en el próximo tick).
  const boom = s.mines.filter((m) => now >= m.fuseAt);
  if (!boom.length) return;
  s.mines = s.mines.filter((m) => now < m.fuseAt);
  for (const m of boom) {
    addFx(s, 'blast', m.x, m.y, now, m.owner);
    for (const t of tanks) {
      if (t.alive && Math.hypot(t.x - m.x, t.y - m.y) < POWER.MINE_BLAST_R) hit(s, t, m.owner, 'mine', now);
    }
    for (const other of s.mines) {
      if (Math.hypot(other.x - m.x, other.y - m.y) < POWER.MINE_BLAST_R) other.fuseAt = Math.min(other.fuseAt, now + 120);
    }
  }
}

/* ── impactos ─────────────────────────────────────────────────────────────── */

/** Un impacto: lo frenan el escudo de reaparición o el de power-up; si no, muere. */
function hit(s: TqState, victim: Tank, killerId: string, how: KillHow, now: number): void {
  if (now < victim.shieldUntil) return;
  if (now < victim.armorUntil) {
    victim.armorUntil = 0;
    // Un respiro para que el mismo abanico o la misma explosión no lo mate igual.
    victim.shieldUntil = now + 250;
    addFx(s, 'armor', victim.x, victim.y, now, victim.playerId);
    return;
  }
  kill(s, victim, killerId, how, now);
}

function kill(s: TqState, victim: Tank, killerId: string, how: KillHow, now: number): void {
  victim.alive = false;
  victim.respawnAt = now + TANK.RESPAWN_MS;
  victim.weapon = null;
  victim.ammo = 0;
  victim.armorUntil = 0;
  victim.speedUntil = 0;
  addFx(s, 'boom', victim.x, victim.y, now, victim.playerId);

  const v = stats(s, victim.playerId);
  v.score -= 1;
  v.deaths += 1;
  if (killerId !== victim.playerId) {
    const k = stats(s, killerId);
    k.score += 1;
    k.kills += 1;
  }
  s.feed.unshift({ id: s.feedSeq++, killer: killerId, victim: victim.playerId, at: now, how });
  if (s.feed.length > FEED_MAX) s.feed.length = FEED_MAX;
}

function addFx(s: TqState, kind: TankFx['kind'], x: number, y: number, at: number, playerId?: string, power?: TankPowerKind): void {
  s.fx.push({ id: s.fxSeq++, kind, x: Math.round(x), y: Math.round(y), at, playerId, power });
  if (s.fx.length > 30) s.fx.shift();
}

function finish(ctx: GameContext, s: TqState): void {
  if (s.stage === 'done') return;
  s.stage = 'done';
  ctx.push();
  ctx.finish(
    ctx.players().map((p) => {
      const st = stats(s, p.id);
      return {
        playerId: p.id,
        value: st.score,
        label: `${st.score} pts · ${st.kills} K / ${st.deaths} M`,
      };
    }),
  );
}
