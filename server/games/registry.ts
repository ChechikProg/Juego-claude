import type { GameId } from '../../shared/types';
import type { GameModule } from './kit';
import { frases } from './frases';
import { piramide } from './piramide';
import { smash } from './smash';
import { tanque } from './tanque';
import { timba } from './timba/index';
import { vanGogh } from './vangogh';

/**
 * Único lugar donde se enchufan los minijuegos.
 * Para sumar uno nuevo: creá el módulo, agregalo acá, sumá su `GameId` en
 * `shared/types.ts`, su metadata en `shared/constants.ts` y su componente en
 * `client/src/games/index.ts`.
 */
export const REGISTRY: Record<GameId, GameModule<any>> = {
  vangogh: vanGogh,
  timba: timba,
  smash: smash,
  piramide: piramide,
  frases: frases,
  tanque: tanque,
};

export function getGame(id: GameId): GameModule<any> | undefined {
  return REGISTRY[id];
}
