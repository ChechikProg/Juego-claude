/* ──────────────────────────────────────────────────────────────────────────
 *  FÓRMULA 99 — pistas y física compartidas.
 *  Cada pista es una línea central cerrada (puntos de control suavizados con
 *  Catmull-Rom). Cliente y servidor generan exactamente la misma geometría.
 * ────────────────────────────────────────────────────────────────────────── */

export const F99 = {
  TICK_HZ: 60,
  CAR_R: 15,
  /** velocidad máxima en asfalto (u/s) */
  MAX_SPEED: 340,
  ACCEL: 300,
  BRAKE: 620,
  REVERSE_MAX: 120,
  /** frenado sin acelerar (1/s) */
  COAST: 0.55,
  /** giro máximo (rad/s) a buena velocidad */
  TURN: 2.9,
  /** agarre lateral: cuanto más alto, menos derrapa (1/s) */
  GRIP: 9,
  /** en el pasto: tope de velocidad y frenado extra */
  GRASS_MAX: 0.48,
  BOOST_MULT: 1.6,
  BOOST_MS: 1500,
  PAD_MS: 700,
  SPIN_MS: 1100,
  OIL_MS: 1300,
  ZAP_MS: 3000,
  ZAP_MULT: 0.62,
  SHIELD_MS: 7000,
  MISSILE_SPEED: 600,
  MISSILE_TURN: 4.2,
  MISSILE_TTL: 4500,
  BOMB_FUSE: 1500,
  BOMB_RADIUS: 95,
  BANANA_R: 13,
  OIL_R: 30,
  BOX_R: 16,
  BOX_RESPAWN: 1600,
  /** el que llega primero dispara una cuenta de esto para el resto */
  FINISH_GRACE_MS: 25_000,
  /** si la carrera se estira mucho, se corta igual */
  RACE_MAX_MS: 210_000,
  COUNTDOWN_MS: 4200,
  PODIUM_MS: 7000,
  LAPS: 3,
  /** paso de muestreo de la línea central */
  SAMPLE_STEP: 12,
} as const;

/** Puntos por puesto en cada carrera. */
export const F99_POINTS = [15, 12, 10, 8, 7, 6, 5, 4, 3, 2, 1, 0];

export interface TrackTheme {
  name: string;
  /** subtítulo con onda */
  tag: string;
  grass: [string, string];
  asphalt: string;
  curb: [string, string];
  edge: string;
  deco: 'trees' | 'palms' | 'pines';
  decoColor: string;
}

export interface TrackDef {
  theme: TrackTheme;
  width: number;
  /** puntos de control de la línea central, en sentido de carrera */
  points: [number, number][];
  /** cajas de objetos: fracción de vuelta donde está la fila */
  boxesAt: number[];
  /** flechas de turbo: fracción de vuelta */
  padsAt: number[];
}

export const TRACKS: TrackDef[] = [
  {
    theme: {
      name: 'Autódromo del Bajo',
      tag: 'Curvones rápidos y una ese en el medio',
      grass: ['#3f9b45', '#2f7e38'],
      asphalt: '#3b3f4a',
      curb: ['#ef4444', '#f8fafc'],
      edge: '#f8fafc',
      deco: 'trees',
      decoColor: '#1f6b2c',
    },
    width: 132,
    points: [
      [420, 980], [330, 760], [360, 520], [520, 330], [800, 270], [1080, 330],
      [1240, 520], [1450, 600], [1700, 470], [1960, 420], [2140, 600], [2110, 860],
      [1880, 980], [1600, 960], [1380, 1080], [1120, 1230], [800, 1230], [560, 1150],
    ],
    boxesAt: [0.36, 0.78],
    padsAt: [0.1, 0.58],
  },
  {
    theme: {
      name: 'Costanera Sur',
      tag: 'Rectas al lado del río y una chicana',
      grass: ['#e8cf8f', '#d9bb72'],
      asphalt: '#454b57',
      curb: ['#0ea5e9', '#f8fafc'],
      edge: '#fef3c7',
      deco: 'palms',
      decoColor: '#15803d',
    },
    width: 128,
    points: [
      [380, 760], [420, 470], [640, 300], [1000, 260], [1400, 260], [1800, 290],
      [2080, 440], [2120, 700], [1920, 820], [1640, 760], [1430, 850], [1420, 1000], [1600, 1095],
      [1880, 1120], [1980, 1330], [1700, 1460], [1240, 1470], [800, 1420], [500, 1240],
      [360, 1010],
    ],
    boxesAt: [0.2, 0.76],
    padsAt: [0.08, 0.83],
  },
  {
    theme: {
      name: 'Cerro Nevado',
      tag: 'Caracoles de montaña entre pinos',
      grass: ['#e2e8f0', '#cbd5e1'],
      asphalt: '#334155',
      curb: ['#dc2626', '#f8fafc'],
      edge: '#f1f5f9',
      deco: 'pines',
      decoColor: '#14532d',
    },
    width: 126,
    points: [
      [360, 420], [700, 280], [1040, 380], [1060, 660], [800, 780], [620, 980],
      [820, 1200], [1160, 1160], [1360, 900], [1560, 640], [1860, 560], [2120, 740],
      [2070, 1030], [1920, 1250], [2010, 1430], [1900, 1560], [1640, 1600], [1180, 1560], [760, 1560],
      [400, 1440], [270, 1100], [300, 720],
    ],
    boxesAt: [0.3, 0.72],
    padsAt: [0.5, 0.88],
  },
];

