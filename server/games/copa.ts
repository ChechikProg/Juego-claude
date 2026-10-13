import {
  COPA, PRACTICE_GOAL, angleDiff, effectiveHalf, formation, goalPosts, layoutGoals,
} from '../../shared/copa';
import type { CopaFx, CopaGoal, CopaPlayer, CopaView } from '../../shared/types';
import { shuffle } from '../util';
import type { GameContext, GameModule } from './kit';

const FX_TTL = 900;

interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  m: number;
}

interface Puck extends Body {
  owner: string;
  i: number;
}

interface CopaState {
  stage: 'countdown' | 'live' | 'goal' | 'roundEnd' | 'done';
  round: number;
  totalRounds: number;
  until: number;
  solo: boolean;
  goals: CopaGoal[];
  pucks: Puck[];
  ball: Body;
  players: Map<string, CopaPlayer>;
  /** quiénes arrancaron la ronda, en orden de asiento */
  roster: string[];
  outCount: number;
  lastTouch: { playerId: string; at: number } | null;
  lastGoal: CopaView['lastGoal'];
  /** desde cuándo se juega sin goles (para agrandar los arcos) */
  calmSince: number;
  roundStartedAt: number;
  soloGoals: number;
  totals: Map<string, number>;
  roundPoints: Map<string, number>;
  roundGoals: Map<string, number>;
  roundSummary: CopaView['roundSummary'];
  fx: CopaFx[];
  fxSeq: number;
  /** throttle de efectos de choque para no inundar el snapshot */
  lastClackAt: number;
  lastTick: number;
}

function newBall(): Body {
  return { x: 0, y: 0, vx: 0, vy: 0, r: COPA.BALL_R, m: COPA.BALL_M };
}

function addPoints(s: CopaState, id: string, pts: number): void {
  if (!pts) return;
  s.totals.set(id, (s.totals.get(id) ?? 0) + pts);
  s.roundPoints.set(id, (s.roundPoints.get(id) ?? 0) + pts);
}

export const copa: GameModule<CopaState> = {
  id: 'copa',
  tickHz: COPA.TICK_HZ,

  create(ctx) {
    const all = ctx.players();
    return {
      stage: 'countdown',
      round: 0,
      totalRounds: Math.max(1, Math.min(5, ctx.config.copaRounds || 2)),
      until: 0,
      solo: all.length <= 1,
      goals: [],
      pucks: [],
      ball: newBall(),
      players: new Map(),
      roster: [],
      outCount: 0,
      lastTouch: null,
      lastGoal: null,
      calmSince: 0,
      roundStartedAt: 0,
      soloGoals: 0,
      totals: new Map(all.map((p) => [p.id, 0] as const)),
      roundPoints: new Map(),
      roundGoals: new Map(),
      roundSummary: null,
      fx: [],
      fxSeq: 1,
      lastClackAt: 0,
      lastTick: 0,
    };
  },

  start(ctx, s) {
    startRound(ctx, s);
  },

  event(ctx, s, playerId, type, data) {
    if (type !== 'flick' || s.stage !== 'live') return;
    const pl = s.players.get(playerId);
    if (!pl || !pl.alive) return;
    const now = ctx.now();
    // Un poquito de tolerancia por la diferencia de reloj con el cliente.
    if (now < pl.readyAt - 80) return;

    const d = (data ?? {}) as { i?: unknown; dx?: unknown; dy?: unknown };
    const i = Math.round(Number(d.i));
    const dx = Number(d.dx);
    const dy = Number(d.dy);
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    const puck = s.pucks.find((p) => p.owner === playerId && p.i === i);
    if (!puck) return;

    const len = Math.hypot(dx, dy);
    if (len < COPA.DRAG_MIN) return;
    const power = Math.min(1, len / COPA.DRAG_MAX);
    const speed = COPA.MAX_FLICK * (0.12 + 0.88 * power);
    puck.vx = (dx / len) * speed;
    puck.vy = (dy / len) * speed;
    pl.readyAt = now + COPA.COOLDOWN;
    addFx(s, 'flick', puck.x, puck.y, now, power, playerId);
    ctx.push();
  },

  tick(ctx, s, _dt, now) {
    if (s.stage === 'countdown') {
      if (now >= s.until) {
        s.stage = 'live';
        s.lastTick = now;
        s.calmSince = now;
        s.roundStartedAt = s.roundStartedAt || now;
        ctx.push();
      }
      return;
    }

    const dt = Math.min(0.05, (now - s.lastTick) / 1000);
    s.lastTick = now;
    if (dt <= 0) return;

    if (s.stage === 'goal') {
      // Festejo: las fichas terminan de deslizarse, la pelota queda en la red.
      simulate(s, dt, now, false);
      if (now >= s.until) afterGoal(ctx, s, now);
      else ctx.push();
      return;
    }

    if (s.stage !== 'live') return;

    const scored = simulate(s, dt, now, true);
    if (scored) {
      onGoal(ctx, s, scored, now);
      return;
    }

    const elapsed = now - s.roundStartedAt;
    if (s.solo ? elapsed >= COPA.SOLO_MS : elapsed >= COPA.ROUND_MAX_MS) {
      endRound(ctx, s, now);
      return;
    }

    if (s.fx.length && now - s.fx[0].at > FX_TTL) s.fx = s.fx.filter((f) => now - f.at <= FX_TTL);
    ctx.push();
  },

  leave(ctx, s, playerId) {
    const pl = s.players.get(playerId);
    if (!pl?.alive || s.solo) return;
    if (s.stage === 'roundEnd' || s.stage === 'done') return;
    // El que se va queda afuera de la ronda: se le saca el arco y las fichas.
    eliminate(s, playerId);
    s.goals = s.goals.filter((g) => g.playerId !== playerId);
    s.pucks = s.pucks.filter((p) => p.owner !== playerId);
    ctx.toast(null, `${ctx.player(playerId)?.name ?? 'Alguien'} se fue de la cancha`, 'info');
    if (aliveIds(s).length <= 1) endRound(ctx, s, ctx.now());
    else ctx.push();
  },

  view(ctx, s): CopaView {
    const r1 = (n: number) => Math.round(n * 10) / 10;
    return {
      stage: s.stage,
      round: s.round,
      totalRounds: s.totalRounds,
      t: ctx.now(),
      until: s.until,
      goals: s.goals,
      pucks: s.pucks.map((p) => ({ owner: p.owner, i: p.i, x: r1(p.x), y: r1(p.y), vx: r1(p.vx), vy: r1(p.vy) })),
      ball: { x: r1(s.ball.x), y: r1(s.ball.y), vx: r1(s.ball.vx), vy: r1(s.ball.vy) },
      players: [...s.players.values()],
      lastGoal: s.lastGoal,
      totals: Object.fromEntries(s.totals),
      roundSummary: s.roundSummary,
      fx: s.fx,
      widen: Math.round(widen(s, ctx.now()) * 1000) / 1000,
      solo: s.solo,
    };
  },
};

