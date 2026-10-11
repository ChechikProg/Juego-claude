/* ──────────────────────────────────────────────────────────────────────────
 *  PARTIDAZO — contrato compartido entre cliente y servidor.
 *  Todo lo que viaja por el socket está tipado acá.
 * ────────────────────────────────────────────────────────────────────────── */

export type GameId =
  | 'vangogh'
  | 'timba'
  | 'smash'
  | 'piramide'
  | 'frases'
  | 'tanque'
  | 'copa'
  | 'formula'
  | 'shooter';

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
  | {
      kind: 'intro';
      gameId: GameId;
      index: number;
      total: number;
      endsAt: number;
      /** jugadores que ya leyeron las reglas; si están todos, arranca */
      readyIds: string[];
    }
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
  tanqueSeconds: number;
  copaRounds: number;
  formulaRaces: number;
  shooterLives: number;
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
  /** 1 = balde: rellena desde el punto p[0],p[1] */
  f?: 1;
  /** [x0,y0,x1,y1,...] */
  p: number[];
}

/** Dibujo anónimo para rankear: el autor se revela recién en la galería. */
export interface RankCard {
  /** id anónimo, válido sólo esta ronda */
  id: string;
  strokes: Stroke[];
}

export interface VanGoghEntry {
  playerId: string;
  strokes: Stroke[];
  /** 0..100: 100 = todos lo pusieron primero */
  score: number;
  /** cuántos lo pusieron primero */
  firsts: number;
  /** cuántos lo rankearon */
  rankers: number;
  /** puesto promedio (1 = mejor), null si nadie lo rankeó */
  avgPlace: number | null;
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
      stage: 'rank';
      round: number;
      totalRounds: number;
      word: string;
      endsAt: number;
      /** duración total de la etapa, para la barra de tiempo */
      totalMs: number;
      /** los dibujos de los demás, en un orden al azar propio de cada jugador */
      cards: RankCard[];
      /** tu propio dibujo, para que lo veas (no se rankea) */
      mine: Stroke[] | null;
      /** el ranking que mandaste (ids de mejor a peor), si ya lo mandaste */
      myOrder: string[] | null;
      submittedIds: string[];
      rankersTotal: number;
    }
  | {
      stage: 'roundResults';
      round: number;
      totalRounds: number;
      word: string;
      endsAt: number;
      entries: VanGoghEntry[];
      totals: Record<string, number>;
      /** true si no hubo con quién comparar (1 o 2 artistas) */
      noContest: boolean;
    };

/* ─────────────────────────────── 2. VIVA LA TIMBA ────────────────────────── */

export type TimbaTable = 'hub' | 'blackjack' | 'roulette' | 'slots' | 'horses';

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
  /** timestamp de servidor en que termina la animación del último giro */
  busyUntil: number;
}

/** Recorrido de un caballo: posiciones 0..1 en cada instante (ms desde la largada). */
export interface HorseTrack {
  t: number[];
  p: number[];
}

export interface HorsesView {
  phase: 'pick' | 'racing' | 'result';
  /** caballo elegido (0..5) */
  horse: number | null;
  bet: number;
  race: {
    /** timestamp de servidor de la largada */
    startAt: number;
    /** cuando el ganador cruza la meta */
    finishAt: number;
    winner: number;
    tracks: HorseTrack[];
  } | null;
  lastNet: number | null;
  /** ganadores de las últimas carreras */
  history: number[];
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
  hr: HorsesView;
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
  /** hasta acá la pelota está quieta esperando el saque */
  serveUntil: number;
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
  'match:ready': (p: { value: boolean }) => void;
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
  /** timestamp en el que se puede volver a disparar el cañonazo */
  shotReadyAt: number;
  /** aplastado: no está en el mapa hasta `respawnAt` */
  dead: boolean;
  respawnAt: number;
  /** volando por un cañonazo */
  launched: boolean;
}

export interface PyrShot {
  id: number;
  x: number;
  y: number;
  /** velocidad horizontal (signo = dirección) */
  vx: number;
  vy: number;
  owner: string;
}

