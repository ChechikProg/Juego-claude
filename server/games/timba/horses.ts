import { HORSES, HORSE_BETS, HORSE_PAYOUT } from '../../../shared/constants';
import type { HorseTrack, HorsesView } from '../../../shared/types';
import { rnd, rndInt, shuffle } from '../../util';

/** cuenta regresiva en las gateras antes de la largada */
export const GATE_MS = 1600;
const KEYFRAMES = 12;

export interface HrState {
  phase: 'pick' | 'racing' | 'result';
  horse: number | null;
  bet: number;
  race: { startAt: number; finishAt: number; winner: number; tracks: HorseTrack[] } | null;
  lastNet: number | null;
  history: number[];
}

export function hrCreate(): HrState {
  return { phase: 'pick', horse: null, bet: HORSE_BETS[1], race: null, lastNet: null, history: [] };
}

export function hrPick(st: HrState, horse: unknown): boolean {
  const n = Math.floor(Number(horse));
  if (st.phase === 'racing' || !Number.isFinite(n) || n < 0 || n >= HORSES.length) return false;
  if (st.phase === 'result') hrNewRound(st);
  st.horse = n;
  return true;
}

export function hrSetBet(st: HrState, amount: unknown): boolean {
  const n = Math.floor(Number(amount));
  if (st.phase === 'racing' || !HORSE_BETS.includes(n)) return false;
  if (st.phase === 'result') hrNewRound(st);
  st.bet = n;
  return true;
}

/**
 * Corre la carrera. El ganador sale con entropía criptográfica (1 en 6) y
 * después se arma un recorrido creíble: cada caballo tiene su ritmo, hay
 * sobrepasos, y el ganador es el que cruza primero.
 */
export function hrRun(st: HrState, now: number): { winner: number; credit: number; finishInMs: number } {
  const winner = rndInt(0, HORSES.length);

  const finishes = Array.from({ length: HORSES.length }, () => Math.round(8400 + rnd() * 2600)).sort((a, b) => a - b);
  const order = shuffle(Array.from({ length: HORSES.length }, (_, i) => i).filter((i) => i !== winner));
  const finishOf: number[] = [];
  finishOf[winner] = finishes[0];
  order.forEach((h, i) => (finishOf[h] = finishes[i + 1]));

  const tracks: HorseTrack[] = finishOf.map((finish) => {
    // Unos arrancan como balas y se cansan, otros atropellan al final.
    const style = (rnd() - 0.5) * 1.1;
    const weights: number[] = [];
    for (let k = 0; k < KEYFRAMES; k++) {
      const phase = 1 - (2 * k) / (KEYFRAMES - 1);
      weights.push(Math.max(0.15, (0.65 + rnd() * 0.7) * (1 + style * phase)));
    }
    const total = weights.reduce((a, b) => a + b, 0);
    const t = [0];
    const p = [0];
    let acc = 0;
    for (let k = 0; k < KEYFRAMES; k++) {
      acc += weights[k];
      t.push(Math.round((finish * (k + 1)) / KEYFRAMES));
      p.push(Math.round((acc / total) * 10000) / 10000);
    }
    p[p.length - 1] = 1;
    return { t, p };
  });

  const startAt = now + GATE_MS;
  st.phase = 'racing';
  st.race = { startAt, finishAt: startAt + finishOf[winner], winner, tracks };
  const won = st.horse === winner;
  const credit = won ? st.bet * HORSE_PAYOUT : 0;
  st.lastNet = credit - st.bet;
  return { winner, credit, finishInMs: GATE_MS + finishOf[winner] };
}

export function hrFinish(st: HrState): void {
  if (!st.race) return;
  st.phase = 'result';
  st.history = [st.race.winner, ...st.history].slice(0, 10);
}

export function hrNewRound(st: HrState): void {
  st.phase = 'pick';
  st.race = null;
}

export function hrView(st: HrState): HorsesView {
  return {
    phase: st.phase,
    horse: st.horse,
    bet: st.bet,
    race: st.race,
    lastNet: st.phase === 'result' ? st.lastNet : null,
    history: st.history,
  };
}
