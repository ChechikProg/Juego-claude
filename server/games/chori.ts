import { CH, CHORI_MAPS, blocked, pushOut, type ChoriMap } from '../../shared/chori';
import type { ChoriFx, ChoriPlayer, ChoriView } from '../../shared/types';
import { pick, rnd, rndInt } from '../util';
import type { GameContext, GameModule } from './kit';

const FX_TTL = 1400;
const DOG_MAX_MS = 22_000;

interface Runner {
  playerId: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  a: number;
  input: { x: number; y: number };
  sprintQueued: boolean;
  sprintUntil: number;
  sprintReadyAt: number;
  stunUntil: number;
  /** ms con el chori */
  held: number;
  /** no puede agarrar el chori hasta acá */
  lockUntil: number;
}

interface Chori {
  x: number;
  y: number;
  vx: number;
  vy: number;
  holder: string | null;
  /** lo tiene el perro en la boca */
  dog: boolean;
  /** volando: no se puede agarrar hasta acá */
  airUntil: number;
  /** a quien lo tiene no se lo pueden sacar hasta acá */
  immuneUntil: number;
  /** se lo llevó el perro: reaparece en respawnAt */
  hidden: boolean;
  respawnAt: number;
}

interface Dog {
  x: number;
  y: number;
  vx: number;
  vy: number;
  hasChori: boolean;
  mode: 'chase' | 'flee';
  exit: { x: number; y: number };
  bornAt: number;
}

type EventKind = 'dog' | 'cart' | 'smoke';

interface CState {
  stage: 'countdown' | 'live' | 'done';
  until: number;
  endsAt: number;
  map: number;
  runners: Map<string, Runner>;
  chori: Chori;
  dog: Dog | null;
  cart: { x: number; y: number; vx: number; vy: number; hit: Set<string> } | null;
  smoke: ChoriView['smoke'];
  pending: { kind: EventKind; at: number } | null;
  nextEventAt: number;
  lastKind: EventKind | null;
  fx: ChoriFx[];
  seq: number;
  lastTick: number;
}

