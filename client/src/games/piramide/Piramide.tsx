import { useEffect, useRef } from 'react';
import { PYR, PYR_TOP_Y, pyrHalfWidth } from '@shared/constants';
import type { PiramideView, PlayerPublic } from '@shared/types';
import { api, serverNow } from '@/net/socket';
import { useCountdown, useRaf, useSize } from '@/lib/hooks';
import { sfx } from '@/lib/sfx';
import { usePlayerMap, useStore } from '@/state/store';
import { Avatar, RankBadge, Timer } from '@/components/ui';

/** Alto del mundo visible, con aire arriba de la cima. */
const WORLD_H = PYR_TOP_Y + 190;

export function Piramide({ view }: { view: PiramideView }): JSX.Element {
  const players = usePlayerMap();
  const meId = useStore((s) => s.playerId);
  const [wrapRef, size] = useSize<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const snap = useRef(view);
  snap.current = view;
  /** posiciones suavizadas para que la red no se note */
  const smooth = useRef(new Map<string, { x: number; y: number }>());
  const seenFx = useRef(new Set<number>());
  const held = useRef({ left: false, right: false });

  const live = view.stage === 'live';
  const countdown = useCountdown(view.stage === 'countdown' ? view.until : null, 10);
  const left = useCountdown(view.stage === 'live' ? view.until : null, 4);
  const me = view.players.find((p) => p.playerId === meId);

  /* ── sonidos ──────────────────────────────────────────────────────────── */
  useEffect(() => {
    for (const fx of view.fx) {
      if (seenFx.current.has(fx.id)) continue;
      seenFx.current.add(fx.id);
      if (fx.kind === 'push') sfx.smash();
      else if (fx.kind === 'land') sfx.tap();
    }
    if (seenFx.current.size > 300) seenFx.current = new Set(view.fx.map((f) => f.id));
  }, [view.fx]);

  /* ── controles ────────────────────────────────────────────────────────── */
  const move = (dir: 'left' | 'right', down: boolean) => {
    if (held.current[dir] === down) return;
    held.current[dir] = down;
    if (live) api.send(dir, { down });
  };

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const k = e.code;
      if (k === 'ArrowLeft' || k === 'KeyA') { e.preventDefault(); move('left', true); }
      else if (k === 'ArrowRight' || k === 'KeyD') { e.preventDefault(); move('right', true); }
      else if (k === 'Space' || k === 'ArrowUp' || k === 'KeyW') { e.preventDefault(); if (live) api.send('jump'); }
      else if (k === 'ShiftLeft' || k === 'ShiftRight' || k === 'KeyE' || k === 'ArrowDown') {
        e.preventDefault();
        if (live) api.send('push');
      }
    };
    const up = (e: KeyboardEvent) => {
      const k = e.code;
      if (k === 'ArrowLeft' || k === 'KeyA') move('left', false);
      else if (k === 'ArrowRight' || k === 'KeyD') move('right', false);
    };
    const blur = () => {
      move('left', false);
      move('right', false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  });

  /* ── canvas ───────────────────────────────────────────────────────────── */
  const scale = size.w ? Math.min(size.w / PYR.W, size.h / WORLD_H) : 0;
  const cw = Math.round(PYR.W * scale);
  const ch = Math.round(WORLD_H * scale);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !cw) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = cw * dpr;
    canvas.height = ch * dpr;
    canvas.style.width = `${cw}px`;
    canvas.style.height = `${ch}px`;
    canvas.getContext('2d')?.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
  }, [cw, ch, scale]);

  useRaf((dt) => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx || !cw) return;
    paint(ctx, snap.current, smooth.current, players, meId, dt);
  });

  const ranking = [...view.players].sort((a, b) => b.points - a.points);
  const pushReady = me ? serverNow() >= me.readyAt : true;

  return (
    <div className="pyr">
      <header className="pyr__top">
        <span className="chip">🏔️ Llegá a la punta</span>
        <div className="pyr__score">
          <span className="label">Tus puntos</span>
          <strong className="tnum">{me?.points ?? 0}</strong>
        </div>
        {live && <Timer ms={left} urgentAt={20_000} />}
      </header>

      <div className="pyr__body">
        <div className="pyr__stage" ref={wrapRef}>
          <canvas ref={canvasRef} className="pyr__canvas" />

          {view.stage === 'countdown' && (
            <div className="sm__overlay">
              <div className="sm__count anim-pop" key={Math.ceil(countdown / 1000)}>
                {Math.max(1, Math.ceil(countdown / 1000))}
              </div>
              <p className="sm__ready">A escalar</p>
            </div>
          )}
        </div>

        <aside className="pyr__side panel">
          <h3 className="card__title">Puntos</h3>
          <ol className="plist">
            {ranking.map((row, i) => {
              const p = players.get(row.playerId);
              if (!p) return null;
              return (
                <li key={row.playerId} className={`prow ${row.playerId === meId ? 'prow--me' : ''}`}>
                  <RankBadge rank={i + 1} />
                  <Avatar avatar={p.avatar} size={26} offline={!p.connected} />
                  <span className="grow prow__name">{p.name}</span>
                  {row.onTop && <span aria-label="en la cima">👑</span>}
                  <span className="prow__score tnum">{row.points}</span>
                </li>
              );
            })}
          </ol>
        </aside>
      </div>

      <footer className="pyr__controls">
        <button
          className="pyr__btn"
          disabled={!live}
          onPointerDown={(e) => { e.preventDefault(); move('left', true); }}
          onPointerUp={() => move('left', false)}
          onPointerLeave={() => move('left', false)}
          onPointerCancel={() => move('left', false)}
          aria-label="Izquierda"
        >
          ◀
        </button>
        <button
          className="pyr__btn pyr__btn--jump"
          disabled={!live}
          onPointerDown={(e) => { e.preventDefault(); api.send('jump'); }}
        >
          <b>SALTAR</b>
          <span>Espacio</span>
        </button>
        <button
          className={`pyr__btn pyr__btn--push ${pushReady ? '' : 'pyr__btn--cooling'}`}
          disabled={!live}
          onPointerDown={(e) => { e.preventDefault(); api.send('push'); sfx.tap(); }}
        >
          <b>EMPUJAR</b>
          <span>Shift</span>
        </button>
        <button
          className="pyr__btn"
          disabled={!live}
          onPointerDown={(e) => { e.preventDefault(); move('right', true); }}
          onPointerUp={() => move('right', false)}
          onPointerLeave={() => move('right', false)}
          onPointerCancel={() => move('right', false)}
          aria-label="Derecha"
        >
          ▶
        </button>
      </footer>
    </div>
  );
}

