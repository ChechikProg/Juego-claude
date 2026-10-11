import { useEffect, useMemo, useRef, useState } from 'react';
import { COPA, PRACTICE_GOAL, angleDiff, effectiveHalf, goalPosts } from '@shared/copa';
import type { CopaView, PlayerPublic } from '@shared/types';
import { api, serverNow } from '@/net/socket';
import { useCountdown, useRaf, useSize } from '@/lib/hooks';
import { sfx } from '@/lib/sfx';
import { usePlayerMap, useStore } from '@/state/store';
import { Avatar, RankBadge } from '@/components/ui';

const TAU = Math.PI * 2;
/** margen alrededor de la cancha (tribuna), en unidades de mundo */
const MARGIN = 78;

interface Smooth {
  x: number;
  y: number;
}

interface Drag {
  i: number;
  /** puntero en coordenadas de mundo */
  px: number;
  py: number;
  pointerId: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
}

export function Copa({ view }: { view: CopaView }): JSX.Element {
  const players = usePlayerMap();
  const meId = useStore((s) => s.playerId);
  const [wrapRef, size] = useSize<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const snap = useRef(view);
  snap.current = view;

  const smooth = useRef(new Map<string, Smooth>());
  const ballRoll = useRef({ angle: 0, x: 0, y: 0 });
  const drag = useRef<Drag | null>(null);
  const [dragging, setDragging] = useState(false);
  const rotation = useRef<number | null>(null);
  const seenFx = useRef(new Set<number>());
  const particles = useRef<Particle[]>([]);
  const shake = useRef(0);
  const lastGoalAt = useRef(0);
  const deniedAt = useRef(0);

  const me = view.players.find((p) => p.playerId === meId);
  const myGoal = view.goals.find((g) => g.playerId === meId);
  const live = view.stage === 'live';
  const countdown = useCountdown(view.stage === 'countdown' ? view.until : null, 10);
  const readyIn = useCountdown(me && live ? me.readyAt : null, 10);
  const roundLeft = useCountdown(view.stage === 'roundEnd' ? view.until : null, 4);

  /* ── sonidos y partículas de los efectos nuevos ─────────────────────── */
  useEffect(() => {
    for (const fx of view.fx) {
      if (seenFx.current.has(fx.id)) continue;
      seenFx.current.add(fx.id);
      if (fx.kind === 'flick') sfx.flick();
      else if (fx.kind === 'kick') {
        sfx.kick(fx.power);
        burst(particles.current, fx.x, fx.y, 4 + Math.round(fx.power * 8), ['#ffffff', '#d9f99d'], 120 + 260 * fx.power, 0.35);
      } else if (fx.kind === 'clack') sfx.clack();
      else if (fx.kind === 'post') {
        sfx.post();
        burst(particles.current, fx.x, fx.y, 8, ['#ffffff', '#fde047'], 200, 0.3);
      } else if (fx.kind === 'wall') {
        sfx.kick(fx.power * 0.5);
      }
    }
    if (seenFx.current.size > 400) seenFx.current = new Set(view.fx.map((f) => f.id));
  }, [view.fx]);

  // Gol: sonido, papelitos y sacudón.
  useEffect(() => {
    const g = view.lastGoal;
    if (!g || g.at === lastGoalAt.current) return;
    lastGoalAt.current = g.at;
    sfx.goal();
    setTimeout(() => sfx.whistle(), 500);
    const ball = snap.current.ball;
    const scorer = g.scorer ? players.get(g.scorer) : null;
    const hue = scorer?.avatar.hue ?? 50;
    burst(particles.current, ball.x, ball.y, 70, [`hsl(${hue} 90% 60%)`, '#fde047', '#ffffff', '#22c55e'], 520, 1.4);
    shake.current = g.victim === meId ? 16 : 9;
  }, [view.lastGoal, players, meId]);

  // Silbato al arrancar cada jugada.
  const prevStage = useRef(view.stage);
  useEffect(() => {
    if (prevStage.current === 'countdown' && view.stage === 'live') sfx.whistle();
    prevStage.current = view.stage;
  }, [view.stage]);

  /* ── geometría de pantalla ─────────────────────────────────────────── */
  const side = Math.max(220, Math.min(size.w, size.h));
  const scale = side / (2 * (COPA.R + MARGIN));

  // Rotamos la cancha para que tu arco quede siempre abajo.
  const targetRot = myGoal ? Math.PI / 2 - myGoal.a : rotation.current ?? 0;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !side) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = side * dpr;
    canvas.height = side * dpr;
    canvas.style.width = `${side}px`;
    canvas.style.height = `${side}px`;
  }, [side]);

  /** capa fija: tribuna y pasto, se dibuja una vez por tamaño */
  const pitchLayer = useMemo(() => {
    if (!side) return null;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const c = document.createElement('canvas');
    c.width = side * dpr;
    c.height = side * dpr;
    const g = c.getContext('2d');
    if (!g) return null;
    g.setTransform(dpr * scale, 0, 0, dpr * scale, (side * dpr) / 2, (side * dpr) / 2);
    paintPitch(g);
    return c;
  }, [side, scale]);

  const toWorld = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const r = canvas.getBoundingClientRect();
    const sx = (clientX - r.left - r.width / 2) / scale;
    const sy = (clientY - r.top - r.height / 2) / scale;
    const rot = -(rotation.current ?? 0);
    return { x: sx * Math.cos(rot) - sy * Math.sin(rot), y: sx * Math.sin(rot) + sy * Math.cos(rot) };
  };

  /* ── lanzar fichas ─────────────────────────────────────────────────── */
  const onDown = (e: React.PointerEvent) => {
    sfx.wake();
    const v = snap.current;
    if (v.stage !== 'live' || !meId) return;
    const pl = v.players.find((p) => p.playerId === meId);
    if (!pl?.alive) return;
    const w = toWorld(e.clientX, e.clientY);
    if (!w) return;
    // La ficha propia más cercana al puntero.
    let best: { i: number; d: number } | null = null;
    for (const p of v.pucks) {
      if (p.owner !== meId) continue;
      const sm = smooth.current.get(`${p.owner}:${p.i}`) ?? p;
      const d = Math.hypot(sm.x - w.x, sm.y - w.y);
      if (d < COPA.PUCK_R + 22 && (!best || d < best.d)) best = { i: p.i, d };
    }
    if (!best) return;
    if (serverNow() < pl.readyAt - 80) {
      deniedAt.current = performance.now();
      sfx.bad();
      return;
    }
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { i: best.i, px: w.x, py: w.y, pointerId: e.pointerId };
    setDragging(true);
    sfx.tap();
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const w = toWorld(e.clientX, e.clientY);
    if (!w) return;
    d.px = w.x;
    d.py = w.y;
  };

  const onUp = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    setDragging(false);
    const shot = launchVector(d, smooth.current.get(`${meId}:${d.i}`));
    if (!shot || snap.current.stage !== 'live') return;
    api.send('flick', { i: d.i, dx: Math.round(shot.dx * 10) / 10, dy: Math.round(shot.dy * 10) / 10 });
  };

  const cancelDrag = () => {
    drag.current = null;
    setDragging(false);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancelDrag();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Si se termina la jugada con una ficha agarrada, la soltamos sin tirar.
  useEffect(() => {
    if (!live) cancelDrag();
  }, [live]);

  /* ── bucle de dibujo ───────────────────────────────────────────────── */
  useRaf((dt) => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx || !side) return;

    // La rotación sigue al arco propio con suavidad (cuando se reacomodan los arcos).
    if (rotation.current === null) rotation.current = targetRot;
    else rotation.current += angleDiff(targetRot, rotation.current) * Math.min(1, dt * 4);

    paint(ctx, {
      v: snap.current,
      side,
      scale,
      rot: rotation.current,
      layer: pitchLayer,
      smooth: smooth.current,
      roll: ballRoll.current,
      players,
      meId,
      drag: drag.current,
      particles: particles.current,
      shake,
      dt,
      denied: performance.now() - deniedAt.current < 400,
    });
  });

  /* ── interfaz ──────────────────────────────────────────────────────── */
  const ranking = [...view.players].sort((a, b) => (view.totals[b.playerId] ?? 0) - (view.totals[a.playerId] ?? 0));
  const goal = view.lastGoal;
  const scorer = goal?.scorer ? players.get(goal.scorer) : null;
  const victim = goal && goal.victim !== PRACTICE_GOAL ? players.get(goal.victim) : null;
  const reloadPct = me ? Math.max(0, Math.min(1, 1 - readyIn / COPA.COOLDOWN)) : 0;
  const alive = view.players.filter((p) => p.alive).length;

  return (
    <div className="cp">
      <header className="cp__top">
        <span className="chip">
          Ronda {view.round} / {view.totalRounds}
        </span>
        <span className="chip chip--accent">
          {view.solo ? `🎯 Práctica · goles ${view.players[0]?.goals ?? 0}` : `🏟️ Quedan ${alive}`}
        </span>
        {view.widen > 1.01 && <span className="chip chip--gold cp__widen">↔ Arcos más grandes</span>}
        {me?.alive && live && (
          <div className="cp__reload" aria-live="polite">
            <span className="label">{readyIn > 0 ? 'Próximo tiro' : '¡Tirá!'}</span>
            <div className="cp__reloadbar">
              <div className={`cp__reloadfill ${readyIn <= 0 ? 'cp__reloadfill--ready' : ''}`} style={{ width: `${reloadPct * 100}%` }} />
            </div>
          </div>
        )}
      </header>

      <div className="cp__body">
        <div className="cp__stage" ref={wrapRef}>
          <canvas
            ref={canvasRef}
            className={`cp__canvas ${dragging ? 'cp__canvas--drag' : ''}`}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={cancelDrag}
            onContextMenu={(e) => {
              e.preventDefault();
              cancelDrag();
            }}
          />

          {view.stage === 'countdown' && (
            <div className="cp__overlay cp__overlay--clear">
              <div className="sm__count anim-pop" key={Math.ceil(countdown / 1000)}>
                {Math.max(1, Math.ceil(countdown / 1000))}
              </div>
              <p className="sm__ready">{view.round === 1 && !goal ? 'Arrastrá una ficha para atrás y soltá' : 'Pelota al medio'}</p>
            </div>
          )}

          {view.stage === 'goal' && goal && (
            <div className="cp__overlay cp__overlay--clear">
              <div className="cp__goal anim-pop">
                <span className="cp__goaltxt">{goal.own ? '¡EN CONTRA!' : '¡GOOOL!'}</span>
                {scorer && (
                  <span className="cp__goalwho">
                    <Avatar avatar={scorer.avatar} size={30} /> {scorer.name}
                    {!view.solo && <b className="cp__bonus">+{COPA.GOAL_BONUS}</b>}
                  </span>
                )}
                {victim && !view.solo && <span className="cp__goalout">{victim.name} queda afuera</span>}
              </div>
            </div>
          )}

          {view.stage === 'roundEnd' && view.roundSummary && (
            <div className="cp__overlay">
              <div className="card cp__summary anim-pop">
                <h3 className="card__title">
                  Fin de la ronda {view.round} · {view.round < view.totalRounds ? `sigue en ${Math.ceil(roundLeft / 1000)}` : 'cierre'}
                </h3>
                <ol className="plist">
                  {view.roundSummary.map((r) => {
                    const p = players.get(r.playerId);
                    if (!p) return null;
                    return (
                      <li key={r.playerId} className={`prow ${r.playerId === meId ? 'prow--me' : ''}`}>
                        <RankBadge rank={r.place} />
                        <Avatar avatar={p.avatar} size={28} />
                        <span className="grow prow__name">{p.name}</span>
                        {r.goals > 0 && <span className="cp__goals">⚽ {r.goals}</span>}
                        <span className="prow__score tnum">+{r.points}</span>
                      </li>
                    );
                  })}
                </ol>
              </div>
            </div>
          )}

          {live && me && !me.alive && <div className="sm__eliminated anim-fade">Te metieron un gol · mirá cómo sigue</div>}
        </div>

        <aside className="cp__side panel">
          <h3 className="card__title">Tabla</h3>
          <ol className="plist">
            {ranking.map((row, i) => {
              const p = players.get(row.playerId);
              if (!p) return null;
              return (
                <li key={row.playerId} className={`prow ${row.playerId === meId ? 'prow--me' : ''} ${row.alive ? '' : 'cp__out'}`}>
                  <RankBadge rank={i + 1} />
                  <span className="cp__swatch" style={{ background: `hsl(${p.avatar.hue} 75% 55%)` }} />
                  <Avatar avatar={p.avatar} size={24} offline={!p.connected} />
                  <span className="grow prow__name">{p.name}</span>
                  {row.goals > 0 && <span className="cp__goals">⚽{row.goals}</span>}
                  {!row.alive && <span aria-label="eliminado">❌</span>}
                  <span className="prow__score tnum">{view.totals[row.playerId] ?? 0}</span>
                </li>
              );
            })}
          </ol>
          <p className="hint cp__help">
            Agarrá una ficha tuya, tirá para atrás y soltá. Gol = +{COPA.GOAL_BONUS} · cada rival que aguantás = +{COPA.SURVIVE_PTS}.
          </p>
        </aside>
      </div>
    </div>
  );
}