export interface TrackGeo {
  /** muestras de la línea central */
  xs: Float64Array;
  ys: Float64Array;
  /** tangente unitaria en cada muestra */
  tx: Float64Array;
  ty: Float64Array;
  n: number;
  width: number;
  /** caja que contiene a la pista */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** posiciones de las cajas de objetos */
  boxes: { x: number; y: number }[];
  /** flechas de turbo: centro y dirección */
  pads: { x: number; y: number; a: number; i: number }[];
}

const cache = new Map<number, TrackGeo>();

/** Muestrea la pista con Catmull-Rom centrípeta cerrada. */
export function trackGeo(index: number): TrackGeo {
  const hit = cache.get(index);
  if (hit) return hit;
  const def = TRACKS[index] ?? TRACKS[0];
  const pts = def.points;
  const m = pts.length;

  // Primero densamente, después re-muestreamos a paso fijo.
  const dense: [number, number][] = [];
  for (let i = 0; i < m; i++) {
    const p0 = pts[(i - 1 + m) % m];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % m];
    const p3 = pts[(i + 2) % m];
    for (let s = 0; s < 40; s++) dense.push(catmull(p0, p1, p2, p3, s / 40));
  }
  let total = 0;
  const cum = [0];
  for (let i = 1; i <= dense.length; i++) {
    const a = dense[i - 1];
    const b = dense[i % dense.length];
    total += Math.hypot(b[0] - a[0], b[1] - a[1]);
    cum.push(total);
  }
  const n = Math.max(40, Math.round(total / F99.SAMPLE_STEP));
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  let j = 0;
  for (let k = 0; k < n; k++) {
    const target = (k / n) * total;
    while (cum[j + 1] < target) j++;
    const a = dense[j];
    const b = dense[(j + 1) % dense.length];
    const seg = cum[j + 1] - cum[j] || 1;
    const t = (target - cum[j]) / seg;
    xs[k] = a[0] + (b[0] - a[0]) * t;
    ys[k] = a[1] + (b[1] - a[1]) * t;
  }
  const tx = new Float64Array(n);
  const ty = new Float64Array(n);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let k = 0; k < n; k++) {
    const nx = xs[(k + 1) % n] - xs[(k - 1 + n) % n];
    const ny = ys[(k + 1) % n] - ys[(k - 1 + n) % n];
    const l = Math.hypot(nx, ny) || 1;
    tx[k] = nx / l;
    ty[k] = ny / l;
    minX = Math.min(minX, xs[k]);
    minY = Math.min(minY, ys[k]);
    maxX = Math.max(maxX, xs[k]);
    maxY = Math.max(maxY, ys[k]);
  }

  const w = def.width;
  const boxes: { x: number; y: number }[] = [];
  for (const f of def.boxesAt) {
    const k = Math.floor(f * n) % n;
    // Fila de 4 cajas a lo ancho de la pista.
    for (const off of [-0.33, -0.11, 0.11, 0.33]) {
      boxes.push({ x: xs[k] - ty[k] * off * w, y: ys[k] + tx[k] * off * w });
    }
  }
  const pads = def.padsAt.map((f, idx) => {
    const k = Math.floor(f * n) % n;
    const off = idx % 2 ? 0.22 : -0.22;
    return { x: xs[k] - ty[k] * off * w, y: ys[k] + tx[k] * off * w, a: Math.atan2(ty[k], tx[k]), i: k };
  });

  const geo: TrackGeo = {
    xs, ys, tx, ty, n, width: w,
    minX: minX - w, minY: minY - w, maxX: maxX + w, maxY: maxY + w,
    boxes, pads,
  };
  cache.set(index, geo);
  return geo;
}

function catmull(
  p0: [number, number],
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
  t: number,
): [number, number] {
  // Catmull-Rom centrípeta (alpha 0.5): no hace rulos en las curvas cerradas.
  const alpha = 0.5;
  const d = (a: [number, number], b: [number, number]) => Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), alpha) || 1e-4;
  const t0 = 0;
  const t1 = t0 + d(p0, p1);
  const t2 = t1 + d(p1, p2);
  const t3 = t2 + d(p2, p3);
  const u = t1 + (t2 - t1) * t;
  const lerp = (a: [number, number], b: [number, number], ta: number, tb: number): [number, number] => {
    const k = (u - ta) / (tb - ta);
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
  };
  const a1 = lerp(p0, p1, t0, t1);
  const a2 = lerp(p1, p2, t1, t2);
  const a3 = lerp(p2, p3, t2, t3);
  const b1 = lerp(a1, a2, t0, t2);
  const b2 = lerp(a2, a3, t1, t3);
  return lerp(b1, b2, t1, t2);
}

