import { PYR, PYR_TOP_Y, pyrHalfWidth, pyrHeightAt } from '../../shared/constants';
import type { PiramideView, PyrFx, PyrPlayer } from '../../shared/types';
import type { GameContext, GameModule } from './kit';

const COUNTDOWN_MS = 3200;
const FX_TTL = 800;

interface Body {
  playerId: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  face: -1 | 1;
  grounded: boolean;
  points: number;
  pushUntil: number;
  readyAt: number;
  input: { left: boolean; right: boolean };
  jumpQueued: boolean;
  pushQueued: boolean;
}

interface PyrState {
  stage: 'countdown' | 'live' | 'done';
  until: number;
  bodies: Map<string, Body>;
  fx: PyrFx[];
  fxSeq: number;
  lastTick: number;
  endsAt: number;
}

function spawn(playerId: string, i: number, total: number): Body {
  // Repartidos a lo ancho del piso para que nadie arranque con ventaja.
  const spread = PYR.W * 0.82;
  const x = PYR.W / 2 - spread / 2 + (spread * (i + 0.5)) / Math.max(1, total);
  return {
    playerId,
    x,
    y: 0,
    vx: 0,
    vy: 0,
    face: x < PYR.W / 2 ? 1 : -1,
    grounded: true,
    points: 0,
    pushUntil: 0,
    readyAt: 0,
    input: { left: false, right: false },
    jumpQueued: false,
    pushQueued: false,
  };
}

function levelOf(y: number): number {
  return Math.round(y / PYR.STEP_H);
}

function isOnTop(b: Body): boolean {
  return (
    b.grounded &&
    b.y >= PYR_TOP_Y - 2 &&
    Math.abs(b.x - PYR.W / 2) <= pyrHalfWidth(PYR.LEVELS) + PYR.PLAYER_R * 0.6
  );
}

