import {
  BOMB, BOMB_MULTIPLIERS, FREE_SPINS_AWARDED, FREE_SPINS_RETRIGGER,
  SCATTER, SCATTER_PAYS, SCATTER_WEIGHT, SLOT_COLS, SLOT_ROWS, SLOT_SYMBOLS,
} from '../../../shared/constants';
import type { SlotSpin, SlotStep, SlotWin, SlotsView } from '../../../shared/types';
import { pick, rnd, shortId, weightedIndex } from '../../util';

const MAX_TUMBLES = 14;
const BOMB_CHANCE = 0.012;
/** ms que tarda la animación de cada paso en el cliente */
export const STEP_MS = 760;
export const SPIN_INTRO_MS = 620;

const SYM_KEYS = SLOT_SYMBOLS.map((s) => s.key);
const SYM_WEIGHTS = SLOT_SYMBOLS.map((s) => s.weight);
const SYM_TOTAL = SYM_WEIGHTS.reduce((a, b) => a + b, 0);
const PAYS = new Map(SLOT_SYMBOLS.map((s) => [s.key, s.pays] as const));

export interface SlState {
  cols: string[][];
  bet: number;
  spin: SlotSpin | null;
  freeSpinsLeft: number;
  freeTotal: number;
  inBonus: boolean;
  lastWin: number;
  bonusWin: number;
  /** momento en que la animación del giro termina en el cliente */
  busyUntil: number;
}

export function bombCell(mult: number): string {
  return `${BOMB}:${mult}`;
}

export function isBomb(cell: string): boolean {
  return cell.startsWith(BOMB);
}

function bombMult(cell: string): number {
  return Number(cell.split(':')[1]) || 0;
}

/**
 * Genera una celda nueva. Si sale bomba, acumula su multiplicador en `sink`,
 * que es la forma exacta de contar sólo las bombas recién creadas.
 */
function newCell(allowScatter: boolean, allowBomb: boolean, sink: number[]): string {
  if (allowBomb && rnd() < BOMB_CHANCE) {
    const mult = pick(BOMB_MULTIPLIERS);
    sink.push(mult);
    return bombCell(mult);
  }
  if (allowScatter && rnd() * (SYM_TOTAL + SCATTER_WEIGHT) < SCATTER_WEIGHT) return SCATTER;
  return SYM_KEYS[weightedIndex(SYM_WEIGHTS)];
}

function randomGrid(free: boolean, sink: number[]): string[][] {
  const cols: string[][] = [];
  for (let c = 0; c < SLOT_COLS; c++) {
    const col: string[] = [];
    for (let r = 0; r < SLOT_ROWS; r++) col.push(newCell(true, free, sink));
    cols.push(col);
  }
  return cols;
}

function cloneGrid(cols: string[][]): string[][] {
  return cols.map((c) => c.slice());
}

function payTier(count: number): 0 | 1 | 2 {
  if (count >= 12) return 2;
  if (count >= 10) return 1;
  return 0;
}

/** Cluster pays: 8 o más iguales en cualquier posición del tablero. */
function evaluate(cols: string[][], bet: number): SlotWin[] {
  const positions = new Map<string, number[]>();
  for (let c = 0; c < SLOT_COLS; c++) {
    for (let r = 0; r < SLOT_ROWS; r++) {
      const cell = cols[c][r];
      if (cell === SCATTER || isBomb(cell)) continue;
      const list = positions.get(cell);
      if (list) list.push(c * SLOT_ROWS + r);
      else positions.set(cell, [c * SLOT_ROWS + r]);
    }
  }
  const wins: SlotWin[] = [];
  for (const [sym, cells] of positions) {
    if (cells.length < 8) continue;
    const pays = PAYS.get(sym);
    if (!pays) continue;
    wins.push({
      sym,
      count: cells.length,
      pay: Math.round(pays[payTier(cells.length)] * bet * 100) / 100,
      cells,
    });
  }
  wins.sort((a, b) => b.pay - a.pay);
  return wins;
}

function countScatters(cols: string[][]): number {
  let n = 0;
  for (const col of cols) for (const cell of col) if (cell === SCATTER) n++;
  return n;
}

function visibleBombs(cols: string[][]): { col: number; row: number; mult: number }[] {
  const out: { col: number; row: number; mult: number }[] = [];
  for (let c = 0; c < SLOT_COLS; c++) {
    for (let r = 0; r < SLOT_ROWS; r++) {
      if (isBomb(cols[c][r])) out.push({ col: c, row: r, mult: bombMult(cols[c][r]) });
    }
  }
  return out;
}