export const chori: GameModule<CState> = {
  id: 'chori',
  tickHz: CH.TICK_HZ,

  create(ctx) {
    const map = rndInt(0, CHORI_MAPS.length);
    const m = CHORI_MAPS[map];
    const s: CState = {
      stage: 'countdown',
      until: 0,
      endsAt: 0,
      map,
      runners: new Map(),
      chori: { x: CH.W / 2, y: CH.H / 2, vx: 0, vy: 0, holder: null, dog: false, airUntil: 0, immuneUntil: 0, hidden: false, respawnAt: 0 },
      dog: null,
      cart: null,
      smoke: null,
      pending: null,
      nextEventAt: 0,
      lastKind: null,
      fx: [],
      seq: 1,
      lastTick: 0,
    };
    const [cx, cy] = pick(m.choriSpots);
    s.chori.x = cx;
    s.chori.y = cy;
    const players = ctx.players();
    players.forEach((p, i) => {
      const r = newRunner(p.id);
      placeOnRing(r, i, players.length, m);
      s.runners.set(p.id, r);
    });
    return s;
  },

  start(ctx, s) {
    const seconds = Math.max(60, Math.min(300, ctx.config.choriSeconds || 120));
    s.stage = 'countdown';
    s.until = ctx.now() + CH.COUNTDOWN_MS;
    s.endsAt = s.until + seconds * 1000;
    s.lastTick = ctx.now();
    ctx.push();
  },

  event(ctx, s, playerId, type, data) {
    const r = s.runners.get(playerId);
    if (!r) return;
    if (type === 'input') {
      const d = (data ?? {}) as { x?: unknown; y?: unknown };
      let x = Number(d.x) || 0;
      let y = Number(d.y) || 0;
      const l = Math.hypot(x, y);
      if (l > 1) {
        x /= l;
        y /= l;
      }
      r.input.x = x;
      r.input.y = y;
    } else if (type === 'sprint') {
      if (s.stage === 'live') r.sprintQueued = true;
    }
    void ctx;
  },

  tick(ctx, s, _dt, now) {
    if (s.stage === 'countdown') {
      if (now >= s.until) {
        s.stage = 'live';
        s.until = s.endsAt;
        s.lastTick = now;
        s.nextEventAt = now + between(CH.EVENT_FIRST);
        ctx.push();
      }
      return;
    }
    if (s.stage !== 'live') return;

    const dt = Math.min(0.05, (now - s.lastTick) / 1000);
    s.lastTick = now;
    if (dt <= 0) return;
    const map = CHORI_MAPS[s.map];

    events(ctx, s, now, map);
    moveRunners(s, dt, now, map);
    collideRunners(s, now);
    stepDog(s, dt, now);
    stepCart(s, dt, now);
    stepChori(s, dt, now, map);

    if (s.smoke && now >= s.smoke.until) s.smoke = null;
    if (s.fx.length && now - s.fx[0].at > FX_TTL) s.fx = s.fx.filter((f) => now - f.at <= FX_TTL);

    if (now >= s.endsAt) {
      finish(ctx, s);
      return;
    }
    ctx.push();
  },

  leave(ctx, s, playerId) {
    const r = s.runners.get(playerId);
    if (r) {
      r.input = { x: 0, y: 0 };
      if (s.chori.holder === playerId) drop(s, r, ctx.now(), rnd() * Math.PI * 2);
    }
    ctx.push();
  },

  rejoin(ctx, s, playerId) {
    if (s.runners.has(playerId) || s.stage === 'done' || !ctx.player(playerId)) return;
    const r = newRunner(playerId);
    placeOnRing(r, rndInt(0, 8), 8, CHORI_MAPS[s.map]);
    s.runners.set(playerId, r);
    ctx.push();
  },

  view(ctx, s): ChoriView {
    const now = ctx.now();
    const r1 = (n: number) => Math.round(n * 10) / 10;
    const players: ChoriPlayer[] = [...s.runners.values()].map((r) => ({
      playerId: r.playerId,
      x: r1(r.x),
      y: r1(r.y),
      vx: r1(r.vx),
      vy: r1(r.vy),
      a: Math.round(r.a * 100) / 100,
      sprintUntil: r.sprintUntil,
      sprintReadyAt: r.sprintReadyAt,
      stunUntil: r.stunUntil,
      held: Math.round(r.held),
    }));
    const c = s.chori;
    const air = c.airUntil > now ? (c.airUntil - now) / CH.CHORI_AIR_MS : 0;
    return {
      stage: s.stage,
      t: now,
      until: s.stage === 'countdown' ? s.until : s.endsAt,
      map: s.map,
      players,
      chori: {
        x: r1(c.x),
        y: r1(c.y),
        vx: r1(c.vx),
        vy: r1(c.vy),
        holder: c.holder,
        dog: c.dog,
        z: c.hidden ? -1 : Math.round(Math.sin(Math.PI * air) * 34),
      },
      dog: s.dog ? { x: r1(s.dog.x), y: r1(s.dog.y), vx: r1(s.dog.vx), vy: r1(s.dog.vy), hasChori: s.dog.hasChori } : null,
      cart: s.cart ? { x: r1(s.cart.x), y: r1(s.cart.y), vx: s.cart.vx, vy: s.cart.vy } : null,
      smoke: s.smoke,
      event: s.pending,
      fx: s.fx,
    };
  },
};

/* ── jugadores ────────────────────────────────────────────────────────────── */

function newRunner(playerId: string): Runner {
  return {
    playerId,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    a: 0,
    input: { x: 0, y: 0 },
    sprintQueued: false,
    sprintUntil: 0,
    sprintReadyAt: 0,
    stunUntil: 0,
    held: 0,
    lockUntil: 0,
  };
}

