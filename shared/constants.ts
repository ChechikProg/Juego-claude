import type { GameId, RoomConfig } from './types';

/** Puntos de partida que reparte cada minijuego: 1º, 2º, 3º. */
export const PODIUM_POINTS = [10, 5, 3] as const;

export const ROOM_CODE_LENGTH = 4;
export const MAX_PLAYERS = 12;
export const MAX_NAME_LENGTH = 14;

export interface GameMeta {
  id: GameId;
  title: string;
  subtitle: string;
  icon: string;
  /** gradiente de acento del minijuego */
  accent: [string, string];
  /** color de texto sobre el acento */
  ink: string;
  howTo: string[];
  minPlayers: number;
}

export const GAMES: Record<GameId, GameMeta> = {
  vangogh: {
    id: 'vangogh',
    title: 'Vicente van Gogh',
    subtitle: 'Dibujá contrarreloj y que te rankeen',
    icon: '🎨',
    accent: ['#6C8BFF', '#F7C948'],
    ink: '#0B0B14',
    howTo: [
      'Se sortea una palabra y todos la dibujan al mismo tiempo. Tenés pincel, balde de pintura y goma.',
      'Tenés 2 minutos. Si terminás antes, tocá LISTO: si todos están listos, la ronda se corta.',
      'Después cada uno ordena los dibujos de los demás del mejor al peor, sin saber de quién es cada uno.',
      'Cuanto más arriba te pongan, más puntos sumás. El mejor rankeado del minijuego se lleva 10, el segundo 5 y el tercero 3.',
    ],
    minPlayers: 1,
  },
  timba: {
    id: 'timba',
    title: 'Viva la Timba',
    subtitle: 'Mil dólares y todo el casino en contra',
    icon: '🎰',
    accent: ['#19C37D', '#F7C948'],
    ink: '#06130D',
    howTo: [
      'Arrancás con $1.000 y tenés el casino abierto hasta que suene la campana.',
      'Blackjack, ruleta europea, un tragamonedas de caramelos y el hipódromo con 6 caballos que paga x6.',
      'Todo lo resuelve el servidor: nadie puede hacer trampa con el RNG.',
      'El que más plata tenga al final se lleva 10 puntos, el segundo 5 y el tercero 3.',
    ],
    minPlayers: 1,
  },
  smash: {
    id: 'smash',
    title: 'Smash 360',
    subtitle: 'Agachate o pegale. No hay tercera.',
    icon: '🏓',
    accent: ['#0E9594', '#F28482'],
    ink: '#04201F',
    howTo: [
      'Estás fijo en el borde del círculo y la pelota orbita cada vez más rápido.',
      'ESPACIO o ↑ para pegarle: la devolvés para el otro lado y acelera.',
      '↓ o SHIFT para agacharte: pasa de largo a la misma velocidad.',
      'Si te toca parado, afuera. El último en pie gana la ronda.',
    ],
    minPlayers: 1,
  },
  piramide: {
    id: 'piramide',
    title: 'Pirámide',
    subtitle: 'Subí, quedate arriba y tirá a todos',
    icon: '🏔️',
    accent: ['#F2A65A', '#E4572E'],
    ink: '#2A1203',
    howTo: [
      'Todos arrancan en el piso. Arriba de todo hay un escalón para uno solo.',
      'Mové con ← →, saltá con ESPACIO, empujá con J y tirá un cañonazo con K: apunta solo al rival que tengas adelante y lo saca volando (uno cada 7 segundos).',
      'Si le caés en la cabeza a alguien lo aplastás: vuelve al piso en 5 segundos.',
      'Mientras estés en la punta sumás puntos cada segundo.',
      'Dos minutos. El que más puntos junte se lleva 10, el segundo 5 y el tercero 3.',
    ],
    minPlayers: 1,
  },
  frases: {
    id: 'frases',
    title: 'Frases Chupete',
    subtitle: 'Completá la frase y ganá el voto',
    icon: '💬',
    accent: ['#C77DFF', '#37E2D5'],
    ink: '#120523',
    howTo: [
      'Aparece una frase con un hueco y cada uno escribe cómo la completa.',
      'Tenés 1 minuto, o menos si todos ponen LISTO antes.',
      'Después se muestran todas las respuestas en anónimo y cada uno vota la mejor.',
      'Cada voto suma un punto. El más votado del minijuego se lleva 10, el segundo 5 y el tercero 3.',
    ],
    minPlayers: 2,
  },
  tanque: {
    id: 'tanque',
    title: 'El Tanque Juan',
    subtitle: 'Laberinto, balas que rebotan y nadie a salvo',
    icon: '💥',
    accent: ['#A3E635', '#F97316'],
    ink: '#14200A',
    howTo: [
      'Todos son tanques en un laberinto visto desde arriba y aparecen en lugares al azar.',
      'Movete con WASD o las flechas, apuntá con el mouse y disparás con click o ESPACIO.',
      'Las balas rebotan en las paredes y también te matan a vos. Cuidado con los rebotes.',
      'Matar suma 1 punto y morir resta 1. Revivís a los 3 segundos. Cuando se acaba el tiempo, el que más puntos tenga gana.',
    ],
    minPlayers: 1,
  },
  copa: {
    id: 'copa',
    title: 'Noche de Copa',
    subtitle: 'Fútbol de fichas en una cancha redonda',
    icon: '⚽',
    accent: ['#22C55E', '#FDE047'],
    ink: '#052E16',
    howTo: [
      'Cada uno tiene un arco en el borde de la cancha redonda y tres fichas para pegarle a la pelota o defender.',
      'Agarrá una ficha tuya con el click (o el dedo), tirá para atrás eligiendo dirección y fuerza, y soltá. Podés lanzar una ficha cada 5 segundos.',
      'Si te meten un gol quedás afuera y tu arco desaparece. La pelota vuelve al medio y se sigue hasta que queda uno.',
      'Hacer un gol da un bonus de 3 puntos y cada rival que aguantás vale 2. ¡Salí a atacar!',
    ],
    minPlayers: 2,
  },
  formula: {
    id: 'formula',
    title: 'Fórmula 99',
    subtitle: 'Carreras, cáscaras de banana y misiles',
    icon: '🏎️',
    accent: ['#EF4444', '#FACC15'],
    ink: '#2A0606',
    howTo: [
      'Carrera de 3 vueltas vista desde arriba. Acelerá con ↑ o W, frená con ↓ o S y doblá con ← → o A D.',
      'Una vez por vuelta podés agarrar un objeto en las cajas ❓. Usalo con ESPACIO: turbo, banana, aceite, misil, bomba, rayo o escudo.',
      'Los que vienen atrás reciben mejores objetos. El pasto te frena y las flechas del piso te dan envión.',
      'Se corre en pistas distintas. Cada carrera reparte puntos por puesto y el que más sume se lleva 10, el segundo 5 y el tercero 3.',
    ],
    minPlayers: 1,
  },
  shooter: {
    id: 'shooter',
    title: 'Ashootatee',
    subtitle: 'Sacalos de la plataforma a los tiros',
    icon: '🔫',
    accent: ['#F472B6', '#38BDF8'],
    ink: '#2A0A1C',
    howTo: [
      'Las balas no lastiman: empujan. Para matar a alguien hay que tirarlo de las plataformas.',
      'Movete con A D o ← →, saltá con W, ↑ o ESPACIO (hay doble salto) y bajá de una plataforma con S o ↓.',
      'Disparás con J o click. Con K o click derecho tirás una granada: tarda en explotar, no llega lejos y empuja muchísimo, también a vos.',
      'Del cielo caen cajas con armas. Tenés pocas vidas y al reaparecer sos invencible un segundo. El último en pie gana; cada baja suma.',
    ],
    minPlayers: 1,
  },
};

