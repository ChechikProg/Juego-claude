/* ──────────────────────────────────────────────────────────────────────────
 *  PARTIDAZO — contrato compartido entre cliente y servidor.
 *  Todo lo que viaja por el socket está tipado acá.
 * ────────────────────────────────────────────────────────────────────────── */

export type GameId = 'vangogh' | 'timba' | 'smash' | 'piramide' | 'frases';

export interface Avatar {
  /** 0-359, define el gradiente del avatar */
  hue: number;
  /** emoji de la cara */
  face: string;
}

export interface PlayerPublic {
  id: string;
  name: string;
  avatar: Avatar;
  connected: boolean;
  isHost: boolean;
  /** puntos acumulados de la partida completa */
  score: number;
  /** true si entró cuando la partida ya había arrancado */
  spectator: boolean;
  /** ms de ida y vuelta, para mostrar calidad de conexión */
  rtt: number;
}

export interface Standing {
  playerId: string;
  rank: number;
  /** valor crudo con el que se ordenó (puntos, plata, etc.) */
  value: number;
  /** representación lista para mostrar: "$2.480", "12.4 pts" */
  label: string;
  /** puntos de partida otorgados por este minijuego */
  awarded: number;
}

export type RoomPhase =
  | { kind: 'lobby' }
  | { kind: 'intro'; gameId: GameId; index: number; total: number; endsAt: number }
  | { kind: 'playing'; gameId: GameId; index: number; total: number }
  | { kind: 'results'; gameId: GameId; index: number; total: number; standings: Standing[]; endsAt: number }
  | { kind: 'final'; standings: Standing[] };

export interface RoomConfig {
  /** minijuegos elegidos, en orden */
  playlist: GameId[];
  vangoghRounds: number;
  timbaSeconds: number;
  smashRounds: number;
  piramideSeconds: number;
  frasesRounds: number;
}

export interface RoomState {
  code: string;
  hostId: string;
  players: PlayerPublic[];
  config: RoomConfig;
  phase: RoomPhase;
  /** cuántos minijuegos ya se jugaron */
  progress: { index: number; total: number } | null;
}

export interface ChatMessage {
  id: string;
  playerId: string | null;
  name: string;
  text: string;
  at: number;
  system?: boolean;
}

/* ───────────────────────────── 1. VICENTE VAN GOGH ───────────────────────── */

/** Trazo vectorial comprimido: coordenadas normalizadas 0..1 aplanadas. */
export interface Stroke {
  /** color css */
  c: string;
  /** grosor relativo al ancho del lienzo (0..1) */
  w: number;
  /** 1 = goma */
  e?: 1;
  /** [x0,y0,x1,y1,...] */
  p: number[];
}

export interface Drawing {
  playerId: string;
  strokes: Stroke[];
}

export interface VanGoghEntry {
  playerId: string;
  strokes: Stroke[];
  /** promedio de estrellas 1..5 */
  avg: number;
  votes: number;
  /** puntos internos sumados esta ronda */
  gained: number;
}

export type VanGoghView =
  | { stage: 'prompt'; round: number; totalRounds: number; word: string; hint: string; endsAt: number }
  | {
      stage: 'draw';
      round: number;
      totalRounds: number;
      word: string;
      endsAt: number;
      readyIds: string[];
      iAmReady: boolean;
      artists: number;
    }
  | {
      stage: 'vote';
      round: number;
      totalRounds: number;
      word: string;
      endsAt: number;
      index: number;
      count: number;
      target: Drawing;
      isMine: boolean;
      myVote: number | null;
      votesIn: number;
      votersTotal: number;
      /** se revela al cerrar la votación de ese dibujo */
      reveal: { avg: number; votes: number } | null;
    }
  | {
      stage: 'roundResults';
      round: number;
      totalRounds: number;
      word: string;
      endsAt: number;
      entries: VanGoghEntry[];
      totals: Record<string, number>;
    };

/* ─────────────────────────────── 2. VIVA LA TIMBA ────────────────────────── */

