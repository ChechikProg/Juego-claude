import type { BjHand, BlackjackView, Card } from '../../../shared/types';
import { rndInt } from '../../util';

const DECKS = 6;
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS: Card['s'][] = ['S', 'H', 'D', 'C'];
const RESHUFFLE_AT = 0.28;

export interface BjState {
  phase: 'bet' | 'player' | 'dealer' | 'settled';
  shoe: Card[];
  shoeSize: number;
  hands: BjHand[];
  active: number;
  dealer: Card[];
  lastNet: number | null;
  message: string | null;
  splits: number;
}

function buildShoe(): Card[] {
  const cards: Card[] = [];
  for (let d = 0; d < DECKS; d++) {
    for (const s of SUITS) for (const r of RANKS) cards.push({ s, r });
  }
  for (let i = cards.length - 1; i > 0; i--) {
    const j = rndInt(0, i + 1);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

export function bjCreate(): BjState {
  const shoe = buildShoe();
  return {
    phase: 'bet',
    shoe,
    shoeSize: shoe.length,
    hands: [],
    active: 0,
    dealer: [],
    lastNet: null,
    message: null,
    splits: 0,
  };
}

function draw(st: BjState): Card {
  if (st.shoe.length < st.shoeSize * RESHUFFLE_AT) {
    st.shoe = buildShoe();
    st.shoeSize = st.shoe.length;
  }
  return st.shoe.pop()!;
}

export function cardValue(r: string): number {
  if (r === 'A') return 11;
  if (r === 'J' || r === 'Q' || r === 'K') return 10;
  return Number(r);
}

export function handValue(cards: Card[]): { total: number; soft: boolean } {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    if (c.hidden) continue;
    total += cardValue(c.r);
    if (c.r === 'A') aces++;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return { total, soft: aces > 0 };
}

function newHand(bet: number): BjHand {
  return {
    cards: [],
    bet,
    total: 0,
    soft: false,
    done: false,
    bust: false,
    blackjack: false,
    doubled: false,
    outcome: null,
    payout: 0,
  };
}

function refresh(h: BjHand): void {
  const { total, soft } = handValue(h.cards);
  h.total = total;
  h.soft = soft;
  h.bust = total > 21;
  h.blackjack = h.cards.length === 2 && total === 21;
}

/** Reparte una mano nueva. Devuelve cuánto hay que descontar del balance. */
export function bjDeal(st: BjState, bet: number): { spend: number; toDealer: boolean } {
  st.hands = [newHand(bet)];
  st.active = 0;
  st.splits = 0;
  st.dealer = [];
  st.lastNet = null;
  st.message = null;

  const h = st.hands[0];
  h.cards.push(draw(st));
  st.dealer.push(draw(st));
  h.cards.push(draw(st));
  const hole = draw(st);
  st.dealer.push({ ...hole, hidden: true });
  refresh(h);

  if (h.blackjack) {
    st.phase = 'dealer';
    return { spend: bet, toDealer: true };
  }
  st.phase = 'player';
  return { spend: bet, toDealer: false };
}

function activeHand(st: BjState): BjHand | undefined {
  return st.hands[st.active];
}

function advance(st: BjState): void {
  while (st.active < st.hands.length && st.hands[st.active].done) st.active++;
  if (st.active >= st.hands.length) st.phase = 'dealer';
}

export function bjCan(st: BjState): BlackjackView['can'] {
  const h = activeHand(st);
  if (st.phase !== 'player' || !h || h.done) {
    return { hit: false, stand: false, double: false, split: false };
  }
  const two = h.cards.length === 2;
  const sameValue = two && cardValue(h.cards[0].r) === cardValue(h.cards[1].r);
  return {
    hit: !h.bust,
    stand: true,
    double: two,
    split: two && sameValue && st.splits < 1,
  };
}

export type BjAction = 'hit' | 'stand' | 'double' | 'split';

/**
 * Aplica una acción del jugador.
 * `spend` es dinero adicional que sale del balance (doblar / dividir).
 */
export function bjAction(st: BjState, action: BjAction): { spend: number; toDealer: boolean } {
  const can = bjCan(st);
  const h = activeHand(st);
  if (!h) return { spend: 0, toDealer: false };

  if (action === 'hit' && can.hit) {
    h.cards.push(draw(st));
    refresh(h);
    if (h.bust || h.total === 21) h.done = true;
    advance(st);
    return { spend: 0, toDealer: st.phase === 'dealer' };
  }

  if (action === 'stand' && can.stand) {
    h.done = true;
    advance(st);
    return { spend: 0, toDealer: st.phase === 'dealer' };
  }

  if (action === 'double' && can.double) {
    const extra = h.bet;
    h.bet *= 2;
    h.doubled = true;
    h.cards.push(draw(st));
    refresh(h);
    h.done = true;
    advance(st);
    return { spend: extra, toDealer: st.phase === 'dealer' };
  }

  if (action === 'split' && can.split) {
    const extra = h.bet;
    st.splits += 1;
    const moved = h.cards.pop()!;
    const second = newHand(h.bet);
    second.cards.push(moved);

    const wasAces = h.cards[0].r === 'A';
    h.cards.push(draw(st));
    second.cards.push(draw(st));
    refresh(h);
    refresh(second);
    // Las manos partidas de 21 valen 21, no blackjack.
    h.blackjack = false;
    second.blackjack = false;
    if (wasAces) {
      h.done = true;
      second.done = true;
    }
    st.hands.splice(st.active + 1, 0, second);
    advance(st);
    return { spend: extra, toDealer: st.phase === 'dealer' };
  }

  return { spend: 0, toDealer: false };
}

/** Juega la mano del croupier y liquida. Devuelve el crédito total a acreditar. */
export function bjSettle(st: BjState): { credit: number; net: number } {
  if (st.dealer[1]?.hidden) st.dealer[1] = { ...st.dealer[1], hidden: false };

  const anyLive = st.hands.some((h) => !h.bust);
  if (anyLive) {
    let dv = handValue(st.dealer);
    while (dv.total < 17) {
      st.dealer.push(draw(st));
      dv = handValue(st.dealer);
    }
  }
  const dealerTotal = handValue(st.dealer).total;
  const dealerBj = st.dealer.length === 2 && dealerTotal === 21;

  let credit = 0;
  let staked = 0;
  for (const h of st.hands) {
    staked += h.bet;
    if (h.bust) {
      h.outcome = 'lose';
      h.payout = 0;
    } else if (h.blackjack && !dealerBj) {
      h.outcome = 'bj';
      h.payout = Math.round(h.bet * 2.5);
    } else if (h.blackjack && dealerBj) {
      h.outcome = 'push';
      h.payout = h.bet;
    } else if (dealerBj) {
      h.outcome = 'lose';
      h.payout = 0;
    } else if (dealerTotal > 21 || h.total > dealerTotal) {
      h.outcome = 'win';
      h.payout = h.bet * 2;
    } else if (h.total === dealerTotal) {
      h.outcome = 'push';
      h.payout = h.bet;
    } else {
      h.outcome = 'lose';
      h.payout = 0;
    }
    credit += h.payout;
  }

  const net = credit - staked;
  st.phase = 'settled';
  st.lastNet = net;
  st.message = messageFor(st, net, dealerTotal);
  return { credit, net };
}

function messageFor(st: BjState, net: number, dealerTotal: number): string {
  if (st.hands.length === 1) {
    const h = st.hands[0];
    if (h.outcome === 'bj') return '¡BLACKJACK! Pagó 3 a 2';
    if (h.bust) return `Te pasaste con ${h.total}`;
    if (dealerTotal > 21) return `Se pasó el croupier con ${dealerTotal}`;
    if (h.outcome === 'win') return `${h.total} contra ${dealerTotal}. Ganaste`;
    if (h.outcome === 'push') return `Empate en ${h.total}`;
    return `${dealerTotal} del croupier contra tu ${h.total}`;
  }
  if (net > 0) return 'Buena mano doble';
  if (net === 0) return 'Quedaron a mano';
  return 'Se la llevó el croupier';
}

export function bjView(st: BjState): BlackjackView {
  const dealerCards = st.dealer.map((c) => (c.hidden ? { s: c.s, r: '?', hidden: true } : c));
  return {
    phase: st.phase,
    hands: st.hands,
    active: st.active,
    dealer: dealerCards as Card[],
    dealerTotal: handValue(st.dealer.filter((c) => !c.hidden)).total,
    can: bjCan(st),
    lastNet: st.lastNet,
    message: st.message,
    shoePct: Math.round((st.shoe.length / Math.max(1, st.shoeSize)) * 100),
  };
}

export function bjReset(st: BjState): void {
  st.phase = 'bet';
  st.hands = [];
  st.dealer = [];
  st.active = 0;
  st.splits = 0;
}
