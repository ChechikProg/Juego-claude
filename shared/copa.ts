/* ──────────────────────────────────────────────────────────────────────────
 *  NOCHE DE COPA — geometría y física compartidas.
 *  La cancha es un círculo centrado en (0,0). Cada jugador tiene un arco
 *  sobre el borde; las fichas nunca pasan la línea, la pelota sí (gol).
 * ────────────────────────────────────────────────────────────────────────── */

import type { CopaGoal } from './types';

export const COPA = {
  /** radio de la cancha */
  R: 420,
  PUCK_R: 25,
  BALL_R: 14,
  PUCK_M: 2.4,
  BALL_M: 1,
  POST_R: 7,
  /** profundidad de la red, sólo visual */
  GOAL_DEPTH: 44,
  /** velocidad de una ficha lanzada a máxima potencia */
  MAX_FLICK: 1250,
  /** cuánto hay que arrastrar (en unidades de cancha) para la potencia máxima */
  DRAG_MAX: 170,
  /** debajo de esto, soltar no lanza (fue un toque sin querer) */
  DRAG_MIN: 14,
  COOLDOWN: 5000,
  /** frenado exponencial (1/s) y rozamiento constante (u/s²) */
  PUCK_DAMP: 1.35,
  PUCK_FRICTION: 70,
  BALL_DAMP: 0.5,
  BALL_FRICTION: 20,
  BALL_MAX: 1500,
  WALL_E: 0.78,
  HIT_E: 0.9,
  POST_E: 0.7,
  TICK_HZ: 60,
  SUBSTEPS: 4,
  /** bonus por meter un gol */
  GOAL_BONUS: 3,
  /** puntos por cada rival que aguantaste */
  SURVIVE_PTS: 2,
  FIRST_COUNTDOWN_MS: 3200,
  COUNTDOWN_MS: 2200,
  GOAL_MS: 3000,
  ROUND_END_MS: 5200,
  /** si pasa esto sin goles, los arcos empiezan a agrandarse */
  WIDEN_AFTER: 25_000,
  /** +12% de ancho cada 10 s, hasta WIDEN_MAX */
  WIDEN_RATE: 0.012,
  WIDEN_MAX: 1.7,
  /** tope de una ronda, por si nadie la mete nunca */
  ROUND_MAX_MS: 240_000,
  /** práctica en solitario: cuántos goles y cuánto tiempo */
  SOLO_GOALS: 3,
  SOLO_MS: 90_000,
  /** el último toque cuenta para el gol si fue hace menos de esto */
  TOUCH_TTL: 9000,
} as const;

/** id del arco vacío de la práctica en solitario */
export const PRACTICE_GOAL = '__practice';

/** Semiancho angular base de cada arco según cuántos quedan. */
export function goalHalf(n: number): number {
  if (n <= 1) return 0.34;
  return Math.min(0.3, (Math.PI / n) * 0.5);
}

/** Semiancho efectivo, con el agrandado por falta de goles (sin pisar al vecino). */
export function effectiveHalf(goal: CopaGoal, widen: number, n: number): number {
  const cap = n > 1 ? (Math.PI / n) * 0.82 : 0.6;
  return Math.min(cap, goal.half * widen);
}

/** Reparte los arcos parejo alrededor de la cancha; el primero queda abajo. */
export function layoutGoals(ids: string[]): CopaGoal[] {
  const n = ids.length;
  const half = goalHalf(n);
  return ids.map((playerId, i) => ({
    playerId,
    a: norm(Math.PI / 2 + (i * Math.PI * 2) / Math.max(1, n)),
    half: playerId === PRACTICE_GOAL ? half * 1.25 : half,
  }));
}

/** Formación inicial de las tres fichas frente al arco. */
export function formation(goal: CopaGoal, n: number): { x: number; y: number }[] {
  const { R, PUCK_R } = COPA;
  const nx = -Math.cos(goal.a);
  const ny = -Math.sin(goal.a);
  const tx = -ny;
  const ty = nx;
  const gx = Math.cos(goal.a) * R;
  const gy = Math.sin(goal.a) * R;
  const keeper = 62;
  const depth = n <= 4 ? 175 : 125;
  const rr = R - depth;
  const spread = Math.max(PUCK_R + 6, Math.min(95, rr * Math.sin(Math.PI / Math.max(2, n)) - PUCK_R - 8));
  return [
    { x: gx + nx * keeper, y: gy + ny * keeper },
    { x: gx + nx * depth + tx * spread, y: gy + ny * depth + ty * spread },
    { x: gx + nx * depth - tx * spread, y: gy + ny * depth - ty * spread },
  ];
}

/** Los dos palos de un arco. */
export function goalPosts(goal: CopaGoal, half: number): [{ x: number; y: number }, { x: number; y: number }] {
  const R = COPA.R;
  return [
    { x: Math.cos(goal.a - half) * R, y: Math.sin(goal.a - half) * R },
    { x: Math.cos(goal.a + half) * R, y: Math.sin(goal.a + half) * R },
  ];
}

export function norm(a: number): number {
  const t = Math.PI * 2;
  return ((a % t) + t) % t;
}

/** Diferencia angular con signo, en (-π, π]. */
export function angleDiff(a: number, b: number): number {
  const t = Math.PI * 2;
  return ((((a - b + Math.PI) % t) + t) % t) - Math.PI;
}