/* ── ciclo de rondas ──────────────────────────────────────────────────────── */

function aliveIds(s: CopaState): string[] {
  return s.roster.filter((id) => s.players.get(id)?.alive);
}

function widen(s: CopaState, now: number): number {
  if (s.stage !== 'live') return s.stage === 'goal' ? widenAt(s, s.lastGoal?.at ?? now) : 1;
  return widenAt(s, now);
}

function widenAt(s: CopaState, now: number): number {
  const calm = now - s.calmSince - COPA.WIDEN_AFTER;
  if (calm <= 0) return 1;
  return Math.min(COPA.WIDEN_MAX, 1 + (calm / 1000) * COPA.WIDEN_RATE);
}

function startRound(ctx: GameContext, s: CopaState): void {
  s.round += 1;
  const roster = ctx.players().filter((p) => p.connected);
  const list = (roster.length ? roster : ctx.players()).map((p) => p.id);
  s.roster = shuffle(list);
  s.solo = s.roster.length <= 1;
  s.players = new Map(
    s.roster.map((id) => [id, { playerId: id, alive: true, readyAt: 0, goals: 0, place: null }] as const),
  );
  // Los goles del minijuego se arrastran entre rondas para la tabla.
  for (const [id, g] of s.roundGoals) {
    const pl = s.players.get(id);
    if (pl) pl.goals = g;
  }
  s.outCount = 0;
  s.soloGoals = 0;
  s.roundPoints = new Map();
  s.roundSummary = null;
  s.lastGoal = null;
  s.roundStartedAt = 0;
  resetPositions(s);
  s.stage = 'countdown';
  s.until = ctx.now() + (s.round === 1 ? COPA.FIRST_COUNTDOWN_MS : COPA.COUNTDOWN_MS);
  ctx.push();
}

/** Arcos repartidos entre los que siguen, fichas en formación y pelota al medio. */
function resetPositions(s: CopaState): void {
  const alive = aliveIds(s);
  const ids = s.solo ? [...alive, PRACTICE_GOAL] : alive;
  s.goals = layoutGoals(ids);
  const n = ids.length;
  s.pucks = [];
  for (const goal of s.goals) {
    if (goal.playerId === PRACTICE_GOAL) continue;
    formation(goal, n).forEach((p, i) => {
      s.pucks.push({ owner: goal.playerId, i, x: p.x, y: p.y, vx: 0, vy: 0, r: COPA.PUCK_R, m: COPA.PUCK_M });
    });
  }
  s.ball = newBall();
  s.lastTouch = null;
  s.fx = [];
  for (const pl of s.players.values()) pl.readyAt = 0;
}

