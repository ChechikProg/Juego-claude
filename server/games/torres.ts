import { AABB, Box, Vec2, World, testOverlap, type Body, type Fixture } from 'planck';
import { CLASSIC_KINDS, CURSED_KINDS, POWER_KINDS, SHAPES, TT, rotCell } from '../../shared/torres';
import type { TorresAbility, TorresFx, TorresLane, TorresView } from '../../shared/types';
import { pick, rnd, shuffle } from '../util';
import type { GameContext, GameModule } from './kit';

const FX_TTL = 1600;
const DT = 1 / TT.TICK_HZ;
/** las torres ajenas viajan con menos frecuencia que la propia */
const RIVAL_EVERY_MS = 180;
/** media celda un poquito achicada: así las piezas no se traban en las juntas */
const HALF = 0.49;
/** la pieza no apoya en nada (cae al vacío): el cliente no dibuja sombra */
const NO_LANDING = -99;

interface PieceData {
  id: number;
  kind: number;
  golden: boolean;
  cemented: boolean;
  /** cuartos de vuelta con los que se armaron las celdas */
  rot: number;
  /** ya no es la pieza que se controla */
  released: boolean;
}

interface Active {
  body: Body;
  kind: number;
  rot: number;
  golden: boolean;
  /** tocó algo en el último paso */
  touched: boolean;
  /** dónde apoyaría si cayera derecho (para la sombra del cliente) */
  landY: number;
  /** viento acumulado: la pieza se corre de a una celda entera, nunca a medias */
  windAcc: number;
}

interface Lane {
  playerId: string;
  world: World;
  base: Body;
  pieces: Map<Body, PieceData>;
  active: Active | null;
  queue: { kind: number; golden: boolean }[];
  bag: number[];
  spawnAt: number;
  fast: boolean;
  top: number;
  best: number;
  holdSince: number | null;
  finishedAt: number | null;
  place: number | null;
  powers: TorresAbility[];
  charge: number;
  shakeUntil: number;
  placed: number;
  lost: number;
  /** caché de las piezas serializadas en este tick */
  packed: number[] | null;
}

interface TState {
  stage: 'countdown' | 'live' | 'roundEnd' | 'done';
  round: number;
  totalRounds: number;
  until: number;
  startAt: number;
  /** fin de la ronda (se acorta cuando llega el primero) */
  endsAt: number;
  lanes: Map<string, Lane>;
  finishedCount: number;
  wind: { dir: -1 | 1; from: number; until: number } | null;
  nextWindAt: number;
  fx: TorresFx[];
  seq: number;
  totals: Map<string, number>;
  roundResults: TorresView['roundResults'];
  /** última vez que cada espectador recibió las torres ajenas completas */
  lastFull: Map<string, number>;
  tickNo: number;
}

