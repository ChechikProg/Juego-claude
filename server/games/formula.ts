import { F99, F99_POINTS, TRACKS, driveStep, gridSlots, nearestSample, trackGeo, type TrackGeo } from '../../shared/formula';
import type { F99Car, F99Fx, F99Hazard, F99Item, F99Missile, F99View } from '../../shared/types';
import { rnd, rndInt, shuffle, weightedIndex } from '../util';
import type { GameContext, GameModule } from './kit';

const FX_TTL = 1200;
const MAX_HAZARDS = 40;
/** el pasto termina acá: más allá hay un límite invisible que te devuelve */
const GRASS_MARGIN = 62;
/** si el más cercano salta más que esto de un tick al otro, no cuenta como avance */
const MAX_PROGRESS_JUMP = 30;
const OIL_TTL = 14_000;

interface Car {
  playerId: string;
  x: number;
  y: number;
  a: number;
  vx: number;
  vy: number;
  input: { throttle: number; steer: number };
  idx: number;
  /** avance con signo, en muestras de la pista */
  dist: number;
  finishedAt: number | null;
  item: F99Item | null;
  itemAt: number;
  /** vuelta en la que agarró el último objeto */
  itemLap: number;
  useQueued: boolean;
  spinUntil: number;
  spinDir: number;
  boostUntil: number;
  padUntil: number;
  lastPadAt: number;
  shrinkUntil: number;
  oilUntil: number;
  shieldUntil: number;
  offTrack: boolean;
  place: number;
}

interface Missile extends F99Missile {
  bornAt: number;
  idx: number;
}

interface FState {
  stage: 'countdown' | 'race' | 'podium' | 'done';
  race: number;
  totalRaces: number;
  track: number;
  geo: TrackGeo;
  usedTracks: number[];
  startAt: number;
  until: number | null;
  cars: Map<string, Car>;
  hazards: F99Hazard[];
  missiles: Missile[];
  boxes: number[];
  fx: F99Fx[];
  seq: number;
  totals: Map<string, number>;
  raceResults: F99View['raceResults'];
  lastTick: number;
}