function placeOnRing(r: Runner, i: number, n: number, map: ChoriMap): void {
  for (let tries = 0; tries < 40; tries++) {
    const a = (i / Math.max(1, n)) * Math.PI * 2 + tries * 0.37;
    const rad = 380 + (tries % 4) * 40;
    const x = CH.W / 2 + Math.cos(a) * rad * 1.35;
    const y = CH.H / 2 + Math.sin(a) * rad * 0.9;
    if (!blocked(x, y, CH.PLAYER_R + 6, map)) {
      r.x = x;
      r.y = y;
      r.a = Math.atan2(CH.H / 2 - y, CH.W / 2 - x);
      return;
    }
  }
  r.x = CH.W / 2;
  r.y = CH.H / 2 + 200;
}

function moveRunners(s: CState, dt: number, now: number, map: ChoriMap): void {
  for (const r of s.runners.values()) {
    const stunned = now < r.stunUntil;
    const hasInput = !stunned && (r.input.x !== 0 || r.input.y !== 0);

    if (r.sprintQueued) {
      r.sprintQueued = false;
      if (!stunned && now >= r.sprintReadyAt) {
        const dx = hasInput ? r.input.x : Math.cos(r.a);
        const dy = hasInput ? r.input.y : Math.sin(r.a);
        const l = Math.hypot(dx, dy) || 1;
        r.vx = (dx / l) * CH.SPRINT_SPEED;
        r.vy = (dy / l) * CH.SPRINT_SPEED;
        r.sprintUntil = now + CH.SPRINT_MS;
        r.sprintReadyAt = now + CH.SPRINT_COOLDOWN;
        addFx(s, 'sprint', r.x, r.y, now, r.playerId);
      }
    }

    const sprinting = now < r.sprintUntil;
    if (!sprinting) {
      if (hasInput) {
        r.vx += r.input.x * CH.ACCEL * dt;
        r.vy += r.input.y * CH.ACCEL * dt;
      }
      // Frena lo que no va en la dirección pedida (y todo si no aprieta nada).
      const damp = Math.exp(-(hasInput ? CH.DAMP * 0.45 : CH.DAMP) * dt);
      r.vx *= damp;
      r.vy *= damp;
      const max = CH.MAX_SPEED * (s.chori.holder === r.playerId ? CH.HOLDER_SPEED : 1);
      const sp = Math.hypot(r.vx, r.vy);
      if (sp > max) {
        // Pasado el tope (después de un pique o un empujón) baja de a poco.
        const k = Math.max(max / sp, Math.exp(-5 * dt));
        r.vx *= k;
        r.vy *= k;
      }
    }

    r.x += r.vx * dt;
    r.y += r.vy * dt;
    pushOut(r, CH.PLAYER_R, map, 0.25);
    if (Math.hypot(r.vx, r.vy) > 20) r.a = Math.atan2(r.vy, r.vx);
  }
}

function collideRunners(s: CState, now: number): void {
  const list = [...s.runners.values()];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      const min = CH.PLAYER_R * 2;
      if (d >= min) continue;
      const nx = d > 1e-6 ? dx / d : 1;
      const ny = d > 1e-6 ? dy / d : 0;
      const push = (min - d) / 2;
      a.x -= nx * push;
      a.y -= ny * push;
      b.x += nx * push;
      b.y += ny * push;
      // Velocidad con la que se acercaban.
      const closing = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
      if (closing > 0) {
        const imp = closing * 0.5 + CH.BUMP * 0.4;
        a.vx -= nx * imp;
        a.vy -= ny * imp;
        b.vx += nx * imp;
        b.vy += ny * imp;
      }

      const holder = s.chori.holder;
      if (holder !== a.playerId && holder !== b.playerId) continue;
      if (now < s.chori.immuneUntil) continue;
      const victim = holder === a.playerId ? a : b;
      const thief = victim === a ? b : a;
      const sprinting = now < thief.sprintUntil;
      if (closing < CH.STEAL_SPEED && !sprinting) continue;
      // Sale volando para el lado al que iba el que chocó.
      const dir = Math.atan2(victim.y - thief.y, victim.x - thief.x) + (rnd() - 0.5) * 1.2;
      drop(s, victim, now, dir);
      addFx(s, 'steal', victim.x, victim.y, now, victim.playerId, thief.playerId);
    }
  }
}