export const torres: GameModule<TState> = {
  id: 'torres',
  tickHz: TT.TICK_HZ,

  create(ctx) {
    const s: TState = {
      stage: 'countdown',
      round: 0,
      totalRounds: Math.max(1, Math.min(3, ctx.config.torresRounds || 1)),
      until: 0,
      startAt: 0,
      endsAt: 0,
      lanes: new Map(),
      finishedCount: 0,
      wind: null,
      nextWindAt: 0,
      fx: [],
      seq: 1,
      totals: new Map(ctx.players().map((p) => [p.id, 0])),
      roundResults: null,
      lastFull: new Map(),
      tickNo: 0,
    };
    return s;
  },

  start(ctx, s) {
    startRound(ctx, s);
  },

  event(ctx, s, playerId, type, data) {
    const lane = s.lanes.get(playerId);
    if (!lane || s.stage !== 'live' || lane.finishedAt !== null) return;
    const d = (data ?? {}) as { dir?: unknown; on?: unknown; slot?: unknown };
    switch (type) {
      case 'move': {
        const dir = Math.sign(Number(d.dir) || 0);
        if (dir && lane.active && shift(lane, dir * TT.STEP, 0)) updateLanding(lane);
        return;
      }
      case 'rotate':
        if (lane.active) rotate(lane);
        return;
      case 'fast':
        lane.fast = !!d.on;
        return;
      case 'power': {
        const slot = Number(d.slot) === 1 ? 1 : 0;
        const power = lane.powers[slot];
        if (!power) return;
        lane.powers.splice(slot, 1);
        usePower(ctx, s, lane, power, ctx.now());
        ctx.push();
        return;
      }
    }
  },

  tick(ctx, s, _dt, now) {
    if (s.stage === 'countdown') {
      if (now >= s.until) {
        s.stage = 'live';
        s.startAt = now;
        s.endsAt = now + TT.ROUND_MS;
        s.nextWindAt = now + windGap();
        for (const lane of s.lanes.values()) lane.spawnAt = now;
        ctx.push();
      }
      return;
    }
    if (s.stage === 'roundEnd') {
      if (now >= s.until) {
        if (s.round >= s.totalRounds) finish(ctx, s);
        else startRound(ctx, s);
      }
      return;
    }
    if (s.stage !== 'live') return;
    s.tickNo += 1;

    // Viento: avisa, sopla un rato y se calma.
    if (!s.wind && now >= s.nextWindAt) {
      s.wind = { dir: rnd() < 0.5 ? -1 : 1, from: now + 1500, until: now + 1500 + TT.WIND_MS };
    }
    if (s.wind && now >= s.wind.until) {
      s.wind = null;
      s.nextWindAt = now + windGap();
    }
    const blowing = s.wind && now >= s.wind.from ? s.wind.dir : 0;

    for (const lane of s.lanes.values()) {
      lane.packed = null;
      if (lane.finishedAt !== null) continue;
      stepLane(ctx, s, lane, now, blowing);
    }

    if (s.fx.length && now - s.fx[0].at > FX_TTL) s.fx = s.fx.filter((f) => now - f.at <= FX_TTL);

    const lanes = [...s.lanes.values()];
    if (now >= s.endsAt || (lanes.length > 0 && lanes.every((l) => l.finishedAt !== null))) {
      endRound(ctx, s, now);
      return;
    }
    ctx.push();
  },

  leave(ctx, s, playerId) {
    // La torre queda donde está; si vuelve, sigue construyendo.
    const lane = s.lanes.get(playerId);
    if (lane) lane.fast = false;
    ctx.push();
  },

  view(ctx, s, playerId): TorresView {
    const now = ctx.now();
    const full = now - (s.lastFull.get(playerId) ?? 0) >= RIVAL_EVERY_MS;
    if (full) s.lastFull.set(playerId, now);
    const mine = s.lanes.has(playerId);
    const lanes: TorresLane[] = [];
    for (const lane of s.lanes.values()) {
      const own = lane.playerId === playerId;
      // Si mira sin jugar, sigue al que va primero con la frecuencia completa.
      const focus = own || (!mine && lane === leader(s));
      const a = lane.active;
      lanes.push({
        playerId: lane.playerId,
        pieces: focus || full ? pack(lane) : null,
        active: a
          ? {
              kind: a.kind,
              x: r2(a.body.getPosition().x),
              y: r2(a.body.getPosition().y),
              rot: a.rot,
              golden: a.golden,
              landY: r2(a.landY),
            }
          : null,
        next: lane.queue[0]?.kind ?? 0,
        nextGolden: lane.queue[0]?.golden ?? false,
        top: r2(lane.top),
        best: r2(lane.best),
        holdSince: lane.holdSince,
        finishedAt: lane.finishedAt,
        place: lane.place,
        powers: lane.powers,
        charge: lane.charge,
        shakeUntil: lane.shakeUntil,
        placed: lane.placed,
        lost: lane.lost,
      });
    }
    return {
      stage: s.stage,
      round: s.round,
      totalRounds: s.totalRounds,
      t: now,
      until: s.stage === 'live' ? s.endsAt : s.until,
      goal: TT.GOAL,
      lanes,
      wind: s.wind,
      fx: s.fx,
      totals: Object.fromEntries(s.totals),
      roundResults: s.roundResults,
    };
  },
};

/* ── rondas ───────────────────────────────────────────────────────────────── */

function startRound(ctx: GameContext, s: TState): void {
  s.round += 1;
  s.lanes = new Map();
  for (const p of ctx.players()) s.lanes.set(p.id, newLane(p.id));
  s.finishedCount = 0;
  s.wind = null;
  s.fx = [];
  s.roundResults = null;
  s.lastFull.clear();
  s.stage = 'countdown';
  s.until = ctx.now() + TT.COUNTDOWN_MS;
  ctx.push();
}

