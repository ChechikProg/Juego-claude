import { useEffect, useRef } from 'react';
import { SMASH } from '@shared/constants';
import type { PlayerPublic, SmashView } from '@shared/types';
import { api, serverNow } from '@/net/socket';
import { useCountdown, useRaf, useSize } from '@/lib/hooks';
import { sfx } from '@/lib/sfx';
import { usePlayerMap, useStore } from '@/state/store';
import { Avatar, RankBadge } from '@/components/ui';

const TAU = Math.PI * 2;

export function Smash({ view }: { view: SmashView }): JSX.Element {
  const players = usePlayerMap();
  const meId = useStore((s) => s.playerId);
  const [wrapRef, size] = useSize<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const snap = useRef(view);
  snap.current = view;

  const angle = useRef(view.ball.angle);
  const trail = useRef<{ x: number; y: number; a: number }[]>([]);
  const seenFx = useRef(new Set<number>());

  const mySeat = view.seats.find((s) => s.playerId === meId);
  const alive = !!mySeat?.alive;
  const live = view.stage === 'live';

  /* ── sonido de los efectos nuevos ─────────────────────────────────────── */
  useEffect(() => {
    for (const fx of view.fx) {
      if (seenFx.current.has(fx.id)) continue;
      seenFx.current.add(fx.id);
      if (fx.kind === 'hit') sfx.smash();
      else if (fx.kind === 'dodge') sfx.dodge();
      else if (fx.kind === 'out') sfx.out();
    }
    if (seenFx.current.size > 200) seenFx.current = new Set(view.fx.map((f) => f.id));
  }, [view.fx]);

  /* ── controles ────────────────────────────────────────────────────────── */
  const act = (kind: 'hit' | 'crouch') => {
    if (!live || !alive) return;
    api.send(kind);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const k = e.code;
      if (k === 'Space' || k === 'ArrowUp' || k === 'KeyW' || k === 'KeyK') {
        e.preventDefault();
        act('hit');
      } else if (k === 'ArrowDown' || k === 'KeyS' || k === 'ShiftLeft' || k === 'ShiftRight' || k === 'KeyJ') {
        e.preventDefault();
        act('crouch');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /* ── render ───────────────────────────────────────────────────────────── */
  const side = Math.max(240, Math.min(size.w, size.h));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !side) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = side * dpr;
    canvas.height = side * dpr;
    canvas.style.width = `${side}px`;
    canvas.style.height = `${side}px`;
    const ctx = canvas.getContext('2d');
    ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  }, [side]);

  useRaf((dt) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !side) return;
    const v = snap.current;

    // Extrapolamos desde el último snapshot y suavizamos el error de red.
    const ahead = (serverNow() - v.t) / 1000;
    const target = v.ball.angle + v.ball.omega * Math.max(0, Math.min(0.4, ahead));
    let diff = ((target - angle.current + Math.PI) % TAU + TAU) % TAU - Math.PI;
    if (Math.abs(diff) > 1.2) angle.current = target;
    else angle.current += diff * Math.min(1, dt * 26);

    paint(ctx, side, v, angle.current, trail, players, meId, dt);
  });

  const countdown = useCountdown(view.stage === 'countdown' ? view.until : null, 10);

  return (
    <div className="sm">
      <header className="sm__top">
        <span className="chip">
          Ronda {view.round} / {view.totalRounds}
        </span>
        <div className="sm__speed">
          <span className="label">Velocidad</span>
          <div className="sm__speedbar">
            <div
              className="sm__speedfill"
              style={{ width: `${Math.min(100, (Math.abs(view.ball.omega) / SMASH.MAX_OMEGA) * 100)}%` }}
            />
          </div>
        </div>
        <span className="chip chip--accent">🔥 rally {view.rally}</span>
      </header>

      <div className="sm__stage" ref={wrapRef}>
        <canvas ref={canvasRef} className="sm__canvas" />

        {view.stage === 'countdown' && (
          <div className="sm__overlay">
            <div className="sm__count anim-pop" key={Math.ceil(countdown / 1000)}>
              {Math.max(1, Math.ceil(countdown / 1000))}
            </div>
            <p className="sm__ready">Preparate…</p>
          </div>
        )}

        {view.stage === 'roundEnd' && view.lastRound && (
          <div className="sm__overlay sm__overlay--soft">
            <div className="card sm__scoreboard anim-pop">
              <h3 className="card__title">Ronda {view.round}</h3>
              <ol className="plist">
                {view.lastRound.map((r) => {
                  const p = players.get(r.playerId);
                  if (!p) return null;
                  return (
                    <li key={r.playerId} className={`prow ${r.playerId === meId ? 'prow--me' : ''}`}>
                      <RankBadge rank={r.place} />
                      <Avatar avatar={p.avatar} size={30} />
                      <span className="grow prow__name">{p.name}</span>
                      <span className="prow__score tnum">+{r.points}</span>
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>
        )}

        {live && !alive && (
          <div className="sm__eliminated anim-fade">Quedaste afuera · mirá cómo se matan</div>
        )}
      </div>

      <footer className="sm__controls">
        <button
          className="sm__btn sm__btn--crouch"
          disabled={!live || !alive}
          onPointerDown={(e) => {
            e.preventDefault();
            act('crouch');
          }}
        >
          <b>AGACHARSE</b>
          <span>↓ / Shift</span>
        </button>
        <button
          className="sm__btn sm__btn--hit"
          disabled={!live || !alive}
          onPointerDown={(e) => {
            e.preventDefault();
            act('hit');
          }}
        >
          <b>SMASH</b>
          <span>Espacio / ↑</span>
        </button>
      </footer>
    </div>
  );
}

/* ── dibujo ───────────────────────────────────────────────────────────────── */

function paint(
  ctx: CanvasRenderingContext2D,
  side: number,
  v: SmashView,
  ballAngle: number,
  trail: React.MutableRefObject<{ x: number; y: number; a: number }[]>,
  players: Map<string, PlayerPublic>,
  meId: string | null,
  dt: number,
): void {
  const cx = side / 2;
  const cy = side / 2;
  /** radio del círculo: los jugadores están parados sobre este borde */
  const R = side * 0.335;
  /** alto de un jugador parado */
  const H = side * 0.088;
  /** la pelota pasa a la altura del pecho */
  const Ro = R + H * 0.52;
  const now = serverNow();

  ctx.clearRect(0, 0, side, side);

  /* resplandor de fondo */
  const glow = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, side * 0.55);
  glow.addColorStop(0, 'rgba(14, 149, 148, 0.22)');
  glow.addColorStop(1, 'rgba(14, 149, 148, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, side, side);

  /* arena */
  const disc = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
  disc.addColorStop(0, '#17a3a0');
  disc.addColorStop(1, '#0b6f73');
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, TAU);
  ctx.fillStyle = disc;
  ctx.fill();

  ctx.lineWidth = Math.max(3, side * 0.012);
  ctx.strokeStyle = 'rgba(255,255,255,0.65)';
  ctx.stroke();

  /* marca en el centro */
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(255, 220, 120, 0.9)';
  ctx.font = `800 ${Math.round(side * 0.165)}px Bungee, Outfit, sans-serif`;
  ctx.fillText('360', cx, cy - side * 0.045);
  ctx.fillStyle = 'rgba(255, 220, 120, 0.72)';
  ctx.font = `800 ${Math.round(side * 0.082)}px Bungee, Outfit, sans-serif`;
  ctx.fillText('SMASH', cx, cy + side * 0.06);
  ctx.restore();

  /* pista punteada */
  ctx.save();
  ctx.setLineDash([side * 0.012, side * 0.018]);
  ctx.lineWidth = Math.max(2, side * 0.007);
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.beginPath();
  ctx.arc(cx, cy, Ro, 0, TAU);
  ctx.stroke();
  ctx.restore();

  /* estela */
  const bx = cx + Math.cos(ballAngle) * Ro;
  const by = cy + Math.sin(ballAngle) * Ro;
  trail.current.push({ x: bx, y: by, a: 1 });
  if (trail.current.length > 18) trail.current.shift();
  for (const t of trail.current) t.a -= dt * 3.4;

  for (let i = 0; i < trail.current.length; i++) {
    const t = trail.current[i];
    if (t.a <= 0) continue;
    ctx.beginPath();
    ctx.arc(t.x, t.y, side * 0.016 * (0.3 + (i / trail.current.length) * 0.7), 0, TAU);
    ctx.fillStyle = `rgba(190, 255, 120, ${t.a * 0.3})`;
    ctx.fill();
  }

  /* jugadores, parados sobre el borde */
  for (const seat of v.seats) {
    drawSeat(ctx, seat, players.get(seat.playerId), seat.playerId === meId, { cx, cy, R, H, side, now });
  }

  /* efectos */
  for (const fx of v.fx) {
    const age = (now - fx.at) / 1000;
    if (age < 0 || age > 0.6) continue;
    const t = age / 0.6;
    const fxX = cx + Math.cos(fx.angle) * Ro;
    const fxY = cy + Math.sin(fx.angle) * Ro;
    ctx.beginPath();
    ctx.arc(fxX, fxY, side * (0.02 + t * 0.07), 0, TAU);
    ctx.lineWidth = Math.max(2, side * 0.008 * (1 - t));
    ctx.strokeStyle =
      fx.kind === 'hit'
        ? `rgba(255, 224, 102, ${1 - t})`
        : fx.kind === 'out'
          ? `rgba(255, 90, 110, ${1 - t})`
          : `rgba(120, 255, 220, ${(1 - t) * 0.7})`;
    ctx.stroke();
  }

  /* pelota */
  const br = side * 0.022;
  const bg = ctx.createRadialGradient(bx - br * 0.3, by - br * 0.4, br * 0.1, bx, by, br);
  bg.addColorStop(0, '#f4ffd6');
  bg.addColorStop(1, '#8ddb2f');
  ctx.beginPath();
  ctx.arc(bx, by, br, 0, TAU);
  ctx.fillStyle = bg;
  ctx.shadowColor = 'rgba(180, 255, 90, 0.9)';
  ctx.shadowBlur = side * 0.045;
  ctx.fill();
  ctx.shadowBlur = 0;
}

interface SeatGeo {
  cx: number;
  cy: number;
  R: number;
  H: number;
  side: number;
  now: number;
}

function drawSeat(
  ctx: CanvasRenderingContext2D,
  seat: SmashView['seats'][number],
  p: PlayerPublic | undefined,
  isMe: boolean,
  g: SeatGeo,
): void {
  const { cx, cy, R, H, side, now } = g;
  const crouching = seat.state === 'crouch' && now < seat.until;
  const swinging = seat.state === 'swing' && now < seat.until;
  const hue = p?.avatar.hue ?? 200;
  const W = H * 0.58;

  // Marco local: el origen es el centro del círculo y "arriba" (-y) apunta hacia afuera.
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(seat.angle + Math.PI / 2);

  /* escotilla en el borde: ahí se esconde */
  ctx.beginPath();
  ctx.ellipse(0, -R + side * 0.004, W * 0.75, side * 0.011, 0, 0, TAU);
  ctx.fillStyle = crouching ? 'rgba(0, 20, 22, 0.85)' : 'rgba(0, 30, 32, 0.45)';
  ctx.fill();

  if (!seat.alive) {
    // Tirado de costado sobre el borde.
    ctx.globalAlpha = 0.45;
    ctx.font = `${Math.round(H * 0.5)}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('💀', 0, -R - H * 0.25);
    ctx.restore();
    paintName(ctx, seat, p, isMe, g, H * 0.6);
    return;
  }

  // Cuánto se hundió: entra rápido y sale con un rebotecito.
  let sink = 0;
  if (crouching) {
    const left = seat.until - now;
    const enter = Math.min(1, (SMASH.CROUCH_ACTIVE - left) / 70);
    // Al final de la ventana vuelve a asomar.
    const exit = Math.min(1, left / 90);
    sink = Math.max(0, Math.min(1, enter, exit)) * 0.86;
  }

  ctx.save();
  // Recortamos todo lo que quede adentro del círculo: así parece que se mete por la escotilla.
  ctx.beginPath();
  ctx.rect(-side, -side, side * 2, side * 2);
  ctx.arc(0, 0, R, 0, TAU, true);
  ctx.clip('evenodd');
  ctx.translate(0, sink * H);

  const feet = -R;
  const top = feet - H;

  /* piernas */
  ctx.fillStyle = `hsl(${hue} 45% 30%)`;
  ctx.fillRect(-W * 0.3, feet - H * 0.22, W * 0.2, H * 0.22);
  ctx.fillRect(W * 0.1, feet - H * 0.22, W * 0.2, H * 0.22);

  /* cuerpo tipo poroto */
  const body = ctx.createLinearGradient(-W / 2, 0, W / 2, 0);
  body.addColorStop(0, `hsl(${hue} 75% 62%)`);
  body.addColorStop(1, `hsl(${hue} 70% 45%)`);
  ctx.fillStyle = body;
  roundRect(ctx, -W / 2, top, W, H * 0.82, W * 0.48);
  ctx.fill();
  ctx.lineWidth = isMe ? Math.max(2.5, side * 0.007) : Math.max(1.2, side * 0.003);
  ctx.strokeStyle = isMe ? '#ffe066' : 'rgba(0,0,0,0.4)';
  ctx.stroke();

  /* cara */
  ctx.font = `${Math.round(W * 0.78)}px serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(p?.avatar.face ?? '🙂', 0, top + W * 0.55);

  /* brazo con paleta: en reposo cuelga, al pegar barre de abajo hacia afuera */
  const shoulderX = W * 0.46;
  const shoulderY = top + H * 0.42;
  let armAng = 0.5; // apuntando abajo y al costado
  if (swinging) {
    const prog = 1 - (seat.until - now) / SMASH.SWING_ACTIVE;
    armAng = 0.5 - Math.sin(Math.min(1, Math.max(0, prog)) * Math.PI) * 2.6;
  }
  ctx.save();
  ctx.translate(shoulderX, shoulderY);
  ctx.rotate(armAng);
  ctx.strokeStyle = `hsl(${hue} 50% 35%)`;
  ctx.lineWidth = Math.max(2, W * 0.14);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(W * 0.62, 0);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(W * 0.9, 0, W * 0.32, W * 0.24, 0, 0, TAU);
  ctx.fillStyle = swinging ? '#ffe066' : '#ff8a3d';
  ctx.fill();
  ctx.lineWidth = Math.max(1, W * 0.05);
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.stroke();
  ctx.restore();

  ctx.restore();

  /* tapa de la escotilla, delante del que se escondió */
  if (crouching) {
    ctx.beginPath();
    ctx.ellipse(0, -R + side * 0.004, W * 0.75, side * 0.011, 0, 0, TAU);
    ctx.strokeStyle = 'rgba(120, 255, 220, 0.85)';
    ctx.lineWidth = Math.max(1.5, side * 0.004);
    ctx.stroke();
  }

  ctx.restore();
  paintName(ctx, seat, p, isMe, g, H * (1 - sink) + side * 0.035);
}

function paintName(
  ctx: CanvasRenderingContext2D,
  seat: SmashView['seats'][number],
  p: PlayerPublic | undefined,
  isMe: boolean,
  g: SeatGeo,
  above: number,
): void {
  const { cx, cy, R, side } = g;
  const d = R + above + side * 0.012;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.globalAlpha = seat.alive ? 0.95 : 0.4;
  ctx.font = `800 ${Math.round(side * 0.026)}px Outfit, sans-serif`;
  ctx.fillStyle = isMe ? '#ffe066' : '#ffffff';
  ctx.fillText(short(p?.name ?? '—'), cx + Math.cos(seat.angle) * d, cy + Math.sin(seat.angle) * d);
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function short(name: string): string {
  return name.length > 9 ? `${name.slice(0, 8)}…` : name;
}
