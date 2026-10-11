/* ──────────────────────────────────────────────────────────────────────────
 *  ASHOOTATEE — mapas, armas y física compartidas.
 *  Vista de costado. Las plataformas se atraviesan desde abajo y se aterriza
 *  arriba. Nadie pierde vida por balazos: se muere cayéndose del mapa.
 * ────────────────────────────────────────────────────────────────────────── */

import type { ShWeapon } from './types';

export const SH = {
  W: 1600,
  H: 900,
  TICK_HZ: 60,
  /** caja del personaje: x es el centro, y son los pies */
  HALF_W: 19,
  HEIGHT: 56,
  GRAVITY: 2150,
  MAX_FALL: 1350,
  RUN: 300,
  ACCEL_GROUND: 3300,
  ACCEL_AIR: 1900,
  FRICTION: 2700,
  JUMP_V: 880,
  DOUBLE_JUMP_V: 760,
  /** con el golpe encima no hay tope de velocidad, sólo rozamiento de aire */
  KNOCK_DRAG: 0.9,
  /** cada golpe seguido pega un 12% más fuerte, hasta 1.6x */
  COMBO_STEP: 0.12,
  COMBO_MAX: 1.6,
  COMBO_WINDOW: 1700,
  /** fuera de estos márgenes te caíste */
  KILL_MARGIN_X: 260,
  KILL_BELOW: 160,
  KILL_ABOVE: 950,
  RESPAWN_MS: 1500,
  /** invencibilidad al reaparecer */
  SHIELD_MS: 1000,
  /** el último que te pegó se lleva la baja si caés antes de esto */
  CREDIT_MS: 5000,
  DROP_MS: 260,
  NADE_COOLDOWN: 3600,
  NADE_FUSE: 1600,
  NADE_RADIUS: 155,
  NADE_FORCE: 1250,
  NADE_THROW_X: 430,
  NADE_THROW_Y: 540,
  NADE_GRAVITY: 1800,
  NADE_R: 11,
  CRATE_EVERY: [7500, 11000] as [number, number],
  CRATE_MAX: 2,
  CRATE_TTL: 15_000,
  CRATE_SIZE: 36,
  MATCH_MS: 210_000,
  SOLO_MS: 80_000,
  COUNTDOWN_MS: 3200,
} as const;

export interface WeaponDef {
  name: string;
  icon: string;
  /** ms entre tiros */
  cooldown: number;
  speed: number;
  knock: number;
  /** balas por disparo */
  pellets: number;
  /** apertura del abanico (rad) */
  spread: number;
  /** vida de la bala (ms); 0 = hasta salir del mapa */
  ttl: number;
  recoil: number;
  /** balas que trae la caja (-1 = infinitas) */
  ammo: number;
}

export const WEAPONS: Record<ShWeapon, WeaponDef> = {
  pistol: { name: 'Pistola', icon: '🔫', cooldown: 300, speed: 640, knock: 330, pellets: 1, spread: 0, ttl: 0, recoil: 0, ammo: -1 },
  shotgun: { name: 'Escopeta', icon: '💥', cooldown: 760, speed: 760, knock: 250, pellets: 5, spread: 0.26, ttl: 360, recoil: 300, ammo: 6 },
  minigun: { name: 'Metra', icon: '⚙️', cooldown: 85, speed: 820, knock: 115, pellets: 1, spread: 0.06, ttl: 0, recoil: 30, ammo: 48 },
  sniper: { name: 'Franco', icon: '🎯', cooldown: 950, speed: 1500, knock: 1050, pellets: 1, spread: 0, ttl: 0, recoil: 380, ammo: 3 },
  nades: { name: 'Granadas', icon: '💣', cooldown: 300, speed: 0, knock: 0, pellets: 0, spread: 0, ttl: 0, recoil: 0, ammo: 3 },
};

/** Lo que puede traer una caja, con su peso. */
export const CRATE_LOOT: [ShWeapon, number][] = [
  ['shotgun', 3],
  ['minigun', 3],
  ['sniper', 2],
  ['nades', 2],
];

export interface Platform {
  x: number;
  /** altura de la superficie */
  y: number;
  w: number;
  /** grosor visual */
  h: number;
  /** plataformas móviles: amplitud y período */
  ax?: number;
  ay?: number;
  period?: number;
  phase?: number;
}

export interface ShMap {
  name: string;
  tag: string;
  theme: 'neon' | 'temple' | 'factory';
  platforms: Platform[];
}

export const SH_MAPS: ShMap[] = [
  {
    name: 'Neón Porteño',
    tag: 'Terrazas de Buenos Aires a medianoche',
    theme: 'neon',
    platforms: [
      { x: 300, y: 650, w: 1000, h: 46 },
      { x: 110, y: 480, w: 300, h: 22 },
      { x: 1190, y: 480, w: 300, h: 22 },
      { x: 570, y: 440, w: 460, h: 22 },
      { x: 320, y: 290, w: 260, h: 22 },
      { x: 1020, y: 290, w: 260, h: 22 },
      { x: 690, y: 160, w: 220, h: 22 },
    ],
  },
  {
    name: 'Templo Flotante',
    tag: 'Islas de piedra en un atardecer eterno',
    theme: 'temple',
    platforms: [
      { x: 180, y: 620, w: 430, h: 50 },
      { x: 990, y: 620, w: 430, h: 50 },
      { x: 640, y: 730, w: 320, h: 40 },
      { x: 530, y: 470, w: 540, h: 26 },
      { x: 70, y: 380, w: 250, h: 24 },
      { x: 1280, y: 380, w: 250, h: 24 },
      { x: 700, y: 270, w: 200, h: 24 },
    ],
  },
  {
    name: 'Fábrica Rosa',
    tag: 'Cintas, grúas y plataformas que no se quedan quietas',
    theme: 'factory',
    platforms: [
      { x: 270, y: 670, w: 1060, h: 44 },
      { x: 230, y: 480, w: 240, h: 22, ax: 210, period: 6400, phase: 0 },
      { x: 1130, y: 480, w: 240, h: 22, ax: 210, period: 6400, phase: Math.PI },
      { x: 650, y: 350, w: 300, h: 22 },
      { x: 120, y: 260, w: 220, h: 22 },
      { x: 1260, y: 260, w: 220, h: 22 },
      { x: 700, y: 150, w: 200, h: 20, ay: 40, period: 4200, phase: 0 },
    ],
  },
];

/** Posición de una plataforma en el instante `t` (ms desde el inicio). */
export function platformAt(p: Platform, t: number): { x: number; y: number } {
  if (!p.period) return { x: p.x, y: p.y };
  const k = Math.sin((t / p.period) * Math.PI * 2 + (p.phase ?? 0));
  return { x: p.x + (p.ax ?? 0) * k, y: p.y + (p.ay ?? 0) * k };
}