export const formula: GameModule<FState> = {
  id: 'formula',
  tickHz: F99.TICK_HZ,

  create(ctx) {
    return {
      stage: 'countdown',
      race: 0,
      totalRaces: Math.max(1, Math.min(3, ctx.config.formulaRaces || 2)),
      track: 0,
      geo: trackGeo(0),
      usedTracks: [],
      startAt: 0,
      until: null,
      cars: new Map(),
      hazards: [],
      missiles: [],
      boxes: [],
      fx: [],
      seq: 1,
      totals: new Map(ctx.players().map((p) => [p.id, 0] as const)),
      raceResults: null,
      lastTick: 0,
    };
  },

  start(ctx, s) {
    startRace(ctx, s);
  },

  event(ctx, s, playerId, type, data) {
    const car = s.cars.get(playerId);
    if (!car) return;
    const d = (data ?? {}) as { throttle?: unknown; steer?: unknown };
    if (type === 'input') {
      car.input.throttle = Math.max(-1, Math.min(1, Math.round(Number(d.throttle) || 0)));
      car.input.steer = Math.max(-1, Math.min(1, Math.round(Number(d.steer) || 0)));
    } else if (type === 'use') {
      if (s.stage === 'race' && car.item && car.finishedAt === null) car.useQueued = true;
    }
  },

  tick(ctx, s, _dt, now) {
    if (s.stage === 'countdown') {
      if (now >= s.startAt) {
        s.stage = 'race';
        s.lastTick = now;
        ctx.push();
      }
      return;
    }
    if (s.stage !== 'race') return;

    const dt = Math.min(0.05, (now - s.lastTick) / 1000);
    s.lastTick = now;
    if (dt <= 0) return;

    const cars = [...s.cars.values()];
    for (const car of cars) driveCar(car, dt, now);
    collideCars(cars);
    for (const car of cars) {
      trackProgress(ctx, s, car, now);
      touchBoxes(s, car, now);
      touchPads(s, car, now);
      touchHazards(s, car, now);
    }
    rankCars(s);
    for (const car of cars) {
      if (car.useQueued) {
        car.useQueued = false;
        useItem(s, car, now);
      }
    }
    stepHazards(s, dt, now);
    stepMissiles(s, dt, now);

    if (s.fx.length && now - s.fx[0].at > FX_TTL) s.fx = s.fx.filter((f) => now - f.at <= FX_TTL);

    const racing = cars.filter((c) => c.finishedAt === null && ctx.player(c.playerId)?.connected);
    if (racing.length === 0 || (s.until !== null && now >= s.until) || now - s.startAt >= F99.RACE_MAX_MS) {
      endRace(ctx, s, now);
      return;
    }
    ctx.push();
  },

  leave(ctx, s, playerId) {
    const car = s.cars.get(playerId);
    if (car) car.input = { throttle: 0, steer: 0 };
    ctx.push();
  },

  view(ctx, s): F99View {
    const r1 = (n: number) => Math.round(n * 10) / 10;
    return {
      stage: s.stage,
      race: s.race,
      totalRaces: s.totalRaces,
      track: s.track,
      laps: F99.LAPS,
      t: ctx.now(),
      startAt: s.startAt,
      until: s.until,
      cars: [...s.cars.values()].map(
        (c): F99Car => ({
          playerId: c.playerId,
          x: r1(c.x),
          y: r1(c.y),
          a: Math.round(c.a * 1000) / 1000,
          vx: r1(c.vx),
          vy: r1(c.vy),
          item: c.item,
          itemAt: c.itemAt,
          spinUntil: c.spinUntil,
          spinDir: c.spinDir,
          boostUntil: c.boostUntil,
          padUntil: c.padUntil,
          oilUntil: c.oilUntil,
          shrinkUntil: c.shrinkUntil,
          shieldUntil: c.shieldUntil,
          lap: Math.max(1, Math.min(F99.LAPS, Math.floor(c.dist / s.geo.n) + 1)),
          progress: Math.round((c.dist / s.geo.n) * 1000) / 1000,
          place: c.place,
          finishedAt: c.finishedAt,
          offTrack: c.offTrack,
        }),
      ),
      hazards: s.hazards.map((h) => ({ ...h, x: r1(h.x), y: r1(h.y), vx: r1(h.vx), vy: r1(h.vy) })),
      missiles: s.missiles.map((m) => ({ id: m.id, x: r1(m.x), y: r1(m.y), a: Math.round(m.a * 100) / 100, owner: m.owner, target: m.target })),
      boxes: s.boxes,
      fx: s.fx,
      totals: Object.fromEntries(s.totals),
      raceResults: s.raceResults,
    };
  },
};

/* ── carreras ─────────────────────────────────────────────────────────────── */

function startRace(ctx: GameContext, s: FState): void {
  s.race += 1;
  // Pista al azar, sin repetir mientras queden sin usar.
  const fresh = TRACKS.map((_, i) => i).filter((i) => !s.usedTracks.includes(i));
  s.track = fresh.length ? fresh[rndInt(0, fresh.length)] : rndInt(0, TRACKS.length);
  s.usedTracks.push(s.track);
  s.geo = trackGeo(s.track);

  const roster = ctx.players().filter((p) => p.connected);
  const ids = shuffle((roster.length ? roster : ctx.players()).map((p) => p.id));
  // En la segunda carrera larga adelante el que viene peor en la tabla.
  if (s.race > 1) ids.sort((a, b) => (s.totals.get(a) ?? 0) - (s.totals.get(b) ?? 0));
  const slots = gridSlots(s.geo, ids.length);
  s.cars = new Map();
  ids.forEach((id, k) => {
    const slot = slots[k];
    s.cars.set(id, {
      playerId: id,
      x: slot.x,
      y: slot.y,
      a: slot.a,
      vx: 0,
      vy: 0,
      input: { throttle: 0, steer: 0 },
      idx: slot.i,
      dist: slot.i - s.geo.n,
      finishedAt: null,
      item: null,
      itemAt: 0,
      itemLap: -1,
      useQueued: false,
      spinUntil: 0,
      spinDir: 1,
      boostUntil: 0,
      padUntil: 0,
      lastPadAt: 0,
      shrinkUntil: 0,
      oilUntil: 0,
      shieldUntil: 0,
      offTrack: false,
      place: k + 1,
    });
  });

  s.hazards = [];
  s.missiles = [];
  s.boxes = s.geo.boxes.map(() => 0);
  s.fx = [];
  s.raceResults = null;
  s.until = null;
  s.stage = 'countdown';
  s.startAt = ctx.now() + F99.COUNTDOWN_MS;
  s.lastTick = ctx.now();
  ctx.push();
}

