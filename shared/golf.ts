/* ──────────────────────────────────────────────────────────────────────────
 *  MINIGOLF — recorridos y física compartidos.
 *  Vista desde arriba, y para abajo. Todos los hoyos viven en una caja de
 *  GOLF.W × GOLF.H. La cancha es el polígono `outer`; `blocks` son paredes
 *  macizas adentro. Los obstáculos que se mueven dependen sólo del reloj del
 *  hoyo, así que cliente y servidor los calculan igual.
 * ────────────────────────────────────────────────────────────────────────── */

export const GOLF = {
  W: 1000,
  H: 640,
  TICK_HZ: 60,
  BALL_R: 9,
  CUP_R: 15,
  /** más rápido que esto, la pelota pasa por arriba del hoyo */
  CAPTURE_SPEED: 430,
  MAX_SHOT: 1050,
  /** arrastre (en unidades de cancha) para la potencia máxima */
  DRAG_MAX: 170,
  STOP_SPEED: 9,
  SUBSTEP: 1 / 480,
  WALL_E: 0.72,
  BUMPER_E: 1.12,
  BUMPER_MIN: 260,
  PORTAL_R: 20,
  HOLE_MS: 60_000,
  COUNTDOWN_MS: 3000,
  HOLE_END_MS: 6000,
} as const;

/** Rozamiento por superficie: exponencial (1/s) + constante (u/s²). */
const SURFACES = {
  grass: { k: 0.85, c: 70 },
  sand: { k: 4.8, c: 340 },
  ice: { k: 0.18, c: 12 },
} as const;

export type ZoneKind = 'sand' | 'water' | 'ice' | 'slope' | 'boost';

export interface GolfZone {
  kind: ZoneKind;
  /** rectángulo x, y, w, h */
  r: [number, number, number, number];
  /** pendiente: aceleración; boost: dirección (se normaliza) */
  ax?: number;
  ay?: number;
}

export interface GolfSpinner {
  x: number;
  y: number;
  len: number;
  arms: number;
  /** rad/s, con signo */
  speed: number;
  thick: number;
}

export interface GolfSlider {
  /** tamaño del bloque */
  w: number;
  h: number;
  /** centro en los dos extremos del recorrido */
  from: [number, number];
  to: [number, number];
  period: number;
  phase: number;
}

export interface GolfHoleDef {
  name: string;
  tag: string;
  par: number;
  /** golpes máximos: si no la metés antes, te anotan esto */
  max: number;
  start: [number, number];
  cup: [number, number];
  outer: number[];
  blocks?: number[][];
  zones?: GolfZone[];
  bumpers?: [number, number, number][];
  spinners?: GolfSpinner[];
  sliders?: GolfSlider[];
  /** portales de una sola mano: entrás por a, salís por b */
  portals?: { a: [number, number]; b: [number, number] }[];
  /** paleta del pasto */
  grass: [string, string];
}

const rect = (x: number, y: number, w: number, h: number): number[] => [x, y, x + w, y, x + w, y + h, x, y + h];

