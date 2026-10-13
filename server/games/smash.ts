import { SMASH } from '../../shared/constants';
import type { SeatState, SmashFx, SmashSeat, SmashView } from '../../shared/types';
import { rnd, shuffle } from '../util';
import type { GameContext, GameModule } from './kit';

const TAU = Math.PI * 2;
/** tope de compensación de latencia, en ms */
const MAX_LAG_COMP = 130;
const FX_TTL = 900;

interface Seat {
  playerId: string;
  angle: number;
  alive: boolean;
  state: SeatState;
  /** fin del estado visual actual */
  until: number;
  /** ventana efectiva de la acción, ya compensada por latencia */
  guardFrom: number;
  guardUntil: number;
  /** 'crouch' | 'swing' — qué acción abrió la ventana */
  guardKind: 'crouch' | 'swing' | null;
  /** no puede volver a accionar hasta acá */
  cooldownUntil: number;
  /** la pelota lo tocó: se resuelve al vencer la gracia salvo que llegue un input */
  doomedAt: number | null;
  doomDeadline: number;
  hits: number;
  dodges: number;
  outOrder: number | null;
}

interface SmashState {
  stage: 'countdown' | 'live' | 'roundEnd' | 'done';
  round: number;
  totalRounds: number;
  until: number;
  /** hasta acá la pelota queda quieta en el saque */
  serveUntil: number;
  angle: number;
  omega: number;
  rally: number;
  seats: Seat[];
  outCount: number;
  totals: Map<string, number>;
  lastRound: { playerId: string; place: number; points: number }[] | null;
  fx: SmashFx[];
  fxSeq: number;
  lastTick: number;
}

function norm(a: number): number {
  const r = a % TAU;
  return r < 0 ? r + TAU : r;
}

