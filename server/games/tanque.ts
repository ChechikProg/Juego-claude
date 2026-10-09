import { TANK, TANK_H, TANK_W, buildMaze, cellCenter, circleHitsWall, pushOutOfWalls, stepBullet, type Wall } from '../../shared/tanque';
import type { TankBullet, TankFx, TankKill, TankPublic, TanqueView } from '../../shared/types';
import { rndInt } from '../util';
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
}

interface Bullet extends TankBullet {
  bornAt: number;
}

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
  },

  tick(ctx, s, _dtMs, now) {
    if (s.stage === 'countdown') {
      if (now >= s.until) {
        s.stage = 'live';
        s.until = s.endsAt;
        s.lastTick = now;
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

    /* ── tanques ── */
    for (const t of tanks) {
      if (!t.alive) {
        if (now >= t.respawnAt) {
          placeTank(s, t, now);
          addFx(s, 'spawn', t.x, t.y, now, t.playerId);
        }
        continue;
      }

      t.a += t.input.turn * TANK.TURN * dt;
      const speed = t.input.move >= 0 ? TANK.SPEED : TANK.SPEED * TANK.REVERSE;
      t.x += Math.cos(t.a) * t.input.move * speed * dt;
      t.y += Math.sin(t.a) * t.input.move * speed * dt;
      pushOutOfWalls(t, TANK.TANK_R, s.walls);
      t.x = Math.max(TANK.TANK_R, Math.min(TANK_W - TANK.TANK_R, t.x));
      t.y = Math.max(TANK.TANK_R, Math.min(TANK_H - TANK.TANK_R, t.y));
      if (!t.aimed) t.ta = t.a;

      if (t.fireQueued) {
        t.fireQueued = false;
        const mine = s.bullets.filter((b) => b.owner === t.playerId).length;
        if (now >= t.readyAt && mine < TANK.MAX_BULLETS) {
          t.readyAt = now + TANK.COOLDOWN;
          fire(s, t, now);
        }
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

    /* ── balas ── */
    const steps = Math.max(1, Math.round(dt / TANK.BULLET_STEP));
    const sub = dt / steps;
    const dead = new Set<number>();
    for (const b of s.bullets) {
      if (now - b.bornAt > TANK.BULLET_TTL) {
        dead.add(b.id);
        continue;
      }
      let bounced = false;
      for (let k = 0; k < steps && !dead.has(b.id); k++) {
        if (stepBullet(b, sub, s.walls)) bounced = true;
        for (const t of tanks) {
          if (!t.alive) continue;
          if (t.playerId === b.owner && now - b.bornAt < TANK.OWNER_GRACE) continue;
          const r = TANK.TANK_R + TANK.BULLET_R - 2;
          if ((t.x - b.x) ** 2 + (t.y - b.y) ** 2 > r * r) continue;
          dead.add(b.id);
          if (now < t.shieldUntil) break;
          kill(s, t, b.owner, now);
          break;
        }
      }
      if (bounced && !dead.has(b.id)) addFx(s, 'bounce', b.x, b.y, now);
    }
    if (dead.size) s.bullets = s.bullets.filter((b) => !dead.has(b.id));

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
      })),
      fx: s.fx,
      feed: s.feed,
    };
  },
};

/** Dispara desde el centro y recorre el caño con el paso de bala: si hay una pared pegada, rebota bien. */
function fire(s: TqState, t: Tank, now: number): void {
  const b: Bullet = {
    id: s.bulletSeq++,
    x: t.x,
    y: t.y,
    vx: Math.cos(t.ta) * TANK.BULLET_SPEED,
    vy: Math.sin(t.ta) * TANK.BULLET_SPEED,
    owner: t.playerId,
    bornAt: now,
  };
  const barrel = TANK.TANK_R + 6;
  const step = 3 / TANK.BULLET_SPEED;
  for (let d = 0; d < barrel; d += 3) stepBullet(b, step, s.walls);
  if (circleHitsWall(b.x, b.y, TANK.BULLET_R, s.walls)) return;
  s.bullets.push(b);
  addFx(s, 'shot', b.x, b.y, now, t.playerId);
}

function kill(s: TqState, victim: Tank, killerId: string, now: number): void {
  victim.alive = false;
  victim.respawnAt = now + TANK.RESPAWN_MS;
  addFx(s, 'boom', victim.x, victim.y, now, victim.playerId);

  const v = stats(s, victim.playerId);
  v.score -= 1;
  v.deaths += 1;
  if (killerId !== victim.playerId) {
    const k = stats(s, killerId);
    k.score += 1;
    k.kills += 1;
  }
  s.feed.unshift({ id: s.feedSeq++, killer: killerId, victim: victim.playerId, at: now });
  if (s.feed.length > FEED_MAX) s.feed.length = FEED_MAX;
}

function addFx(s: TqState, kind: TankFx['kind'], x: number, y: number, at: number, playerId?: string): void {
  s.fx.push({ id: s.fxSeq++, kind, x: Math.round(x), y: Math.round(y), at, playerId });
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