function eliminate(s: CopaState, victim: string): void {
  const pl = s.players.get(victim);
  if (!pl || !pl.alive) return;
  pl.alive = false;
  pl.place = aliveIds(s).length + 1;
  // Cada rival que ya había caído antes vale puntos.
  addPoints(s, victim, COPA.SURVIVE_PTS * s.outCount);
  s.outCount += 1;
}

function onGoal(ctx: GameContext, s: CopaState, goal: CopaGoal, now: number): void {
  const touch = s.lastTouch && now - s.lastTouch.at <= COPA.TOUCH_TTL ? s.lastTouch.playerId : null;

  if (goal.playerId === PRACTICE_GOAL) {
    s.soloGoals += 1;
    if (touch) scoreGoal(s, touch);
    s.lastGoal = { victim: PRACTICE_GOAL, scorer: touch, own: false, at: now };
  } else {
    const victim = goal.playerId;
    const own = !touch || touch === victim;
    if (!own && touch) scoreGoal(s, touch);
    s.lastGoal = { victim, scorer: own ? null : touch, own, at: now };
    if (!s.solo) eliminate(s, victim);
  }

  s.ball.vx *= 0.15;
  s.ball.vy *= 0.15;
  s.stage = 'goal';
  s.until = now + COPA.GOAL_MS;
  ctx.push();
}

function scoreGoal(s: CopaState, id: string): void {
  addPoints(s, id, COPA.GOAL_BONUS);
  s.roundGoals.set(id, (s.roundGoals.get(id) ?? 0) + 1);
  const pl = s.players.get(id);
  if (pl) pl.goals += 1;
}

function afterGoal(ctx: GameContext, s: CopaState, now: number): void {
  const done = s.solo ? s.soloGoals >= COPA.SOLO_GOALS : aliveIds(s).length <= 1;
  if (done) {
    endRound(ctx, s, now);
    return;
  }
  resetPositions(s);
  s.stage = 'countdown';
  s.until = now + COPA.COUNTDOWN_MS;
  ctx.push();
}

function endRound(ctx: GameContext, s: CopaState, now: number): void {
  if (s.stage === 'roundEnd' || s.stage === 'done') return;
  // Los que siguen en pie comparten el primer puesto y cobran por todos los caídos.
  for (const id of aliveIds(s)) {
    const pl = s.players.get(id)!;
    pl.place = 1;
    if (!s.solo) addPoints(s, id, COPA.SURVIVE_PTS * s.outCount);
  }
  s.roundSummary = s.roster
    .map((id) => ({
      playerId: id,
      place: s.players.get(id)?.place ?? s.roster.length,
      points: s.roundPoints.get(id) ?? 0,
      goals: s.players.get(id)?.goals ?? 0,
    }))
    .sort((a, b) => a.place - b.place || b.points - a.points);
  s.stage = 'roundEnd';
  s.until = now + COPA.ROUND_END_MS;
  ctx.push();

  ctx.timers.after(COPA.ROUND_END_MS, () => {
    if (s.round >= s.totalRounds) {
      s.stage = 'done';
      ctx.push();
      ctx.finish(
        ctx.players().map((p) => {
          const total = s.totals.get(p.id) ?? 0;
          const goals = s.roundGoals.get(p.id) ?? 0;
          return { playerId: p.id, value: total, label: `${total} pts · ${goals} ⚽` };
        }),
      );
    } else {
      startRound(ctx, s);
    }
  });
}

/* ── física ───────────────────────────────────────────────────────────────── */

function addFx(s: CopaState, kind: CopaFx['kind'], x: number, y: number, at: number, power: number, playerId?: string): void {
  s.fx.push({ id: s.fxSeq++, kind, x: Math.round(x), y: Math.round(y), at, power: Math.round(power * 100) / 100, playerId });
  if (s.fx.length > 24) s.fx.shift();
}

function damp(b: Body, damping: number, friction: number, dt: number): void {
  const sp = Math.hypot(b.vx, b.vy);
  if (sp < 0.5) {
    b.vx = 0;
    b.vy = 0;
    return;
  }
  const next = Math.max(0, sp * Math.exp(-damping * dt) - friction * dt);
  const k = next / sp;
  b.vx *= k;
  b.vy *= k;
}