export const smash: GameModule<SmashState> = {
  id: 'smash',
  tickHz: 60,

  create(ctx) {
    return {
      stage: 'countdown',
      round: 0,
      totalRounds: Math.max(1, Math.min(9, ctx.config.smashRounds || 3)),
      until: 0,
      serveUntil: 0,
      angle: 0,
      omega: SMASH.START_OMEGA,
      rally: 0,
      seats: [],
      outCount: 0,
      totals: new Map(ctx.players().map((p) => [p.id, 0] as const)),
      lastRound: null,
      fx: [],
      fxSeq: 1,
      lastTick: 0,
    };
  },

  start(ctx, s) {
    startRound(ctx, s);
  },

  event(ctx, s, playerId, type, _data) {
    if (s.stage !== 'live') return;
    if (type !== 'hit' && type !== 'crouch') return;

    const seat = s.seats.find((x) => x.playerId === playerId);
    if (!seat || !seat.alive) return;

    const t = ctx.now();
    if (t < seat.cooldownUntil) return;

    const lag = Math.min(MAX_LAG_COMP, Math.max(0, (ctx.player(playerId)?.rtt ?? 0) / 2));
    const from = t - lag;
    const active = type === 'crouch' ? SMASH.CROUCH_ACTIVE : SMASH.SWING_ACTIVE;
    const recover = type === 'crouch' ? SMASH.CROUCH_RECOVER : SMASH.SWING_RECOVER;

    seat.guardKind = type === 'crouch' ? 'crouch' : 'swing';
    seat.guardFrom = from;
    seat.guardUntil = from + active;
    seat.state = type === 'crouch' ? 'crouch' : 'swing';
    seat.until = t + active;
    seat.cooldownUntil = seat.guardUntil + recover;

    // Rescate por latencia: la pelota lo tocó dentro de la ventana efectiva.
    if (seat.doomedAt !== null && seat.doomedAt >= from && seat.doomedAt <= seat.guardUntil) {
      const at = seat.doomedAt;
      seat.doomedAt = null;
      if (type === 'hit') {
        // Un raquetazo a tiempo devuelve la pelota: antes sólo se perdonaba la
        // eliminación y la pelota "atravesaba" la paleta.
        returnBall(s, seat, at, t);
      } else {
        seat.dodges += 1;
        addFx(s, 'dodge', seat, t);
      }
    }
    ctx.push();
  },

  tick(ctx, s, _dt, t) {
    if (s.stage === 'countdown') {
      if (t >= s.until) {
        s.stage = 'live';
        s.lastTick = t;
        ctx.push();
      }
      return;
    }
    if (s.stage !== 'live') return;

    const dt = Math.min(0.1, (t - s.lastTick) / 1000);
    s.lastTick = t;
    if (dt <= 0) return;

    // Estados de los jugadores
    for (const seat of s.seats) {
      if (!seat.alive) continue;
      if ((seat.state === 'crouch' || seat.state === 'swing') && t >= seat.until) {
        seat.state = 'recover';
        seat.until = seat.cooldownUntil;
      } else if (seat.state === 'recover' && t >= seat.until) {
        seat.state = 'idle';
        seat.guardKind = null;
      }
    }

    // Saque: la pelota queda quieta un ratito marcando para dónde va.
    if (t < s.serveUntil) {
      ctx.push();
      return;
    }

    // La velocidad sube sola: ninguna ronda es eterna. Después del saque arranca
    // despacio y llega a la velocidad normal en SERVE_RAMP_MS.
    const dir = Math.sign(s.omega) || 1;
    let speed = Math.abs(s.omega) * (1 + SMASH.RAMP * dt);
    if (s.rally === 0 && speed < SMASH.START_OMEGA) {
      const rampPerSec = (SMASH.START_OMEGA * (1 - SMASH.SERVE_START)) / (SMASH.SERVE_RAMP_MS / 1000);
      speed = Math.min(SMASH.START_OMEGA, speed + rampPerSec * dt);
    }
    s.omega = Math.min(SMASH.MAX_OMEGA, speed) * dir;

    const delta = s.omega * dt;
    const a0 = s.angle;
    const a1 = norm(a0 + delta);

    // Como el paso angular es menor a la separación entre asientos, a lo sumo
    // se cruza un jugador por tick.
    let crossed: { seat: Seat; at: number } | null = null;
    for (const seat of s.seats) {
      if (!seat.alive || seat.doomedAt !== null) continue;
      const u = delta > 0 ? norm(seat.angle - a0) : norm(a0 - seat.angle);
      if (u > 0 && u <= Math.abs(delta)) {
        const at = t - (1 - u / Math.abs(delta)) * dt * 1000;
        if (!crossed || at < crossed.at) crossed = { seat, at };
      }
    }

    s.angle = a1;

    if (crossed) {
      const { seat, at } = crossed;
      const guarded = seat.guardKind !== null && at >= seat.guardFrom && at <= seat.guardUntil;

      if (guarded && seat.guardKind === 'swing') {
        returnBall(s, seat, at, t);
      } else if (guarded) {
        seat.dodges += 1;
        addFx(s, 'dodge', seat, t);
      } else {
        seat.doomedAt = at;
        seat.doomDeadline = at + SMASH.GRACE_MS;
      }
    }

    // Resolución de eliminaciones diferidas
    for (const seat of s.seats) {
      if (seat.doomedAt !== null && t >= seat.doomDeadline) {
        seat.doomedAt = null;
        eliminate(s, seat, t);
      }
    }

    if (s.fx.length && t - s.fx[0].at > FX_TTL) {
      s.fx = s.fx.filter((f) => t - f.at <= FX_TTL);
    }

    const alive = s.seats.filter((x) => x.alive).length;
    const threshold = s.seats.length > 1 ? 1 : 0;
    if (alive <= threshold) {
      endRound(ctx, s);
      return;
    }
    ctx.push();
  },

  leave(ctx, s, playerId) {
    const seat = s.seats.find((x) => x.playerId === playerId);
    if (seat?.alive && s.stage === 'live') {
      eliminate(s, seat, ctx.now());
      const alive = s.seats.filter((x) => x.alive).length;
      if (alive <= (s.seats.length > 1 ? 1 : 0)) endRound(ctx, s);
    }
    ctx.push();
  },

  view(ctx, s, _playerId): SmashView {
    return {
      stage: s.stage,
      round: s.round,
      totalRounds: s.totalRounds,
      t: ctx.now(),
      until: s.until,
      serveUntil: s.serveUntil,
      ball: { angle: s.angle, omega: s.omega },
      rally: s.rally,
      seats: s.seats.map(
        (x): SmashSeat => ({
          playerId: x.playerId,
          angle: x.angle,
          alive: x.alive,
          state: x.state,
          until: x.until,
          hits: x.hits,
          dodges: x.dodges,
          outOrder: x.outOrder,
        }),
      ),
      totals: Object.fromEntries(s.totals),
      lastRound: s.lastRound,
      fx: s.fx,
    };
  },

  dispose() {
    /* el motor se encarga de parar el tick */
  },
};

/* ── helpers ──────────────────────────────────────────────────────────────── */