/** Al que lo tenía se le cae el chori y sale volando en la dirección `dir`. */
function drop(s: CState, victim: Runner, now: number, dir: number): void {
  const c = s.chori;
  if (c.holder !== victim.playerId) return;
  c.holder = null;
  c.x = victim.x;
  c.y = victim.y;
  c.vx = Math.cos(dir) * CH.CHORI_FLY + victim.vx * 0.3;
  c.vy = Math.sin(dir) * CH.CHORI_FLY + victim.vy * 0.3;
  c.airUntil = now + CH.CHORI_AIR_MS;
  victim.lockUntil = now + CH.DROP_LOCK_MS;
  addFx(s, 'drop', c.x, c.y, now, victim.playerId);
}

/* ── el chori ─────────────────────────────────────────────────────────────── */

function stepChori(s: CState, dt: number, now: number, map: ChoriMap): void {
  const c = s.chori;
  if (c.hidden) {
    if (now >= c.respawnAt) {
      // Que no aparezca encima de nadie.
      const spots = map.choriSpots
        .map(([x, y]) => ({ x, y, near: Math.min(...[...s.runners.values()].map((r) => Math.hypot(r.x - x, r.y - y)), 9999) }))
        .sort((a, b) => b.near - a.near);
      const spot = spots[rndInt(0, Math.min(3, spots.length))] ?? { x: CH.W / 2, y: CH.H / 2 };
      c.hidden = false;
      c.x = spot.x;
      c.y = spot.y;
      c.vx = 0;
      c.vy = 0;
      c.airUntil = now + 250;
      addFx(s, 'run', c.x, c.y, now);
    }
    return;
  }
  if (c.holder) {
    const h = s.runners.get(c.holder);
    if (!h) {
      c.holder = null;
      return;
    }
    c.x = h.x;
    c.y = h.y;
    h.held += dt * 1000;
    return;
  }
  if (c.dog) {
    if (s.dog) {
      c.x = s.dog.x;
      c.y = s.dog.y;
    }
    return;
  }

  c.x += c.vx * dt;
  c.y += c.vy * dt;
  const damp = Math.exp(-CH.CHORI_DAMP * dt);
  c.vx *= damp;
  c.vy *= damp;
  pushOut(c, 10, map, 0.5);
  if (now < c.airUntil) return;

  // Lo agarra el más cercano que no esté bloqueado ni aturdido.
  let best: Runner | null = null;
  let bestD: number = CH.PICK_R;
  for (const r of s.runners.values()) {
    if (now < r.lockUntil || now < r.stunUntil) continue;
    const d = Math.hypot(r.x - c.x, r.y - c.y);
    if (d < bestD) {
      best = r;
      bestD = d;
    }
  }
  if (best) {
    c.holder = best.playerId;
    c.immuneUntil = now + CH.GRAB_IMMUNE_MS;
    c.vx = 0;
    c.vy = 0;
    addFx(s, 'grab', c.x, c.y, now, best.playerId);
  }
}

/* ── eventos ──────────────────────────────────────────────────────────────── */