function endRace(ctx: GameContext, s: FState, now: number): void {
  rankCars(s);
  const sorted = [...s.cars.values()].sort((a, b) => a.place - b.place);
  s.raceResults = sorted.map((c) => {
    const points = F99_POINTS[c.place - 1] ?? 0;
    s.totals.set(c.playerId, (s.totals.get(c.playerId) ?? 0) + points);
    return {
      playerId: c.playerId,
      place: c.place,
      points,
      time: c.finishedAt !== null ? c.finishedAt - s.startAt : null,
    };
  });
  s.stage = 'podium';
  s.until = now + F99.PODIUM_MS;
  ctx.push();

  ctx.timers.after(F99.PODIUM_MS, () => {
    if (s.race >= s.totalRaces) {
      s.stage = 'done';
      ctx.push();
      ctx.finish(
        ctx.players().map((p) => {
          const total = s.totals.get(p.id) ?? 0;
          return { playerId: p.id, value: total, label: `${total} pts` };
        }),
      );
    } else {
      startRace(ctx, s);
    }
  });
}

/** Orden de carrera: los que llegaron por tiempo, el resto por avance. */
function rankCars(s: FState): void {
  const list = [...s.cars.values()].sort((a, b) => {
    if (a.finishedAt !== null || b.finishedAt !== null) {
      if (a.finishedAt === null) return 1;
      if (b.finishedAt === null) return -1;
      return a.finishedAt - b.finishedAt;
    }
    return b.dist - a.dist;
  });
  list.forEach((c, i) => (c.place = i + 1));
}

/* ── manejo ───────────────────────────────────────────────────────────────── */

function driveCar(car: Car, dt: number, now: number): void {
  const done = car.finishedAt !== null;
  driveStep(car, done ? 0 : car.input.throttle, done ? 0 : car.input.steer, dt, now);
}

function collideCars(cars: Car[]): void {
  const R = F99.CAR_R;
  for (let i = 0; i < cars.length; i++) {
    for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i];
      const b = cars[j];
      // Los que ya llegaron son fantasmas: no estorban.
      if (a.finishedAt !== null || b.finishedAt !== null) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 0.01;
      if (d >= R * 2) continue;
      const nx = dx / d;
      const ny = dy / d;
      const push = (R * 2 - d) / 2;
      a.x -= nx * push;
      a.y -= ny * push;
      b.x += nx * push;
      b.y += ny * push;
      const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (vn < 0) {
        const j2 = (-(1 + 0.45) * vn) / 2;
        a.vx -= j2 * nx;
        a.vy -= j2 * ny;
        b.vx += j2 * nx;
        b.vy += j2 * ny;
      }
    }
  }
}