/**
 * Smash: invierte y acelera la pelota como si hubiera rebotado en la paleta en
 * el instante `at`. Si el golpe llega tarde (rescate por latencia), la pelota
 * ya siguió de largo: la reubicamos donde estaría si hubiera rebotado a tiempo.
 */
function returnBall(s: SmashState, seat: Seat, at: number, t: number): void {
  const oldDir = Math.sign(s.omega) || 1;
  const speed = Math.min(SMASH.MAX_OMEGA, Math.abs(s.omega) * SMASH.HIT_BOOST);
  s.omega = -oldDir * speed;
  const travelled = Math.max(0.02, (speed * Math.max(0, t - at)) / 1000);
  s.angle = norm(seat.angle - oldDir * travelled);

  // A mucha velocidad la pelota "fantasma" pudo haber marcado al vecino: como en
  // realidad rebotó, esos toques no cuentan.
  for (const other of s.seats) {
    if (other !== seat && other.doomedAt !== null && other.doomedAt >= at) other.doomedAt = null;
  }

  seat.hits += 1;
  s.rally += 1;
  // El smash consume el raquetazo.
  seat.guardUntil = at;
  addFx(s, 'hit', seat, t);
}

function addFx(s: SmashState, kind: SmashFx['kind'], seat: Seat, t: number): void {
  s.fx.push({ id: s.fxSeq++, kind, angle: seat.angle, at: t, playerId: seat.playerId });
  if (s.fx.length > 12) s.fx.shift();
}

function eliminate(s: SmashState, seat: Seat, t: number): void {
  if (!seat.alive) return;
  seat.alive = false;
  seat.state = 'out';
  seat.until = t;
  seat.outOrder = s.outCount++;
  addFx(s, 'out', seat, t);
}

function startRound(ctx: GameContext, s: SmashState): void {
  s.round += 1;
  s.stage = 'countdown';
  s.outCount = 0;
  s.rally = 0;
  s.fx = [];
  s.lastRound = null;

  const roster = ctx.players().filter((p) => p.connected);
  const list = roster.length ? roster : ctx.players();
  const order = shuffle(list.map((p) => p.id));
  const n = order.length;

  s.seats = order.map((playerId, i) => ({
    playerId,
    angle: norm(-Math.PI / 2 + (i * TAU) / n),
    alive: true,
    state: 'idle' as SeatState,
    until: 0,
    guardFrom: 0,
    guardUntil: 0,
    guardKind: null,
    cooldownUntil: 0,
    doomedAt: null,
    doomDeadline: 0,
    hits: 0,
    dodges: 0,
    outOrder: null,
  }));

  // Arranca justo en el medio entre dos jugadores, en una dirección al azar.
  const gap = n > 0 ? TAU / n / 2 : Math.PI;
  s.angle = norm(s.seats[0]?.angle ?? 0) + gap;
  // Arranca lento y con una pausa de saque: nadie recibe la pelota encima.
  s.omega = (rnd() < 0.5 ? -1 : 1) * SMASH.START_OMEGA * SMASH.SERVE_START;
  s.until = ctx.now() + SMASH.COUNTDOWN_MS;
  s.serveUntil = s.until + SMASH.SERVE_MS;
  s.lastTick = ctx.now();
  ctx.push();
}

function endRound(ctx: GameContext, s: SmashState): void {
  s.stage = 'roundEnd';
  const n = s.seats.length;

  // place 1 = último en pie. Los eliminados se ordenan al revés de su caída.
  const placed = s.seats.map((seat) => {
    const place = seat.alive ? 1 : n - (seat.outOrder ?? 0);
    const points = (n - place) * 10 + seat.hits;
    return { playerId: seat.playerId, place, points, hits: seat.hits };
  });
  placed.sort((a, b) => a.place - b.place);

  for (const row of placed) {
    s.totals.set(row.playerId, (s.totals.get(row.playerId) ?? 0) + row.points);
  }
  s.lastRound = placed.map(({ playerId, place, points }) => ({ playerId, place, points }));
  s.until = ctx.now() + SMASH.ROUND_END_MS;
  ctx.push();

  ctx.timers.after(SMASH.ROUND_END_MS, () => {
    if (s.round >= s.totalRounds) {
      s.stage = 'done';
      ctx.push();
      ctx.finish(
        ctx.players().map((p) => {
          const total = s.totals.get(p.id) ?? 0;
          return { playerId: p.id, value: total, label: `${total} pts` };
        }),
      );
    } else {
      startRound(ctx, s);
    }
  });
}