export const piramide: GameModule<PyrState> = {
  id: 'piramide',
  tickHz: PYR.TICK_HZ,

  create(ctx) {
    const list = ctx.players();
    const bodies = new Map<string, Body>();
    list.forEach((p, i) => bodies.set(p.id, spawn(p.id, i, list.length)));
    return {
      stage: 'countdown',
      until: 0,
      bodies,
      fx: [],
      fxSeq: 1,
      lastTick: 0,
      endsAt: 0,
    };
  },

  start(ctx, s) {
    const seconds = Math.max(30, Math.min(600, ctx.config.piramideSeconds || 120));
    s.stage = 'countdown';
    s.until = ctx.now() + COUNTDOWN_MS;
    s.endsAt = s.until + seconds * 1000;
    s.lastTick = ctx.now();
    ctx.push();
  },

  event(ctx, s, playerId, type, data) {
    const b = s.bodies.get(playerId);
    if (!b || s.stage !== 'live') return;
    const d = (data ?? {}) as { down?: boolean };

    switch (type) {
      case 'left':
        b.input.left = d.down !== false;
        if (b.input.left) b.face = -1;
        return;
      case 'right':
        b.input.right = d.down !== false;
        if (b.input.right) b.face = 1;
        return;
      case 'stop':
        b.input.left = false;
        b.input.right = false;
        return;
      case 'jump':
        b.jumpQueued = true;
        return;
      case 'push':
        b.pushQueued = true;
        return;
    }
  },

  tick(ctx, s, _dtMs, t) {
    if (s.stage === 'countdown') {
      if (t >= s.until) {
        s.stage = 'live';
        s.until = s.endsAt;
        s.lastTick = t;
        ctx.push();
      }
      return;
    }
    if (s.stage !== 'live') return;

    const dt = Math.min(0.05, (t - s.lastTick) / 1000);
    s.lastTick = t;
    if (dt <= 0) return;

    const bodies = [...s.bodies.values()];

    for (const b of bodies) {
      /* ── horizontal ── */
      const dir = (b.input.right ? 1 : 0) - (b.input.left ? 1 : 0);
      if (dir !== 0) {
        b.vx += dir * PYR.ACCEL * dt;
        b.face = dir as -1 | 1;
      } else {
        const damp = b.grounded ? PYR.GROUND_FRICTION : PYR.AIR_FRICTION;
        b.vx *= Math.pow(damp, dt);
      }
      b.vx = Math.max(-PYR.MAX_VX, Math.min(PYR.MAX_VX, b.vx));

      /* ── salto ── */
      if (b.jumpQueued) {
        b.jumpQueued = false;
        if (b.grounded) {
          b.vy = PYR.JUMP_V;
          b.grounded = false;
        }
      }

      /* ── empujón ── */
      if (b.pushQueued) {
        b.pushQueued = false;
        if (t >= b.readyAt) {
          b.readyAt = t + PYR.PUSH_COOLDOWN;
          b.pushUntil = t + 220;
          addFx(s, 'push', b.x + b.face * 26, b.y + 26, t);
          for (const other of bodies) {
            if (other === b) continue;
            const dx = other.x - b.x;
            const dy = other.y - b.y;
            const dist = Math.hypot(dx, dy);
            if (dist > PYR.PUSH_RADIUS || dist < 0.001) continue;
            // Sólo empuja hacia donde mira: hay que apuntar.
            if (Math.sign(dx) !== b.face && Math.abs(dx) > PYR.PLAYER_R) continue;
            const falloff = 1 - dist / PYR.PUSH_RADIUS;
            other.vx += (dx / dist) * PYR.PUSH_FORCE * (0.55 + falloff);
            other.vy += PYR.PUSH_LIFT * (0.5 + falloff * 0.8);
            other.grounded = false;
          }
        }
      }

      /* ── integración en x con pared de escalón ── */
      const nx = b.x + b.vx * dt;
      const feet = b.y;
      const groundAhead = pyrHeightAt(nx);
      if (groundAhead > feet + PYR.AUTO_STEP) {
        // Choca contra el frente del escalón.
        b.vx *= -0.22;
      } else {
        b.x = nx;
        if (groundAhead > feet && b.grounded) b.y = groundAhead;
      }
      // Paredes del mundo: rebotan suave.
      if (b.x < PYR.PLAYER_R) {
        b.x = PYR.PLAYER_R;
        b.vx = Math.abs(b.vx) * 0.4;
      } else if (b.x > PYR.W - PYR.PLAYER_R) {
        b.x = PYR.W - PYR.PLAYER_R;
        b.vx = -Math.abs(b.vx) * 0.4;
      }

      /* ── integración en y ── */
      b.vy -= PYR.GRAVITY * dt;
      b.y += b.vy * dt;
      const floor = pyrHeightAt(b.x);
      if (b.y <= floor) {
        if (!b.grounded && b.vy < -260) addFx(s, 'land', b.x, floor, t);
        b.y = floor;
        b.vy = 0;
        b.grounded = true;
      } else {
        b.grounded = false;
      }
    }

    /* ── choques entre jugadores ── */
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i];
        const b = bodies[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 0.001;
        const min = PYR.PLAYER_R * 2;
        if (dist >= min) continue;

        const nxv = dx / dist;
        const nyv = dy / dist;
        const overlap = (min - dist) / 2;
        a.x -= nxv * overlap;
        a.y -= nyv * overlap;
        b.x += nxv * overlap;
        b.y += nyv * overlap;

        // Intercambio de impulso con bastante rebote: los choques mandan.
        const rel = (b.vx - a.vx) * nxv + (b.vy - a.vy) * nyv;
        if (rel < 0) {
          const imp = -rel * PYR.BUMP * 0.5;
          a.vx -= nxv * imp;
          a.vy -= nyv * imp;
          b.vx += nxv * imp;
          b.vy += nyv * imp;
          a.grounded = false;
          b.grounded = false;
        }
      }
    }

    /* ── puntos de la cima ── */
    for (const b of bodies) {
      if (isOnTop(b)) b.points += PYR.POINTS_PER_SEC * dt;
    }

    if (s.fx.length && t - s.fx[0].at > FX_TTL) s.fx = s.fx.filter((f) => t - f.at <= FX_TTL);

    if (t >= s.endsAt) {
      finish(ctx, s);
      return;
    }
    ctx.push();
  },

  leave(ctx, s, playerId) {
    s.bodies.delete(playerId);
    ctx.push();
  },

  view(ctx, s): PiramideView {
    let leaderId: string | null = null;
    let best = -1;
    const players: PyrPlayer[] = [];
    for (const b of s.bodies.values()) {
      if (b.points > best) {
        best = b.points;
        leaderId = b.playerId;
      }
      players.push({
        playerId: b.playerId,
        x: Math.round(b.x * 10) / 10,
        y: Math.round(b.y * 10) / 10,
        vx: Math.round(b.vx),
        vy: Math.round(b.vy),
        face: b.face,
        grounded: b.grounded,
        level: levelOf(b.y),
        onTop: isOnTop(b),
        points: Math.floor(b.points),
        pushUntil: b.pushUntil,
        readyAt: b.readyAt,
      });
    }
    return {
      stage: s.stage,
      t: ctx.now(),
      until: s.stage === 'countdown' ? s.until : s.endsAt,
      players,
      fx: s.fx,
      leaderId: best > 0 ? leaderId : null,
    };
  },
};

function addFx(s: PyrState, kind: PyrFx['kind'], x: number, y: number, at: number): void {
  s.fx.push({ id: s.fxSeq++, kind, x, y, at });
  if (s.fx.length > 16) s.fx.shift();
}

function finish(ctx: GameContext, s: PyrState): void {
  if (s.stage === 'done') return;
  s.stage = 'done';
  ctx.push();
  ctx.finish(
    ctx.players().map((p) => {
      const pts = Math.floor(s.bodies.get(p.id)?.points ?? 0);
      return { playerId: p.id, value: pts, label: `${pts} pts` };
    }),
  );
}