function trackProgress(ctx: GameContext, s: FState, car: Car, now: number): void {
  const geo = s.geo;
  const near = nearestSample(geo, car.x, car.y, car.idx, 26);
  let idx = near.i;
  let dist = near.d;
  // Si quedó lejísimos (por ejemplo, un choque fuerte), buscamos en toda la pista.
  if (dist > geo.width * 2) {
    const full = nearestSample(geo, car.x, car.y);
    idx = full.i;
    dist = full.d;
  }
  let delta = idx - car.idx;
  if (delta > geo.n / 2) delta -= geo.n;
  else if (delta < -geo.n / 2) delta += geo.n;
  const before = car.dist;
  // Un salto grande es un atajo o un teletransporte: no suma avance.
  if (Math.abs(delta) <= MAX_PROGRESS_JUMP) car.dist += delta;
  car.idx = idx;

  car.offTrack = dist > geo.width / 2 + F99.CAR_R * 0.2;

  // Límite invisible al final del pasto: te devuelve hacia la pista.
  const limit = geo.width / 2 + GRASS_MARGIN;
  if (dist > limit) {
    const cx = geo.xs[idx];
    const cy = geo.ys[idx];
    const nx = (car.x - cx) / dist;
    const ny = (car.y - cy) / dist;
    car.x = cx + nx * limit;
    car.y = cy + ny * limit;
    const vn = car.vx * nx + car.vy * ny;
    if (vn > 0) {
      car.vx -= vn * nx * 1.4;
      car.vy -= vn * ny * 1.4;
    }
  }

  const lapPrev = Math.floor(before / geo.n);
  const lapNow = Math.floor(car.dist / geo.n);
  if (car.finishedAt === null && lapNow > lapPrev && lapNow >= 1) {
    if (lapNow >= F99.LAPS) {
      car.finishedAt = now;
      car.item = null;
      addFx(s, 'finish', car.x, car.y, now, car.playerId);
      // El primero que llega pone el reloj para los demás.
      if (s.until === null) s.until = now + F99.FINISH_GRACE_MS;
      const pl = ctx.player(car.playerId);
      if (pl) ctx.toast(null, `🏁 ${pl.name} cruzó la meta`, 'good');
    } else {
      addFx(s, 'lap', car.x, car.y, now, car.playerId);
    }
  }
}

/* ── objetos ──────────────────────────────────────────────────────────────── */

const ITEMS: F99Item[] = ['turbo', 'banana', 'oil', 'missile', 'bomb', 'zap', 'shield'];

/** Los que vienen atrás reciben mejores cosas. */
function rollItem(place: number, count: number): F99Item {
  const solo = count <= 1;
  const q = solo ? 0.5 : (place - 1) / (count - 1);
  const weights = [
    2 + 4 * q, // turbo
    4 - 2.2 * q, // banana
    2.4 - q, // aceite
    solo || q === 0 ? 0 : 0.6 + 3 * q, // misil
    1 + q, // bomba
    solo || q < 0.6 ? 0 : 2.6 * q, // rayo
    2 - q, // escudo
  ];
  return ITEMS[weightedIndex(weights)];
}

function touchBoxes(s: FState, car: Car, now: number): void {
  if (car.finishedAt !== null) return;
  const geo = s.geo;
  const reach = F99.BOX_R + F99.CAR_R;
  for (let k = 0; k < geo.boxes.length; k++) {
    if (s.boxes[k] > now) continue;
    const b = geo.boxes[k];
    if ((b.x - car.x) ** 2 + (b.y - car.y) ** 2 > reach * reach) continue;
    s.boxes[k] = now + F99.BOX_RESPAWN;
    const lap = Math.floor(car.dist / geo.n);
    if (car.item === null && car.itemLap !== lap) {
      car.item = rollItem(car.place, s.cars.size);
      car.itemAt = now;
      car.itemLap = lap;
      addFx(s, 'pickup', b.x, b.y, now, car.playerId);
    }
  }
}

function touchPads(s: FState, car: Car, now: number): void {
  for (const p of s.geo.pads) {
    if ((p.x - car.x) ** 2 + (p.y - car.y) ** 2 > 38 * 38) continue;
    car.padUntil = now + F99.PAD_MS;
    if (now - car.lastPadAt > 900) addFx(s, 'pad', car.x, car.y, now, car.playerId);
    car.lastPadAt = now;
  }
}