function endRound(ctx: GameContext, s: TState, now: number): void {
  const lanes = [...s.lanes.values()];
  const done = lanes.filter((l) => l.finishedAt !== null).sort((a, b) => (a.place ?? 0) - (b.place ?? 0));
  const rest = lanes.filter((l) => l.finishedAt === null).sort((a, b) => b.best - a.best);
  const results: NonNullable<TState['roundResults']> = [];
  [...done, ...rest].forEach((l, i) => {
    const time = l.finishedAt !== null ? l.finishedAt - s.startAt : null;
    const height = r2(l.best);
    const prev = results[i - 1];
    // Los que no llegaron y quedaron a la misma altura (por ejemplo, en cero) empatan.
    const tied = prev && time === null && prev.time === null && Math.abs(prev.height - height) < 0.05;
    results.push({ playerId: l.playerId, place: tied ? prev.place : i + 1, points: 0, time, height });
  });
  s.roundResults = results;
  for (const row of results) {
    row.points = TT.POINTS[row.place - 1] ?? 0;
    s.totals.set(row.playerId, (s.totals.get(row.playerId) ?? 0) + row.points);
  }
  for (const lane of lanes) {
    if (lane.active) {
      lane.world.destroyBody(lane.active.body);
      lane.active = null;
    }
    lane.packed = null;
  }
  s.wind = null;
  s.stage = 'roundEnd';
  s.until = now + TT.ROUND_END_MS;
  ctx.push();
}

function finish(ctx: GameContext, s: TState): void {
  if (s.stage === 'done') return;
  s.stage = 'done';
  ctx.push();
  ctx.finish(
    ctx.players().map((p) => {
      const pts = s.totals.get(p.id) ?? 0;
      return { playerId: p.id, value: pts, label: `${pts} pts` };
    }),
  );
}

function windGap(): number {
  const [a, b] = TT.WIND_EVERY;
  return a + rnd() * (b - a);
}

function leader(s: TState): Lane | null {
  let best: Lane | null = null;
  for (const l of s.lanes.values()) {
    if (!best) best = l;
    else if ((l.place ?? 99) < (best.place ?? 99)) best = l;
    else if ((l.place ?? 99) === (best.place ?? 99) && l.top > best.top) best = l;
  }
  return best;
}

/* ── carril ───────────────────────────────────────────────────────────────── */

function newLane(playerId: string): Lane {
  const world = new World({ gravity: new Vec2(0, -TT.GRAVITY) });
  const base = world.createBody({ type: 'static', position: new Vec2(0, -0.5) });
  base.createFixture({ shape: new Box(TT.BASE_W / 2, 0.5), friction: TT.FRICTION });
  // Un tronco angosto debajo, sólo para que las piezas que rozan el borde no se enganchen raro.
  base.createFixture({ shape: new Box(TT.BASE_W / 2 - 0.6, 3, new Vec2(0, -3.5), 0), friction: TT.FRICTION });

  const lane: Lane = {
    playerId,
    world,
    base,
    pieces: new Map(),
    active: null,
    queue: [],
    bag: [],
    spawnAt: 0,
    fast: false,
    top: 0,
    best: 0,
    holdSince: null,
    finishedAt: null,
    place: null,
    powers: [],
    charge: TT.PIECES_PER_POWER,
    shakeUntil: 0,
    placed: 0,
    lost: 0,
    packed: null,
  };
  world.on('begin-contact', (c) => {
    const a = lane.active;
    if (!a) return;
    const ba = c.getFixtureA().getBody();
    const bb = c.getFixtureB().getBody();
    if (ba === a.body || bb === a.body) a.touched = true;
  });
  fillQueue(lane);
  return lane;
}

function fillQueue(lane: Lane): void {
  while (lane.queue.length < 2) {
    // Bolsa de las siete clásicas: nunca pasan muchas sin que salga cada una.
    if (lane.bag.length === 0) lane.bag = shuffle([0, 1, 2, 3, 4, 5, 6].slice(0, CLASSIC_KINDS));
    lane.queue.push({ kind: lane.bag.pop()!, golden: rnd() < 1 / TT.GOLDEN_EVERY });
  }
}

function spawn(lane: Lane): void {
  fillQueue(lane);
  const next = lane.queue.shift()!;
  fillQueue(lane);
  const y = Math.max(lane.top, 0) + TT.SPAWN_ABOVE;
  const body = lane.world.createBody({
    type: 'dynamic',
    position: new Vec2(0, y),
    fixedRotation: true,
    gravityScale: 0,
    allowSleep: false,
  });
  addCells(body, next.kind, 0);
  lane.active = { body, kind: next.kind, rot: 0, golden: next.golden, touched: false, landY: y, windAcc: 0 };
  snapX(lane.active);
  updateLanding(lane);
  lane.pieces.set(body, { id: nextPieceId(), kind: next.kind, golden: next.golden, cemented: false, rot: 0, released: false });
}