export type TimbaTable = 'hub' | 'blackjack' | 'roulette' | 'slots';

export interface Card {
  s: 'S' | 'H' | 'D' | 'C';
  /** 'A','2'..'10','J','Q','K' */
  r: string;
  /** carta boca abajo */
  hidden?: boolean;
}

export interface BjHand {
  cards: Card[];
  bet: number;
  total: number;
  soft: boolean;
  done: boolean;
  bust: boolean;
  blackjack: boolean;
  doubled: boolean;
  outcome: 'win' | 'lose' | 'push' | 'bj' | null;
  payout: number;
}

export interface BlackjackView {
  phase: 'bet' | 'player' | 'dealer' | 'settled';
  hands: BjHand[];
  active: number;
  dealer: Card[];
  dealerTotal: number;
  can: { hit: boolean; stand: boolean; double: boolean; split: boolean };
  lastNet: number | null;
  message: string | null;
  shoePct: number;
}

export type RouletteBetKind =
  | 'straight' | 'red' | 'black' | 'odd' | 'even' | 'low' | 'high'
  | 'dozen1' | 'dozen2' | 'dozen3' | 'col1' | 'col2' | 'col3';

export interface RouletteBet {
  kind: RouletteBetKind;
  /** sólo para 'straight' */
  n?: number;
  amount: number;
}

export interface RouletteView {
  phase: 'bets' | 'spinning' | 'result';
  bets: RouletteBet[];
  staked: number;
  result: number | null;
  /** timestamp de servidor en el que la bolita se detiene */
  revealAt: number | null;
  lastNet: number | null;
  history: number[];
}

export interface SlotWin {
  sym: string;
  count: number;
  pay: number;
  /** índices col * ROWS + row */
  cells: number[];
}

export interface SlotStep {
  /** cols[col][row], row 0 = arriba */
  cols: string[][];
  wins: SlotWin[];
  stepWin: number;
  /** bombas multiplicadoras visibles (sólo en free spins) */
  bombs: { col: number; row: number; mult: number }[];
}

export interface SlotSpin {
  id: string;
  bet: number;
  steps: SlotStep[];
  baseWin: number;
  multiplier: number;
  totalWin: number;
  scatters: number;
  freeSpinsAwarded: number;
  free: boolean;
}

export interface SlotsView {
  cols: string[][];
  bet: number;
  spin: SlotSpin | null;
  freeSpinsLeft: number;
  freeTotal: number;
  inBonus: boolean;
  lastWin: number;
  bonusWin: number;
}

export interface TimbaFeedItem {
  id: string;
  playerId: string;
  text: string;
  amount: number;
  kind: 'win' | 'lose' | 'mega';
  at: number;
}

export interface TimbaView {
  endsAt: number;
  balance: number;
  peak: number;
  wagered: number;
  table: TimbaTable;
  board: { playerId: string; balance: number; broke: boolean }[];
  feed: TimbaFeedItem[];
  bj: BlackjackView;
  rl: RouletteView;
  sl: SlotsView;
}

/* ──────────────────────────────── 3. SMASH 360 ───────────────────────────── */

export type SeatState = 'idle' | 'crouch' | 'swing' | 'recover' | 'out';

export interface SmashSeat {
  playerId: string;
  /** radianes, posición fija en el círculo */
  angle: number;
  alive: boolean;
  state: SeatState;
  /** timestamp de servidor hasta el cual dura el estado actual */
  until: number;
  hits: number;
  dodges: number;
  /** orden de eliminación (0 = primero en caer) */
  outOrder: number | null;
}

export interface SmashFx {
  id: number;
  kind: 'hit' | 'dodge' | 'out';
  angle: number;
  at: number;
  playerId: string;
}