/** Choque elástico entre dos cuerpos. Devuelve la velocidad de impacto (0 si no chocaron). */
function collide(a: Body, b: Body, e: number): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const min = a.r + b.r;
  const d2 = dx * dx + dy * dy;
  if (d2 >= min * min) return 0;
  const d = Math.sqrt(d2) || 0.001;
  const nx = dx / d;
  const ny = dy / d;
  const ia = 1 / a.m;
  const ib = 1 / b.m;
  // Los separamos según la masa.
  const overlap = min - d;
  a.x -= nx * overlap * (ia / (ia + ib));
  a.y -= ny * overlap * (ia / (ia + ib));
  b.x += nx * overlap * (ib / (ia + ib));
  b.y += ny * overlap * (ib / (ia + ib));
  const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (vn >= 0) return 0;
  const j = (-(1 + e) * vn) / (ia + ib);
  a.vx -= j * ia * nx;
  a.vy -= j * ia * ny;
  b.vx += j * ib * nx;
  b.vy += j * ib * ny;
  return -vn;
}

/** Choque contra un palo (círculo fijo). */
function collidePost(b: Body, px: number, py: number): number {
  const dx = b.x - px;
  const dy = b.y - py;
  const min = b.r + COPA.POST_R;
  const d2 = dx * dx + dy * dy;
  if (d2 >= min * min) return 0;
  const d = Math.sqrt(d2) || 0.001;
  const nx = dx / d;
  const ny = dy / d;
  b.x = px + nx * min;
  b.y = py + ny * min;
  const vn = b.vx * nx + b.vy * ny;
  if (vn >= 0) return 0;
  b.vx -= (1 + COPA.POST_E) * vn * nx;
  b.vy -= (1 + COPA.POST_E) * vn * ny;
  return -vn;
}

/**
 * Avanza la simulación. Si `goals` está activo y la pelota entra en un arco,
 * devuelve ese arco.
 */
function simulate(s: CopaState, dt: number, now: number, goals: boolean): CopaGoal | null {
  const steps = COPA.SUBSTEPS;
  const h = dt / steps;
  const ball = s.ball;
  const ballFrozen = s.stage === 'goal';
  const w = widen(s, now);
  const n = s.goals.length;
  const spans = s.goals.map((g) => ({ goal: g, half: effectiveHalf(g, w, n) }));
  const posts = spans.flatMap(({ goal, half }) => goalPosts(goal, half));
  const bodies: Body[] = ballFrozen ? [...s.pucks] : [...s.pucks, ball];

  for (let k = 0; k < steps; k++) {
    for (const b of bodies) {
      b.x += b.vx * h;
      b.y += b.vy * h;
    }

    // Choques entre cuerpos.
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i];
        const b = bodies[j];
        const hit = collide(a, b, COPA.HIT_E);
        if (hit <= 0) continue;
        if (b === ball || a === ball) {
          const puck = (a === ball ? b : a) as Puck;
          s.lastTouch = { playerId: puck.owner, at: now };
          if (hit > 60) addFx(s, 'kick', ball.x, ball.y, now, Math.min(1, hit / 1100), puck.owner);
        } else if (hit > 140 && now - s.lastClackAt > 70) {
          s.lastClackAt = now;
          addFx(s, 'clack', (a.x + b.x) / 2, (a.y + b.y) / 2, now, Math.min(1, hit / 1100));
        }
      }
    }

    // Palos.
    for (const b of bodies) {
      for (const p of posts) {
        const hit = collidePost(b, p.x, p.y);
        if (hit > 120 && b === ball) addFx(s, 'post', p.x, p.y, now, Math.min(1, hit / 1000));
      }
    }

    // Borde de la cancha: la pelota puede entrar por un arco, las fichas nunca.
    for (const b of bodies) {
      const d = Math.hypot(b.x, b.y);
      if (d <= COPA.R - b.r) continue;
      if (b === ball) {
        const ang = Math.atan2(b.y, b.x);
        const mouth = spans.find(({ goal, half }) => Math.abs(angleDiff(ang, goal.a)) < half - 0.004);
        if (mouth) {
          if (goals && d > COPA.R + b.r * 0.9) return mouth.goal;
          continue;
        }
      }
      const nx = b.x / d;
      const ny = b.y / d;
      b.x = nx * (COPA.R - b.r);
      b.y = ny * (COPA.R - b.r);
      const vn = b.vx * nx + b.vy * ny;
      if (vn > 0) {
        b.vx -= (1 + COPA.WALL_E) * vn * nx;
        b.vy -= (1 + COPA.WALL_E) * vn * ny;
        if (b === ball && vn > 220) addFx(s, 'wall', b.x, b.y, now, Math.min(1, vn / 1100));
      }
    }
  }

  for (const p of s.pucks) damp(p, COPA.PUCK_DAMP, COPA.PUCK_FRICTION, dt);
  if (!ballFrozen) {
    damp(ball, COPA.BALL_DAMP, COPA.BALL_FRICTION, dt);
    const sp = Math.hypot(ball.vx, ball.vy);
    if (sp > COPA.BALL_MAX) {
      ball.vx *= COPA.BALL_MAX / sp;
      ball.vy *= COPA.BALL_MAX / sp;
    }
  } else {
    damp(ball, 6, 200, dt);
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
  }
  return null;
}
