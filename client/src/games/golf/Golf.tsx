import { useEffect, useMemo, useRef, useState } from 'react';
import { GOLF, GOLF_HOLES, sliderAt, spinnerAngle, stepBall, type GolfHoleDef } from '@shared/golf';
import type { GolfBall, GolfView, PlayerPublic } from '@shared/types';
import { api, serverNow } from '@/net/socket';
import { useCountdown, useRaf, useSize } from '@/lib/hooks';
import { sfx } from '@/lib/sfx';
import { usePlayerMap, useStore } from '@/state/store';
import { Avatar, RankBadge, Timer } from '@/components/ui';

const TAU = Math.PI * 2;

interface Smooth {
  x: number;
  y: number;
}

interface Aim {
  /** ángulo del tiro */
  a: number;
  /** 0..1 */
  p: number;
  /** de dónde salió el arrastre (en unidades de cancha), null si apunta con teclado */
  from: { x: number; y: number } | null;
}

interface Ring {
  x: number;
  y: number;
  at: number;
  color: string;
  size: number;
}

export function Golf({ view }: { view: GolfView }): JSX.Element {
  const players = usePlayerMap();
  const meId = useStore((s) => s.playerId);
  const [wrapRef, size] = useSize<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const snap = useRef(view);
  snap.current = view;
  const smooth = useRef(new Map<string, Smooth>());
  const rings = useRef<Ring[]>([]);
  const seenFx = useRef(new Set<number>());
  const [aim, setAimState] = useState<Aim | null>(null);
  const aimRef = useRef<Aim | null>(null);
  const setAim = (a: Aim | null) => {
    aimRef.current = a;
    setAimState(a);
  };

  const def = GOLF_HOLES[view.course];
  const live = view.stage === 'live';
  const countdown = useCountdown(view.stage === 'countdown' ? view.until : null, 10);
  const left = useCountdown(live ? view.until : null, 4);
  const endLeft = useCountdown(view.stage === 'holeEnd' ? view.until : null, 4);
  const me = view.balls.find((b) => b.playerId === meId) ?? null;
  const canShoot = live && !!me && !me.done && !me.moving;

  // Al cambiar de hoyo, las pelotas arrancan de cero.
  useEffect(() => {
    smooth.current.clear();
    setAim(null);
  }, [view.hole]);

  useEffect(() => {
    if (!canShoot) setAim(null);
  }, [canShoot]);

  /* ── efectos ──────────────────────────────────────────────────────────── */
  useEffect(() => {
    for (const fx of view.fx) {
      if (seenFx.current.has(fx.id)) continue;
      seenFx.current.add(fx.id);
      if (serverNow() - fx.at > 1200) continue;
      const mine = fx.playerId === meId;
      switch (fx.kind) {
        case 'shot':
          if (mine) sfx.putt(fx.power ?? 0.5);
          break;
        case 'wall':
          if (mine) sfx.tock();
          break;
        case 'bumper':
          if (mine) sfx.boing();
          rings.current.push({ x: fx.x, y: fx.y, at: fx.at, color: '#fecaca', size: 26 });
          break;
        case 'water':
          if (mine) sfx.splash();
          rings.current.push({ x: fx.x, y: fx.y, at: fx.at, color: '#e0f2fe', size: 40 });
          rings.current.push({ x: fx.x, y: fx.y, at: fx.at + 150, color: '#bae6fd', size: 28 });
          break;
        case 'sink':
          if (mine) sfx.cup();
          else sfx.tock();
          rings.current.push({ x: fx.x, y: fx.y, at: fx.at, color: '#fde047', size: 46 });
          break;
        case 'warp':
          if (mine) sfx.warp();
          break;
        case 'boost':
          if (mine) sfx.boost();
          break;
        case 'max':
        case 'timeout':
          if (mine) sfx.bad();
          break;
      }
    }
    if (seenFx.current.size > 400) seenFx.current = new Set(view.fx.map((f) => f.id));
    if (rings.current.length > 40) rings.current.splice(0, rings.current.length - 40);
  }, [view.fx, meId]);

  /* ── geometría de pantalla ────────────────────────────────────────────── */
  const scale = size.w ? Math.min(size.w / GOLF.W, size.h / GOLF.H) : 0;
  const offX = (size.w - GOLF.W * scale) / 2;
  const offY = (size.h - GOLF.H * scale) / 2;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !size.w) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    canvas.style.width = `${size.w}px`;
    canvas.style.height = `${size.h}px`;
  }, [size.w, size.h]);

  /** la cancha fija, pintada una vez por hoyo y tamaño */
  const layer = useMemo(() => {
    if (!scale) return null;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const c = document.createElement('canvas');
    c.width = Math.round(size.w * dpr);
    c.height = Math.round(size.h * dpr);
    const g = c.getContext('2d');
    if (!g) return null;
    g.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * offX, dpr * offY);
    paintCourse(g, def);
    return c;
  }, [def, scale, size.w, size.h, offX, offY]);

  const toWorld = (clientX: number, clientY: number) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: (clientX - rect.left - offX) / scale, y: (clientY - rect.top - offY) / scale };
  };

  /* ── apuntar con el mouse o el dedo: arrastrás para atrás y soltás ───── */
  const dragging = useRef(false);
  const onDown = (e: React.PointerEvent) => {
    if (!canShoot || !scale) return;
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragging.current = true;
    const p = toWorld(e.clientX, e.clientY);
    setAim({ a: aimRef.current?.a ?? 0, p: 0, from: p });
  };
  const onMove = (e: React.PointerEvent) => {
    const cur = aimRef.current;
    if (!dragging.current || !cur?.from) return;
    const p = toWorld(e.clientX, e.clientY);
    const dx = cur.from.x - p.x;
    const dy = cur.from.y - p.y;
    const len = Math.hypot(dx, dy);
    setAim({ a: len > 2 ? Math.atan2(dy, dx) : cur.a, p: Math.min(1, len / GOLF.DRAG_MAX), from: cur.from });
  };
  const onUp = () => {
    if (!dragging.current) return;
    dragging.current = false;
    const cur = aimRef.current;
    if (cur && cur.p >= 0.04 && canShoot) shoot(cur);
    else setAim(null);
  };

  const shoot = (a: Aim) => {
    api.send('shot', { a: Math.round(a.a * 10000) / 10000, p: Math.round(a.p * 1000) / 1000 });
    setAim(null);
  };

  /* ── teclado: ← → giran, ↑ ↓ fuerza, espacio tira ─────────────────────── */
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const v = snap.current;
      const mine = v.balls.find((b) => b.playerId === meId);
      if (v.stage !== 'live' || !mine || mine.done || mine.moving) return;
      const cur = aimRef.current ?? { a: initialAim(v, mine), p: 0.4, from: null };
      const fine = e.shiftKey ? 0.25 : 1;
      switch (e.code) {
        case 'ArrowLeft':
        case 'KeyA':
          setAim({ ...cur, a: cur.a - 0.05 * fine, from: null });
          break;
        case 'ArrowRight':
        case 'KeyD':
          setAim({ ...cur, a: cur.a + 0.05 * fine, from: null });
          break;
        case 'ArrowUp':
        case 'KeyW':
          setAim({ ...cur, p: Math.min(1, cur.p + 0.04 * fine), from: null });
          break;
        case 'ArrowDown':
        case 'KeyS':
          setAim({ ...cur, p: Math.max(0.04, cur.p - 0.04 * fine), from: null });
          break;
        case 'Space':
        case 'Enter':
          if (!e.repeat) shoot(cur);
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meId]);

  /* ── bucle de dibujo ──────────────────────────────────────────────────── */
  useRaf((dt) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas || !scale) return;
    const v = snap.current;
    const now = serverNow();
    const dpr = canvas.width / size.w;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (layer) ctx.drawImage(layer, 0, 0);
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * offX, dpr * offY);
    paintDynamic(ctx, {
      v,
      def: GOLF_HOLES[v.course],
      smooth: smooth.current,
      rings: rings.current,
      players,
      meId,
      aim: aimRef.current,
      now,
      dt,
      scale,
    });
  });

  /* ── tabla ────────────────────────────────────────────────────────────── */
  const rows = [...view.balls].map((b) => ({
    b,
    total: (view.totals[b.playerId] ?? 0) + (view.stage === 'live' || view.stage === 'countdown' ? b.strokes : 0),
  }));
  rows.sort((x, y) => x.total - y.total);

  return (
    <div className="gf">
      <header className="gf__top">
        <span className="chip">
          ⛳ Hoyo {view.hole}/{view.totalHoles}
        </span>
        <div className="gf__hole">
          <b>{def.name}</b>
          <span className="muted">
            Par {def.par} · máx {def.max}
          </span>
        </div>
        {me && (
          <div className="gf__strokes">
            <span className="label">Golpes</span>
            <strong className={`tnum ${me.strokes >= def.max - 1 && !me.done ? 'gf__warn' : ''}`}>
              {me.strokes}
              <span className="muted">/{def.max}</span>
            </strong>
          </div>
        )}
        {live && <Timer ms={left} urgentAt={15_000} />}
      </header>

      <div className="gf__body">
        <div className="gf__stage" ref={wrapRef}>
          <canvas
            ref={canvasRef}
            className={`gf__canvas ${canShoot ? 'gf__canvas--aim' : ''}`}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={() => {
              dragging.current = false;
              setAim(null);
            }}
            onContextMenu={(e) => e.preventDefault()}
          />

          {canShoot && !aim && <div className="gf__hint anim-fade">Arrastrá para atrás y soltá para tirar</div>}
          {aim && <div className="gf__power" style={{ ['--p' as string]: aim.p }}><span>{Math.round(aim.p * 100)}%</span></div>}

          {live && me?.done && (
            <div className="gf__done anim-pop">
              {me.holed ? (me.strokes === 1 ? '🎯 ¡Hoyo en uno!' : `⛳ Adentro en ${me.strokes}`) : `😵 Te anotan ${me.strokes}`}
              <span className="muted">Esperando a los demás…</span>
            </div>
          )}

          {view.stage === 'countdown' && (
            <div className="sm__overlay">
              <div className="gf__intro anim-pop">
                <span className="gf__intronum">Hoyo {view.hole}</span>
                <b>{def.name}</b>
                <span className="muted">{def.tag}</span>
                <span className="gf__intropar">
                  Par {def.par} · máximo {def.max} golpes · 1 minuto
                </span>
              </div>
              <div className="sm__count anim-pop" key={Math.ceil(countdown / 1000)}>
                {Math.max(1, Math.ceil(countdown / 1000))}
              </div>
            </div>
          )}

          {(view.stage === 'holeEnd' || view.stage === 'done') && view.holeResults && (
            <div className="f9__overlay f9__overlay--dim">
              <div className="card f9__podium anim-pop">
                <h3 className="card__title">
                  ⛳ {def.name} ·{' '}
                  {view.hole < view.totalHoles ? `próximo hoyo en ${Math.ceil(endLeft / 1000)}` : 'último hoyo'}
                </h3>
                <ol className="plist">
                  {view.holeResults.map((r, i) => {
                    const p = players.get(r.playerId);
                    if (!p) return null;
                    return (
                      <li key={r.playerId} className={`prow ${r.playerId === meId ? 'prow--me' : ''}`}>
                        <RankBadge rank={i + 1} />
                        <Avatar avatar={p.avatar} size={28} />
                        <span className="grow prow__name">{p.name}</span>
                        <span className="f9__time">{r.holed ? scoreName(r.strokes, def.par) : 'no la metió'}</span>
                        <span className="prow__score tnum">{r.strokes}</span>
                      </li>
                    );
                  })}
                </ol>
              </div>
            </div>
          )}
        </div>

        <aside className="gf__side panel">
          <h3 className="card__title">Tarjeta</h3>
          <ol className="plist">
            {rows.map(({ b, total }, i) => {
              const p = players.get(b.playerId);
              if (!p) return null;
              return (
                <li key={b.playerId} className={`prow ${b.playerId === meId ? 'prow--me' : ''}`}>
                  <RankBadge rank={i + 1} />
                  <span className="tq__swatch" style={{ background: ballColor(p) }} />
                  <Avatar avatar={p.avatar} size={24} offline={!p.connected} />
                  <span className="grow prow__name">{p.name}</span>
                  <span className="f9__lapchip tnum">{b.holed ? '⛳' : b.done ? '✗' : b.strokes}</span>
                  <span className="prow__score tnum">{total}</span>
                </li>
              );
            })}
          </ol>
          <Scorecard view={view} players={players} meId={meId} />
          <p className="hint gf__help">Arrastrá para atrás y soltá · o ← → apuntar, ↑ ↓ fuerza, espacio tirar (shift = fino)</p>
        </aside>
      </div>
    </div>
  );
}