/** Golpe que hace trompear. Devuelve false si lo frenó el escudo. */
function hit(s: FState, car: Car, now: number, ms: number): boolean {
  if (car.finishedAt !== null) return false;
  if (now < car.shieldUntil) {
    car.shieldUntil = 0;
    addFx(s, 'block', car.x, car.y, now, car.playerId);
    return false;
  }
  car.spinUntil = Math.max(car.spinUntil, now + ms);
  car.spinDir = rnd() < 0.5 ? -1 : 1;
  addFx(s, 'spin', car.x, car.y, now, car.playerId);
  return true;
}

function useItem(s: FState, car: Car, now: number): void {
  const item = car.item;
  if (!item) return;
  car.item = null;
  const fx = Math.cos(car.a);
  const fy = Math.sin(car.a);

  switch (item) {
    case 'turbo': {
      car.boostUntil = now + F99.BOOST_MS;
      car.vx += fx * 120;
      car.vy += fy * 120;
      addFx(s, 'boost', car.x, car.y, now, car.playerId);
      return;
    }
    case 'banana':
    case 'oil': {
      const back = F99.CAR_R + (item === 'oil' ? 30 : 18);
      addHazard(s, {
        kind: item,
        x: car.x - fx * back,
        y: car.y - fy * back,
        vx: 0,
        vy: 0,
        owner: car.playerId,
        at: now,
        fuseAt: 0,
      });
      addFx(s, 'drop', car.x, car.y, now, car.playerId);
      return;
    }
    case 'bomb': {
      addHazard(s, {
        kind: 'bomb',
        x: car.x + fx * (F99.CAR_R + 10),
        y: car.y + fy * (F99.CAR_R + 10),
        vx: fx * 470 + car.vx * 0.5,
        vy: fy * 470 + car.vy * 0.5,
        owner: car.playerId,
        at: now,
        fuseAt: now + F99.BOMB_FUSE,
      });
      addFx(s, 'drop', car.x, car.y, now, car.playerId);
      return;
    }
    case 'missile': {
      // Va al que tenés justo adelante; si vas primero, sigue la pista.
      const ahead = [...s.cars.values()].find((c) => c.place === car.place - 1 && c.finishedAt === null);
      s.missiles.push({
        id: s.seq++,
        x: car.x + fx * (F99.CAR_R + 8),
        y: car.y + fy * (F99.CAR_R + 8),
        a: car.a,
        owner: car.playerId,
        target: ahead?.playerId ?? null,
        bornAt: now,
        idx: car.idx,
      });
      addFx(s, 'launch', car.x, car.y, now, car.playerId);
      return;
    }
    case 'zap': {
      for (const other of s.cars.values()) {
        if (other === car || other.finishedAt !== null) continue;
        if (now < other.shieldUntil) {
          other.shieldUntil = 0;
          addFx(s, 'block', other.x, other.y, now, other.playerId);
          continue;
        }
        other.shrinkUntil = now + F99.ZAP_MS;
        other.spinUntil = Math.max(other.spinUntil, now + 450);
        other.spinDir = rnd() < 0.5 ? -1 : 1;
      }
      addFx(s, 'zap', car.x, car.y, now, car.playerId);
      return;
    }
    case 'shield': {
      car.shieldUntil = now + F99.SHIELD_MS;
      addFx(s, 'block', car.x, car.y, now, car.playerId);
      return;
    }
  }
}

function addHazard(s: FState, h: Omit<F99Hazard, 'id'>): void {
  s.hazards.push({ id: s.seq++, ...h });
  if (s.hazards.length > MAX_HAZARDS) s.hazards.shift();
}

function touchHazards(s: FState, car: Car, now: number): void {
  if (car.finishedAt !== null) return;
  for (let i = s.hazards.length - 1; i >= 0; i--) {
    const h = s.hazards[i];
    // Lo que tirás no te pega enseguida.
    if (h.owner === car.playerId && now - h.at < 700) continue;
    const r = (h.kind === 'oil' ? F99.OIL_R : F99.BANANA_R) + F99.CAR_R * 0.8;
    if ((h.x - car.x) ** 2 + (h.y - car.y) ** 2 > r * r) continue;
    if (h.kind === 'banana') {
      s.hazards.splice(i, 1);
      if (hit(s, car, now, F99.SPIN_MS)) {
        car.vx *= 0.45;
        car.vy *= 0.45;
      }
    } else if (h.kind === 'oil') {
      if (now >= car.oilUntil && now >= car.shieldUntil) {
        car.oilUntil = now + F99.OIL_MS;
        addFx(s, 'spin', car.x, car.y, now, car.playerId);
      }
    } else if (h.kind === 'bomb' && now - h.at > 200) {
      explode(s, h, now);
      s.hazards.splice(i, 1);
    }
  }
}