function events(ctx: GameContext, s: CState, now: number, map: ChoriMap): void {
  if (!s.pending && now >= s.nextEventAt) {
    const options: EventKind[] = (['dog', 'cart', 'smoke'] as EventKind[]).filter(
      (k) => k !== s.lastKind && !(k === 'dog' && s.dog) && !(k === 'cart' && s.cart) && !(k === 'smoke' && s.smoke),
    );
    if (options.length) s.pending = { kind: pick(options), at: now + CH.WARN_MS };
    else s.nextEventAt = now + 3000;
  }
  if (!s.pending || now < s.pending.at) return;
  const kind = s.pending.kind;
  s.pending = null;
  s.lastKind = kind;
  s.nextEventAt = now + between(CH.EVENT_EVERY);

  if (kind === 'dog') {
    const side = rndInt(0, 4);
    const x = side === 0 ? -40 : side === 1 ? CH.W + 40 : 100 + rnd() * (CH.W - 200);
    const y = side === 2 ? -40 : side === 3 ? CH.H + 40 : 100 + rnd() * (CH.H - 200);
    s.dog = { x, y, vx: 0, vy: 0, hasChori: false, mode: 'chase', exit: { x, y }, bornAt: now };
    addFx(s, 'dog', x, y, now);
    ctx.toast(null, '🐕 ¡Se escapó un perro y quiere el chori!', 'info');
  } else if (kind === 'cart') {
    const horizontal = rnd() < 0.6;
    const fromStart = rnd() < 0.5;
    if (horizontal) {
      const y = 180 + rnd() * (CH.H - 360);
      s.cart = { x: fromStart ? -80 : CH.W + 80, y, vx: fromStart ? CH.CART_SPEED : -CH.CART_SPEED, vy: 0, hit: new Set() };
    } else {
      const x = 200 + rnd() * (CH.W - 400);
      s.cart = { x, y: fromStart ? -80 : CH.H + 80, vx: 0, vy: fromStart ? CH.CART_SPEED : -CH.CART_SPEED, hit: new Set() };
    }
    addFx(s, 'cart', s.cart.x, s.cart.y, now);
    ctx.toast(null, '🛒 ¡Pasa el vendedor! Corranse', 'info');
  } else {
    const side = pick(['left', 'right', 'top', 'bottom'] as const);
    s.smoke = { side, from: now, until: now + CH.SMOKE_MS };
    addFx(s, 'smoke', CH.W / 2, CH.H / 2, now);
    ctx.toast(null, '💨 ¡El humo de la parrilla tapa todo!', 'info');
  }
  void map;
}

function stepDog(s: CState, dt: number, now: number): void {
  const dog = s.dog;
  if (!dog) return;
  const c = s.chori;

  if (dog.mode === 'chase') {
    // Si el chori desapareció o tarda demasiado, se va.
    if (c.hidden || now - dog.bornAt > DOG_MAX_MS) {
      dog.mode = 'flee';
      dog.exit = nearestExit(dog.x, dog.y);
    } else {
      steer(dog, c.x, c.y, CH.DOG_SPEED, dt);
      const reach = c.holder ? CH.DOG_R + CH.PLAYER_R : CH.DOG_R + 12;
      if (now >= c.airUntil && Math.hypot(dog.x - c.x, dog.y - c.y) < reach) {
        const holder = c.holder ? s.runners.get(c.holder) : null;
        if (holder) holder.lockUntil = now + CH.DROP_LOCK_MS;
        c.holder = null;
        c.dog = true;
        dog.hasChori = true;
        dog.mode = 'flee';
        dog.exit = nearestExit(dog.x, dog.y);
        addFx(s, 'dogbite', dog.x, dog.y, now, holder?.playerId);
      }
    }
    return;
  }

  steer(dog, dog.exit.x, dog.exit.y, CH.DOG_RUN_SPEED, dt);

  if (dog.hasChori) {
    // Si alguien lo alcanza, lo suelta.
    for (const r of s.runners.values()) {
      if (now < r.stunUntil) continue;
      if (Math.hypot(r.x - dog.x, r.y - dog.y) >= CH.DOG_R + CH.PLAYER_R) continue;
      dog.hasChori = false;
      c.dog = false;
      c.x = dog.x;
      c.y = dog.y;
      const a = rnd() * Math.PI * 2;
      c.vx = Math.cos(a) * CH.CHORI_FLY * 0.8;
      c.vy = Math.sin(a) * CH.CHORI_FLY * 0.8;
      c.airUntil = now + CH.CHORI_AIR_MS;
      addFx(s, 'dogdrop', dog.x, dog.y, now, r.playerId);
      break;
    }
  }

  const out = dog.x < -60 || dog.y < -60 || dog.x > CH.W + 60 || dog.y > CH.H + 60;
  if (out) {
    if (dog.hasChori) {
      c.dog = false;
      c.hidden = true;
      c.respawnAt = now + CH.RESPAWN_MS;
    }
    s.dog = null;
  }
}