/** Orden en el que se muestran en el lobby. */
export const GAME_ORDER: GameId[] = [
  'vangogh', 'timba', 'smash', 'piramide', 'frases', 'tanque', 'copa', 'formula', 'shooter',
];

export const DEFAULT_CONFIG: RoomConfig = {
  playlist: ['vangogh', 'timba', 'smash', 'piramide', 'frases', 'tanque', 'copa', 'formula', 'shooter'],
  vangoghRounds: 2,
  timbaSeconds: 300,
  smashRounds: 3,
  piramideSeconds: 120,
  frasesRounds: 3,
  tanqueSeconds: 180,
  copaRounds: 2,
  formulaRaces: 2,
  shooterLives: 3,
};

/** Tiempo para leer las reglas antes de cada minijuego (se corta si todos dan listo). */
export const INTRO_MS = 30_000;

export const AVATAR_FACES = [
  '😎', '🤠', '🥸', '🤡', '👽', '🤖', '🐶', '🐱', '🦊', '🐸',
  '🐼', '🐵', '🦁', '🐯', '🦄', '🐙', '🦖', '🐧', '🍄', '👾',
  '💀', '🎃', '🧠', '🔥', '⚡', '🌮', '🍕', '🧉', '🥑', '🦩',
];

export const PALETTE = [
  '#0B0B14', '#FFFFFF', '#FF4D6D', '#FF8A3D', '#F7C948', '#5CD98B',
  '#19C37D', '#37E2D5', '#4C8DFF', '#7C5CFF', '#C77DFF', '#FF6FD8',
  '#8B5E3C', '#C9A227', '#9AA4B2', '#2E3A4D',
];