export interface SmashView {
  stage: 'countdown' | 'live' | 'roundEnd' | 'done';
  round: number;
  totalRounds: number;
  /** timestamp de servidor del snapshot */
  t: number;
  /** cuándo arranca / termina la fase actual */
  until: number;
  ball: { angle: number; omega: number };
  /** golpes acumulados en la ronda */
  rally: number;
  seats: SmashSeat[];
  totals: Record<string, number>;
  lastRound: { playerId: string; place: number; points: number }[] | null;
  fx: SmashFx[];
}

/* ─────────────────────────────── SOCKET EVENTS ───────────────────────────── */

export interface Ack<T = unknown> {
  ok: boolean;
  error?: string;
  data?: T;
}

/** Identidad persistida en el navegador: permite volver a entrar tras recargar. */
export interface Identity {
  playerId: string | null;
  name: string;
  avatar: Avatar;
}

export type JoinAck = Ack<{ code: string; playerId: string }>;

export interface ClientToServer {
  'room:create': (p: Identity, cb: (a: JoinAck) => void) => void;
  'room:join': (p: Identity & { code: string }, cb: (a: JoinAck) => void) => void;
  'room:leave': () => void;
  'room:config': (p: Partial<RoomConfig>) => void;
  'room:kick': (p: { playerId: string }) => void;
  'room:profile': (p: { name: string; avatar: Avatar }) => void;
  'match:start': () => void;
  'match:skip': () => void;
  'match:again': () => void;
  'game:event': (p: { type: string; data?: unknown }) => void;
  'chat:send': (p: { text: string }) => void;
  'time:ping': (p: { t0: number; rtt?: number }, cb: (a: { t0: number; ts: number }) => void) => void;
}

export interface ServerToClient {
  'room:state': (s: RoomState) => void;
  'room:closed': (p: { reason: string }) => void;
  'game:state': (p: { gameId: GameId; view: unknown }) => void;
  'chat:msg': (m: ChatMessage) => void;
  'toast': (p: { text: string; kind?: 'info' | 'good' | 'bad' }) => void;
}

/* ──────────────────────────────── 4. PIRÁMIDE ────────────────────────────── */

export interface PyrPlayer {
  playerId: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** -1 izquierda, 1 derecha */
  face: -1 | 1;
  grounded: boolean;
  /** nivel del escalón sobre el que está parado (LEVELS = la cima) */
  level: number;
  onTop: boolean;
  points: number;
  /** timestamp hasta el que dura la animación del empujón */
  pushUntil: number;
  /** timestamp en el que se puede volver a empujar */
  readyAt: number;
}

export interface PyrFx {
  id: number;
  kind: 'push' | 'land' | 'crown';
  x: number;
  y: number;
  at: number;
}

export interface PiramideView {
  stage: 'countdown' | 'live' | 'done';
  /** reloj del servidor en el snapshot */
  t: number;
  /** fin de la fase actual */
  until: number;
  players: PyrPlayer[];
  fx: PyrFx[];
  /** id del que más puntos lleva */
  leaderId: string | null;
}

/* ───────────────────────────── 5. FRASES CHUPETE ─────────────────────────── */

export interface FraseAnswer {
  /** id anónimo mientras se vota; es el playerId recién en los resultados */
  id: string;
  text: string;
  playerId: string | null;
  votes: number;
  voters: string[];
}

export type FrasesView =
  | { stage: 'prompt'; round: number; totalRounds: number; phrase: string; endsAt: number }
  | {
      stage: 'write';
      round: number;
      totalRounds: number;
      phrase: string;
      endsAt: number;
      myAnswer: string;
      iAmReady: boolean;
      readyIds: string[];
      writers: number;
    }
  | {
      stage: 'vote';
      round: number;
      totalRounds: number;
      phrase: string;
      endsAt: number;
      answers: FraseAnswer[];
      myVote: string | null;
      /** true si no mandaste respuesta y sólo mirás */
      canVote: boolean;
      votesIn: number;
      votersTotal: number;
    }
  | {
      stage: 'roundResults';
      round: number;
      totalRounds: number;
      phrase: string;
      endsAt: number;
      answers: FraseAnswer[];
      totals: Record<string, number>;
    };
