import { BJ_MIN_BET, HORSES, HORSE_RESULT_MS, START_BALANCE, money } from '../../../shared/constants';
import type { TimbaFeedItem, TimbaTable, TimbaView } from '../../../shared/types';
import { shortId } from '../../util';
import type { GameContext, GameModule } from '../kit';
import { bjAction, bjCreate, bjDeal, bjReset, bjSettle, bjView, type BjAction, type BjState } from './blackjack';
import { RESULT_MS, SPIN_MS, rlAddBet, rlClear, rlCreate, rlFinishSpin, rlNewRound, rlParseBet, rlSpin, rlUndo, rlView, type RlState } from './roulette';
import { slCreate, slSpin, slView, type SlState } from './slots';
import { hrCreate, hrFinish, hrNewRound, hrPick, hrRun, hrSetBet, hrView, type HrState } from './horses';

const SLOT_BETS = [5, 10, 20, 50, 100, 200, 500];
const BAILOUT_AMOUNT = 150;
const BAILOUT_MAX = 5;
const BAILOUT_THRESHOLD = 20;
const FEED_MAX = 14;
/** a partir de acá el premio se anuncia a toda la sala */
const FEED_MIN_WIN = 400;
/** margen para que una diferencia de reloj con el cliente no rechace el giro siguiente */
const SLOT_SLACK_MS = 200;

interface Pending {
  amount: number;
  paid: boolean;
}

interface Seat {
  balance: number;
  peak: number;
  wagered: number;
  table: TimbaTable;
  bj: BjState;
  rl: RlState;
  sl: SlState;
  hr: HrState;
  bailouts: number;
  pending: Pending[];
}

interface TimbaState {
  endsAt: number;
  timer: NodeJS.Timeout | null;
  seats: Map<string, Seat>;
  feed: TimbaFeedItem[];
}

function newSeat(): Seat {
  return {
    balance: START_BALANCE,
    peak: START_BALANCE,
    wagered: 0,
    table: 'hub',
    bj: bjCreate(),
    rl: rlCreate(),
    sl: slCreate(),
    hr: hrCreate(),
    bailouts: 0,
    pending: [],
  };
}

function credit(seat: Seat, amount: number): void {
  seat.balance += amount;
  if (seat.balance > seat.peak) seat.peak = seat.balance;
}

function spend(seat: Seat, amount: number): boolean {
  if (amount <= 0 || seat.balance < amount) return false;
  seat.balance -= amount;
  seat.wagered += amount;
  return true;
}

/** Programa un pago para que coincida con el final de la animación del cliente. */
function payLater(ctx: GameContext, s: TimbaState, seat: Seat, amount: number, ms: number, after?: () => void): void {
  if (amount <= 0) {
    if (after) ctx.timers.after(ms, () => { after(); ctx.push(); });
    return;
  }
  const slot: Pending = { amount, paid: false };
  seat.pending.push(slot);
  ctx.timers.after(ms, () => {
    if (slot.paid) return;
    slot.paid = true;
    credit(seat, slot.amount);
    if (after) after();
    ctx.push();
  });
}

function flushPending(seat: Seat): void {
  for (const p of seat.pending) {
    if (!p.paid) {
      p.paid = true;
      credit(seat, p.amount);
    }
  }
  seat.pending = [];
}

function announce(s: TimbaState, playerId: string, text: string, amount: number, kind: TimbaFeedItem['kind']): void {
  s.feed.unshift({ id: shortId(), playerId, text, amount, kind, at: Date.now() });
  if (s.feed.length > FEED_MAX) s.feed.length = FEED_MAX;
}

