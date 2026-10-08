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
  const R = side * 0.325;
  const Ro = side * 0.375;
  const Rp = side * 0.452;
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

  /* jugadores */
  for (const seat of v.seats) {
    const p = players.get(seat.playerId);
    const isMe = seat.playerId === meId;
    const crouching = seat.state === 'crouch' && now < seat.until;
    const swinging = seat.state === 'swing' && now < seat.until;

    const push = crouching ? side * 0.035 : 0;
    const scale = crouching ? 0.62 : 1;
    const px = cx + Math.cos(seat.angle) * (Rp + push);
    const py = cy + Math.sin(seat.angle) * (Rp + push);

    /* raqueta */
    if (seat.alive) {
      const reach = swinging ? side * 0.082 : side * 0.03;
      const rx = cx + Math.cos(seat.angle) * (Rp - reach);
      const ry = cy + Math.sin(seat.angle) * (Rp - reach);
      ctx.lineWidth = Math.max(2, side * 0.009);
      ctx.strokeStyle = swinging ? '#ffe066' : 'rgba(255,255,255,0.45)';
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(rx, ry);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(rx, ry, side * (swinging ? 0.027 : 0.018), 0, TAU);
      ctx.fillStyle = swinging ? 'rgba(255, 224, 102, 0.95)' : 'rgba(255,255,255,0.3)';
      ctx.fill();
    }

    /* cápsula */
    const r = side * 0.042 * scale;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, TAU);
    if (!seat.alive) ctx.fillStyle = 'rgba(70, 70, 90, 0.75)';
    else if (crouching) ctx.fillStyle = 'rgba(60, 220, 190, 0.95)';
    else ctx.fillStyle = `hsl(${p?.avatar.hue ?? 200} 70% 55%)`;
    ctx.fill();
    ctx.lineWidth = isMe ? Math.max(3, side * 0.009) : Math.max(1.5, side * 0.004);
    ctx.strokeStyle = isMe ? '#ffe066' : 'rgba(0,0,0,0.35)';
    ctx.stroke();

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = seat.alive ? 1 : 0.4;
    ctx.font = `${Math.round(r * 1.15)}px serif`;
    ctx.fillText(seat.alive ? (p?.avatar.face ?? '🙂') : '💀', px, py + r * 0.06);

    /* nombre, siempre fuera del círculo */
    const nx = cx + Math.cos(seat.angle) * (Rp + side * 0.078);
    const ny = cy + Math.sin(seat.angle) * (Rp + side * 0.078);
    ctx.globalAlpha = seat.alive ? 0.95 : 0.4;
    ctx.font = `800 ${Math.round(side * 0.027)}px Outfit, sans-serif`;
    ctx.fillStyle = isMe ? '#ffe066' : '#ffffff';
    ctx.fillText(short(p?.name ?? '—'), nx, ny);
    ctx.restore();
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

function short(name: string): string {
  return name.length > 9 ? `${name.slice(0, 8)}…` : name;
}