function steer(d: { x: number; y: number; vx: number; vy: number }, tx: number, ty: number, speed: number, dt: number): void {
  const dx = tx - d.x;
  const dy = ty - d.y;
  const l = Math.hypot(dx, dy) || 1;
  const k = Math.min(1, dt * 6);
  d.vx += ((dx / l) * speed - d.vx) * k;
  d.vy += ((dy / l) * speed - d.vy) * k;
  d.x += d.vx * dt;
  d.y += d.vy * dt;
}

function nearestExit(x: number, y: number): { x: number; y: number } {
  const options = [
    { x: -120, y, d: x },
    { x: CH.W + 120, y, d: CH.W - x },
    { x, y: -120, d: y },
    { x, y: CH.H + 120, d: CH.H - y },
  ];
  // No siempre la más cercana: así hay tiempo de perseguirlo.
  options.sort((a, b) => a.d - b.d);
  return options[rnd() < 0.6 ? 1 : 2];
}

function stepCart(s: CState, dt: number, now: number): void {
  const cart = s.cart;
  if (!cart) return;
  cart.x += cart.vx * dt;
  cart.y += cart.vy * dt;
  const speed = Math.hypot(cart.vx, cart.vy) || 1;
  const fx = cart.vx / speed;
  const fy = cart.vy / speed;
  for (const r of s.runners.values()) {
    const dx = r.x - cart.x;
    const dy = r.y - cart.y;
    const d = Math.hypot(dx, dy);
    if (d >= CH.CART_R + CH.PLAYER_R) continue;
    // Lo tira hacia el costado y un poco para adelante.
    const side = dx * -fy + dy * fx >= 0 ? 1 : -1;
    const px = -fy * side;
    const py = fx * side;
    r.vx = (px * 0.85 + fx * 0.5) * CH.CART_PUSH;
    r.vy = (py * 0.85 + fy * 0.5) * CH.CART_PUSH;
    r.x = cart.x + (dx / (d || 1)) * (CH.CART_R + CH.PLAYER_R + 1);
    r.y = cart.y + (dy / (d || 1)) * (CH.CART_R + CH.PLAYER_R + 1);
    if (!cart.hit.has(r.playerId)) {
      cart.hit.add(r.playerId);
      r.stunUntil = now + CH.STUN_MS;
      addFx(s, 'bump', r.x, r.y, now, r.playerId);
      if (s.chori.holder === r.playerId) drop(s, r, now, Math.atan2(py, px));
    }
  }
  if (cart.x < -140 || cart.y < -140 || cart.x > CH.W + 140 || cart.y > CH.H + 140) s.cart = null;
}

/* ── fin ──────────────────────────────────────────────────────────────────── */

function finish(ctx: GameContext, s: CState): void {
  if (s.stage === 'done') return;
  s.stage = 'done';
  ctx.push();
  ctx.finish(
    ctx.players().map((p) => {
      const held = s.runners.get(p.id)?.held ?? 0;
      return { playerId: p.id, value: Math.round(held / 100), label: `${(held / 1000).toFixed(1)} s con el chori` };
    }),
  );
}

function between([a, b]: [number, number]): number {
  return a + rnd() * (b - a);
}

function addFx(s: CState, kind: ChoriFx['kind'], x: number, y: number, at: number, playerId?: string, by?: string): void {
  s.fx.push({ id: s.seq++, kind, x: Math.round(x), y: Math.round(y), at, playerId, by });
  if (s.fx.length > 40) s.fx.shift();
}