export const timba: GameModule<TimbaState> = {
  id: 'timba',

  create(ctx) {
    const seats = new Map<string, Seat>();
    for (const p of ctx.players()) seats.set(p.id, newSeat());
    return { endsAt: 0, timer: null, seats, feed: [] };
  },

  start(ctx, s) {
    const seconds = Math.max(60, Math.min(900, ctx.config.timbaSeconds || 300));
    s.endsAt = ctx.now() + seconds * 1000;
    s.timer = ctx.timers.after(seconds * 1000, () => finish(ctx, s));
    ctx.push();
  },

  event(ctx, s, playerId, type, data) {
    const seat = s.seats.get(playerId);
    if (!seat || ctx.now() > s.endsAt) return;
    const d = (data ?? {}) as Record<string, unknown>;
    const num = (v: unknown): number => {
      const n = Math.floor(Number(v));
      return Number.isFinite(n) ? n : 0;
    };

    switch (type) {
      /* ── navegación ───────────────────────────────────────────────── */
      case 'table': {
        const t = d.t as TimbaTable;
        if (t === 'hub' || t === 'blackjack' || t === 'roulette' || t === 'slots' || t === 'horses') {
          seat.table = t;
          ctx.pushTo(playerId);
        }
        return;
      }

      case 'bailout': {
        if (seat.balance >= BAILOUT_THRESHOLD || seat.bailouts >= BAILOUT_MAX) return;
        if (seat.rl.phase === 'spinning' || seat.bj.phase === 'player' || seat.hr.phase === 'racing') return;
        seat.bailouts += 1;
        credit(seat, BAILOUT_AMOUNT);
        ctx.toast(playerId, `El tío te presta ${money(BAILOUT_AMOUNT)}. Van ${seat.bailouts}/${BAILOUT_MAX}.`, 'info');
        ctx.push();
        return;
      }

      /* ── blackjack ────────────────────────────────────────────────── */
      case 'bj:bet': {
        if (seat.bj.phase !== 'bet' && seat.bj.phase !== 'settled') return;
        const bet = Math.min(num(d.amount), seat.balance);
        if (bet < BJ_MIN_BET) return;
        if (!spend(seat, bet)) return;
        if (bjDeal(seat.bj, bet).toDealer) settleBj(ctx, s, playerId, seat);
        ctx.push();
        return;
      }

      case 'bj:act': {
        if (seat.bj.phase !== 'player') return;
        const action = d.action as BjAction;
        if (!['hit', 'stand', 'double', 'split'].includes(action)) return;
        if ((action === 'double' || action === 'split') && seat.balance < (seat.bj.hands[seat.bj.active]?.bet ?? 0)) {
          ctx.toast(playerId, 'No te alcanza para eso.', 'bad');
          return;
        }
        const res = bjAction(seat.bj, action);
        if (res.spend > 0) spend(seat, res.spend);
        if (res.toDealer) settleBj(ctx, s, playerId, seat);
        ctx.push();
        return;
      }

      case 'bj:next': {
        if (seat.bj.phase !== 'settled') return;
        bjReset(seat.bj);
        ctx.pushTo(playerId);
        return;
      }

      /* ── ruleta ───────────────────────────────────────────────────── */
      case 'rl:chip': {
        if (seat.rl.phase === 'spinning') return;
        if (seat.rl.phase === 'result') rlNewRound(seat.rl);
        const bet = rlParseBet(d);
        if (!bet) return;
        if (bet.amount > seat.balance) {
          ctx.toast(playerId, 'No te alcanza esa ficha.', 'bad');
          return;
        }
        if (!spend(seat, bet.amount)) return;
        if (!rlAddBet(seat.rl, bet)) credit(seat, bet.amount);
        ctx.push();
        return;
      }

      case 'rl:undo': {
        if (seat.rl.phase !== 'bets') return;
        const back = rlUndo(seat.rl);
        if (back) {
          credit(seat, back);
          seat.wagered -= back;
        }
        ctx.push();
        return;
      }

      case 'rl:clear': {
        if (seat.rl.phase !== 'bets') return;
        const back = rlClear(seat.rl);
        if (back) {
          credit(seat, back);
          seat.wagered -= back;
        }
        ctx.push();
        return;
      }

      case 'rl:spin': {
        if (seat.rl.phase !== 'bets' || seat.rl.bets.length === 0) return;
        const { result, credit: win, staked } = rlSpin(seat.rl, ctx.now());
        payLater(ctx, s, seat, win, SPIN_MS, () => {
          rlFinishSpin(seat.rl);
          const net = win - staked;
          if (net >= FEED_MIN_WIN) {
            announce(s, playerId, `clavó el ${result} en la ruleta`, net, net >= staked * 10 ? 'mega' : 'win');
          }
          ctx.timers.after(RESULT_MS, () => {
            if (seat.rl.phase === 'result') {
              rlNewRound(seat.rl);
              ctx.pushTo(playerId);
            }
          });
        });
        ctx.push();
        return;
      }

      /* ── hipódromo ─────────────────────────────────────────────────── */
      case 'hr:pick': {
        if (hrPick(seat.hr, d.horse)) ctx.pushTo(playerId);
        return;
      }

      case 'hr:bet': {
        if (hrSetBet(seat.hr, d.amount)) ctx.pushTo(playerId);
        return;
      }

      case 'hr:run': {
        const hr = seat.hr;
        if (hr.phase === 'result') hrNewRound(hr);
        if (hr.phase !== 'pick' || hr.horse === null) return;
        if (seat.balance < hr.bet) {
          ctx.toast(playerId, 'No te alcanza para esa apuesta.', 'bad');
          return;
        }
        if (!spend(seat, hr.bet)) return;
        const bet = hr.bet;
        const { winner, credit: win, finishInMs } = hrRun(hr, ctx.now());
        payLater(ctx, s, seat, win, finishInMs, () => {
          hrFinish(hr);
          const net = win - bet;
          if (net >= FEED_MIN_WIN) {
            announce(s, playerId, `la pegó con ${HORSES[winner].name} en el hipódromo`, net, net >= 1500 ? 'mega' : 'win');
          }
          ctx.timers.after(HORSE_RESULT_MS + 2600, () => {
            if (hr.phase === 'result') {
              hrNewRound(hr);
              ctx.pushTo(playerId);
            }
          });
        });
        ctx.push();
        return;
      }

      /* ── tragamonedas ─────────────────────────────────────────────── */
      case 'sl:bet': {
        if (ctx.now() < seat.sl.busyUntil - SLOT_SLACK_MS || seat.sl.freeSpinsLeft > 0) return;
        const amount = num(d.amount);
        if (!SLOT_BETS.includes(amount)) return;
        seat.sl.bet = amount;
        ctx.pushTo(playerId);
        return;
      }

      case 'sl:spin': {
        if (ctx.now() < seat.sl.busyUntil - SLOT_SLACK_MS) return;
        const free = seat.sl.freeSpinsLeft > 0;
        if (!free && seat.balance < seat.sl.bet) {
          ctx.toast(playerId, 'No te alcanza para girar.', 'bad');
          return;
        }
        if (!free && !spend(seat, seat.sl.bet)) return;

        runSpin(ctx, s, playerId, seat);
        return;
      }
    }
  },

  leave() {
    // La plata del que se va queda congelada y sigue contando para el ranking.
  },

  view(ctx, s, playerId): TimbaView {
    const seat = s.seats.get(playerId) ?? newSeat();
    const board = [...s.seats.entries()]
      .map(([id, st]) => ({ playerId: id, balance: Math.round(st.balance), broke: st.balance < BAILOUT_THRESHOLD }))
      .sort((a, b) => b.balance - a.balance);

    return {
      endsAt: s.endsAt,
      balance: Math.round(seat.balance),
      peak: Math.round(seat.peak),
      wagered: Math.round(seat.wagered),
      table: seat.table,
      board,
      feed: s.feed,
      bj: bjView(seat.bj),
      rl: rlView(seat.rl),
      sl: slView(seat.sl),
      hr: hrView(seat.hr),
    };
  },

  dispose(ctx, s) {
    ctx.timers.cancel(s.timer);
    s.timer = null;
    for (const seat of s.seats.values()) flushPending(seat);
  },
};

