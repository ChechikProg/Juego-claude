import type { RouletteBet, RouletteBetKind, RouletteView } from '../../../shared/types';
import { ROULETTE_REDS, ROULETTE_RESULT_MS, ROULETTE_SPIN_MS, ROULETTE_WHEEL } from '../../../shared/constants';
import { rndInt } from '../../util';

export const WHEEL = ROULETTE_WHEEL;
export const REDS = ROULETTE_REDS;
export const SPIN_MS = ROULETTE_SPIN_MS;
export const RESULT_MS = ROULETTE_RESULT_MS;
const MAX_BETS = 40;

export interface RlState {
  phase: 'bets' | 'spinning' | 'result';
  bets: RouletteBet[];
  result: number | null;
  revealAt: number | null;
  lastNet: number | null;
  history: number[];
}

export function rlCreate(): RlState {
  return { phase: 'bets', bets: [], result: null, revealAt: null, lastNet: null, history: [] };
}

export function isRed(n: number): boolean {
  return REDS.has(n);
}

const KINDS: RouletteBetKind[] = [
  'straight', 'red', 'black', 'odd', 'even', 'low', 'high',
  'dozen1', 'dozen2', 'dozen3', 'col1', 'col2', 'col3',
];

export function rlParseBet(raw: unknown): RouletteBet | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const kind = o.kind as RouletteBetKind;
  if (!KINDS.includes(kind)) return null;
  const amount = Math.floor(Number(o.amount));
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) return null;
  if (kind === 'straight') {
    const n = Math.floor(Number(o.n));
    if (!Number.isFinite(n) || n < 0 || n > 36) return null;
    return { kind, n, amount };
  }
  return { kind, amount };
}

/** Suma la ficha a una apuesta existente del mismo tipo, o crea una nueva. */
export function rlAddBet(st: RlState, bet: RouletteBet): boolean {
  const existing = st.bets.find((b) => b.kind === bet.kind && b.n === bet.n);
  if (existing) {
    existing.amount += bet.amount;
    return true;
  }
  if (st.bets.length >= MAX_BETS) return false;
  st.bets.push(bet);
  return true;
}

/** Quita la última ficha puesta. Devuelve lo que hay que reintegrar. */
export function rlUndo(st: RlState): number {
  const last = st.bets.pop();
  return last ? last.amount : 0;
}

export function rlClear(st: RlState): number {
  const total = st.bets.reduce((a, b) => a + b.amount, 0);
  st.bets = [];
  return total;
}

/** Multiplicador total devuelto (incluye la apuesta) si la apuesta acierta. */
function payoutFor(kind: RouletteBetKind, n: number | undefined, result: number): number {
  if (result === 0) return kind === 'straight' && n === 0 ? 36 : 0;
  switch (kind) {
    case 'straight': return n === result ? 36 : 0;
    case 'red': return isRed(result) ? 2 : 0;
    case 'black': return !isRed(result) ? 2 : 0;
    case 'odd': return result % 2 === 1 ? 2 : 0;
    case 'even': return result % 2 === 0 ? 2 : 0;
    case 'low': return result <= 18 ? 2 : 0;
    case 'high': return result >= 19 ? 2 : 0;
    case 'dozen1': return result <= 12 ? 3 : 0;
    case 'dozen2': return result >= 13 && result <= 24 ? 3 : 0;
    case 'dozen3': return result >= 25 ? 3 : 0;
    case 'col1': return result % 3 === 1 ? 3 : 0;
    case 'col2': return result % 3 === 2 ? 3 : 0;
    case 'col3': return result % 3 === 0 ? 3 : 0;
    default: return 0;
  }
}

export function rlSpin(st: RlState, nowMs: number): { result: number; credit: number; staked: number } {
  const result = WHEEL[rndInt(0, WHEEL.length)];
  const staked = st.bets.reduce((a, b) => a + b.amount, 0);
  let credit = 0;
  for (const b of st.bets) credit += b.amount * payoutFor(b.kind, b.n, result);

  st.phase = 'spinning';
  st.result = result;
  st.revealAt = nowMs + SPIN_MS;
  st.lastNet = credit - staked;
  st.history = [result, ...st.history].slice(0, 14);
  return { result, credit, staked };
}

export function rlFinishSpin(st: RlState): void {
  st.phase = 'result';
  st.bets = [];
}

export function rlNewRound(st: RlState): void {
  st.phase = 'bets';
  st.result = null;
  st.revealAt = null;
  st.bets = [];
}

export function rlView(st: RlState): RouletteView {
  return {
    phase: st.phase,
    bets: st.bets,
    staked: st.bets.reduce((a, b) => a + b.amount, 0),
    result: st.phase === 'bets' ? null : st.result,
    revealAt: st.revealAt,
    lastNet: st.lastNet,
    history: st.history,
  };
}