/* ── helpers ──────────────────────────────────────────────────────────────── */

/** Vector de lanzamiento: el contrario al arrastre, con tope de potencia. */
function launchVector(d: Drag, puck: Smooth | undefined): { dx: number; dy: number; power: number } | null {
  if (!puck) return null;
  let dx = puck.x - d.px;
  let dy = puck.y - d.py;
  const len = Math.hypot(dx, dy);
  if (len < COPA.DRAG_MIN) return null;
  if (len > COPA.DRAG_MAX) {
    dx *= COPA.DRAG_MAX / len;
    dy *= COPA.DRAG_MAX / len;
  }
  return { dx, dy, power: Math.min(1, len / COPA.DRAG_MAX) };
}

function burst(list: Particle[], x: number, y: number, n: number, colors: string[], speed: number, life: number): void {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU;
    const v = speed * (0.25 + Math.random() * 0.75);
    const l = life * (0.5 + Math.random() * 0.6);
    list.push({
      x,
      y,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v,
      life: l,
      max: l,
      size: 3 + Math.random() * 5,
      color: colors[Math.floor(Math.random() * colors.length)],
    });
  }
  if (list.length > 500) list.splice(0, list.length - 500);
}

/* ── dibujo ───────────────────────────────────────────────────────────────── */

/** Tribuna + pasto + líneas fijas (sin rotar: es simétrico). */
function paintPitch(g: CanvasRenderingContext2D): void {
  const R = COPA.R;
  const outer = R + MARGIN;

  // Tribuna oscura con público.
  const stand = g.createRadialGradient(0, 0, R, 0, 0, outer * 1.45);
  stand.addColorStop(0, '#0f1a14');
  stand.addColorStop(1, '#05080a');
  g.fillStyle = stand;
  g.fillRect(-outer * 1.5, -outer * 1.5, outer * 3, outer * 3);

  // Puntitos de colores: la hinchada.
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const crowd = ['#ef4444', '#f8fafc', '#3b82f6', '#facc15', '#22c55e', '#a855f7', '#fb923c'];
  for (let i = 0; i < 900; i++) {
    const a = rand() * TAU;
    const r = R + 56 + rand() * (outer * 1.4 - R - 56);
    g.globalAlpha = 0.25 + rand() * 0.35;
    g.fillStyle = crowd[Math.floor(rand() * crowd.length)];
    g.beginPath();
    g.arc(Math.cos(a) * r, Math.sin(a) * r, 2 + rand() * 2.2, 0, TAU);
    g.fill();
  }
  g.globalAlpha = 1;

  // Pista de atletismo alrededor.
  g.beginPath();
  g.arc(0, 0, R + 50, 0, TAU);
  g.fillStyle = '#1d2b22';
  g.fill();

  // Pasto con franjas.
  g.save();
  g.beginPath();
  g.arc(0, 0, R + 8, 0, TAU);
  g.clip();
  const grass = g.createRadialGradient(0, -R * 0.3, R * 0.1, 0, 0, R * 1.1);
  grass.addColorStop(0, '#3fae4f');
  grass.addColorStop(1, '#23803a');
  g.fillStyle = grass;
  g.fillRect(-R - 10, -R - 10, (R + 10) * 2, (R + 10) * 2);
  const stripe = 60;
  for (let x = -R - 10, k = 0; x < R + 10; x += stripe, k++) {
    if (k % 2) continue;
    g.fillStyle = 'rgba(255,255,255,0.055)';
    g.fillRect(x, -R - 10, stripe, (R + 10) * 2);
  }
  // Viñeta: los bordes un poco más oscuros.
  const vig = g.createRadialGradient(0, 0, R * 0.55, 0, 0, R * 1.02);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.28)');
  g.fillStyle = vig;
  g.fillRect(-R - 10, -R - 10, (R + 10) * 2, (R + 10) * 2);
  g.restore();

  // Líneas.
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.lineWidth = 4;
  g.beginPath();
  g.arc(0, 0, R, 0, TAU);
  g.stroke();
  g.lineWidth = 3;
  g.strokeStyle = 'rgba(255,255,255,0.6)';
  g.beginPath();
  g.arc(0, 0, 92, 0, TAU);
  g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.75)';
  g.beginPath();
  g.arc(0, 0, 5, 0, TAU);
  g.fill();

  // Reflejo de los reflectores.
  for (const [lx, ly] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]) {
    const fx = lx * outer * 1.05;
    const fy = ly * outer * 1.05;
    const flood = g.createRadialGradient(fx, fy, 0, fx, fy, outer * 0.9);
    flood.addColorStop(0, 'rgba(255, 250, 220, 0.16)');
    flood.addColorStop(1, 'rgba(255, 250, 220, 0)');
    g.fillStyle = flood;
    g.fillRect(-outer * 1.5, -outer * 1.5, outer * 3, outer * 3);
  }
}