/** Ordenados de más fácil a más difícil. */
export const GOLF_HOLES: GolfHoleDef[] = [
  {
    name: 'La Recta',
    tag: 'Para calentar la muñeca',
    par: 2,
    max: 4,
    start: [190, 320],
    cup: [800, 320],
    outer: rect(120, 230, 760, 180),
    bumpers: [[520, 320, 22]],
    grass: ['#4ade80', '#3fc872'],
  },
  {
    name: 'El Codo',
    tag: 'Doblá a tiempo',
    par: 2,
    max: 5,
    start: [170, 490],
    cup: [640, 175],
    outer: [100, 420, 560, 420, 560, 100, 720, 100, 720, 560, 100, 560],
    grass: ['#4ade80', '#3fc872'],
  },
  {
    name: 'Bunker',
    tag: 'La arena te come la pelota',
    par: 3,
    max: 5,
    start: [170, 320],
    cup: [830, 320],
    outer: rect(100, 140, 800, 360),
    blocks: [rect(600, 140, 40, 120), rect(600, 380, 40, 120)],
    zones: [
      { kind: 'sand', r: [300, 140, 150, 230] },
      { kind: 'sand', r: [440, 290, 140, 210] },
      { kind: 'sand', r: [700, 260, 70, 120] },
    ],
    grass: ['#86efac', '#6fdc95'],
  },
  {
    name: 'Los Hongos',
    tag: 'Rebotan más de lo que pensás',
    par: 3,
    max: 6,
    start: [170, 320],
    cup: [840, 320],
    outer: rect(100, 120, 800, 400),
    bumpers: [
      [380, 220, 32],
      [380, 420, 32],
      [520, 320, 36],
      [660, 200, 32],
      [660, 440, 32],
      [760, 320, 26],
    ],
    grass: ['#4ade80', '#3fc872'],
  },
  {
    name: 'El Molino',
    tag: 'Pasá entre las aspas',
    par: 3,
    max: 6,
    start: [170, 320],
    cup: [830, 320],
    outer: rect(100, 220, 800, 200),
    blocks: [rect(540, 220, 40, 62), rect(540, 358, 40, 62)],
    spinners: [{ x: 560, y: 320, len: 92, arms: 4, speed: 1.5, thick: 12 }],
    grass: ['#a3e635', '#8ccf27'],
  },
  {
    name: 'La Laguna',
    tag: 'Un puentecito y mucha agua',
    par: 3,
    max: 7,
    start: [170, 320],
    cup: [830, 320],
    outer: rect(100, 120, 800, 400),
    zones: [
      { kind: 'water', r: [330, 120, 340, 172] },
      { kind: 'water', r: [330, 348, 340, 172] },
    ],
    bumpers: [[740, 210, 24], [740, 430, 24]],
    grass: ['#4ade80', '#3fc872'],
  },
  {
    name: 'Pista de Hielo',
    tag: 'Frenar es opcional',
    par: 3,
    max: 7,
    start: [170, 190],
    cup: [190, 450],
    outer: rect(100, 100, 800, 440),
    blocks: [rect(100, 280, 600, 80)],
    zones: [
      { kind: 'ice', r: [420, 100, 480, 180] },
      { kind: 'ice', r: [700, 100, 200, 440] },
      { kind: 'ice', r: [380, 360, 520, 180] },
    ],
    bumpers: [[800, 320, 26]],
    grass: ['#bbf7d0', '#a7f0c0'],
  },
  {
    name: 'La Rampa',
    tag: 'Las pendientes tiran para cualquier lado',
    par: 3,
    max: 7,
    start: [170, 320],
    cup: [830, 190],
    outer: rect(100, 100, 800, 440),
    blocks: [rect(480, 100, 80, 290)],
    zones: [
      { kind: 'slope', r: [290, 100, 190, 440], ax: 0, ay: 300 },
      { kind: 'slope', r: [560, 100, 190, 440], ax: 0, ay: -320 },
    ],
    grass: ['#4ade80', '#3fc872'],
  },
  {
    name: 'Zigzag',
    tag: 'Banda, banda y adentro',
    par: 4,
    max: 8,
    start: [180, 180],
    cup: [830, 170],
    outer: rect(100, 100, 800, 440),
    blocks: [rect(290, 100, 34, 330), rect(500, 210, 34, 330), rect(710, 100, 34, 330)],
    bumpers: [[410, 480, 20], [620, 160, 20]],
    grass: ['#86efac', '#6fdc95'],
  },
  {
    name: 'Las Puertas',
    tag: 'Esperá el momento justo',
    par: 4,
    max: 8,
    start: [160, 320],
    cup: [845, 320],
    outer: rect(100, 220, 800, 200),
    sliders: [
      { w: 28, h: 110, from: [330, 275], to: [330, 365], period: 2400, phase: 0 },
      { w: 28, h: 110, from: [520, 365], to: [520, 275], period: 1900, phase: 1.2 },
      { w: 28, h: 110, from: [710, 275], to: [710, 365], period: 1500, phase: 2.4 },
    ],
    grass: ['#a3e635', '#8ccf27'],
  },
  {
    name: 'La Isla',
    tag: 'Un puente finito y el turbo',
    par: 4,
    max: 9,
    start: [160, 320],
    cup: [800, 250],
    outer: rect(80, 80, 840, 480),
    sliders: [{ w: 24, h: 64, from: [664, 268], to: [664, 372], period: 2300, phase: 0 }],
    zones: [
      { kind: 'water', r: [420, 80, 500, 160] },
      { kind: 'water', r: [420, 400, 500, 160] },
      { kind: 'water', r: [420, 240, 220, 58] },
      { kind: 'water', r: [420, 342, 220, 58] },
      { kind: 'boost', r: [300, 296, 60, 48], ax: 1, ay: 0 },
    ],
    bumpers: [[200, 170, 26], [200, 470, 26], [860, 320, 22]],
    grass: ['#4ade80', '#3fc872'],
  },
  {
    name: 'El Gran Final',
    tag: 'Arena, molino, laguna y un atajo',
    par: 5,
    max: 10,
    start: [160, 480],
    cup: [180, 220],
    outer: rect(80, 80, 840, 480),
    blocks: [rect(80, 368, 680, 34)],
    zones: [
      { kind: 'sand', r: [300, 402, 130, 158] },
      { kind: 'water', r: [400, 160, 200, 208] },
      { kind: 'ice', r: [600, 80, 320, 120] },
    ],
    spinners: [{ x: 840, y: 385, len: 74, arms: 3, speed: -2.1, thick: 12 }],
    bumpers: [[290, 290, 26], [320, 140, 24]],
    portals: [{ a: [620, 480], b: [700, 250] }],
    grass: ['#86efac', '#6fdc95'],
  },
];

