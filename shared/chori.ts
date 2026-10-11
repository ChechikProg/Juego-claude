/* ──────────────────────────────────────────────────────────────────────────
 *  EL ÚLTIMO CHORIPÁN — mapas y constantes compartidas.
 *  Vista desde arriba, y para abajo. Los obstáculos son rectángulos (mesas,
 *  bancos, la parrilla) y círculos (árboles, sillas, mesas redondas).
 * ────────────────────────────────────────────────────────────────────────── */

export const CH = {
  W: 1600,
  H: 1000,
  TICK_HZ: 60,
  PLAYER_R: 22,
  ACCEL: 2400,
  MAX_SPEED: 300,
  /** el que tiene el chori corre un poquito más lento */
  HOLDER_SPEED: 0.88,
  DAMP: 7,
  SPRINT_SPEED: 640,
  SPRINT_MS: 300,
  SPRINT_COOLDOWN: 3000,
  /** el que lo agarra no se lo pueden sacar enseguida */
  GRAB_IMMUNE_MS: 750,
  /** al que se le cae no lo puede volver a agarrar enseguida */
  DROP_LOCK_MS: 900,
  PICK_R: 36,
  /** vuelo del chori cuando se cae */
  CHORI_FLY: 360,
  CHORI_DAMP: 3.2,
  CHORI_AIR_MS: 380,
  BUMP: 260,
  /** choque contra el que lo tiene: hace falta esta velocidad relativa mínima */
  STEAL_SPEED: 60,
  DOG_R: 20,
  DOG_SPEED: 380,
  DOG_RUN_SPEED: 320,
  CART_R: 48,
  CART_SPEED: 420,
  CART_PUSH: 760,
  STUN_MS: 650,
  SMOKE_MS: 9000,
  /** cuánto antes se anuncia un evento */
  WARN_MS: 1800,
  EVENT_FIRST: [10_000, 16_000] as [number, number],
  EVENT_EVERY: [13_000, 21_000] as [number, number],
  RESPAWN_MS: 2200,
  COUNTDOWN_MS: 3200,
} as const;

export type ChoriObstacle =
  | { kind: 'table' | 'bench' | 'grill' | 'cooler'; r: [number, number, number, number] }
  | { kind: 'tree' | 'chair' | 'round' | 'fountain' | 'barrel'; c: [number, number, number] };

export interface ChoriMap {
  name: string;
  floor: [string, string];
  obstacles: ChoriObstacle[];
  /** dónde puede reaparecer el chori */
  choriSpots: [number, number][];
}

const chairsAround = (x: number, y: number, r: number, n: number, off = 0): ChoriObstacle[] =>
  Array.from({ length: n }, (_, i) => {
    const a = off + (i / n) * Math.PI * 2;
    return { kind: 'chair', c: [Math.round(x + Math.cos(a) * r), Math.round(y + Math.sin(a) * r), 15] } as ChoriObstacle;
  });

export const CHORI_MAPS: ChoriMap[] = [
  {
    name: 'El Quincho',
    floor: ['#c2410c', '#b23a0a'],
    obstacles: [
      { kind: 'grill', r: [660, 70, 280, 60] },
      { kind: 'table', r: [260, 280, 220, 90] },
      { kind: 'table', r: [1120, 280, 220, 90] },
      { kind: 'table', r: [260, 640, 220, 90] },
      { kind: 'table', r: [1120, 640, 220, 90] },
      { kind: 'round', c: [800, 520, 62] },
      ...chairsAround(800, 520, 100, 6, 0.5),
      { kind: 'tree', c: [130, 120, 46] },
      { kind: 'tree', c: [1470, 120, 46] },
      { kind: 'tree', c: [130, 880, 46] },
      { kind: 'tree', c: [1470, 880, 46] },
      { kind: 'cooler', r: [760, 860, 80, 50] },
    ],
    choriSpots: [
      [800, 360], [560, 500], [1040, 500], [800, 760], [400, 480], [1200, 480],
    ],
  },
  {
    name: 'La Tribuna',
    floor: ['#15803d', '#166534'],
    obstacles: [
      { kind: 'bench', r: [220, 190, 460, 42] },
      { kind: 'bench', r: [920, 190, 460, 42] },
      { kind: 'bench', r: [220, 770, 460, 42] },
      { kind: 'bench', r: [920, 770, 460, 42] },
      { kind: 'grill', r: [720, 470, 160, 60] },
      { kind: 'barrel', c: [430, 500, 34] },
      { kind: 'barrel', c: [1170, 500, 34] },
      { kind: 'tree', c: [110, 500, 44] },
      { kind: 'tree', c: [1490, 500, 44] },
      ...chairsAround(430, 500, 70, 4, 0.78),
      ...chairsAround(1170, 500, 70, 4, 0.78),
    ],
    choriSpots: [
      [800, 360], [800, 650], [300, 330], [1300, 330], [300, 660], [1300, 660],
    ],
  },
  {
    name: 'La Plaza',
    floor: ['#78716c', '#6b6560'],
    obstacles: [
      { kind: 'fountain', c: [800, 500, 105] },
      { kind: 'tree', c: [380, 250, 44] },
      { kind: 'tree', c: [1220, 250, 44] },
      { kind: 'tree', c: [380, 750, 44] },
      { kind: 'tree', c: [1220, 750, 44] },
      { kind: 'bench', r: [700, 140, 200, 36] },
      { kind: 'bench', r: [700, 824, 200, 36] },
      { kind: 'bench', r: [140, 420, 36, 160] },
      { kind: 'bench', r: [1424, 420, 36, 160] },
      { kind: 'table', r: [520, 440, 70, 120] },
      { kind: 'table', r: [1010, 440, 70, 120] },
    ],
    choriSpots: [
      [800, 320], [800, 680], [600, 500], [1000, 500], [250, 200], [1350, 800],
    ],
  },
];