/** Saca los ganadores, aplica gravedad y rellena desde arriba. */
function tumble(cols: string[][], wins: SlotWin[], free: boolean, sink: number[]): string[][] {
  const dead = new Set<number>();
  for (const w of wins) for (const idx of w.cells) dead.add(idx);

  const next: string[][] = [];
  for (let c = 0; c < SLOT_COLS; c++) {
    const kept: string[] = [];
    for (let r = 0; r < SLOT_ROWS; r++) {
      if (!dead.has(c * SLOT_ROWS + r)) kept.push(cols[c][r]);
    }
    const fresh: string[] = [];
    // En los tumbles no entran scatters nuevos: el scatter se evalúa en la caída inicial.
    for (let i = kept.length; i < SLOT_ROWS; i++) fresh.push(newCell(false, free, sink));
    next.push([...fresh, ...kept]);
  }
  return next;
}

export function slCreate(): SlState {
  return {
    cols: randomGrid(false, []),
    bet: 20,
    spin: null,
    freeSpinsLeft: 0,
    freeTotal: 0,
    inBonus: false,
    lastWin: 0,
    bonusWin: 0,
    busyUntil: 0,
  };
}

export interface SpinOutcome {
  spin: SlotSpin;
  /** dinero a descontar (0 en free spins) */
  spend: number;
  /** dinero a acreditar */
  credit: number;
  /** duración total de la animación en el cliente */
  animMs: number;
}

export function slSpin(st: SlState, nowMs: number): SpinOutcome {
  const free = st.freeSpinsLeft > 0;
  const bet = st.bet;
  /** multiplicadores de todas las bombas que cayeron durante la secuencia */
  const bombs: number[] = [];

  let cols = randomGrid(free, bombs);
  const scatters = countScatters(cols);
  const steps: SlotStep[] = [];
  let baseWin = 0;

  for (let i = 0; i < MAX_TUMBLES; i++) {
    const wins = evaluate(cols, bet);
    const stepWin = Math.round(wins.reduce((a, w) => a + w.pay, 0) * 100) / 100;
    baseWin += stepWin;
    steps.push({ cols: cloneGrid(cols), wins, stepWin, bombs: free ? visibleBombs(cols) : [] });

    if (wins.length === 0) break;
    cols = tumble(cols, wins, free, bombs);
  }

  const multiplier = free && bombs.length ? bombs.reduce((a, b) => a + b, 0) : 1;
  let totalWin = Math.round(baseWin * multiplier * 100) / 100;

  // Pago del scatter (sólo en la caída inicial).
  if (scatters >= 4) totalWin += (SCATTER_PAYS[Math.min(6, scatters)] ?? SCATTER_PAYS[6]) * bet;

  let freeSpinsAwarded = 0;
  if (!free && scatters >= 4) freeSpinsAwarded = FREE_SPINS_AWARDED;
  else if (free && scatters >= 3) freeSpinsAwarded = FREE_SPINS_RETRIGGER;

  const spin: SlotSpin = {
    id: shortId(),
    bet,
    steps,
    baseWin: Math.round(baseWin * 100) / 100,
    multiplier,
    totalWin: Math.round(totalWin * 100) / 100,
    scatters,
    freeSpinsAwarded,
    free,
  };

  const animMs = SPIN_INTRO_MS + steps.length * STEP_MS + (spin.totalWin > 0 ? 520 : 0);

  st.cols = steps[steps.length - 1].cols;
  st.spin = spin;
  st.lastWin = spin.totalWin;
  st.busyUntil = nowMs + animMs;

  if (free) {
    st.freeSpinsLeft -= 1;
    st.bonusWin += spin.totalWin;
  } else {
    st.bonusWin = 0;
  }
  if (freeSpinsAwarded > 0) {
    st.freeSpinsLeft += freeSpinsAwarded;
    st.freeTotal += freeSpinsAwarded;
    st.inBonus = true;
  }
  if (st.freeSpinsLeft <= 0) {
    st.inBonus = false;
    st.freeTotal = 0;
  }

  return { spin, spend: free ? 0 : bet, credit: Math.round(spin.totalWin), animMs };
}

export function slView(st: SlState): SlotsView {
  return {
    cols: st.cols,
    bet: st.bet,
    spin: st.spin,
    freeSpinsLeft: st.freeSpinsLeft,
    freeTotal: st.freeTotal,
    inBonus: st.inBonus,
    lastWin: st.lastWin,
    bonusWin: Math.round(st.bonusWin),
  };
}
