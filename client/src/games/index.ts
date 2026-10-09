import type { GameId } from '@shared/types';
import { Frases } from './frases/Frases';
import { Piramide } from './piramide/Piramide';
import { Smash } from './smash/Smash';
import { Tanque } from './tanque/Tanque';
import { Timba } from './timba/Timba';
import { VanGogh } from './vangogh/VanGogh';

/**
 * Registro de vistas. Para sumar un minijuego alcanza con agregar su
 * componente acá (y su módulo en el servidor).
 */
export const GAME_VIEWS: Record<GameId, (props: { view: never }) => JSX.Element> = {
  vangogh: VanGogh as never,
  timba: Timba as never,
  smash: Smash as never,
  piramide: Piramide as never,
  frases: Frases as never,
  tanque: Tanque as never,
};