/* ── dibujo ───────────────────────────────────────────────────────────────── */

function paint(
  ctx: CanvasRenderingContext2D,
  v: PiramideView,
  smooth: Map<string, { x: number; y: number }>,
  players: Map<string, PlayerPublic>,
  meId: string | null,
  dt: number,
): void {
  const toY = (worldY: number) => WORLD_H - worldY;
  ctx.clearRect(0, 0, PYR.W, WORLD_H);

  /* cielo */
  const sky = ctx.createLinearGradient(0, 0, 0, WORLD_H);
  sky.addColorStop(0, '#2b1b48');
  sky.addColorStop(1, '#120b22');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, PYR.W, WORLD_H);

  /* sol detrás de la cima */
  const sun = ctx.createRadialGradient(PYR.W / 2, toY(PYR_TOP_Y + 40), 10, PYR.W / 2, toY(PYR_TOP_Y + 40), 260);
  sun.addColorStop(0, 'rgba(255, 190, 110, 0.5)');
  sun.addColorStop(1, 'rgba(255, 190, 110, 0)');
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, PYR.W, WORLD_H);

  /* escalones, del piso hacia arriba */
  for (let i = PYR.LEVELS; i >= 1; i--) {
    const hw = pyrHalfWidth(i);
    const top = toY(i * PYR.STEP_H);
    const x0 = PYR.W / 2 - hw;
    const w = hw * 2;
    const h = PYR.STEP_H;

    const g = ctx.createLinearGradient(0, top, 0, top + h);
    const shade = 0.35 + (i / PYR.LEVELS) * 0.3;
    g.addColorStop(0, `rgba(242, 166, 90, ${shade + 0.3})`);
    g.addColorStop(1, `rgba(190, 104, 50, ${shade})`);
    ctx.fillStyle = g;
    ctx.fillRect(x0, top, w, h);

    ctx.fillStyle = 'rgba(255, 226, 170, 0.75)';
    ctx.fillRect(x0, top, w, 5);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x0, top, w, h);
  }

  /* piso */
  ctx.fillStyle = '#1a1030';
  ctx.fillRect(0, toY(0), PYR.W, WORLD_H - toY(0) + 40);
  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  ctx.fillRect(0, toY(0), PYR.W, 3);

  /* banderín en la cima */
  const flagX = PYR.W / 2;
  const flagY = toY(PYR_TOP_Y);
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(flagX, flagY);
  ctx.lineTo(flagX, flagY - 74);
  ctx.stroke();
  ctx.fillStyle = '#ffc93c';
  ctx.beginPath();
  ctx.moveTo(flagX, flagY - 74);
  ctx.lineTo(flagX + 54, flagY - 60);
  ctx.lineTo(flagX, flagY - 46);
  ctx.closePath();
  ctx.fill();

  /* efectos */
  const now = serverNow();
  for (const fx of v.fx) {
    const age = (now - fx.at) / 1000;
    if (age < 0 || age > 0.55) continue;
    const t = age / 0.55;
    ctx.beginPath();
    ctx.arc(fx.x, toY(fx.y), 24 + t * 54, 0, Math.PI * 2);
    ctx.lineWidth = 6 * (1 - t);
    ctx.strokeStyle = fx.kind === 'push' ? `rgba(255, 200, 90, ${1 - t})` : `rgba(255,255,255,${(1 - t) * 0.45})`;
    ctx.stroke();
  }

  /* jugadores */
  for (const pl of v.players) {
    const p = players.get(pl.playerId);
    let sm = smooth.get(pl.playerId);
    if (!sm) {
      sm = { x: pl.x, y: pl.y };
      smooth.set(pl.playerId, sm);
    }
    const k = Math.min(1, dt * 22);
    if (Math.hypot(pl.x - sm.x, pl.y - sm.y) > 220) {
      sm.x = pl.x;
      sm.y = pl.y;
    } else {
      sm.x += (pl.x - sm.x) * k;
      sm.y += (pl.y - sm.y) * k;
    }

    const px = sm.x;
    const py = toY(sm.y + PYR.PLAYER_R);
    const isMe = pl.playerId === meId;
    const pushing = now < pl.pushUntil;

    /* sombra */
    ctx.beginPath();
    ctx.ellipse(px, toY(sm.y) + 3, PYR.PLAYER_R * 0.9, 5, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fill();

    /* brazo de empuje */
    if (pushing) {
      ctx.beginPath();
      ctx.arc(px + pl.face * PYR.PLAYER_R * 1.5, py, PYR.PLAYER_R * 0.6, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 200, 90, 0.85)';
      ctx.fill();
    }

    /* cuerpo */
    ctx.beginPath();
    ctx.arc(px, py, PYR.PLAYER_R, 0, Math.PI * 2);
    ctx.fillStyle = `hsl(${p?.avatar.hue ?? 210} 78% 58%)`;
    ctx.fill();
    ctx.lineWidth = isMe ? 4 : 2;
    ctx.strokeStyle = isMe ? '#ffe066' : 'rgba(0,0,0,0.4)';
    ctx.stroke();

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${Math.round(PYR.PLAYER_R * 1.25)}px serif`;
    ctx.fillText(p?.avatar.face ?? '🙂', px, py + 1);

    if (pl.playerId === v.leaderId) {
      ctx.font = '20px serif';
      ctx.fillText('👑', px, py - PYR.PLAYER_R - 14);
    }

    ctx.font = '800 17px Outfit, sans-serif';
    ctx.fillStyle = isMe ? '#ffe066' : 'rgba(255,255,255,0.92)';
    ctx.fillText(short(p?.name ?? '—'), px, py - PYR.PLAYER_R - (pl.playerId === v.leaderId ? 34 : 16));
    ctx.restore();
  }
}

function short(name: string): string {
  return name.length > 10 ? `${name.slice(0, 9)}…` : name;
}