let pieceSeq = 1;
function nextPieceId(): number {
  pieceSeq = (pieceSeq + 1) % 1_000_000_000;
  return pieceSeq;
}

/** Arma las celdas con la rotación ya aplicada: el cuerpo nace con ángulo 0. */
function addCells(body: Body, kind: number, rot: number): void {
  for (const [cx, cy] of SHAPES[kind]) {
    const [x, y] = rotCell(cx, cy, rot);
    body.createFixture({
      shape: new Box(HALF, HALF, new Vec2(x, y), 0),
      density: TT.DENSITY,
      friction: TT.FRICTION,
      restitution: 0,
    });
  }
}

function stepLane(ctx: GameContext, s: TState, lane: Lane, now: number, wind: number): void {
  if (!lane.active && now >= lane.spawnAt) spawn(lane);

  const a = lane.active;
  if (a) {
    // El viento corre la pieza de a una celda entera, así sigue alineada a la grilla.
    if (wind) {
      a.windAcc += wind * TT.WIND_SPEED * DT;
      if (Math.abs(a.windAcc) >= TT.STEP) {
        const dir = Math.sign(a.windAcc);
        a.windAcc -= dir * TT.STEP;
        if (shift(lane, dir * TT.STEP, 0)) updateLanding(lane);
      }
    } else {
      a.windAcc = 0;
    }
    a.body.setLinearVelocity(new Vec2(0, -(lane.fast ? TT.FAST_SPEED : TT.FALL_SPEED)));
  }

  // Terremoto: la base se sacude de un lado al otro.
  if (now < lane.shakeUntil) {
    const w = Math.PI * 2 * 3.2;
    const tt = (lane.shakeUntil - now) / 1000;
    lane.base.setLinearVelocity(new Vec2(Math.cos(w * tt) * TT.QUAKE_AMP * w * 0.5, 0));
  } else if (lane.base.isKinematic()) {
    lane.base.setLinearVelocity(new Vec2(0, 0));
    lane.base.setStatic();
    lane.base.setPosition(new Vec2(0, -0.5));
  }

  // El viento también empuja un poquito las torres.
  if (wind) {
    for (const [body, p] of lane.pieces) {
      if (!p.released || p.cemented) continue;
      body.applyForceToCenter(new Vec2(wind * body.getMass() * 0.45, 0), true);
    }
  }

  lane.world.step(DT, 8, 3);

  if (a && lane.active === a) {
    // La torre se mueve un poco: refresco la sombra unas 10 veces por segundo.
    if (s.tickNo % 6 === 0) updateLanding(lane);
    const y = a.body.getPosition().y;
    if (a.touched) release(ctx, s, lane, now, true);
    else if (y < -2) release(ctx, s, lane, now, false);
  }

  // Piezas que se fueron al vacío.
  for (const [body, p] of lane.pieces) {
    if (body.getPosition().y > TT.LOST_Y) continue;
    if (lane.active?.body === body) lane.active = null;
    lane.world.destroyBody(body);
    lane.pieces.delete(body);
    lane.lost += 1;
    addFx(s, 'lost', lane.playerId, now, body.getPosition().x);
    void p;
  }

  measure(lane);
  if (lane.top >= TT.GOAL) {
    if (lane.holdSince === null) lane.holdSince = now;
    if (now - lane.holdSince >= TT.HOLD_MS) finishLane(ctx, s, lane, now);
  } else {
    lane.holdSince = null;
  }
}

function release(ctx: GameContext, s: TState, lane: Lane, now: number, landed: boolean): void {
  const a = lane.active;
  if (!a) return;
  lane.active = null;
  lane.fast = false;
  const body = a.body;
  body.setGravityScale(1);
  body.setFixedRotation(false);
  body.setSleepingAllowed(true);
  const v = body.getLinearVelocity();
  body.setLinearVelocity(new Vec2(v.x * 0.3, Math.max(v.y, -1.2)));
  const data = lane.pieces.get(body);
  if (data) {
    data.released = true;
    data.rot = a.rot;
  }
  lane.spawnAt = now + TT.SPAWN_DELAY;
  if (!landed) return;

  lane.placed += 1;
  const pos = body.getPosition();
  addFx(s, 'place', lane.playerId, now, pos.x, pos.y);
  lane.charge -= 1;
  if (lane.charge <= 0) {
    lane.charge = TT.PIECES_PER_POWER;
    grantPower(ctx, s, lane, now);
  }
  if (a.golden) {
    addFx(s, 'golden', lane.playerId, now, pos.x, pos.y);
    grantPower(ctx, s, lane, now);
  }
}