interface PaintArgs {
  v: CopaView;
  side: number;
  scale: number;
  rot: number;
  layer: HTMLCanvasElement | null;
  smooth: Map<string, Smooth>;
  roll: { angle: number; x: number; y: number };
  players: Map<string, PlayerPublic>;
  meId: string | null;
  drag: Drag | null;
  particles: Particle[];
  shake: React.MutableRefObject<number>;
  dt: number;
  denied: boolean;
}

function paint(ctx: CanvasRenderingContext2D, a: PaintArgs): void {
  const { v, side, scale, rot, layer, smooth, roll, players, meId, drag, particles, shake, dt, denied } = a;
  const dpr = ctx.canvas.width / side;
  const now = serverNow();

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  if (layer) ctx.drawImage(layer, 0, 0);

  let sx = 0;
  let sy = 0;
  if (shake.current > 0.2) {
    sx = (Math.random() - 0.5) * shake.current;
    sy = (Math.random() - 0.5) * shake.current;
    shake.current *= Math.pow(0.003, dt);
  }
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, (side / 2 + sx) * dpr, (side / 2 + sy) * dpr);
  ctx.rotate(rot);

  const R = COPA.R;
  const n = v.goals.length;

  /* ── arcos ── */
  for (const goal of v.goals) {
    const half = effectiveHalf(goal, v.widen, n);
    const practice = goal.playerId === PRACTICE_GOAL;
    const p = practice ? null : players.get(goal.playerId);
    const hue = p?.avatar.hue ?? 0;
    const color = practice ? 'rgba(255,255,255,0.9)' : `hsl(${hue} 85% 60%)`;
    const isMine = goal.playerId === meId;

    // Área chica: semicírculo frente al arco.
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, TAU);
    ctx.clip();
    ctx.beginPath();
    ctx.arc(Math.cos(goal.a) * R, Math.sin(goal.a) * R, 120 + half * 90, 0, TAU);
    ctx.fillStyle = practice ? 'rgba(255,255,255,0.05)' : `hsla(${hue} 85% 55% / ${isMine ? 0.16 : 0.1})`;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.restore();

    // Red: banda afuera del círculo entre los dos palos.
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, R + COPA.GOAL_DEPTH, goal.a - half, goal.a + half);
    ctx.arc(0, 0, R, goal.a + half, goal.a - half, true);
    ctx.closePath();
    ctx.fillStyle = 'rgba(10, 14, 12, 0.75)';
    ctx.fill();
    ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 1.2;
    for (let k = -14; k <= 14; k++) {
      const aa = goal.a + (k / 14) * half;
      ctx.beginPath();
      ctx.moveTo(Math.cos(aa) * R, Math.sin(aa) * R);
      ctx.lineTo(Math.cos(aa) * (R + COPA.GOAL_DEPTH + 4), Math.sin(aa) * (R + COPA.GOAL_DEPTH + 4));
      ctx.stroke();
    }
    for (let d = R + 8; d < R + COPA.GOAL_DEPTH; d += 9) {
      ctx.beginPath();
      ctx.arc(0, 0, d, goal.a - half, goal.a + half);
      ctx.stroke();
    }
    ctx.restore();

    // Marco del arco con el color del dueño.
    ctx.beginPath();
    ctx.arc(0, 0, R + COPA.GOAL_DEPTH, goal.a - half, goal.a + half);
    ctx.strokeStyle = color;
    ctx.lineWidth = 6;
    ctx.stroke();
    const posts = goalPosts(goal, half);
    for (const post of posts) {
      const ox = (post.x / R) * (R + COPA.GOAL_DEPTH);
      const oy = (post.y / R) * (R + COPA.GOAL_DEPTH);
      ctx.beginPath();
      ctx.moveTo(post.x, post.y);
      ctx.lineTo(ox, oy);
      ctx.strokeStyle = color;
      ctx.lineWidth = 6;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(post.x, post.y, COPA.POST_R + 1, 0, TAU);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Cartel con la cara del dueño detrás del arco (derecho en pantalla).
    const lx = Math.cos(goal.a) * (R + COPA.GOAL_DEPTH + 24);
    const ly = Math.sin(goal.a) * (R + COPA.GOAL_DEPTH + 24);
    ctx.save();
    ctx.translate(lx, ly);
    ctx.rotate(-rot);
    ctx.beginPath();
    ctx.arc(0, 0, 18, 0, TAU);
    ctx.fillStyle = practice ? '#1f2937' : `hsl(${hue} 70% 32%)`;
    ctx.fill();
    ctx.strokeStyle = isMine ? '#fde047' : color;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.font = '20px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(practice ? '🥅' : p?.avatar.face ?? '🙂', 0, 1);
    ctx.restore();
  }

  /* ── posiciones suavizadas ── */
  const elapsed = Math.max(0, Math.min(0.12, (now - v.t) / 1000));
  const k = Math.min(1, dt * 20);
  const follow = (key: string, x: number, y: number, vx: number, vy: number): Smooth => {
    const tx = x + vx * elapsed;
    const ty = y + vy * elapsed;
    let sm = smooth.get(key);
    if (!sm || Math.hypot(tx - sm.x, ty - sm.y) > 90) {
      sm = { x: tx, y: ty };
      smooth.set(key, sm);
    } else {
      sm.x += (tx - sm.x) * k;
      sm.y += (ty - sm.y) * k;
    }
    return sm;
  };

  /* ── fichas ── */
  const present = new Set<string>();
  const me = v.players.find((p) => p.playerId === meId);
  const ready = !!me?.alive && v.stage === 'live' && now >= me.readyAt;
  for (const puck of v.pucks) {
    const key = `${puck.owner}:${puck.i}`;
    present.add(key);
    const sm = follow(key, puck.x, puck.y, puck.vx, puck.vy);
    const p = players.get(puck.owner);
    const isMine = puck.owner === meId;
    drawPuck(ctx, sm.x, sm.y, p, isMine, rot, now);

    if (isMine && me?.alive && v.stage === 'live') {
      const cd = Math.max(0, Math.min(1, (me.readyAt - now) / COPA.COOLDOWN));
      if (cd > 0) {
        // Anillo de recarga.
        ctx.beginPath();
        ctx.arc(sm.x, sm.y, COPA.PUCK_R + 6, -Math.PI / 2 - rot, -Math.PI / 2 - rot + TAU * (1 - cd));
        ctx.strokeStyle = denied ? '#ff4d6d' : 'rgba(255,255,255,0.7)';
        ctx.lineWidth = 3;
        ctx.stroke();
      } else if (ready && (!drag || drag.i !== puck.i)) {
        const pulse = 0.5 + 0.5 * Math.sin(now / 160 + puck.i);
        ctx.beginPath();
        ctx.arc(sm.x, sm.y, COPA.PUCK_R + 5 + pulse * 3, 0, TAU);
        ctx.strokeStyle = `rgba(253, 224, 71, ${0.45 + pulse * 0.45})`;
        ctx.lineWidth = 3;
        ctx.stroke();
      }
    }
  }
  for (const key of smooth.keys()) if (key !== 'ball' && !present.has(key)) smooth.delete(key);

  /* ── apuntado (gomera) ── */
  if (drag) {
    const sm = smooth.get(`${meId}:${drag.i}`);
    const shot = launchVector(drag, sm);
    if (sm) {
      // Elástico desde la ficha hasta el dedo.
      ctx.beginPath();
      ctx.moveTo(sm.x, sm.y);
      ctx.lineTo(drag.px, drag.py);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 6]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (sm && shot) {
      const hue = 120 - shot.power * 120;
      const len = 60 + shot.power * 230;
      const ux = shot.dx / Math.hypot(shot.dx, shot.dy);
      const uy = shot.dy / Math.hypot(shot.dx, shot.dy);
      const ex = sm.x + ux * len;
      const ey = sm.y + uy * len;
      // Puntos de la trayectoria.
      for (let t = 0.12; t <= 1; t += 0.11) {
        ctx.beginPath();
        ctx.arc(sm.x + ux * len * t, sm.y + uy * len * t, 3.2 + t * 2, 0, TAU);
        ctx.fillStyle = `hsla(${hue} 95% 60% / ${0.35 + t * 0.55})`;
        ctx.fill();
      }
      ctx.beginPath();
      ctx.moveTo(ex + ux * 16, ey + uy * 16);
      ctx.lineTo(ex - uy * 11, ey + ux * 11);
      ctx.lineTo(ex + uy * 11, ey - ux * 11);
      ctx.closePath();
      ctx.fillStyle = `hsl(${hue} 95% 60%)`;
      ctx.fill();
      // Potencia en texto, derecho en pantalla.
      ctx.save();
      ctx.translate(sm.x, sm.y - COPA.PUCK_R - 18);
      ctx.rotate(-rot);
      ctx.font = '900 16px Outfit, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = `hsl(${hue} 95% 70%)`;
      ctx.fillText(`${Math.round(shot.power * 100)}%`, 0, 0);
      ctx.restore();
    }
  }

  /* ── pelota ── */
  const b = follow('ball', v.ball.x, v.ball.y, v.stage === 'goal' ? 0 : v.ball.vx, v.stage === 'goal' ? 0 : v.ball.vy);
  const moved = Math.hypot(b.x - roll.x, b.y - roll.y);
  roll.angle += moved / COPA.BALL_R;
  roll.x = b.x;
  roll.y = b.y;
  drawBall(ctx, b.x, b.y, roll.angle);

  /* ── efectos de anillo ── */
  for (const fx of v.fx) {
    const age = (now - fx.at) / 1000;
    if (age < 0 || age > 0.45) continue;
    if (fx.kind !== 'kick' && fx.kind !== 'post' && fx.kind !== 'flick') continue;
    const t = age / 0.45;
    ctx.beginPath();
    ctx.arc(fx.x, fx.y, 14 + t * (30 + fx.power * 40), 0, TAU);
    ctx.strokeStyle = fx.kind === 'flick' ? `rgba(255,255,255,${(1 - t) * 0.5})` : `rgba(253, 224, 71, ${1 - t})`;
    ctx.lineWidth = 4 * (1 - t);
    ctx.stroke();
  }

  /* ── partículas ── */
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) {
      particles.splice(i, 1);
      continue;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= Math.pow(0.08, dt);
    p.vy *= Math.pow(0.08, dt);
    ctx.globalAlpha = Math.max(0, p.life / p.max);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;
}

