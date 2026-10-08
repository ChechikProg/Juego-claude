import type { GameId, RoomConfig } from '../../shared/types';
import type { TimerBag } from '../util';

export interface GamePlayer {
  id: string;
  name: string;
  connected: boolean;
  /** RTT estimado en ms, usado para compensar latencia */
  rtt: number;
}

/** Fila cruda con la que un minijuego reporta su resultado final. */
export interface ResultRow {
  playerId: string;
  /** más alto = mejor */
  value: number;
  label: string;
}

/**
 * Todo lo que un minijuego puede pedirle al motor. Los módulos no conocen
 * sockets ni salas: hablan solamente a través de este contexto.
 */
export interface GameContext {
  readonly config: RoomConfig;
  /** jugadores que participan de este minijuego (sin espectadores) */
  players(): GamePlayer[];
  player(id: string): GamePlayer | undefined;
  readonly timers: TimerBag;
  now(): number;
  /** reenvía la vista a todos (se agrupa en el próximo frame) */
  push(): void;
  /** reenvía la vista sólo a un jugador */
  pushTo(playerId: string): void;
  toast(playerId: string | null, text: string, kind?: 'info' | 'good' | 'bad'): void;
  /** termina el minijuego y entrega el ranking crudo */
  finish(rows: ResultRow[]): void;
}

/**
 * Contrato de un minijuego. Para agregar uno nuevo alcanza con implementar
 * esto y registrarlo en `registry.ts` + `shared/constants.ts`.
 */
export interface GameModule<S = unknown> {
  id: GameId;
  /** si está definido, el motor llama a `tick` a esta frecuencia */
  tickHz?: number;
  /** crea el estado interno; el minijuego todavía no arrancó */
  create(ctx: GameContext): S;
  /** arranca la lógica (timers, primera ronda, etc.) */
  start(ctx: GameContext, s: S): void;
  /** input de un jugador */
  event(ctx: GameContext, s: S, playerId: string, type: string, data: unknown): void;
  tick?(ctx: GameContext, s: S, dtMs: number, t: number): void;
  /** un jugador se desconectó */
  leave?(ctx: GameContext, s: S, playerId: string): void;
  /** un jugador volvió */
  rejoin?(ctx: GameContext, s: S, playerId: string): void;
  /** vista personalizada por jugador (lo que viaja por el socket) */
  view(ctx: GameContext, s: S, playerId: string): unknown;
  /** limpieza al cortar el minijuego a mitad de camino */
  dispose?(ctx: GameContext, s: S): void;
}
