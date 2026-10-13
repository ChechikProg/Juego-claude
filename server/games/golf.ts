import { GOLF, GOLF_HOLES, pickCourse, stepBall } from '../../shared/golf';
import type { GolfBall, GolfFx, GolfView } from '../../shared/types';
import { rnd } from '../util';
import type { GameContext, GameModule } from './kit';

const FX_TTL = 1500;
/** si la pelota anda arrastrándose sin frenar (contra una pared en pendiente), se la frena */
const CRAWL_SPEED = 26;
const CRAWL_MS = 1200;
/** después de un chapuzón la pelota vuelve donde estaba, quietita */
const SPLASH_MS = 700;

interface Ball {
  playerId: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  strokes: number;
  done: boolean;
  holed: boolean;
  holedAt: number | null;
  /** desde dónde tiró por última vez (para el agua) */
  lastX: number;
  lastY: number;
  slowSince: number | null;
  /** quieta hasta acá (después del agua) */
  frozenUntil: number;
}

interface GState {
  stage: 'countdown' | 'live' | 'holeEnd' | 'done';
  course: number[];
  hole: number;
  until: number;
  clock0: number;
  balls: Map<string, Ball>;
  totals: Map<string, number>;
  card: Map<string, number[]>;
  fx: GolfFx[];
  seq: number;
  lastTick: number;
  holeResults: GolfView['holeResults'];
}

export const golf: GameModule<GState> = {
  id: 'golf',
  tickHz: GOLF.TICK_HZ,

  create(ctx) {
    const n = Math.max(3, Math.min(GOLF_HOLES.length, ctx.config.golfHoles || 6));
    return {
      stage: 'countdown',
      course: pickCourse(n, rnd),
      hole: -1,
      until: 0,
      clock0: 0,
      balls: new Map(),
      totals: new Map(ctx.players().map((p) => [p.id, 0])),
      card: new Map(ctx.players().map((p) => [p.id, []])),
      fx: [],
      seq: 1,
      lastTick: 0,
      holeResults: null,
    };
  },

  start(ctx, s) {
    startHole(ctx, s);
  },

  event(ctx, s, playerId, type, data) {
    if (type !== 'shot' || s.stage !== 'live') return;
    const b = s.balls.get(playerId);
    if (!b || b.done || b.vx !== 0 || b.vy !== 0) return;
    const now = ctx.now();
    if (now < b.frozenUntil) return;
    const d = (data ?? {}) as { a?: unknown; p?: unknown };
    const a = Number(d.a);
    const p = Number(d.p);
    if (!Number.isFinite(a) || !Number.isFinite(p)) return;
    const power = Math.max(0.04, Math.min(1, p));
    const speed = GOLF.MAX_SHOT * power;
    b.lastX = b.x;
    b.lastY = b.y;
    b.vx = Math.cos(a) * speed;
    b.vy = Math.sin(a) * speed;
    b.strokes += 1;
    b.slowSince = null;
    addFx(s, 'shot', b.x, b.y, now, playerId, power);
    ctx.push();
  },

  tick(ctx, s, _dt, now) {
    if (s.stage === 'countdown') {
      if (now >= s.until) {
        s.stage = 'live';
        s.clock0 = now;
        s.until = now + GOLF.HOLE_MS;
        s.lastTick = now;
        ctx.push();
      }
      return;
    }
    if (s.stage === 'holeEnd') {
      if (now >= s.until) {
        if (s.hole + 1 >= s.course.length) finish(ctx, s);
        else startHole(ctx, s);
      }
      return;
    }
    if (s.stage !== 'live') return;

    const dt = Math.min(0.05, (now - s.lastTick) / 1000);
    const t = s.lastTick - s.clock0;
    s.lastTick = now;
    const index = s.course[s.hole];
    const def = GOLF_HOLES[index];

    for (const b of s.balls.values()) {
      if (b.done || (b.vx === 0 && b.vy === 0)) continue;
      const ev = stepBall(b, index, dt, t);
      if (ev === 'cup') {
        b.holed = true;
        b.done = true;
        b.holedAt = now;
        addFx(s, 'sink', def.cup[0], def.cup[1], now, b.playerId);
        const name = ctx.player(b.playerId)?.name;
        if (name && b.strokes === 1) ctx.toast(null, `🎯 ¡${name} hizo hoyo en uno!`, 'good');
        continue;
      }
      if (ev === 'water') {
        addFx(s, 'water', b.x, b.y, now, b.playerId);
        b.x = b.lastX;
        b.y = b.lastY;
        b.vx = 0;
        b.vy = 0;
        b.strokes += 1;
        b.frozenUntil = now + SPLASH_MS;
      } else if (ev === 'bumper' || ev === 'wall' || ev === 'warp' || ev === 'boost') {
        addFx(s, ev, b.x, b.y, now, b.playerId);
      }
      // Por si se coló por una rendija: vuelve a donde tiró.
      if (b.x < -20 || b.y < -20 || b.x > GOLF.W + 20 || b.y > GOLF.H + 20) {
        b.x = b.lastX;
        b.y = b.lastY;
        b.vx = 0;
        b.vy = 0;
      }
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > 0 && sp < CRAWL_SPEED) {
        if (b.slowSince === null) b.slowSince = now;
        else if (now - b.slowSince > CRAWL_MS) {
          b.vx = 0;
          b.vy = 0;
        }
      } else {
        b.slowSince = null;
      }
      // Se le acabaron los golpes y la pelota ya está quieta.
      if (b.vx === 0 && b.vy === 0 && b.strokes >= def.max) {
        b.done = true;
        b.strokes = def.max;
        addFx(s, 'max', b.x, b.y, now, b.playerId);
      }
    }

    if (s.fx.length && now - s.fx[0].at > FX_TTL) s.fx = s.fx.filter((f) => now - f.at <= FX_TTL);

    // Termina cuando se acaba el tiempo o cuando todos los conectados terminaron.
    const pending = [...s.balls.values()].filter((b) => !b.done && ctx.player(b.playerId)?.connected);
    if (now >= s.until || pending.length === 0) {
      endHole(ctx, s, now);
      return;
    }
    ctx.push();
  },

  view(ctx, s): GolfView {
    const balls: GolfBall[] = [...s.balls.values()].map((b) => ({
      playerId: b.playerId,
      x: Math.round(b.x * 10) / 10,
      y: Math.round(b.y * 10) / 10,
      vx: Math.round(b.vx * 10) / 10,
      vy: Math.round(b.vy * 10) / 10,
      moving: b.vx !== 0 || b.vy !== 0,
      strokes: b.strokes,
      done: b.done,
      holed: b.holed,
      holedAt: b.holedAt,
    }));
    return {
      stage: s.stage,
      hole: s.hole + 1,
      totalHoles: s.course.length,
      course: s.course[Math.max(0, s.hole)],
      t: ctx.now(),
      until: s.until,
      clock0: s.clock0,
      balls,
      totals: Object.fromEntries(s.totals),
      card: Object.fromEntries(s.card),
      courses: s.course,
      fx: s.fx,
      holeResults: s.holeResults,
    };
  },
};