/**
 * Muestra más cercana. Si se pasa `hint`, busca sólo en una ventana alrededor
 * (así no salta a otro tramo de la pista que pase cerca).
 */
export function nearestSample(geo: TrackGeo, x: number, y: number, hint = -1, window = 40): { i: number; d: number } {
  let best = 0;
  let bestD = Infinity;
  if (hint >= 0) {
    for (let o = -window; o <= window; o++) {
      const k = (hint + o + geo.n) % geo.n;
      const d = (geo.xs[k] - x) ** 2 + (geo.ys[k] - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
  } else {
    for (let k = 0; k < geo.n; k++) {
      const d = (geo.xs[k] - x) ** 2 + (geo.ys[k] - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
  }
  return { i: best, d: Math.sqrt(bestD) };
}

/** Posiciones de largada: dos filas escalonadas detrás de la línea. */
export function gridSlots(geo: TrackGeo, count: number): { x: number; y: number; a: number; i: number }[] {
  const out: { x: number; y: number; a: number; i: number }[] = [];
  for (let s = 0; s < count; s++) {
    const back = 3 + Math.floor(s / 2) * 4 + (s % 2) * 2;
    const k = (geo.n - back) % geo.n;
    const side = s % 2 ? 0.22 : -0.22;
    out.push({
      x: geo.xs[k] - geo.ty[k] * side * geo.width,
      y: geo.ys[k] + geo.tx[k] * side * geo.width,
      a: Math.atan2(geo.ty[k], geo.tx[k]),
      i: k,
    });
  }
  return out;
}

/** Lo que necesita la física de manejo (lo comparten servidor y predicción del cliente). */
export interface DriveState {
  x: number;
  y: number;
  a: number;
  vx: number;
  vy: number;
  spinUntil: number;
  spinDir: number;
  boostUntil: number;
  padUntil: number;
  shrinkUntil: number;
  oilUntil: number;
  offTrack: boolean;
}

/** Un paso de manejo arcade: acelerar, frenar, doblar y derrapar. */
export function driveStep(car: DriveState, throttle: number, steer: number, dt: number, now: number): void {
  const spinning = now < car.spinUntil;
  let fx = Math.cos(car.a);
  let fy = Math.sin(car.a);
  let vf = car.vx * fx + car.vy * fy;
  let vr = car.vx * -fy + car.vy * fx;

  const boosting = now < car.boostUntil;
  const padding = now < car.padUntil;
  let max: number = F99.MAX_SPEED;
  if (boosting) max *= F99.BOOST_MULT;
  else if (padding) max *= 1.35;
  if (now < car.shrinkUntil) max *= F99.ZAP_MULT;
  if (car.offTrack && !boosting) max *= F99.GRASS_MAX;

  if (spinning) {
    car.a += car.spinDir * 11 * dt;
    vf *= Math.exp(-2.4 * dt);
  } else {
    if (boosting || padding) vf += F99.ACCEL * 2.2 * dt;
    if (throttle > 0) {
      if (vf < max) vf = Math.min(max, vf + F99.ACCEL * dt * (vf < 0 ? 2 : 1));
    } else if (throttle < 0) {
      if (vf > 0) vf = Math.max(0, vf - F99.BRAKE * dt);
      else vf = Math.max(-F99.REVERSE_MAX, vf - F99.ACCEL * 0.7 * dt);
    } else {
      vf *= Math.exp(-F99.COAST * dt);
    }
    // Pasado el tope (se terminó el turbo, entró al pasto) frena de a poco.
    if (vf > max) vf = Math.max(max, vf - (car.offTrack ? 560 : 260) * dt);

    // El giro depende de la velocidad: quieto no dobla, en reversa dobla al revés.
    const speedK = Math.min(1, Math.abs(vf) / 150);
    const wobble = now < car.oilUntil ? Math.sin(now / 90) * 0.9 : 0;
    car.a += (steer + wobble) * F99.TURN * speedK * Math.sign(vf || 1) * dt;
  }

  // Agarre lateral: en el aceite o trompeando derrapa mucho más.
  const grip = spinning ? 0.8 : now < car.oilUntil ? 1.3 : car.offTrack ? 5 : F99.GRIP;
  vr *= Math.exp(-grip * dt);

  fx = Math.cos(car.a);
  fy = Math.sin(car.a);
  car.vx = fx * vf - fy * vr;
  car.vy = fy * vf + fx * vr;
  car.x += car.vx * dt;
  car.y += car.vy * dt;
}