function Scorecard({ view, players, meId }: { view: GolfView; players: Map<string, PlayerPublic>; meId: string | null }): JSX.Element | null {
  const ids = Object.keys(view.card).filter((id) => players.has(id));
  if (view.hole <= 1 && view.stage !== 'holeEnd') return null;
  return (
    <div className="gf__card">
      <table>
        <thead>
          <tr>
            <th />
            {view.courses.map((c, i) => (
              <th key={i} title={GOLF_HOLES[c].name}>
                {i + 1}
              </th>
            ))}
          </tr>
          <tr className="gf__par">
            <td>par</td>
            {view.courses.map((c, i) => (
              <td key={i}>{GOLF_HOLES[c].par}</td>
            ))}
          </tr>
        </thead>
        <tbody>
          {ids.map((id) => (
            <tr key={id} className={id === meId ? 'gf__me' : ''}>
              <td>{players.get(id)?.avatar.face}</td>
              {view.courses.map((c, i) => {
                const s = view.card[id]?.[i];
                const par = GOLF_HOLES[c].par;
                return (
                  <td key={i} className={s === undefined ? '' : s < par ? 'gf__under' : s > par ? 'gf__over' : ''}>
                    {s ?? ''}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function scoreName(strokes: number, par: number): string {
  if (strokes === 1) return '🎯 hoyo en uno';
  const d = strokes - par;
  if (d <= -2) return '🦅 águila';
  if (d === -1) return '🐦 birdie';
  if (d === 0) return 'par';
  if (d === 1) return 'bogey';
  return `+${d}`;
}

function initialAim(v: GolfView, me: GolfBall): number {
  const def = GOLF_HOLES[v.course];
  return Math.atan2(def.cup[1] - me.y, def.cup[0] - me.x);
}

function ballColor(p: PlayerPublic | undefined): string {
  return `hsl(${p?.avatar.hue ?? 0} 85% 60%)`;
}

/* ── dibujo de la cancha (fijo) ───────────────────────────────────────────── */

function polyPath(g: CanvasRenderingContext2D, poly: number[]): void {
  g.beginPath();
  g.moveTo(poly[0], poly[1]);
  for (let i = 2; i < poly.length; i += 2) g.lineTo(poly[i], poly[i + 1]);
  g.closePath();
}

function paintCourse(g: CanvasRenderingContext2D, def: GolfHoleDef): void {
  // Fondo: pasto alto oscuro con florcitas.
  g.fillStyle = '#14532d';
  g.fillRect(-400, -400, GOLF.W + 800, GOLF.H + 800);
  g.fillStyle = 'rgba(255,255,255,0.06)';
  for (let i = 0; i < 160; i++) {
    const x = ((i * 137.5) % GOLF.W) + ((i * 13) % 7);
    const y = ((i * 89.3) % GOLF.H) + ((i * 7) % 11);
    g.beginPath();
    g.arc(x, y, 2 + (i % 3), 0, TAU);
    g.fill();
  }

  // Sombra de la cancha.
  g.save();
  g.translate(6, 9);
  polyPath(g, def.outer);
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fill();
  g.restore();

  // Pasto cortado a rayas.
  g.save();
  polyPath(g, def.outer);
  g.clip();
  g.fillStyle = def.grass[0];
  g.fillRect(0, 0, GOLF.W, GOLF.H);
  g.fillStyle = def.grass[1];
  for (let x = -GOLF.H; x < GOLF.W; x += 56) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x + 28, 0);
    g.lineTo(x + 28 + GOLF.H, GOLF.H);
    g.lineTo(x + GOLF.H, GOLF.H);
    g.closePath();
    g.fill();
  }

  // Zonas.
  for (const z of def.zones ?? []) {
    const [x, y, w, h] = z.r;
    if (z.kind === 'sand') {
      g.fillStyle = '#f5deb3';
      roundRect(g, x, y, w, h, 18);
      g.fill();
      g.fillStyle = 'rgba(180, 140, 80, 0.35)';
      for (let i = 0; i < (w * h) / 220; i++) {
        g.fillRect(x + 6 + ((i * 37.7) % (w - 12)), y + 6 + ((i * 53.3) % (h - 12)), 2, 2);
      }
    } else if (z.kind === 'water') {
      g.fillStyle = '#38bdf8';
      roundRect(g, x, y, w, h, 14);
      g.fill();
      g.strokeStyle = 'rgba(14, 116, 144, 0.6)';
      g.lineWidth = 4;
      g.stroke();
    } else if (z.kind === 'ice') {
      const ice = g.createLinearGradient(x, y, x + w, y + h);
      ice.addColorStop(0, 'rgba(224, 242, 254, 0.92)');
      ice.addColorStop(1, 'rgba(186, 230, 253, 0.92)');
      g.fillStyle = ice;
      roundRect(g, x, y, w, h, 12);
      g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.7)';
      g.lineWidth = 2;
      for (let i = 0; i < 6; i++) {
        const sx = x + ((i * 61) % w);
        const sy = y + ((i * 43) % h);
        g.beginPath();
        g.moveTo(sx, sy);
        g.lineTo(sx + 26, sy - 14);
        g.stroke();
      }
    } else if (z.kind === 'slope') {
      g.fillStyle = 'rgba(0, 0, 0, 0.08)';
      g.fillRect(x, y, w, h);
      const a = Math.atan2(z.ay ?? 0, z.ax ?? 0);
      g.strokeStyle = 'rgba(255,255,255,0.45)';
      g.lineWidth = 4;
      g.lineCap = 'round';
      for (let yy = y + 40; yy < y + h; yy += 70) {
        for (let xx = x + 40; xx < x + w; xx += 60) {
          g.save();
          g.translate(xx, yy);
          g.rotate(a);
          g.beginPath();
          g.moveTo(-10, -9);
          g.lineTo(2, 0);
          g.lineTo(-10, 9);
          g.stroke();
          g.restore();
        }
      }
    } else if (z.kind === 'boost') {
      g.fillStyle = '#f59e0b';
      roundRect(g, x, y, w, h, 8);
      g.fill();
      const a = Math.atan2(z.ay ?? 0, z.ax ?? 1);
      g.save();
      g.translate(x + w / 2, y + h / 2);
      g.rotate(a);
      g.fillStyle = '#fff7ed';
      for (let i = -1; i <= 1; i++) {
        g.beginPath();
        g.moveTo(i * 14 - 6, -12);
        g.lineTo(i * 14 + 6, 0);
        g.lineTo(i * 14 - 6, 12);
        g.lineTo(i * 14 - 1, 0);
        g.closePath();
        g.fill();
      }
      g.restore();
    }
  }
  g.restore();

  // Paredes internas de madera.
  for (const b of def.blocks ?? []) {
    g.save();
    g.translate(3, 5);
    polyPath(g, b);
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.fill();
    g.restore();
    polyPath(g, b);
    g.fillStyle = '#a16207';
    g.fill();
    g.strokeStyle = '#713f12';
    g.lineWidth = 3;
    g.stroke();
  }

  // Baranda del borde.
  polyPath(g, def.outer);
  g.lineJoin = 'round';
  g.strokeStyle = '#713f12';
  g.lineWidth = 14;
  g.stroke();
  g.strokeStyle = '#ca8a04';
  g.lineWidth = 7;
  g.stroke();

  // Hongos.
  for (const [x, y, r] of def.bumpers ?? []) {
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.beginPath();
    g.arc(x + 3, y + 5, r, 0, TAU);
    g.fill();
    g.fillStyle = '#ef4444';
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.fill();
    g.fillStyle = '#fef2f2';
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU + 0.4;
      g.beginPath();
      g.arc(x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55, r * 0.17, 0, TAU);
      g.fill();
    }
    g.beginPath();
    g.arc(x, y, r * 0.2, 0, TAU);
    g.fill();
  }

  // Salida.
  g.fillStyle = 'rgba(255,255,255,0.35)';
  roundRect(g, def.start[0] - 16, def.start[1] - 16, 32, 32, 6);
  g.fill();

  // Hoyo.
  const [cx, cy] = def.cup;
  g.fillStyle = 'rgba(255,255,255,0.55)';
  g.beginPath();
  g.arc(cx, cy, GOLF.CUP_R + 4, 0, TAU);
  g.fill();
  const hole = g.createRadialGradient(cx - 3, cy - 3, 2, cx, cy, GOLF.CUP_R);
  hole.addColorStop(0, '#020617');
  hole.addColorStop(1, '#1e293b');
  g.fillStyle = hole;
  g.beginPath();
  g.arc(cx, cy, GOLF.CUP_R, 0, TAU);
  g.fill();
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}

/* ── dibujo de lo que se mueve ────────────────────────────────────────────── */

interface DynArgs {
  v: GolfView;
  def: GolfHoleDef;
  smooth: Map<string, Smooth>;
  rings: Ring[];
  players: Map<string, PlayerPublic>;
  meId: string | null;
  aim: Aim | null;
  now: number;
  dt: number;
  scale: number;
}

function paintDynamic(g: CanvasRenderingContext2D, a: DynArgs): void {
  const { v, def, smooth, rings, players, meId, aim, now, dt, scale } = a;
  const t = now - v.clock0;

  // Brillo del agua.
  for (const z of def.zones ?? []) {
    if (z.kind !== 'water') continue;
    const [x, y, w, h] = z.r;
    g.save();
    roundRect(g, x, y, w, h, 14);
    g.clip();
    g.strokeStyle = 'rgba(255,255,255,0.4)';
    g.lineWidth = 2;
    for (let i = 0; i < (w * h) / 5000; i++) {
      const bx = x + ((i * 71.3 + now / 40) % (w + 40)) - 20;
      const by = y + ((i * 47.9) % h);
      g.beginPath();
      g.moveTo(bx, by);
      g.quadraticCurveTo(bx + 8, by - 4 + Math.sin(now / 300 + i) * 2, bx + 16, by);
      g.stroke();
    }
    g.restore();
  }

  // Portales.
  for (const p of def.portals ?? []) {
    for (const [pt, color] of [
      [p.a, '#a855f7'],
      [p.b, '#22d3ee'],
    ] as const) {
      g.save();
      g.translate(pt[0], pt[1]);
      g.rotate(now / 300);
      for (let i = 0; i < 3; i++) {
        g.strokeStyle = color;
        g.globalAlpha = 0.9 - i * 0.25;
        g.lineWidth = 4;
        g.beginPath();
        g.arc(0, 0, GOLF.PORTAL_R - i * 5, i, i + 4.2);
        g.stroke();
      }
      g.restore();
    }
  }

  // Puertas corredizas.
  for (const sl of def.sliders ?? []) {
    const c = sliderAt(sl, t);
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.fillRect(c.x - sl.w / 2 + 3, c.y - sl.h / 2 + 5, sl.w, sl.h);
    g.fillStyle = '#7c3aed';
    roundRect(g, c.x - sl.w / 2, c.y - sl.h / 2, sl.w, sl.h, 6);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.3)';
    g.fillRect(c.x - sl.w / 2 + 4, c.y - sl.h / 2 + 6, 4, sl.h - 12);
  }

  // Bandera.
  const [cx, cy] = def.cup;
  g.strokeStyle = '#f8fafc';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(cx, cy);
  g.lineTo(cx + 6, cy - 54);
  g.stroke();
  const wave = Math.sin(now / 220) * 4;
  g.fillStyle = '#ef4444';
  g.beginPath();
  g.moveTo(cx + 6, cy - 54);
  g.quadraticCurveTo(cx + 22, cy - 50 + wave, cx + 38, cy - 46);
  g.lineTo(cx + 5, cy - 34);
  g.closePath();
  g.fill();

  // Pelotas: se predicen desde el snapshot con la misma física y se suavizan.
  const elapsed = Math.max(0, Math.min(0.15, (now - v.t) / 1000));
  const order = [...v.balls].sort((x, y) => (x.playerId === meId ? 1 : 0) - (y.playerId === meId ? 1 : 0));
  for (const b of order) {
    const target = predict(b, v, elapsed);
    let s = smooth.get(b.playerId);
    if (!s || Math.hypot(s.x - target.x, s.y - target.y) > 120) {
      s = { x: target.x, y: target.y };
      smooth.set(b.playerId, s);
    }
    const k = Math.min(1, dt * 22);
    s.x += (target.x - s.x) * k;
    s.y += (target.y - s.y) * k;
    drawBall(g, b, s, players.get(b.playerId), b.playerId === meId, now);
  }

  // Apuntado.
  const me = v.balls.find((b) => b.playerId === meId);
  if (aim && me && !me.moving && !me.done) {
    const s = smooth.get(me.playerId) ?? { x: me.x, y: me.y };
    const len = 30 + aim.p * 190;
    const col = `hsl(${120 - aim.p * 120} 90% 55%)`;
    g.strokeStyle = col;
    g.lineWidth = 4;
    g.setLineDash([8, 7]);
    g.lineDashOffset = -now / 30;
    g.beginPath();
    g.moveTo(s.x, s.y);
    g.lineTo(s.x + Math.cos(aim.a) * len, s.y + Math.sin(aim.a) * len);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = col;
    g.save();
    g.translate(s.x + Math.cos(aim.a) * len, s.y + Math.sin(aim.a) * len);
    g.rotate(aim.a);
    g.beginPath();
    g.moveTo(10, 0);
    g.lineTo(-6, -8);
    g.lineTo(-6, 8);
    g.closePath();
    g.fill();
    g.restore();
    if (aim.from) {
      // La "gomera": de la pelota hacia donde tirás para atrás.
      g.strokeStyle = 'rgba(255,255,255,0.5)';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(s.x, s.y);
      g.lineTo(s.x - Math.cos(aim.a) * aim.p * GOLF.DRAG_MAX * 0.6, s.y - Math.sin(aim.a) * aim.p * GOLF.DRAG_MAX * 0.6);
      g.stroke();
    }
  }

  // Molinos (arriba de las pelotas, como en la vida real).
  for (const sp of def.spinners ?? []) {
    const a0 = spinnerAngle(sp, t);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    for (let i = 0; i < sp.arms; i++) {
      const ang = a0 + (i * TAU) / sp.arms;
      g.save();
      g.translate(sp.x + 4, sp.y + 6);
      g.rotate(ang);
      g.fillRect(0, -sp.thick / 2, sp.len, sp.thick);
      g.restore();
    }
    for (let i = 0; i < sp.arms; i++) {
      const ang = a0 + (i * TAU) / sp.arms;
      g.save();
      g.translate(sp.x, sp.y);
      g.rotate(ang);
      g.fillStyle = '#f8fafc';
      roundRect(g, 0, -sp.thick / 2, sp.len, sp.thick, 4);
      g.fill();
      g.fillStyle = '#dc2626';
      g.fillRect(sp.len * 0.35, -sp.thick / 2, sp.len * 0.2, sp.thick);
      g.fillRect(sp.len * 0.75, -sp.thick / 2, sp.len * 0.2, sp.thick);
      g.restore();
    }
    g.fillStyle = '#1e293b';
    g.beginPath();
    g.arc(sp.x, sp.y, sp.thick * 0.9, 0, TAU);
    g.fill();
  }

  // Anillos de efectos.
  for (let i = rings.length - 1; i >= 0; i--) {
    const r = rings[i];
    const age = (now - r.at) / 600;
    if (age < 0) continue;
    if (age > 1) {
      rings.splice(i, 1);
      continue;
    }
    g.strokeStyle = r.color;
    g.globalAlpha = 1 - age;
    g.lineWidth = 4 * (1 - age) + 1;
    g.beginPath();
    g.arc(r.x, r.y, 6 + r.size * age, 0, TAU);
    g.stroke();
  }
  g.globalAlpha = 1;

  // Nombres (en tamaño de pantalla).
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const fs = 11 / scale;
  g.font = `800 ${fs}px Outfit, sans-serif`;
  for (const b of v.balls) {
    if (b.holed) continue;
    const s = smooth.get(b.playerId);
    if (!s) continue;
    const isMe = b.playerId === meId;
    const p = players.get(b.playerId);
    const label = isMe ? 'VOS' : short(p?.name ?? '—');
    const w = g.measureText(label).width + 10 / scale;
    const y = s.y - GOLF.BALL_R - 12 / scale;
    g.globalAlpha = isMe ? 1 : 0.75;
    g.fillStyle = 'rgba(8,10,14,0.65)';
    roundRect(g, s.x - w / 2, y - 7 / scale, w, 14 / scale, 7 / scale);
    g.fill();
    g.fillStyle = isMe ? '#fef08a' : '#fff';
    g.fillText(label, s.x, y + 0.5 / scale);
  }
  g.globalAlpha = 1;
}

function predict(b: GolfBall, v: GolfView, elapsed: number): { x: number; y: number } {
  if (!b.moving || b.done || v.stage !== 'live') return { x: b.x, y: b.y };
  const sim = { x: b.x, y: b.y, vx: b.vx, vy: b.vy };
  const ev = stepBall(sim, v.course, elapsed, v.t - v.clock0);
  // Si la predicción dice agua u hoyo, mejor esperar lo que diga el servidor.
  if (ev === 'water' || ev === 'cup') return { x: b.x, y: b.y };
  return { x: sim.x, y: sim.y };
}

function drawBall(g: CanvasRenderingContext2D, b: GolfBall, s: Smooth, p: PlayerPublic | undefined, isMe: boolean, now: number): void {
  let r = GOLF.BALL_R;
  if (b.holed && b.holedAt) {
    // Se hunde en el hoyo.
    const k = Math.min(1, (now - b.holedAt) / 350);
    r *= 1 - k * 0.75;
    if (k >= 1) return;
  }
  g.globalAlpha = isMe ? 1 : 0.6;
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.beginPath();
  g.arc(s.x + 2, s.y + 3, r, 0, TAU);
  g.fill();
  const grad = g.createRadialGradient(s.x - r * 0.35, s.y - r * 0.35, r * 0.1, s.x, s.y, r);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(1, isMe ? '#e2e8f0' : ballColor(p));
  g.fillStyle = grad;
  g.beginPath();
  g.arc(s.x, s.y, r, 0, TAU);
  g.fill();
  g.strokeStyle = ballColor(p);
  g.lineWidth = isMe ? 3 : 1.5;
  g.stroke();
  if (isMe && !b.moving && !b.done) {
    const pulse = 0.5 + 0.5 * Math.sin(now / 200);
    g.strokeStyle = `rgba(254, 240, 138, ${0.4 + pulse * 0.5})`;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(s.x, s.y, r + 6 + pulse * 3, 0, TAU);
    g.stroke();
  }
  g.globalAlpha = 1;
}

function short(name: string): string {
  return name.length > 10 ? `${name.slice(0, 9)}…` : name;
}