/** Empuja un círculo fuera de los obstáculos. Devuelve true si tocó algo. */
export function pushOut(p: { x: number; y: number; vx: number; vy: number }, r: number, map: ChoriMap, bounce = 0.2): boolean {
  let hit = false;
  for (const o of map.obstacles) {
    let nx = 0;
    let ny = 0;
    let depth = 0;
    if ('r' in o) {
      const [x, y, w, h] = o.r;
      const cx = Math.max(x, Math.min(x + w, p.x));
      const cy = Math.max(y, Math.min(y + h, p.y));
      const dx = p.x - cx;
      const dy = p.y - cy;
      const d = Math.hypot(dx, dy);
      if (d >= r) continue;
      if (d > 1e-6) {
        nx = dx / d;
        ny = dy / d;
        depth = r - d;
      } else {
        // El centro quedó adentro: sale por el lado más cercano.
        const left = p.x - x;
        const right = x + w - p.x;
        const top = p.y - y;
        const bottom = y + h - p.y;
        const m = Math.min(left, right, top, bottom);
        if (m === left) [nx, ny, depth] = [-1, 0, left + r];
        else if (m === right) [nx, ny, depth] = [1, 0, right + r];
        else if (m === top) [nx, ny, depth] = [0, -1, top + r];
        else [nx, ny, depth] = [0, 1, bottom + r];
      }
    } else {
      const [cx, cy, cr] = o.c;
      const dx = p.x - cx;
      const dy = p.y - cy;
      const d = Math.hypot(dx, dy);
      if (d >= r + cr) continue;
      nx = d > 1e-6 ? dx / d : 1;
      ny = d > 1e-6 ? dy / d : 0;
      depth = r + cr - d;
    }
    p.x += nx * depth;
    p.y += ny * depth;
    const vn = p.vx * nx + p.vy * ny;
    if (vn < 0) {
      p.vx -= (1 + bounce) * vn * nx;
      p.vy -= (1 + bounce) * vn * ny;
    }
    hit = true;
  }
  // Bordes de la cancha.
  if (p.x < r) [p.x, p.vx] = [r, Math.abs(p.vx) * bounce];
  if (p.x > CH.W - r) [p.x, p.vx] = [CH.W - r, -Math.abs(p.vx) * bounce];
  if (p.y < r) [p.y, p.vy] = [r, Math.abs(p.vy) * bounce];
  if (p.y > CH.H - r) [p.y, p.vy] = [CH.H - r, -Math.abs(p.vy) * bounce];
  return hit;
}

/** true si el punto cae adentro de algún obstáculo (con margen). */
export function blocked(x: number, y: number, r: number, map: ChoriMap): boolean {
  for (const o of map.obstacles) {
    if ('r' in o) {
      const [ox, oy, w, h] = o.r;
      if (x > ox - r && x < ox + w + r && y > oy - r && y < oy + h + r) return true;
    } else if (Math.hypot(x - o.c[0], y - o.c[1]) < o.c[2] + r) return true;
  }
  return x < r || y < r || x > CH.W - r || y > CH.H - r;
}
