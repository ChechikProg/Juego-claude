import { randomInt, randomUUID } from 'node:crypto';
import { PODIUM_POINTS } from '../shared/constants';
import type { Standing } from '../shared/types';

/** Alfabeto sin caracteres ambiguos (0/O, 1/I). */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function roomCode(len = 4): string {
  let out = '';
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

export function uid(): string {
  return randomUUID();
}

export function shortId(): string {
  return randomUUID().slice(0, 8);
}

export function rnd(): number {
  // Float uniforme en [0,1) con entropía criptográfica: el casino no se banca Math.random.
  return randomInt(0, 2 ** 31) / 2 ** 31;
}

export function rndInt(minInclusive: number, maxExclusive: number): number {
  if (maxExclusive <= minInclusive) return minInclusive;
  return randomInt(minInclusive, maxExclusive);
}

export function pick<T>(arr: readonly T[]): T {
  return arr[rndInt(0, arr.length)];
}

export function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = rndInt(0, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Elige un índice según pesos relativos. */
export function weightedIndex(weights: number[]): number {
  let total = 0;
  for (const w of weights) total += w;
  let r = rnd() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r < 0) return i;
  }
  return weights.length - 1;
}

export const now = (): number => Date.now();

export function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

export function sanitizeName(raw: unknown, fallback = 'Anónimo'): string {
  const s = String(raw ?? '')
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 14);
  return s.length ? s : fallback;
}

export function sanitizeText(raw: unknown, max = 140): string {
  return String(raw ?? '')
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
    .trim()
    .slice(0, max);
}

/**
 * Ranking competitivo estándar (1,1,3). Reparte 10/5/3 por puesto: los empatados
 * en un puesto cobran lo mismo y el siguiente salta los lugares ocupados.
 */
export function buildStandings(
  rows: { playerId: string; value: number; label: string }[],
): Standing[] {
  const sorted = rows.slice().sort((a, b) => b.value - a.value);
  const out: Standing[] = [];
  let rank = 0;
  let prev: number | null = null;
  sorted.forEach((row, i) => {
    if (prev === null || row.value !== prev) rank = i + 1;
    prev = row.value;
    out.push({
      playerId: row.playerId,
      rank,
      value: row.value,
      label: row.label,
      awarded: rank <= PODIUM_POINTS.length ? PODIUM_POINTS[rank - 1] : 0,
    });
  });
  return out;
}

/** Cronómetros cancelables agrupados, para no dejar timers colgados al cerrar una sala. */
export class TimerBag {
  private timers = new Set<NodeJS.Timeout>();
  private intervals = new Set<NodeJS.Timeout>();

  after(ms: number, fn: () => void): NodeJS.Timeout {
    const t = setTimeout(() => {
      this.timers.delete(t);
      try {
        fn();
      } catch (err) {
        console.error('[timer]', err);
      }
    }, Math.max(0, ms));
    this.timers.add(t);
    return t;
  }

  every(ms: number, fn: () => void): NodeJS.Timeout {
    const t = setInterval(() => {
      try {
        fn();
      } catch (err) {
        console.error('[interval]', err);
      }
    }, ms);
    this.intervals.add(t);
    return t;
  }

  cancel(t: NodeJS.Timeout | null | undefined): void {
    if (!t) return;
    clearTimeout(t);
    clearInterval(t);
    this.timers.delete(t);
    this.intervals.delete(t);
  }

  clear(): void {
    for (const t of this.timers) clearTimeout(t);
    for (const t of this.intervals) clearInterval(t);
    this.timers.clear();
    this.intervals.clear();
  }
}