export const BRUSH_SIZES = [0.006, 0.014, 0.03, 0.06, 0.11];

/* ── Tragamonedas: tabla de pagos estilo cluster-pays ─────────────────────── */

export const SLOT_ROWS = 5;
export const SLOT_COLS = 6;
export const SCATTER = '🍭';
export const BOMB = '💣';

export interface SlotSymbolDef {
  key: string;
  /** peso relativo de aparición */
  weight: number;
  /** pagos por cantidad: [8-9, 10-11, 12+] en múltiplos de la apuesta */
  pays: [number, number, number];
}

export const SLOT_SYMBOLS: SlotSymbolDef[] = [
  { key: '🍌', weight: 170, pays: [0.25, 0.75, 4] },
  { key: '🍇', weight: 160, pays: [0.4, 0.9, 6] },
  { key: '🍉', weight: 150, pays: [0.5, 1, 8] },
  { key: '🍎', weight: 140, pays: [0.8, 1.5, 10] },
  { key: '💙', weight: 95, pays: [1.5, 2, 12] },
  { key: '💚', weight: 80, pays: [2, 5, 15] },
  { key: '💜', weight: 62, pays: [2.5, 10, 25] },
  { key: '❤️', weight: 44, pays: [10, 25, 50] },
];

/** Pago del scatter por cantidad 4 / 5 / 6+, en múltiplos de la apuesta. */
export const SCATTER_PAYS: Record<number, number> = { 4: 3, 5: 5, 6: 100 };
export const SCATTER_WEIGHT = 20;
export const FREE_SPINS_AWARDED = 10;
export const FREE_SPINS_RETRIGGER = 5;
export const BOMB_MULTIPLIERS = [2, 2, 2, 3, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 50, 100];

export const CHIPS = [5, 25, 100, 500];
export const START_BALANCE = 1000;
export const BJ_MIN_BET = 10;

/* ── Smash 360: constantes de simulación (compartidas para la UI) ─────────── */

export const SMASH = {
  TICK_HZ: 30,
  /** semi-ancho de la zona de cada jugador, en radianes */
  ZONE: 0.17,
  SWING_ACTIVE: 320,
  SWING_RECOVER: 260,
  CROUCH_ACTIVE: 440,
  CROUCH_RECOVER: 260,
  /** multiplicador de velocidad por cada smash */
  HIT_BOOST: 1.17,
  /** aceleración pasiva por segundo */
  RAMP: 0.016,
  START_OMEGA: 1.9,
  MAX_OMEGA: 16,
  /** margen para compensar latencia al resolver una eliminación */
  GRACE_MS: 160,
  /** al largar, la pelota queda quieta este rato marcando para dónde va */
  SERVE_MS: 1200,
  /** arranca a esta fracción de START_OMEGA y acelera hasta el 100% */
  SERVE_START: 0.4,
  /** cuánto tarda en llegar a la velocidad normal después del saque */
  SERVE_RAMP_MS: 1600,
  COUNTDOWN_MS: 3200,
  ROUND_END_MS: 4200,
} as const;

/* ── Helpers de formato compartidos ───────────────────────────────────────── */

export function money(n: number): string {
  const sign = n < 0 ? '-' : '';
  const v = Math.round(Math.abs(n));
  return sign + '$' + v.toLocaleString('es-AR');
}

export function ordinal(n: number): string {
  return n === 1 ? '1º' : n === 2 ? '2º' : n === 3 ? '3º' : `${n}º`;
}

