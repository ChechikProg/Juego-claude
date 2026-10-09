import { useEffect, useRef } from 'react';
import { PYR, PYR_TOP_Y, pyrHalfWidth } from '@shared/constants';
import type { PiramideView, PlayerPublic, PyrFx } from '@shared/types';
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
  const respawnIn = useCountdown(me?.dead ? me.respawnAt : null, 10);
  const shotIn = useCountdown(me && live ? me.shotReadyAt : null, 5);

  /* ── sonidos ──────────────────────────────────────────────────────────── */
  useEffect(() => {
    for (const fx of view.fx) {
      if (seenFx.current.has(fx.id)) continue;
      seenFx.current.add(fx.id);
      if (fx.kind === 'push') sfx.smash();
      else if (fx.kind === 'land') sfx.tap();
      else if (fx.kind === 'shot') sfx.shoot();
      else if (fx.kind === 'blast') sfx.blast();
      else if (fx.kind === 'stomp') sfx.stomp();
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
      // Nada de Shift: spamearlo activa las teclas especiales de Windows.
      else if (k === 'KeyJ' || k === 'KeyE' || k === 'ArrowDown' || k === 'KeyS') {
        e.preventDefault();
        if (live) api.send('push');
      } else if (k === 'KeyK' || k === 'KeyQ') {
        e.preventDefault();
        if (live) api.send('shoot');
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
  const shotReady = shotIn <= 0;

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

          {live && me?.dead && (
            <div className="pyr__dead anim-pop">
              <span>🥞 Te aplastaron</span>
              <b className="tnum">Volvés al piso en {Math.max(1, Math.ceil(respawnIn / 1000))}</b>
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
                  {row.dead && <span aria-label="aplastado">🥞</span>}
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
          <span>J</span>
        </button>
        <button
          className={`pyr__btn pyr__btn--shot ${shotReady ? '' : 'pyr__btn--cooling'}`}
          disabled={!live}
          onPointerDown={(e) => { e.preventDefault(); api.send('shoot'); }}
        >
          <b>{shotReady ? 'CAÑONAZO' : `${Math.ceil(shotIn / 1000)}s`}</b>
          <span>K</span>
          {!shotReady && (
            <i className="pyr__cool" style={{ width: `${(1 - shotIn / PYR.SHOT_COOLDOWN) * 100}%` }} />
          )}
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
  for (const fx of v.fx) paintFx(ctx, fx, now, toY);

  /* cañonazos */
  for (const sh of v.shots) {
    const ahead = Math.max(0, Math.min(0.12, (now - v.t) / 1000));
    const x = sh.x + sh.vx * ahead;
    const vy = sh.vy;
    const y = toY(sh.y + sh.vy * ahead);
    // estela de fuego, apuntando hacia atrás sobre la parábola
    const sp = Math.hypot(sh.vx, vy) || 1;
    const tx = x - (sh.vx / sp) * 90;
    const ty = y + (vy / sp) * 90;
    const nx = (-vy / sp) * PYR.SHOT_R * 0.9;
    const ny = (-sh.vx / sp) * PYR.SHOT_R * 0.9;
    const trail = ctx.createLinearGradient(x, y, tx, ty);
    trail.addColorStop(0, 'rgba(255, 170, 60, 0.9)');
    trail.addColorStop(1, 'rgba(255, 80, 40, 0)');
    ctx.fillStyle = trail;
    ctx.beginPath();
    ctx.moveTo(x + nx, y + ny);
    ctx.lineTo(tx, ty);
    ctx.lineTo(x - nx, y - ny);
    ctx.closePath();
    ctx.fill();
    // bala
    const ball = ctx.createRadialGradient(x - 4, y - 4, 2, x, y, PYR.SHOT_R);
    ball.addColorStop(0, '#6b6b7d');
    ball.addColorStop(1, '#16161e');
    ctx.fillStyle = ball;
    ctx.shadowColor = 'rgba(255, 150, 60, 0.9)';
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.arc(x, y, PYR.SHOT_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  /* jugadores */
  for (const pl of v.players) {
    if (pl.dead) {
      smooth.delete(pl.playerId);
      continue;
    }
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
    const pushLeft = pl.pushUntil - now;
    const pushing = pushLeft > 0;
    /** 0 → 1 a lo largo del empujón (dura 220 ms) */
    const pushT = pushing ? 1 - pushLeft / 220 : 0;

    /* sombra */
    ctx.beginPath();
    ctx.ellipse(px, toY(sm.y) + 3, PYR.PLAYER_R * 0.9, 5, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fill();

    /* puño del empujón: sale disparado y vuelve, con líneas de velocidad */
    if (pushing) {
      const ext = Math.sin(Math.min(1, pushT) * Math.PI);
      const fx = px + pl.face * (PYR.PLAYER_R * 0.6 + ext * PYR.PLAYER_R * 1.7);
      ctx.strokeStyle = `hsl(${p?.avatar.hue ?? 210} 60% 45%)`;
      ctx.lineWidth = 7;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(px + pl.face * PYR.PLAYER_R * 0.5, py + 3);
      ctx.lineTo(fx, py + 2);
      ctx.stroke();
      for (let i = 0; i < 3; i++) {
        const ly = py - 8 + i * 8;
        ctx.strokeStyle = `rgba(255, 236, 170, ${0.7 * ext})`;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(fx - pl.face * (16 + i * 5), ly);
        ctx.lineTo(fx - pl.face * (34 + i * 9), ly);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(fx, py + 2, PYR.PLAYER_R * 0.62, 0, Math.PI * 2);
      ctx.fillStyle = '#ffd36b';
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#7a3d0c';
      ctx.stroke();
      ctx.lineWidth = 1.6;
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(fx + pl.face * 3, py + 2 + i * 4.5);
        ctx.lineTo(fx + pl.face * 8, py + 2 + i * 4.5);
        ctx.stroke();
      }
    }

    /* cuerpo: se estira hacia el golpe y gira si lo voló un cañonazo */
    ctx.save();
    ctx.translate(px, py);
    if (pl.launched) ctx.rotate(((now % 500) / 500) * Math.PI * 2 * (pl.vx >= 0 ? 1 : -1));
    else if (pushing) {
      const lean = Math.sin(Math.min(1, pushT) * Math.PI);
      ctx.translate(pl.face * lean * 5, 0);
      ctx.scale(1 + lean * 0.18, 1 - lean * 0.12);
    }
    ctx.beginPath();
    ctx.arc(0, 0, PYR.PLAYER_R, 0, Math.PI * 2);
    ctx.fillStyle = `hsl(${p?.avatar.hue ?? 210} 78% 58%)`;
    ctx.fill();
    ctx.lineWidth = isMe ? 4 : 2;
    ctx.strokeStyle = isMe ? '#ffe066' : 'rgba(0,0,0,0.4)';
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${Math.round(PYR.PLAYER_R * 1.25)}px serif`;
    ctx.fillText(pl.launched ? '😵' : (p?.avatar.face ?? '🙂'), 0, 1);
    ctx.restore();

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

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

function paintFx(ctx: CanvasRenderingContext2D, fx: PyrFx, now: number, toY: (y: number) => number): void {
  const age = (now - fx.at) / 1000;
  if (age < 0) return;
  const x = fx.x;
  const y = toY(fx.y);
  const TAU = Math.PI * 2;

  if (fx.kind === 'push' || fx.kind === 'shot') {
    // Onda de choque en forma de medialuna hacia donde mira.
    const life = 0.32;
    if (age > life) return;
    const t = age / life;
    const dir = fx.dir ?? 1;
    const base = dir > 0 ? 0 : Math.PI;
    for (let i = 0; i < 3; i++) {
      const k = Math.max(0, t - i * 0.12);
      if (k <= 0) continue;
      ctx.beginPath();
      ctx.arc(x - dir * 16, y, 16 + k * 62, base - 0.85, base + 0.85);
      ctx.lineWidth = 5 * (1 - k);
      ctx.strokeStyle = fx.kind === 'shot' ? `rgba(255, 150, 60, ${1 - k})` : `rgba(255, 236, 170, ${(1 - k) * 0.9})`;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
    return;
  }

  if (fx.kind === 'blast') {
    const life = 0.6;
    if (age > life) return;
    const t = age / life;
    const g = ctx.createRadialGradient(x, y, 0, x, y, 30 + t * 70);
    g.addColorStop(0, `rgba(255, 245, 200, ${1 - t})`);
    g.addColorStop(0.4, `rgba(255, 150, 50, ${(1 - t) * 0.8})`);
    g.addColorStop(1, 'rgba(255, 80, 40, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, 30 + t * 70, 0, TAU);
    ctx.fill();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU + fx.id;
      const r = 20 + t * 90;
      ctx.fillStyle = `rgba(255, ${180 - i * 8}, 70, ${1 - t})`;
      ctx.fillRect(x + Math.cos(a) * r - 3, y + Math.sin(a) * r - 3, 6, 6);
    }
    return;
  }

  if (fx.kind === 'stomp') {
    const life = 0.9;
    if (age > life) return;
    const t = age / life;
    ctx.save();
    ctx.globalAlpha = 1 - t;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '26px serif';
    ctx.fillText('💥', x, y - t * 20);
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i - 2) * 0.5;
      ctx.font = '16px serif';
      ctx.fillText('⭐', x + Math.cos(a) * (18 + t * 40), y + Math.sin(a) * (18 + t * 40));
    }
    ctx.restore();
    // Panqueque: la silueta aplastada contra el piso.
    ctx.fillStyle = `rgba(255, 255, 255, ${0.35 * (1 - t)})`;
    ctx.beginPath();
    ctx.ellipse(x, y + PYR.PLAYER_R - 3, PYR.PLAYER_R * 1.5, 5, 0, 0, TAU);
    ctx.fill();
    return;
  }

  if (fx.kind === 'respawn') {
    const life = 0.8;
    if (age > life) return;
    const t = age / life;
    ctx.beginPath();
    ctx.ellipse(x, y - PYR.PLAYER_R, PYR.PLAYER_R + 10, (PYR.PLAYER_R + 10) * (1 - t), 0, 0, TAU);
    ctx.lineWidth = 3;
    ctx.strokeStyle = `rgba(120, 255, 220, ${1 - t})`;
    ctx.stroke();
    return;
  }

  // aterrizaje
  const life = 0.55;
  if (age > life) return;
  const t = age / life;
  ctx.beginPath();
  ctx.arc(x, y, 24 + t * 54, 0, TAU);
  ctx.lineWidth = 6 * (1 - t);
  ctx.strokeStyle = `rgba(255,255,255,${(1 - t) * 0.45})`;
  ctx.stroke();
}

function short(name: string): string {
  return name.length > 10 ? `${name.slice(0, 9)}…` : name;
}