function drawPuck(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  p: PlayerPublic | undefined,
  isMine: boolean,
  rot: number,
  now: number,
): void {
  const r = COPA.PUCK_R;
  const hue = p?.avatar.hue ?? 200;

  // Sombra.
  ctx.beginPath();
  ctx.ellipse(x + 4, y + 6, r, r * 0.92, 0, 0, TAU);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fill();

  // Canto de la ficha (grosor).
  ctx.beginPath();
  ctx.arc(x, y + 3, r, 0, TAU);
  ctx.fillStyle = `hsl(${hue} 65% 28%)`;
  ctx.fill();

  // Cara superior.
  const grad = ctx.createRadialGradient(x - r * 0.35, y - r * 0.45, r * 0.1, x, y, r);
  grad.addColorStop(0, `hsl(${hue} 85% 72%)`);
  grad.addColorStop(1, `hsl(${hue} 75% 46%)`);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.lineWidth = isMine ? 3 : 2;
  ctx.strokeStyle = isMine ? '#fde047' : 'rgba(255,255,255,0.75)';
  ctx.stroke();

  // Botón central con la cara.
  ctx.beginPath();
  ctx.arc(x, y, r * 0.62, 0, TAU);
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fill();
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-rot);
  ctx.font = `${Math.round(r * 0.9)}px serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(p?.avatar.face ?? '🙂', 0, 1.5);
  ctx.restore();

  // Brillo.
  ctx.beginPath();
  ctx.ellipse(x - r * 0.35, y - r * 0.55, r * 0.32, r * 0.14, -0.5, 0, TAU);
  ctx.fillStyle = `rgba(255,255,255,${0.35 + 0.05 * Math.sin(now / 400)})`;
  ctx.fill();
}

function drawBall(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number): void {
  const r = COPA.BALL_R;
  ctx.beginPath();
  ctx.ellipse(x + 3, y + 5, r, r * 0.9, 0, 0, TAU);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.clip();
  // Pentágonos negros que giran con la rodada.
  ctx.fillStyle = '#111827';
  ctx.translate(x, y);
  ctx.rotate(angle);
  pentagon(ctx, 0, 0, r * 0.38);
  for (let i = 0; i < 5; i++) {
    const a = (i * TAU) / 5 - Math.PI / 2;
    pentagon(ctx, Math.cos(a) * r * 0.95, Math.sin(a) * r * 0.95, r * 0.3);
  }
  ctx.restore();

  const shine = ctx.createRadialGradient(x - r * 0.4, y - r * 0.5, 1, x, y, r);
  shine.addColorStop(0, 'rgba(255,255,255,0.7)');
  shine.addColorStop(0.5, 'rgba(255,255,255,0)');
  shine.addColorStop(1, 'rgba(0,0,0,0.25)');
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fillStyle = shine;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

function pentagon(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = (i * TAU) / 5 - Math.PI / 2;
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}
