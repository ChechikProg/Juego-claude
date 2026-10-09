/* ──────────────────────────────────────────────────────────────────────────
 *  EL TANQUE JUAN — geometría y física compartidas.
 *  El laberinto sale de una semilla: cliente y servidor generan exactamente
 *  las mismas paredes, así no hace falta mandarlas por el socket. Las balas
 *  usan el mismo paso de simulación de los dos lados para que el cliente
 *  pueda predecir los rebotes entre snapshots.
 * ────────────────────────────────────────────────────────────────────────── */

export const TANK = {
  COLS: 10,
  ROWS: 7,
  CELL: 92,
  /** grosor de pared */
  WALL: 10,
  TANK_R: 15,
  SPEED: 150,
  REVERSE: 0.65,
  TURN: 3.4,
  BULLET_R: 4,
  BULLET_SPEED: 300,
  BULLET_TTL: 6000,
  MAX_BULLETS: 5,
  COOLDOWN: 380,
  /** la bala propia no te mata hasta que pasa esto */
  OWNER_GRACE: 140,
  RESPAWN_MS: 3000,
  SHIELD_MS: 1400,
  TICK_HZ: 60,
  /** paso fijo de la simulación de balas, en segundos */
  BULLET_STEP: 1 / 120,
} as const;

export const TANK_W = TANK.COLS * TANK.CELL;
export const TANK_H = TANK.ROWS * TANK.CELL;

/** Rectángulo de pared: x, y, ancho, alto. */
export type Wall = [number, number, number, number];

/** PRNG determinístico (mulberry32). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Laberinto perfecto por DFS al que después se le abren paredes extra para que
 * haya varios caminos (si no, con muchos jugadores es un embudo).
 */
export function buildMaze(seed: number): Wall[] {
  const { COLS, ROWS, CELL, WALL } = TANK;
  const rand = seeded(seed);

  // h[r][c]: pared superior de la celda (r,c), r en 0..ROWS
  // v[r][c]: pared izquierda de la celda (r,c), c en 0..COLS
  const h = Array.from({ length: ROWS + 1 }, () => Array<boolean>(COLS).fill(true));
  const v = Array.from({ length: ROWS }, () => Array<boolean>(COLS + 1).fill(true));

  const seen = Array.from({ length: ROWS }, () => Array<boolean>(COLS).fill(false));
  const stack: [number, number][] = [[Math.floor(rand() * ROWS), Math.floor(rand() * COLS)]];
  seen[stack[0][0]][stack[0][1]] = true;
  while (stack.length) {
    const [r, c] = stack[stack.length - 1];
    const options: [number, number, number][] = [];
    if (r > 0 && !seen[r - 1][c]) options.push([r - 1, c, 0]);
    if (r < ROWS - 1 && !seen[r + 1][c]) options.push([r + 1, c, 1]);
    if (c > 0 && !seen[r][c - 1]) options.push([r, c - 1, 2]);
    if (c < COLS - 1 && !seen[r][c + 1]) options.push([r, c + 1, 3]);
    if (!options.length) {
      stack.pop();
      continue;
    }
    const [nr, nc, dir] = options[Math.floor(rand() * options.length)];
    if (dir === 0) h[r][c] = false;
    else if (dir === 1) h[r + 1][c] = false;
    else if (dir === 2) v[r][c] = false;
    else v[r][c + 1] = false;
    seen[nr][nc] = true;
    stack.push([nr, nc]);
  }

  // Abrimos un buen porcentaje de las paredes interiores.
  for (let r = 1; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (h[r][c] && rand() < 0.42) h[r][c] = false;
  for (let r = 0; r < ROWS; r++) for (let c = 1; c < COLS; c++) if (v[r][c] && rand() < 0.42) v[r][c] = false;

  const walls: Wall[] = [];
  const half = WALL / 2;

  // Horizontales: unimos tramos contiguos en un solo rectángulo.
  for (let r = 0; r <= ROWS; r++) {
    let start = -1;
    for (let c = 0; c <= COLS; c++) {
      const on = c < COLS && h[r][c];
      if (on && start < 0) start = c;
      if (!on && start >= 0) {
        walls.push([start * CELL - half, r * CELL - half, (c - start) * CELL + WALL, WALL]);
        start = -1;
      }
    }
  }
  // Verticales.
  for (let c = 0; c <= COLS; c++) {
    let start = -1;
    for (let r = 0; r <= ROWS; r++) {
      const on = r < ROWS && v[r][c];
      if (on && start < 0) start = r;
      if (!on && start >= 0) {
        walls.push([c * CELL - half, start * CELL - half, WALL, (r - start) * CELL + WALL]);
        start = -1;
      }
    }
  }
  return walls;
}

/** Saca un círculo de las paredes. Devuelve true si tocó alguna. */
export function pushOutOfWalls(p: { x: number; y: number }, r: number, walls: Wall[]): boolean {
  let touched = false;
  for (const [wx, wy, ww, wh] of walls) {
    const cx = Math.max(wx, Math.min(p.x, wx + ww));
    const cy = Math.max(wy, Math.min(p.y, wy + wh));
    const dx = p.x - cx;
    const dy = p.y - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 >= r * r) continue;
    touched = true;
    if (d2 > 1e-6) {
      const d = Math.sqrt(d2);
      p.x += (dx / d) * (r - d);
      p.y += (dy / d) * (r - d);
    } else {
      // El centro quedó adentro de la pared: salimos por el lado más cercano.
      const left = p.x - wx;
      const right = wx + ww - p.x;
      const top = p.y - wy;
      const bottom = wy + wh - p.y;
      const m = Math.min(left, right, top, bottom);
      if (m === left) p.x = wx - r;
      else if (m === right) p.x = wx + ww + r;
      else if (m === top) p.y = wy - r;
      else p.y = wy + wh + r;
    }
  }
  return touched;
}

export function circleHitsWall(x: number, y: number, r: number, walls: Wall[]): boolean {
  for (const [wx, wy, ww, wh] of walls) {
    const cx = Math.max(wx, Math.min(x, wx + ww));
    const cy = Math.max(wy, Math.min(y, wy + wh));
    const dx = x - cx;
    const dy = y - cy;
    if (dx * dx + dy * dy < r * r) return true;
  }
  return false;
}

/**
 * Avanza una bala un paso y la hace rebotar contra las paredes.
 * Devuelve true si rebotó.
 */
export function stepBullet(b: { x: number; y: number; vx: number; vy: number }, dt: number, walls: Wall[]): boolean {
  const r = TANK.BULLET_R;
  let bounced = false;

  // Primero en x, después en y: así el eje del rebote sale solo.
  b.x += b.vx * dt;
  for (const [wx, wy, ww, wh] of walls) {
    if (b.x + r > wx && b.x - r < wx + ww && b.y + r > wy && b.y - r < wy + wh) {
      b.x = b.vx > 0 ? wx - r : wx + ww + r;
      b.vx = -b.vx;
      bounced = true;
      break;
    }
  }
  b.y += b.vy * dt;
  for (const [wx, wy, ww, wh] of walls) {
    if (b.x + r > wx && b.x - r < wx + ww && b.y + r > wy && b.y - r < wy + wh) {
      b.y = b.vy > 0 ? wy - r : wy + wh + r;
      b.vy = -b.vy;
      bounced = true;
      break;
    }
  }
  return bounced;
}

/** Centro de una celda al azar. */
export function cellCenter(col: number, row: number): { x: number; y: number } {
  return { x: (col + 0.5) * TANK.CELL, y: (row + 0.5) * TANK.CELL };
}