export interface PyrFx {
  id: number;
  kind: 'push' | 'land' | 'crown' | 'stomp' | 'blast' | 'respawn' | 'shot';
  x: number;
  y: number;
  at: number;
  /** dirección del efecto (empujón) */
  dir?: -1 | 1;
}

export interface PiramideView {
  stage: 'countdown' | 'live' | 'done';
  /** reloj del servidor en el snapshot */
  t: number;
  /** fin de la fase actual */
  until: number;
  players: PyrPlayer[];
  shots: PyrShot[];
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

/* ───────────────────────────── 6. EL TANQUE JUAN ─────────────────────────── */

export interface TankPublic {
  playerId: string;
  x: number;
  y: number;
  /** ángulo del casco, radianes */
  a: number;
  /** ángulo de la torreta */
  ta: number;
  alive: boolean;
  respawnAt: number;
  /** invulnerable hasta acá (recién aparecido) */
  shieldUntil: number;
  /** timestamp en el que puede volver a disparar */
  readyAt: number;
  score: number;
  kills: number;
  deaths: number;
}

export interface TankBullet {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  owner: string;
}

export interface TankFx {
  id: number;
  kind: 'shot' | 'boom' | 'spawn' | 'bounce';
  x: number;
  y: number;
  at: number;
  playerId?: string;
}

export interface TankKill {
  id: number;
  killer: string;
  victim: string;
  at: number;
}

export interface TanqueView {
  stage: 'countdown' | 'live' | 'done';
  /** reloj del servidor en el snapshot */
  t: number;
  until: number;
  /** semilla del laberinto: cliente y servidor lo generan igual */
  seed: number;
  tanks: TankPublic[];
  bullets: TankBullet[];
  fx: TankFx[];
  feed: TankKill[];
}

/* ───────────────────────────── 7. NOCHE DE COPA ──────────────────────────── */

export interface CopaGoal {
  playerId: string;
  /** ángulo del centro del arco sobre el borde de la cancha */
  a: number;
  /** semiancho angular del arco */
  half: number;
}

export interface CopaPuck {
  owner: string;
  /** 0..2 */
  i: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface CopaPlayer {
  playerId: string;
  alive: boolean;
  /** timestamp desde el que puede volver a lanzar */
  readyAt: number;
  /** goles hechos en el minijuego */
  goals: number;
  /** puesto en la ronda actual (1 = ganó), null mientras sigue en juego */
  place: number | null;
}

export interface CopaFx {
  id: number;
  kind: 'flick' | 'kick' | 'clack' | 'wall' | 'post';
  x: number;
  y: number;
  at: number;
  /** 0..1, intensidad del golpe */
  power: number;
  playerId?: string;
}

export interface CopaView {
  stage: 'countdown' | 'live' | 'goal' | 'roundEnd' | 'done';
  round: number;
  totalRounds: number;
  /** reloj del servidor en el snapshot */
  t: number;
  /** fin de la fase actual (cuenta regresiva, festejo, resumen) */
  until: number;
  goals: CopaGoal[];
  pucks: CopaPuck[];
  ball: { x: number; y: number; vx: number; vy: number };
  players: CopaPlayer[];
  lastGoal: { victim: string; scorer: string | null; own: boolean; at: number } | null;
  /** puntos del minijuego acumulados */
  totals: Record<string, number>;
  roundSummary: { playerId: string; place: number; points: number; goals: number }[] | null;
  fx: CopaFx[];
  /** multiplicador del ancho de los arcos: crece si pasa mucho sin goles */
  widen: number;
  /** modo práctica (un solo jugador contra un arco vacío) */
  solo: boolean;
}

/* ─────────────────────────────── 8. FÓRMULA 99 ───────────────────────────── */

export type F99Item = 'turbo' | 'banana' | 'oil' | 'missile' | 'bomb' | 'zap' | 'shield';

export interface F99Car {
  playerId: string;
  x: number;
  y: number;
  /** rumbo, radianes */
  a: number;
  vx: number;
  vy: number;
  item: F99Item | null;
  /** cuándo agarró el objeto (para la ruleta del cliente) */
  itemAt: number;
  spinUntil: number;
  spinDir: number;
  boostUntil: number;
  /** envión de las flechas del piso */
  padUntil: number;
  shrinkUntil: number;
  oilUntil: number;
  shieldUntil: number;
  /** vuelta actual, empezando en 1 */
  lap: number;
  /** progreso total sobre la pista, en vueltas (2.5 = mitad de la tercera) */
  progress: number;
  place: number;
  finishedAt: number | null;
  offTrack: boolean;
}

export interface F99Hazard {
  id: number;
  kind: 'banana' | 'oil' | 'bomb';
  x: number;
  y: number;
  vx: number;
  vy: number;
  owner: string;
  at: number;
  /** bomba: cuándo explota */
  fuseAt: number;
}

export interface F99Missile {
  id: number;
  x: number;
  y: number;
  a: number;
  owner: string;
  target: string | null;
}

export interface F99Fx {
  id: number;
  kind: 'pickup' | 'boost' | 'spin' | 'boom' | 'zap' | 'lap' | 'finish' | 'block' | 'drop' | 'launch' | 'pad';
  x: number;
  y: number;
  at: number;
  playerId?: string;
}

export interface F99View {
  stage: 'countdown' | 'race' | 'podium' | 'done';
  race: number;
  totalRaces: number;
  /** índice de la pista en TRACKS */
  track: number;
  laps: number;
  t: number;
  /** largada (fin de la cuenta regresiva) */
  startAt: number;
  /** límite de la carrera (se activa cuando llega el primero) o fin del podio */
  until: number | null;
  cars: F99Car[];
  hazards: F99Hazard[];
  missiles: F99Missile[];
  /** por caja: 0 = disponible, si no, timestamp en que reaparece */
  boxes: number[];
  fx: F99Fx[];
  totals: Record<string, number>;
  raceResults: { playerId: string; place: number; points: number; time: number | null }[] | null;
}

/* ─────────────────────────────── 9. ASHOOTATEE ───────────────────────────── */

export type ShWeapon = 'pistol' | 'shotgun' | 'minigun' | 'sniper' | 'nades';

export interface ShFighter {
  /** id del jugador, o "dummy-N" para los muñecos de práctica */
  playerId: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  face: -1 | 1;
  alive: boolean;
  lives: number;
  respawnAt: number;
  shieldUntil: number;
  weapon: ShWeapon;
  /** balas del arma especial (-1 = infinitas) */
  ammo: number;
  readyAt: number;
  nadeReadyAt: number;
  kills: number;
  deaths: number;
  /** puesto final (1 = ganó), null mientras tenga vidas */
  place: number | null;
  grounded: boolean;
  /** recibió un golpe hace poco: para el parpadeo */
  hitAt: number;
}

export interface ShBullet {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  owner: string;
  kind: ShWeapon;
}

export interface ShNade {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  owner: string;
  boomAt: number;
}

export interface ShCrate {
  id: number;
  x: number;
  y: number;
  weapon: ShWeapon;
  landed: boolean;
}

export interface ShFx {
  id: number;
  kind: 'shot' | 'hit' | 'boom' | 'fall' | 'spawn' | 'pickup' | 'jump' | 'crate' | 'toss';
  x: number;
  y: number;
  at: number;
  playerId?: string;
  dir?: number;
  weapon?: ShWeapon;
}

export interface ShKill {
  id: number;
  killer: string | null;
  victim: string;
  at: number;
}

export interface ShooterView {
  stage: 'countdown' | 'live' | 'done';
  t: number;
  until: number;
  /** índice del mapa en SH_MAPS */
  map: number;
  /** reloj de los objetos móviles: ms desde el inicio de la partida */
  clock0: number;
  fighters: ShFighter[];
  bullets: ShBullet[];
  nades: ShNade[];
  crates: ShCrate[];
  fx: ShFx[];
  feed: ShKill[];
}