function explode(s: FState, h: F99Hazard, now: number): void {
  addFx(s, 'boom', h.x, h.y, now, h.owner);
  for (const car of s.cars.values()) {
    const d = Math.hypot(car.x - h.x, car.y - h.y);
    if (d > F99.BOMB_RADIUS) continue;
    if (hit(s, car, now, F99.SPIN_MS + 300)) {
      const k = 260 * (1 - d / F99.BOMB_RADIUS);
      const nx = (car.x - h.x) / (d || 1);
      const ny = (car.y - h.y) / (d || 1);
      car.vx = car.vx * 0.3 + nx * k;
      car.vy = car.vy * 0.3 + ny * k;
    }
  }
}

function stepHazards(s: FState, dt: number, now: number): void {
  for (let i = s.hazards.length - 1; i >= 0; i--) {
    const h = s.hazards[i];
    if (h.kind === 'bomb') {
      h.x += h.vx * dt;
      h.y += h.vy * dt;
      const k = Math.exp(-2.6 * dt);
      h.vx *= k;
      h.vy *= k;
      if (now >= h.fuseAt) {
        explode(s, h, now);
        s.hazards.splice(i, 1);
      }
    } else if (h.kind === 'oil' && now - h.at > OIL_TTL) {
      s.hazards.splice(i, 1);
    }
  }
}

function stepMissiles(s: FState, dt: number, now: number): void {
  const geo = s.geo;
  for (let i = s.missiles.length - 1; i >= 0; i--) {
    const m = s.missiles[i];
    if (now - m.bornAt > F99.MISSILE_TTL) {
      s.missiles.splice(i, 1);
      addFx(s, 'boom', m.x, m.y, now, m.owner);
      continue;
    }
    // Apunta al objetivo; sin objetivo (o si está lejos) sigue la pista.
    const target = m.target ? s.cars.get(m.target) : undefined;
    let tx: number;
    let ty: number;
    const near = nearestSample(geo, m.x, m.y, m.idx, 20);
    m.idx = near.i;
    if (target && target.finishedAt === null && Math.hypot(target.x - m.x, target.y - m.y) < 320) {
      tx = target.x;
      ty = target.y;
    } else {
      const k = (near.i + 9) % geo.n;
      tx = geo.xs[k];
      ty = geo.ys[k];
    }
    const want = Math.atan2(ty - m.y, tx - m.x);
    let diff = want - m.a;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    const turn = F99.MISSILE_TURN * dt;
    m.a += Math.max(-turn, Math.min(turn, diff));
    m.x += Math.cos(m.a) * F99.MISSILE_SPEED * dt;
    m.y += Math.sin(m.a) * F99.MISSILE_SPEED * dt;

    for (const car of s.cars.values()) {
      if (car.finishedAt !== null) continue;
      if (car.playerId === m.owner && now - m.bornAt < 600) continue;
      if ((car.x - m.x) ** 2 + (car.y - m.y) ** 2 > (F99.CAR_R + 9) ** 2) continue;
      s.missiles.splice(i, 1);
      addFx(s, 'boom', m.x, m.y, now, m.owner);
      if (hit(s, car, now, F99.SPIN_MS + 400)) {
        car.vx *= 0.25;
        car.vy *= 0.25;
      }
      break;
    }
  }
}

function addFx(s: FState, kind: F99Fx['kind'], x: number, y: number, at: number, playerId?: string): void {
  s.fx.push({ id: s.seq++, kind, x: Math.round(x), y: Math.round(y), at, playerId });
  if (s.fx.length > 40) s.fx.shift();
}