function grantPower(ctx: GameContext, s: TState, lane: Lane, now: number): void {
  if (lane.powers.length >= TT.MAX_POWERS) return;
  // En solitario los poderes contra rivales no sirven: sólo cemento.
  const solo = s.lanes.size <= 1;
  const power = solo ? 'cement' : pick(POWER_KINDS);
  lane.powers.push(power);
  addFx(s, 'power', lane.playerId, now);
  void ctx;
}

function usePower(ctx: GameContext, s: TState, lane: Lane, power: TorresAbility, now: number): void {
  const me = ctx.player(lane.playerId)?.name ?? 'Alguien';
  if (power === 'cement') {
    for (const [body, p] of lane.pieces) {
      if (!p.released || p.cemented) continue;
      if (body.getLinearVelocity().length() > 1.5) continue;
      body.setLinearVelocity(new Vec2(0, 0));
      body.setAngularVelocity(0);
      body.setStatic();
      p.cemented = true;
    }
    lane.packed = null;
    addFx(s, 'cement', lane.playerId, now, 0, lane.top);
    return;
  }
  const rivals = [...s.lanes.values()].filter((l) => l !== lane && l.finishedAt === null);
  for (const r of rivals) {
    if (power === 'curse') {
      fillQueue(r);
      r.queue.unshift({ kind: pick(CURSED_KINDS), golden: false });
      addFx(s, 'curse', r.playerId, now, undefined, undefined, lane.playerId);
    } else if (power === 'quake') {
      r.shakeUntil = now + TT.QUAKE_MS;
      r.base.setKinematic();
      for (const body of r.pieces.keys()) body.setAwake(true);
      addFx(s, 'quake', r.playerId, now, undefined, undefined, lane.playerId);
    }
  }
  ctx.toast(null, power === 'curse' ? `👻 ${me} les mandó una pieza maldita` : `🌋 ${me} hizo temblar las torres`, 'info');
}

function finishLane(ctx: GameContext, s: TState, lane: Lane, now: number): void {
  s.finishedCount += 1;
  lane.place = s.finishedCount;
  lane.finishedAt = now;
  lane.best = Math.max(lane.best, lane.top);
  if (lane.active) {
    lane.world.destroyBody(lane.active.body);
    lane.pieces.delete(lane.active.body);
    lane.active = null;
  }
  lane.packed = null;
  addFx(s, 'finish', lane.playerId, now, 0, lane.top);
  const name = ctx.player(lane.playerId)?.name ?? 'Alguien';
  ctx.toast(null, `🏁 ${name} llegó a la cima (${lane.place}º)`, 'good');
  // El primero que llega pone el reloj para los demás.
  if (s.finishedCount === 1 && s.lanes.size > 1) s.endsAt = Math.min(s.endsAt, now + TT.FINISH_GRACE_MS);
}

/** Altura de la torre: el punto más alto de las piezas que están quietas. */
function measure(lane: Lane): void {
  let top = 0;
  for (const [body, p] of lane.pieces) {
    if (!p.released) continue;
    if (!p.cemented && (body.getLinearVelocity().length() > 0.7 || Math.abs(body.getAngularVelocity()) > 0.8)) continue;
    for (let f: Fixture | null = body.getFixtureList(); f; f = f.getNext()) {
      const y = f.getAABB(0).upperBound.y;
      if (y > top) top = y;
    }
  }
  lane.top = top;
  if (top > lane.best) lane.best = top;
}

/* ── controles de la pieza activa ─────────────────────────────────────────── */

const tmpBox = new AABB();

function overlaps(lane: Lane, body: Body): boolean {
  const xfA = body.getTransform();
  for (let fa: Fixture | null = body.getFixtureList(); fa; fa = fa.getNext()) {
    // El AABB guardado de la pieza activa queda viejo al moverla a mano: se calcula de nuevo.
    fa.getShape().computeAABB(tmpBox, xfA, 0);
    const boxA = tmpBox;
    for (let other: Body | null = lane.world.getBodyList(); other; other = other.getNext()) {
      if (other === body) continue;
      const xfB = other.getTransform();
      for (let fb: Fixture | null = other.getFixtureList(); fb; fb = fb.getNext()) {
        const boxB = fb.getAABB(0);
        if (boxA.upperBound.x < boxB.lowerBound.x || boxB.upperBound.x < boxA.lowerBound.x) continue;
        if (boxA.upperBound.y < boxB.lowerBound.y || boxB.upperBound.y < boxA.lowerBound.y) continue;
        if (testOverlap(fa.getShape(), 0, fb.getShape(), 0, xfA, xfB)) return true;
      }
    }
  }
  return false;
}