/* ── geometría que depende del reloj ──────────────────────────────────────── */

export interface Seg {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** radio extra (aspas gruesas) */
  r: number;
  /** superficie que se mueve: velocidad en un punto */
  vel?: (x: number, y: number) => [number, number];
}

const staticCache = new Map<number, Seg[]>();

function polySegs(poly: number[], out: Seg[]): void {
  const n = poly.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    out.push({ x1: poly[i * 2], y1: poly[i * 2 + 1], x2: poly[j * 2], y2: poly[j * 2 + 1], r: 0 });
  }
}

/** Paredes fijas del hoyo. */
export function staticSegs(index: number): Seg[] {
  const hit = staticCache.get(index);
  if (hit) return hit;
  const def = GOLF_HOLES[index];
  const out: Seg[] = [];
  polySegs(def.outer, out);
  for (const b of def.blocks ?? []) polySegs(b, out);
  staticCache.set(index, out);
  return out;
}

/** Ángulo de un molino en el instante t (ms desde que arrancó el hoyo). */
export function spinnerAngle(s: GolfSpinner, t: number): number {
  return (t / 1000) * s.speed;
}

/** Centro de una puerta corrediza en el instante t y su velocidad. */
export function sliderAt(s: GolfSlider, t: number): { x: number; y: number; vx: number; vy: number } {
  const w = (Math.PI * 2) / s.period;
  const k = 0.5 - 0.5 * Math.cos(w * t + s.phase);
  const dk = 0.5 * Math.sin(w * t + s.phase) * w * 1000;
  return {
    x: s.from[0] + (s.to[0] - s.from[0]) * k,
    y: s.from[1] + (s.to[1] - s.from[1]) * k,
    vx: (s.to[0] - s.from[0]) * dk,
    vy: (s.to[1] - s.from[1]) * dk,
  };
}

/** Paredes móviles en el instante t. */
export function movingSegs(def: GolfHoleDef, t: number): Seg[] {
  const out: Seg[] = [];
  for (const sp of def.spinners ?? []) {
    const a0 = spinnerAngle(sp, t);
    const vel = (x: number, y: number): [number, number] => [-(y - sp.y) * sp.speed, (x - sp.x) * sp.speed];
    for (let i = 0; i < sp.arms; i++) {
      const a = a0 + (i * Math.PI * 2) / sp.arms;
      out.push({ x1: sp.x, y1: sp.y, x2: sp.x + Math.cos(a) * sp.len, y2: sp.y + Math.sin(a) * sp.len, r: sp.thick / 2, vel });
    }
  }
  for (const sl of def.sliders ?? []) {
    const c = sliderAt(sl, t);
    const vel = (): [number, number] => [c.vx, c.vy];
    const x = c.x - sl.w / 2;
    const y = c.y - sl.h / 2;
    const poly = rect(x, y, sl.w, sl.h);
    const n = 4;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      out.push({ x1: poly[i * 2], y1: poly[i * 2 + 1], x2: poly[j * 2], y2: poly[j * 2 + 1], r: 0, vel });
    }
  }
  return out;
}