function startHole(ctx: GameContext, s: GState): void {
  s.hole += 1;
  const def = GOLF_HOLES[s.course[s.hole]];
  s.balls = new Map();
  for (const p of ctx.players()) {
    s.balls.set(p.id, {
      playerId: p.id,
      x: def.start[0],
      y: def.start[1],
      vx: 0,
      vy: 0,
      strokes: 0,
      done: false,
      holed: false,
      holedAt: null,
      lastX: def.start[0],
      lastY: def.start[1],
      slowSince: null,
      frozenUntil: 0,
    });
    if (!s.totals.has(p.id)) s.totals.set(p.id, 0);
    if (!s.card.has(p.id)) s.card.set(p.id, []);
  }
  s.fx = [];
  s.holeResults = null;
  s.stage = 'countdown';
  s.until = ctx.now() + (s.hole === 0 ? GOLF.COUNTDOWN_MS : GOLF.COUNTDOWN_MS - 500);
  s.clock0 = s.until;
  ctx.push();
}

function endHole(ctx: GameContext, s: GState, now: number): void {
  const def = GOLF_HOLES[s.course[s.hole]];
  for (const b of s.balls.values()) {
    if (!b.done) {
      // No la metió a tiempo: le anotan el máximo.
      b.done = true;
      b.strokes = def.max;
      b.vx = 0;
      b.vy = 0;
      addFx(s, 'timeout', b.x, b.y, now, b.playerId);
    }
    s.totals.set(b.playerId, (s.totals.get(b.playerId) ?? 0) + b.strokes);
    const card = s.card.get(b.playerId) ?? [];
    card[s.hole] = b.strokes;
    s.card.set(b.playerId, card);
  }
  s.holeResults = [...s.balls.values()]
    .map((b) => ({ playerId: b.playerId, strokes: b.strokes, holed: b.holed }))
    .sort((a, b) => a.strokes - b.strokes);
  s.stage = 'holeEnd';
  s.until = now + GOLF.HOLE_END_MS;
  ctx.push();
}

function finish(ctx: GameContext, s: GState): void {
  if (s.stage === 'done') return;
  s.stage = 'done';
  ctx.push();
  ctx.finish(
    ctx.players().map((p) => {
      // Si entró a mitad de camino, los hoyos que no jugó cuentan como el máximo.
      const card = s.card.get(p.id) ?? [];
      let total = 0;
      s.course.forEach((idx, i) => {
        total += card[i] ?? GOLF_HOLES[idx].max;
      });
      return { playerId: p.id, value: -total, label: `${total} golpes` };
    }),
  );
}

function addFx(s: GState, kind: GolfFx['kind'], x: number, y: number, at: number, playerId: string, power?: number): void {
  s.fx.push({ id: s.seq++, kind, x: Math.round(x), y: Math.round(y), at, playerId, power });
  if (s.fx.length > 40) s.fx.shift();
}