/** Extremos laterales (en celdas) de la pieza activa respecto de su origen. */
function extents(a: Active): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const [cx, cy] of SHAPES[a.kind]) {
    const [x] = rotCell(cx, cy, a.rot);
    lo = Math.min(lo, x - 0.5);
    hi = Math.max(hi, x + 0.5);
  }
  return [lo, hi];
}

/**
 * Alinea la pieza a la grilla: el borde izquierdo cae siempre sobre una línea
 * entera (como los bordes de la base), sin importar cómo quedó el centroide.
 */
function snapX(a: Active): void {
  const p = a.body.getPosition();
  const [lo] = extents(a);
  a.body.setPosition(new Vec2(Math.round(p.x + lo) - lo, p.y));
}

/** Corre la pieza; si choca o se sale del carril, vuelve a donde estaba. */
function shift(lane: Lane, dx: number, dy: number): boolean {
  const a = lane.active;
  if (!a) return false;
  const p = a.body.getPosition();
  const nx = p.x + dx;
  const [lo, hi] = extents(a);
  if (nx + lo < -TT.LANE_HALF - 0.01 || nx + hi > TT.LANE_HALF + 0.01) return false;
  const before = new Vec2(p.x, p.y);
  a.body.setPosition(new Vec2(nx, p.y + dy));
  if (overlaps(lane, a.body)) {
    a.body.setPosition(before);
    return false;
  }
  return true;
}

/** Calcula dónde apoyaría la pieza si cayera derecho: baja de a poco hasta chocar. */
function updateLanding(lane: Lane): void {
  const a = lane.active;
  if (!a) return;
  const p = a.body.getPosition();
  const x = p.x;
  const y0 = p.y;
  const floor = Math.max(lane.top, 0) - 6;
  let y = y0;
  let hit = false;
  // Bajada gruesa y después afino con pasos cortos.
  for (const step of [0.5, 0.1, 0.02]) {
    for (;;) {
      if (y - step < floor) break;
      a.body.setPosition(new Vec2(x, y - step));
      if (overlaps(lane, a.body)) {
        hit = true;
        break;
      }
      y -= step;
    }
  }
  a.body.setPosition(new Vec2(x, y0));
  a.landY = hit ? y : NO_LANDING;
}

function rotate(lane: Lane): void {
  const a = lane.active;
  if (!a) return;
  const old = a.rot;
  setShape(a, (a.rot + 1) % 4);
  snapX(a);
  // Si no entra, prueba correrse una o dos celdas (como cualquier Tetris).
  for (const [dx, dy] of [[0, 0], [TT.STEP, 0], [-TT.STEP, 0], [2 * TT.STEP, 0], [-2 * TT.STEP, 0], [0, 0.5]]) {
    if (shift(lane, dx, dy)) {
      updateLanding(lane);
      return;
    }
  }
  setShape(a, old);
  snapX(a);
  updateLanding(lane);
}

function setShape(a: Active, rot: number): void {
  for (let f = a.body.getFixtureList(); f; ) {
    const next = f.getNext();
    a.body.destroyFixture(f);
    f = next;
  }
  a.rot = rot;
  addCells(a.body, a.kind, rot);
}

/* ── serialización ────────────────────────────────────────────────────────── */

function pack(lane: Lane): number[] {
  if (lane.packed) return lane.packed;
  const out: number[] = [];
  for (const [body, p] of lane.pieces) {
    if (!p.released) continue;
    const pos = body.getPosition();
    out.push(
      p.id,
      p.kind,
      Math.round(pos.x * 100),
      Math.round(pos.y * 100),
      Math.round(body.getAngle() * 1000),
      (p.cemented ? 1 : 0) | (p.golden ? 2 : 0) | (p.rot << 2),
    );
  }
  lane.packed = out;
  return out;
}

function addFx(
  s: TState,
  kind: TorresFx['kind'],
  playerId: string,
  at: number,
  x?: number,
  y?: number,
  by?: string,
): void {
  s.fx.push({
    id: s.seq++,
    kind,
    playerId,
    at,
    x: x === undefined ? undefined : r2(x),
    y: y === undefined ? undefined : r2(y),
    by,
  });
  if (s.fx.length > 40) s.fx.shift();
}

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}