export function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

/* ── Hipódromo ────────────────────────────────────────────────────────────── */

export const HORSES: { name: string; color: string; silk: string }[] = [
  { name: 'Relámpago', color: '#FF4D6D', silk: '#FFE066' },
  { name: 'Dulce de Leche', color: '#C98B4B', silk: '#FFF4E0' },
  { name: 'Mate Amargo', color: '#19C37D', silk: '#0B3D2B' },
  { name: 'Tormenta', color: '#4C8DFF', silk: '#FFFFFF' },
  { name: 'Chispita', color: '#FFC93C', silk: '#7C5CFF' },
  { name: 'Pampa', color: '#C77DFF', silk: '#37E2D5' },
];

/** Pago total (incluye la apuesta) si tu caballo gana. */
export const HORSE_PAYOUT = 6;
export const HORSE_BETS = [10, 25, 50, 100, 250, 500];
/** tiempo de pantalla de resultado antes de volver a apostar */
export const HORSE_RESULT_MS = 4500;

/* ── Ruleta europea (un solo cero) ────────────────────────────────────────── */

/** Orden físico de los números en la rueda. */
export const ROULETTE_WHEEL = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24,
  16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
] as const;

export const ROULETTE_REDS = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

export function isRed(n: number): boolean {
  return ROULETTE_REDS.has(n);
}

/** Duración de la bolita girando; cliente y servidor la comparten. */
export const ROULETTE_SPIN_MS = 6200;
export const ROULETTE_RESULT_MS = 3600;

/* ── Pirámide: geometría y física (compartidas con el renderer) ───────────── */

export const PYR = {
  /** ancho del mundo en unidades de simulación */
  W: 1280,
  /** cantidad de escalones por encima del piso */
  LEVELS: 6,
  STEP_H: 54,
  BASE_HALF: 520,
  TOP_HALF: 62,
  PLAYER_R: 18,
  GRAVITY: 1600,
  ACCEL: 1450,
  MAX_VX: 220,
  /** al apretar para el lado contrario al que vas, frena así de más rápido */
  TURN_BOOST: 2.4,
  /** fracción de la aceleración que se tiene en el aire */
  AIR_CONTROL: 0.7,
  GROUND_FRICTION: 0.0012,
  AIR_FRICTION: 0.35,
  JUMP_V: 540,
  /** escalón que se sube solo sin saltar */
  AUTO_STEP: 9,
  PUSH_RADIUS: 78,
  PUSH_FORCE: 700,
  PUSH_LIFT: 260,
  PUSH_COOLDOWN: 620,
  /** rebote al chocarse entre jugadores */
  BUMP: 1.5,
  /** puntos por segundo en la cima */
  POINTS_PER_SEC: 12,
  TICK_HZ: 60,
  /** aplastado: tiempo hasta reaparecer en el piso */
  RESPAWN_MS: 5000,
  /** rebote del que aplasta */
  STOMP_BOUNCE: 460,
  /** cañonazo */
  SHOT_COOLDOWN: 7000,
  SHOT_SPEED: 760,
  SHOT_R: 13,
  SHOT_TTL: 1700,
  /** apunta solo al rival más cercano dentro de este cono (radianes, hacia arriba o abajo) */
  SHOT_AIM_CONE: 0.9,
  SHOT_AIM_RANGE: 760,
  SHOT_FORCE: 1500,
  SHOT_LIFT: 720,
  /** sin control y sin tope de velocidad mientras vuela */
  LAUNCH_MS: 900,
} as const;

/** Semiancho del escalón `level` (1..LEVELS). El nivel 0 es el piso. */
export function pyrHalfWidth(level: number): number {
  if (level <= 0) return PYR.W;
  const t = (level - 1) / Math.max(1, PYR.LEVELS - 1);
  return PYR.BASE_HALF + (PYR.TOP_HALF - PYR.BASE_HALF) * t;
}

/** Altura del terreno en la coordenada x. */
export function pyrHeightAt(x: number): number {
  const d = Math.abs(x - PYR.W / 2);
  let top = 0;
  for (let i = 1; i <= PYR.LEVELS; i++) {
    if (d <= pyrHalfWidth(i)) top = i;
    else break;
  }
  return top * PYR.STEP_H;
}

export const PYR_TOP_Y = PYR.LEVELS * PYR.STEP_H;
