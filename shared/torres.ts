/* ──────────────────────────────────────────────────────────────────────────
 *  LAS TORRES DE TITI — piezas y constantes compartidas.
 *  Unidad = una celda. Eje y hacia arriba (como Box2D): el tope de la base
 *  está en y = 0 y la meta en y = GOAL. Cada jugador construye en su propio
 *  carril, centrado en x = 0.
 * ────────────────────────────────────────────────────────────────────────── */

import type { TorresAbility } from './types';

export const TT = {
  TICK_HZ: 60,
  /** ancho de la base donde se apoya la torre */
  BASE_W: 6,
  /** hasta dónde se puede mover la pieza a cada lado */
  LANE_HALF: 7,
  /** altura de la meta (en celdas sobre la base) */
  GOAL: 26,
  /** hay que sostener la torre por encima de la meta este tiempo */
  HOLD_MS: 3000,
  /** la pieza nueva aparece esta altura por encima de la torre */
  SPAWN_ABOVE: 8,
  FALL_SPEED: 2.4,
  FAST_SPEED: 13,
  /** paso lateral de la pieza: una celda entera, siempre alineada a la grilla */
  STEP: 1,
  GRAVITY: 18,
  FRICTION: 0.9,
  DENSITY: 1,
  /** una pieza que cae debajo de esto se pierde */
  LOST_Y: -14,
  /** pausa entre que se apoya una pieza y aparece la siguiente */
  SPAWN_DELAY: 260,
  /** cada tantas piezas apoyadas ganás un poder */
  PIECES_PER_POWER: 7,
  MAX_POWERS: 2,
  /** una de cada tantas piezas sale dorada: al apoyarla te da un poder */
  GOLDEN_EVERY: 11,
  QUAKE_MS: 1500,
  QUAKE_AMP: 0.15,
  /** viento: cada tanto sopla y empuja las piezas que caen */
  WIND_EVERY: [32_000, 46_000] as [number, number],
  WIND_MS: 4500,
  WIND_SPEED: 1.1,
  COUNTDOWN_MS: 3200,
  ROUND_MS: 270_000,
  /** cuando alguien llega, el resto tiene este tiempo para terminar */
  FINISH_GRACE_MS: 45_000,
  ROUND_END_MS: 6500,
  /** puntos por puesto en cada ronda */
  POINTS: [10, 7, 5, 3, 2, 1],
} as const;

/** Celdas de cada pieza. 0-6 son las clásicas; de 7 en adelante, las malditas. */
const RAW_SHAPES: [number, number][][] = [
  [[0, 0], [1, 0], [2, 0], [3, 0]], // I
  [[0, 0], [1, 0], [0, 1], [1, 1]], // O
  [[0, 0], [1, 0], [2, 0], [1, 1]], // T
  [[0, 0], [1, 0], [1, 1], [2, 1]], // S
  [[1, 0], [2, 0], [0, 1], [1, 1]], // Z
  [[0, 0], [1, 0], [2, 0], [2, 1]], // L
  [[0, 0], [1, 0], [2, 0], [0, 1]], // J
  [[0, 0], [1, 0], [2, 0], [0, 1], [2, 1]], // U maldita
  [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]], // cruz maldita
  [[0, 0], [0, 1], [1, 1], [1, 2], [2, 2]], // escalera maldita
  [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]], // palo de cinco
  [[0, 0], [1, 1], [2, 0], [1, 0], [3, 1]], // rayo
];

export const CLASSIC_KINDS = 7;
export const CURSED_KINDS = [7, 8, 9, 10, 11];

/** Celdas centradas en el centroide (el origen del cuerpo). */
export const SHAPES: [number, number][][] = RAW_SHAPES.map((cells) => {
  const cx = cells.reduce((a, c) => a + c[0], 0) / cells.length;
  const cy = cells.reduce((a, c) => a + c[1], 0) / cells.length;
  return cells.map(([x, y]) => [x - cx, y - cy] as [number, number]);
});

/** Colores de cada pieza: [cara, sombra]. */
export const PIECE_COLORS: [string, string][] = [
  ['#38bdf8', '#0369a1'],
  ['#facc15', '#a16207'],
  ['#c084fc', '#7e22ce'],
  ['#4ade80', '#15803d'],
  ['#fb7185', '#be123c'],
  ['#fb923c', '#c2410c'],
  ['#818cf8', '#4338ca'],
  ['#5b5470', '#2b2638'],
  ['#5b5470', '#2b2638'],
  ['#5b5470', '#2b2638'],
  ['#5b5470', '#2b2638'],
  ['#5b5470', '#2b2638'],
];

export const POWERS: Record<TorresAbility, { name: string; icon: string; desc: string }> = {
  cement: { name: 'Cemento', icon: '🧱', desc: 'Tu torre queda fija: ni el viento ni un terremoto la mueven.' },
  curse: { name: 'Pieza maldita', icon: '👻', desc: 'A todos los demás les toca una pieza imposible.' },
  quake: { name: 'Terremoto', icon: '🌋', desc: 'Sacude las torres de todos los rivales.' },
};

export const POWER_KINDS: TorresAbility[] = ['cement', 'curse', 'quake'];

/** Rota una celda 90° * r alrededor del origen. */
export function rotCell(x: number, y: number, r: number): [number, number] {
  switch (((r % 4) + 4) % 4) {
    case 1:
      return [-y, x];
    case 2:
      return [-x, -y];
    case 3:
      return [y, -x];
    default:
      return [x, y];
  }
}
