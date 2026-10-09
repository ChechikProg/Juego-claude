import { useEffect, useMemo, useRef } from 'react';
import { TANK, TANK_H, TANK_W, buildMaze, stepBullet, type Wall } from '@shared/tanque';
import type { PlayerPublic, TankPublic, TanqueView } from '@shared/types';
import { api, serverNow } from '@/net/socket';
import { useCountdown, useRaf, useSize } from '@/lib/hooks';
import { sfx } from '@/lib/sfx';
import { usePlayerMap, useStore } from '@/state/store';
import { Avatar, RankBadge, Timer } from '@/components/ui';

const TAU = Math.PI * 2;
const AIM_EVERY = 50;

interface Smooth {
  x: number;
  y: number;
  a: number;
  ta: number;
  /** avance acumulado para animar las orugas */
  tread: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
}

interface Scorch {
  x: number;
  y: number;
  at: number;
}

export function Tanque({ view }: { view: TanqueView }): JSX.Element {
  const players = usePlayerMap();
  const meId = useStore((s) => s.playerId);
  const [wrapRef, size] = useSize<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const snap = useRef(view);
  snap.current = view;

  const walls = useMemo(() => buildMaze(view.seed), [view.seed]);
  const smooth = useRef(new Map<string, Smooth>());
  const particles = useRef<Particle[]>([]);
  const scorches = useRef<Scorch[]>([]);
  const seenFx = useRef(new Set<number>());
  const shake = useRef(0);

  /** ángulo de la torreta local, para que apuntar no tenga lag */
  const myAim = useRef<number | null>(null);
  const lastAimSent = useRef(0);
  const keys = useRef({ up: false, down: false, left: false, right: false });
  const sentInput = useRef('0:0');
  const firing = useRef(false);
  const lastFire = useRef(0);

  const live = view.stage === 'live';
  const countdown = useCountdown(view.stage === 'countdown' ? view.until : null, 10);
  const left = useCountdown(live ? view.until : null, 4);
  const me = view.tanks.find((t) => t.playerId === meId);
  const respawnIn = useCountdown(me && !me.alive ? me.respawnAt : null, 10);

  /* ── efectos nuevos: sonido y partículas ─────────────────────────────── */
  useEffect(() => {
    for (const fx of view.fx) {
      if (seenFx.current.has(fx.id)) continue;
      seenFx.current.add(fx.id);
      if (fx.kind === 'shot') {
        if (fx.playerId === meId) sfx.shoot();
        burst(particles.current, fx.x, fx.y, 6, ['#fff3b0', '#ffc93c'], 90, 0.18);
      } else if (fx.kind === 'boom') {
        sfx.boom();
        const p = fx.playerId ? players.get(fx.playerId) : null;
        const hull = `hsl(${p?.avatar.hue ?? 30} 70% 55%)`;
        burst(particles.current, fx.x, fx.y, 34, ['#ffe066', '#ff8a3d', '#ff4d6d', hull, '#3b3b48'], 260, 0.8);
        scorches.current.push({ x: fx.x, y: fx.y, at: fx.at });
        if (scorches.current.length > 24) scorches.current.shift();
        shake.current = fx.playerId === meId ? 14 : 6;
      } else if (fx.kind === 'spawn') {
        if (fx.playerId === meId) sfx.spawn();
      } else if (fx.kind === 'bounce') {
        sfx.bounce();
        burst(particles.current, fx.x, fx.y, 3, ['#ffffff', '#c8f560'], 60, 0.15);
      }
    }
    if (seenFx.current.size > 400) seenFx.current = new Set(view.fx.map((f) => f.id));
  }, [view.fx, meId, players]);

  /* ── teclado ──────────────────────────────────────────────────────────── */
  const syncInput = () => {
    const k = keys.current;
    const move = (k.up ? 1 : 0) - (k.down ? 1 : 0);
    const turn = (k.right ? 1 : 0) - (k.left ? 1 : 0);
    const key = `${move}:${turn}`;
    if (key === sentInput.current) return;
    sentInput.current = key;
    api.send('input', { move, turn });
  };

  const setKey = (k: keyof typeof keys.current, down: boolean) => {
    if (keys.current[k] === down) return;
    keys.current[k] = down;
    syncInput();
  };

  useEffect(() => {
    const map: Record<string, keyof typeof keys.current> = {
      ArrowUp: 'up', KeyW: 'up',
      ArrowDown: 'down', KeyS: 'down',
      ArrowLeft: 'left', KeyA: 'left',
      ArrowRight: 'right', KeyD: 'right',
    };
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      const k = map[e.code];
      if (k) {
        e.preventDefault();
        setKey(k, true);
      } else if (e.code === 'Space' || e.code === 'KeyJ') {
        e.preventDefault();
        if (!e.repeat) fireNow();
        firing.current = true;
      }
    };
    const up = (e: KeyboardEvent) => {
      const k = map[e.code];
      if (k) setKey(k, false);
      else if (e.code === 'Space' || e.code === 'KeyJ') firing.current = false;
    };
    const blur = () => {
      keys.current = { up: false, down: false, left: false, right: false };
      firing.current = false;
      syncInput();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      blur();
    };
  }, []);

  const fireNow = () => {
    const v = snap.current;
    if (v.stage !== 'live') return;
    const mine = v.tanks.find((t) => t.playerId === meId);
    if (!mine?.alive) return;
    const now = serverNow();
    if (now - lastFire.current < TANK.COOLDOWN * 0.9) return;
    lastFire.current = now;
    api.send('fire');
  };

  /* ── mouse / toque: apuntar ──────────────────────────────────────────── */
  const scale = size.w ? Math.min(size.w / TANK_W, size.h / TANK_H) : 0;
  const cw = Math.round(TANK_W * scale);
  const ch = Math.round(TANK_H * scale);

  const aimAt = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    const mine = meId ? smooth.current.get(meId) : undefined;
    if (!canvas || !mine || !scale) return;
    const rect = canvas.getBoundingClientRect();
    const wx = (clientX - rect.left) / scale;
    const wy = (clientY - rect.top) / scale;
    const a = Math.atan2(wy - mine.y, wx - mine.x);
    myAim.current = a;
    const now = performance.now();
    if (now - lastAimSent.current >= AIM_EVERY) {
      lastAimSent.current = now;
      api.send('aim', { a: Math.round(a * 1000) / 1000 });
    }
  };

  const sendAimNow = () => {
    if (myAim.current === null) return;
    lastAimSent.current = performance.now();
    api.send('aim', { a: Math.round(myAim.current * 1000) / 1000 });
  };

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

  /** capa fija del laberinto, se dibuja una vez por tamaño */
  const floorLayer = useMemo(() => {
    if (!cw) return null;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const c = document.createElement('canvas');
    c.width = cw * dpr;
    c.height = ch * dpr;
    const g = c.getContext('2d');
    if (!g) return null;
    g.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    paintArena(g, walls);
    return c;
  }, [walls, cw, ch, scale]);

  useRaf((dt) => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx || !cw) return;

    // Disparo sostenido.
    if (firing.current) fireNow();

    paint(ctx, {
      v: snap.current,
      walls,
      floor: floorLayer,
      smooth: smooth.current,
      particles: particles.current,
      scorches: scorches.current,
      players,
      meId,
      myAim: myAim.current,
      dt,
      shake,
    });
  });

  const ranking = [...view.tanks].sort((a, b) => b.score - a.score || b.kills - a.kills);
  const reloadPct = me ? Math.max(0, Math.min(1, 1 - (me.readyAt - serverNow()) / TANK.COOLDOWN)) : 1;

  return (
    <div className="tq">
      <header className="tq__top">
        <span className="chip">💥 Todos contra todos</span>
        {me && (
          <div className="tq__stats">
            <span className="tq__stat">
              <span className="label">Puntos</span>
              <strong className={`tnum ${me.score < 0 ? 'tq__neg' : ''}`}>{me.score}</strong>
            </span>
            <span className="tq__stat">
              <span className="label">Bajas</span>
              <strong className="tnum">{me.kills}</strong>
            </span>
            <span className="tq__stat">
              <span className="label">Muertes</span>
              <strong className="tnum">{me.deaths}</strong>
            </span>
          </div>
        )}
        {live && <Timer ms={left} urgentAt={20_000} />}
      </header>

      <div className="tq__body">
        <div className="tq__stage" ref={wrapRef}>
          <canvas
            ref={canvasRef}
            className="tq__canvas"
            onPointerMove={(e) => {
              if (e.pointerType === 'mouse') aimAt(e.clientX, e.clientY);
            }}
            onPointerDown={(e) => {
              e.preventDefault();
              aimAt(e.clientX, e.clientY);
              sendAimNow();
              fireNow();
              if (e.pointerType === 'mouse') firing.current = true;
            }}
            onPointerUp={() => (firing.current = false)}
            onPointerLeave={() => (firing.current = false)}
            onContextMenu={(e) => e.preventDefault()}
          />

          {view.stage === 'countdown' && (
            <div className="sm__overlay">
              <div className="sm__count anim-pop" key={Math.ceil(countdown / 1000)}>
                {Math.max(1, Math.ceil(countdown / 1000))}
              </div>
              <p className="sm__ready">Cargando munición</p>
            </div>
          )}

          {live && me && !me.alive && (
            <div className="tq__dead anim-fade">
              <span>💀 Te volaron</span>
              <b className="tnum">Volvés en {Math.max(1, Math.ceil(respawnIn / 1000))}</b>
            </div>
          )}

          <ul className="tq__feed" aria-live="polite">
            {view.feed.map((k) => {
              const killer = players.get(k.killer);
              const victim = players.get(k.victim);
              const self = k.killer === k.victim;
              return (
                <li key={k.id} className={`tq__kill anim-fade ${k.killer === meId || k.victim === meId ? 'tq__kill--me' : ''}`}>
                  {self ? (
                    <>
                      <b>{victim?.name ?? '—'}</b> se voló solo 🤦
                    </>
                  ) : (
                    <>
                      <b>{killer?.name ?? '—'}</b> 💥 <b>{victim?.name ?? '—'}</b>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        <aside className="tq__side panel">
          <h3 className="card__title">Tabla</h3>
          <ol className="plist">
            {ranking.map((row, i) => {
              const p = players.get(row.playerId);
              if (!p) return null;
              return (
                <li key={row.playerId} className={`prow ${row.playerId === meId ? 'prow--me' : ''}`}>
                  <RankBadge rank={i + 1} />
                  <span className="tq__swatch" style={{ background: `hsl(${p.avatar.hue} 70% 55%)` }} />
                  <Avatar avatar={p.avatar} size={24} offline={!p.connected} />
                  <span className="grow prow__name">{p.name}</span>
                  {!row.alive && <span aria-label="muerto">💀</span>}
                  <span className={`prow__score tnum ${row.score < 0 ? 'tq__neg' : ''}`}>{row.score}</span>
                </li>
              );
            })}
          </ol>
          <div className="tq__reload">
            <span className="label">Recarga</span>
            <div className="tq__reloadbar">
              <div className="tq__reloadfill" style={{ width: `${reloadPct * 100}%` }} />
            </div>
          </div>
          <p className="hint tq__help">WASD / flechas para moverte · mouse para apuntar · click o espacio para disparar</p>
        </aside>
      </div>

      <footer className="tq__controls">
        <div className="tq__pad">
          {(
            [
              ['up', '▲'],
              ['left', '◀'],
              ['down', '▼'],
              ['right', '▶'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              className={`tq__btn tq__btn--${k}`}
              disabled={!live}
              onPointerDown={(e) => {
                e.preventDefault();
                setKey(k, true);
              }}
              onPointerUp={() => setKey(k, false)}
              onPointerLeave={() => setKey(k, false)}
              onPointerCancel={() => setKey(k, false)}
              aria-label={k}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          className="tq__fire"
          disabled={!live}
          onPointerDown={(e) => {
            e.preventDefault();
            fireNow();
          }}
        >
          <b>FUEGO</b>
          <span>tocá el mapa para apuntar</span>
        </button>
      </footer>
    </div>
  );
}

/* ── partículas ───────────────────────────────────────────────────────────── */

function burst(list: Particle[], x: number, y: number, n: number, colors: string[], speed: number, life: number): void {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU;
    const v = speed * (0.3 + Math.random() * 0.7);
    const l = life * (0.5 + Math.random() * 0.6);
    list.push({
      x,
      y,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v,
      life: l,
      max: l,
      size: 2 + Math.random() * 4,
      color: colors[Math.floor(Math.random() * colors.length)],
    });
  }
  if (list.length > 400) list.splice(0, list.length - 400);
}

/* ── dibujo ───────────────────────────────────────────────────────────────── */

function paintArena(g: CanvasRenderingContext2D, walls: Wall[]): void {
  const floor = g.createLinearGradient(0, 0, TANK_W, TANK_H);
  floor.addColorStop(0, '#1e2a24');
  floor.addColorStop(1, '#141d1a');
  g.fillStyle = floor;
  g.fillRect(0, 0, TANK_W, TANK_H);

  // Baldosas: un damero muy suave por celda.
  for (let r = 0; r < TANK.ROWS; r++) {
    for (let c = 0; c < TANK.COLS; c++) {
      if ((r + c) % 2) {
        g.fillStyle = 'rgba(255,255,255,0.025)';
        g.fillRect(c * TANK.CELL, r * TANK.CELL, TANK.CELL, TANK.CELL);
      }
      g.fillStyle = 'rgba(163, 230, 53, 0.06)';
      g.beginPath();
      g.arc((c + 0.5) * TANK.CELL, (r + 0.5) * TANK.CELL, 2.5, 0, TAU);
      g.fill();
    }
  }

  // Sombras de las paredes.
  g.fillStyle = 'rgba(0,0,0,0.38)';
  for (const [x, y, w, h] of walls) roundRect(g, x + 4, y + 6, w, h, 4, true);

  // Paredes con bisel.
  for (const [x, y, w, h] of walls) {
    const grad = g.createLinearGradient(x, y, x, y + h);
    grad.addColorStop(0, '#5d6b7f');
    grad.addColorStop(1, '#3a4556');
    g.fillStyle = grad;
    roundRect(g, x, y, w, h, 4, true);
    g.fillStyle = 'rgba(255,255,255,0.16)';
    roundRect(g, x + 1.5, y + 1.5, w - 3, Math.min(3, h - 3), 2, true);
  }

  // Borde exterior con brillo de acento.
  g.strokeStyle = 'rgba(163, 230, 53, 0.35)';
  g.lineWidth = 2;
  g.strokeRect(1, 1, TANK_W - 2, TANK_H - 2);
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, fill: boolean): void {
  const rr = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
  if (fill) g.fill();
}

function lerpAngle(a: number, b: number, k: number): number {
  const d = ((b - a + Math.PI) % TAU + TAU) % TAU - Math.PI;
  return a + d * k;
}

interface PaintArgs {
  v: TanqueView;
  walls: Wall[];
  floor: HTMLCanvasElement | null;
  smooth: Map<string, Smooth>;
  particles: Particle[];
  scorches: Scorch[];
  players: Map<string, PlayerPublic>;
  meId: string | null;
  myAim: number | null;
  dt: number;
  shake: React.MutableRefObject<number>;
}

function paint(ctx: CanvasRenderingContext2D, a: PaintArgs): void {
  const { v, walls, floor, smooth, particles, scorches, players, meId, myAim, dt, shake } = a;
  const now = serverNow();

  ctx.save();
  if (shake.current > 0.2) {
    ctx.translate((Math.random() - 0.5) * shake.current, (Math.random() - 0.5) * shake.current);
    shake.current *= Math.pow(0.002, dt);
  }

  if (floor) {
    // La capa fija ya tiene el dpr y la escala aplicados: la pegamos 1:1 en píxeles.
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(floor, 0, 0);
    ctx.restore();
  } else {
    paintArena(ctx, walls);
  }

  /* marcas de explosiones */
  for (const s of scorches) {
    const age = (now - s.at) / 1000;
    const alpha = Math.max(0, 0.45 - age * 0.02);
    if (alpha <= 0) continue;
    const g = ctx.createRadialGradient(s.x, s.y, 2, s.x, s.y, 26);
    g.addColorStop(0, `rgba(0,0,0,${alpha})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 26, 0, TAU);
    ctx.fill();
  }

  /* tanques */
  for (const t of v.tanks) {
    let sm = smooth.get(t.playerId);
    if (!sm) {
      sm = { x: t.x, y: t.y, a: t.a, ta: t.ta, tread: 0 };
      smooth.set(t.playerId, sm);
    }
    const k = Math.min(1, dt * 18);
    const jump = Math.hypot(t.x - sm.x, t.y - sm.y) > 120;
    const px = sm.x;
    const py = sm.y;
    if (jump) {
      sm.x = t.x;
      sm.y = t.y;
      sm.a = t.a;
    } else {
      sm.x += (t.x - sm.x) * k;
      sm.y += (t.y - sm.y) * k;
      sm.a = lerpAngle(sm.a, t.a, k);
    }
    const isMe = t.playerId === meId;
    sm.ta = isMe && myAim !== null ? myAim : lerpAngle(sm.ta, t.ta, k);
    // Las orugas avanzan con la distancia recorrida, en la dirección del casco.
    sm.tread += ((sm.x - px) * Math.cos(sm.a) + (sm.y - py) * Math.sin(sm.a)) * 0.6;

    if (!t.alive) continue;
    drawTank(ctx, t, sm, players.get(t.playerId), isMe, now);
  }

  /* balas, predichas desde el snapshot con la misma física del servidor */
  const elapsed = Math.max(0, Math.min(0.25, (now - v.t) / 1000));
  const steps = Math.ceil(elapsed / TANK.BULLET_STEP);
  for (const b of v.bullets) {
    const p = { x: b.x, y: b.y, vx: b.vx, vy: b.vy };
    for (let i = 0; i < steps; i++) stepBullet(p, elapsed / steps, walls);
    const owner = players.get(b.owner);
    const sp = Math.hypot(p.vx, p.vy) || 1;
    ctx.strokeStyle = `hsla(${owner?.avatar.hue ?? 60} 90% 70% / 0.45)`;
    ctx.lineWidth = TANK.BULLET_R * 1.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x - (p.vx / sp) * 14, p.y - (p.vy / sp) * 14);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(p.x, p.y, TANK.BULLET_R, 0, TAU);
    ctx.fillStyle = '#fffbe6';
    ctx.shadowColor = `hsl(${owner?.avatar.hue ?? 60} 95% 65%)`;
    ctx.shadowBlur = 10;
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  /* efectos de anillo */
  for (const fx of v.fx) {
    const age = (now - fx.at) / 1000;
    if (fx.kind === 'boom' && age >= 0 && age < 0.5) {
      const t = age / 0.5;
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, 10 + t * 46, 0, TAU);
      ctx.lineWidth = 7 * (1 - t);
      ctx.strokeStyle = `rgba(255, 200, 90, ${1 - t})`;
      ctx.stroke();
      const g = ctx.createRadialGradient(fx.x, fx.y, 0, fx.x, fx.y, 34 * (1 - t * 0.5));
      g.addColorStop(0, `rgba(255, 250, 200, ${0.9 * (1 - t)})`);
      g.addColorStop(1, 'rgba(255, 120, 40, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, 34, 0, TAU);
      ctx.fill();
    } else if (fx.kind === 'spawn' && age >= 0 && age < 0.7) {
      const t = age / 0.7;
      const p = fx.playerId ? players.get(fx.playerId) : null;
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, 40 * (1 - t) + 14, 0, TAU);
      ctx.lineWidth = 3;
      ctx.strokeStyle = `hsla(${p?.avatar.hue ?? 120} 90% 65% / ${1 - t})`;
      ctx.stroke();
    }
  }

  /* partículas */
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) {
      particles.splice(i, 1);
      continue;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= Math.pow(0.04, dt);
    p.vy *= Math.pow(0.04, dt);
    ctx.globalAlpha = Math.max(0, p.life / p.max);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;

  /* nombres arriba de todo */
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const t of v.tanks) {
    if (!t.alive) continue;
    const sm = smooth.get(t.playerId);
    const p = players.get(t.playerId);
    if (!sm) continue;
    const isMe = t.playerId === meId;
    ctx.font = '800 12px Outfit, sans-serif';
    const label = isMe ? 'VOS' : short(p?.name ?? '—');
    const w = ctx.measureText(label).width + 12;
    ctx.fillStyle = 'rgba(8, 10, 14, 0.7)';
    roundRect(ctx, sm.x - w / 2, sm.y - TANK.TANK_R - 25, w, 16, 8, true);
    ctx.fillStyle = isMe ? '#d9f99d' : '#ffffff';
    ctx.fillText(label, sm.x, sm.y - TANK.TANK_R - 16.5);
  }

  ctx.restore();
}

function drawTank(
  ctx: CanvasRenderingContext2D,
  t: TankPublic,
  sm: Smooth,
  p: PlayerPublic | undefined,
  isMe: boolean,
  now: number,
): void {
  const hue = p?.avatar.hue ?? 120;
  const R = TANK.TANK_R;
  const shielded = now < t.shieldUntil;

  ctx.save();
  ctx.translate(sm.x, sm.y);

  /* escudo de reaparición */
  if (shielded) {
    const pulse = 0.5 + 0.5 * Math.sin(now / 80);
    ctx.beginPath();
    ctx.arc(0, 0, R + 7, 0, TAU);
    ctx.strokeStyle = `hsla(${hue} 90% 70% / ${0.35 + pulse * 0.45})`;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.globalAlpha = 0.55 + pulse * 0.35;
  }

  /* sombra */
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(3, 5, R * 1.15, R * 0.95, sm.a, 0, TAU);
  ctx.fill();

  /* casco + orugas */
  ctx.save();
  ctx.rotate(sm.a);
  const L = R * 2.1;
  const W = R * 1.75;
  // orugas
  ctx.fillStyle = '#1b1d24';
  roundRect(ctx, -L / 2, -W / 2 - 1, L, 7, 3, true);
  roundRect(ctx, -L / 2, W / 2 - 6, L, 7, 3, true);
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  const off = ((sm.tread % 6) + 6) % 6;
  for (let x = -L / 2 + off; x < L / 2 - 1; x += 6) {
    ctx.fillRect(x, -W / 2, 2, 5);
    ctx.fillRect(x, W / 2 - 5, 2, 5);
  }
  // casco
  const hull = ctx.createLinearGradient(0, -W / 2, 0, W / 2);
  hull.addColorStop(0, `hsl(${hue} 72% 62%)`);
  hull.addColorStop(1, `hsl(${hue} 70% 40%)`);
  ctx.fillStyle = hull;
  roundRect(ctx, -L / 2 + 3, -W / 2 + 4, L - 6, W - 8, 5, true);
  ctx.strokeStyle = isMe ? '#d9f99d' : 'rgba(0,0,0,0.45)';
  ctx.lineWidth = isMe ? 2 : 1.2;
  ctx.stroke();
  // faro delantero
  ctx.fillStyle = 'rgba(255,255,220,0.8)';
  ctx.fillRect(L / 2 - 6, -3, 3, 6);
  ctx.restore();

  /* torreta */
  ctx.save();
  ctx.rotate(sm.ta);
  const recoil = Math.max(0, (t.readyAt - now) / TANK.COOLDOWN) * 3.5;
  ctx.fillStyle = '#2a2d36';
  roundRect(ctx, 2 - recoil, -3, R + 9, 6, 2, true);
  ctx.fillStyle = `hsl(${hue} 40% 78%)`;
  ctx.fillRect(R + 6 - recoil, -3.5, 5, 7);
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.62, 0, TAU);
  ctx.fillStyle = `hsl(${hue} 65% 50%)`;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.restore();

  /* cara del jugador en la escotilla */
  ctx.font = `${Math.round(R * 0.85)}px serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(p?.avatar.face ?? '🙂', 0, 1);

  ctx.restore();
}

function short(name: string): string {
  return name.length > 10 ? `${name.slice(0, 9)}…` : name;
}