/**
 * Gira el tragamonedas, programa el pago para cuando termine la animación y,
 * si quedan giros gratis, encadena el siguiente solo.
 */
function runSpin(ctx: GameContext, s: TimbaState, playerId: string, seat: Seat): void {
  const out = slSpin(seat.sl, ctx.now());
  const spin = out.spin;
  const bonusClosing = spin.free && seat.sl.freeSpinsLeft === 0;

  payLater(ctx, s, seat, out.credit, out.animMs, () => {
    if (spin.freeSpinsAwarded > 0) {
      announce(s, playerId, `sacó ${spin.freeSpinsAwarded} giros gratis`, 0, 'mega');
    }
    if (spin.totalWin >= Math.max(FEED_MIN_WIN, spin.bet * 15)) {
      announce(s, playerId, `reventó la máquina (x${Math.round(spin.totalWin / spin.bet)})`, spin.totalWin, 'mega');
    } else if (spin.totalWin >= FEED_MIN_WIN) {
      announce(s, playerId, 'pegó en el tragamonedas', spin.totalWin, 'win');
    }

    if (seat.sl.freeSpinsLeft > 0) {
      ctx.timers.after(750, () => {
        if (seat.sl.freeSpinsLeft > 0 && ctx.now() < s.endsAt) runSpin(ctx, s, playerId, seat);
      });
    } else if (bonusClosing && seat.sl.bonusWin > 0) {
      announce(s, playerId, `cerró el bonus en ${money(seat.sl.bonusWin)}`, seat.sl.bonusWin, 'mega');
    }
  });
  ctx.push();
}

function settleBj(ctx: GameContext, s: TimbaState, playerId: string, seat: Seat): void {
  const { credit: win, net } = bjSettle(seat.bj);
  credit(seat, win);
  if (net >= FEED_MIN_WIN) {
    announce(s, playerId, seat.bj.hands.some((h) => h.blackjack) ? 'hizo blackjack' : 'le ganó al croupier', net, 'win');
  }
}

function finish(ctx: GameContext, s: TimbaState): void {
  ctx.timers.cancel(s.timer);
  s.timer = null;
  for (const seat of s.seats.values()) flushPending(seat);

  ctx.finish(
    ctx.players().map((p) => {
      const seat = s.seats.get(p.id);
      const balance = Math.round(seat?.balance ?? 0);
      return { playerId: p.id, value: balance, label: money(balance) };
    }),
  );
}