/* ── física de la pelota ──────────────────────────────────────────────────── */

export interface BallSim {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export type StepEvent = 'wall' | 'bumper' | 'water' | 'cup' | 'boost' | 'warp' | null;

const inRect = (x: number, y: number, r: [number, number, number, number]) =>
  x >= r[0] && x <= r[0] + r[2] && y >= r[1] && y <= r[1] + r[3];

/**
 * Avanza la pelota `dt` segundos (en sub-pasos). Devuelve el evento más
 * importante que pasó: el servidor lo usa para el agua y el hoyo, el cliente
 * sólo para predecir. `t` es el reloj del hoyo en ms al empezar.
 */
export function stepBall(b: BallSim, index: number, dt: number, t: number): StepEvent {
  const def = GOLF_HOLES[index];
  const walls = staticSegs(index);
  let event: StepEvent = null;
  const steps = Math.max(1, Math.ceil(dt / GOLF.SUBSTEP));
  const h = dt / steps;
  for (let s = 0; s < steps; s++) {
    const tt = t + s * h * 1000;
    const speed = Math.hypot(b.vx, b.vy);
    if (speed === 0) break;

    // Superficie y zonas.
    let surf: { k: number; c: number } = SURFACES.grass;
    for (const z of def.zones ?? []) {
      if (!inRect(b.x, b.y, z.r)) continue;
      if (z.kind === 'sand') surf = SURFACES.sand;
      else if (z.kind === 'ice') surf = SURFACES.ice;
      else if (z.kind === 'water') return 'water';
      else if (z.kind === 'slope') {
        b.vx += (z.ax ?? 0) * h;
        b.vy += (z.ay ?? 0) * h;
      } else if (z.kind === 'boost') {
        const l = Math.hypot(z.ax ?? 1, z.ay ?? 0) || 1;
        b.vx += ((z.ax ?? 1) / l) * 2400 * h;
        b.vy += ((z.ay ?? 0) / l) * 2400 * h;
        const sp = Math.hypot(b.vx, b.vy);
        if (sp > GOLF.MAX_SHOT * 1.15) {
          b.vx *= (GOLF.MAX_SHOT * 1.15) / sp;
          b.vy *= (GOLF.MAX_SHOT * 1.15) / sp;
        }
        event = event ?? 'boost';
      }
    }

    // Rozamiento.
    const sp0 = Math.hypot(b.vx, b.vy);
    let sp1 = sp0 * Math.exp(-surf.k * h) - surf.c * h;
    if (sp1 < 0) sp1 = 0;
    if (sp0 > 0) {
      b.vx *= sp1 / sp0;
      b.vy *= sp1 / sp0;
    }

    // El hoyo: si viene despacio, adentro; si viene rápido, lo desvía un poco.
    const dxc = def.cup[0] - b.x;
    const dyc = def.cup[1] - b.y;
    const dc = Math.hypot(dxc, dyc);
    if (dc < GOLF.CUP_R) {
      if (sp1 < GOLF.CAPTURE_SPEED) {
        b.x = def.cup[0];
        b.y = def.cup[1];
        b.vx = 0;
        b.vy = 0;
        return 'cup';
      }
      b.vx += (dxc / (dc || 1)) * 1600 * h;
      b.vy += (dyc / (dc || 1)) * 1600 * h;
    }

    b.x += b.vx * h;
    b.y += b.vy * h;

    // Portales.
    for (const p of def.portals ?? []) {
      if (Math.hypot(b.x - p.a[0], b.y - p.a[1]) < GOLF.PORTAL_R) {
        const sp = Math.hypot(b.vx, b.vy) || 1;
        b.x = p.b[0] + (b.vx / sp) * (GOLF.PORTAL_R + 4);
        b.y = p.b[1] + (b.vy / sp) * (GOLF.PORTAL_R + 4);
        event = 'warp';
      }
    }

    // Paredes fijas y móviles.
    if (collideSegs(b, walls)) event = event ?? 'wall';
    if (def.spinners || def.sliders) {
      if (collideSegs(b, movingSegs(def, tt))) event = event ?? 'wall';
    }

    // Hongos.
    for (const [cx, cy, r] of def.bumpers ?? []) {
      const dx = b.x - cx;
      const dy = b.y - cy;
      const d = Math.hypot(dx, dy);
      const min = r + GOLF.BALL_R;
      if (d >= min || d === 0) continue;
      const nx = dx / d;
      const ny = dy / d;
      b.x = cx + nx * min;
      b.y = cy + ny * min;
      const vn = b.vx * nx + b.vy * ny;
      if (vn < 0) {
        b.vx -= (1 + GOLF.BUMPER_E) * vn * nx;
        b.vy -= (1 + GOLF.BUMPER_E) * vn * ny;
        const out = b.vx * nx + b.vy * ny;
        if (out < GOLF.BUMPER_MIN) {
          b.vx += (GOLF.BUMPER_MIN - out) * nx;
          b.vy += (GOLF.BUMPER_MIN - out) * ny;
        }
        event = 'bumper';
      }
    }

    if (Math.hypot(b.vx, b.vy) < GOLF.STOP_SPEED) {
      // Sobre una pendiente no se frena del todo hasta que la pendiente lo suelte.
      const onSlope = (def.zones ?? []).some((z) => z.kind === 'slope' && inRect(b.x, b.y, z.r));
      if (!onSlope) {
        b.vx = 0;
        b.vy = 0;
        break;
      }
    }
  }
  return event;
}

function collideSegs(b: BallSim, segs: Seg[]): boolean {
  let hit = false;
  for (const s of segs) {
    const ex = s.x2 - s.x1;
    const ey = s.y2 - s.y1;
    const len2 = ex * ex + ey * ey || 1;
    let u = ((b.x - s.x1) * ex + (b.y - s.y1) * ey) / len2;
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    const px = s.x1 + ex * u;
    const py = s.y1 + ey * u;
    const dx = b.x - px;
    const dy = b.y - py;
    const d = Math.hypot(dx, dy);
    const min = GOLF.BALL_R + s.r;
    if (d >= min) continue;
    let nx: number;
    let ny: number;
    if (d > 1e-6) {
      nx = dx / d;
      ny = dy / d;
    } else {
      // Justo encima de la línea: empujamos por la normal del segmento.
      const l = Math.sqrt(len2);
      nx = -ey / l;
      ny = ex / l;
    }
    b.x = px + nx * min;
    b.y = py + ny * min;
    const [svx, svy] = s.vel ? s.vel(px, py) : [0, 0];
    const rvx = b.vx - svx;
    const rvy = b.vy - svy;
    const vn = rvx * nx + rvy * ny;
    if (vn < 0) {
      b.vx -= (1 + GOLF.WALL_E) * vn * nx;
      b.vy -= (1 + GOLF.WALL_E) * vn * ny;
      if (-vn > 40) hit = true;
    }
  }
  return hit;
}

/** Elige `n` hoyos al azar respetando el orden de dificultad. */
export function pickCourse(n: number, rand: () => number): number[] {
  const all = GOLF_HOLES.map((_, i) => i);
  if (n >= all.length) return all;
  // Siempre arranca por uno de los dos primeros y termina con uno de los dos últimos.
  const first = rand() < 0.5 ? 0 : 1;
  const last = all.length - (rand() < 0.6 ? 1 : 2);
  const middle = all.filter((i) => i > first && i < last);
  for (let i = middle.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [middle[i], middle[j]] = [middle[j], middle[i]];
  }
  const chosen = n <= 2 ? [first, last].slice(0, n) : [first, ...middle.slice(0, n - 2), last];
  return chosen.sort((a, b) => a - b);
}
