import { useEffect, useMemo, useRef } from 'react';
import { CH, CHORI_MAPS, type ChoriMap } from '@shared/chori';
import type { ChoriPlayer, ChoriView, PlayerPublic } from '@shared/types';
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

const EVENT_TEXT: Record<'dog' | 'cart' | 'smoke', string> = {
  dog: '🐕 ¡Ojo que viene el perro!',
  cart: '🛒 ¡Ahí viene el carrito!',
  smoke: '💨 ¡Se viene la humareda!',
};

export function Chori({ view }: { view: ChoriView }): JSX.Element {
  const players = usePlayerMap();
  const meId = useStore((s) => s.playerId);
  const [wrapRef, size] = useSize<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const snap = useRef(view);
  snap.current = view;
  const smooth = useRef(new Map<string, Smooth>());
  const things = useRef({ chori: null as Smooth | null, dog: null as Smooth | null, cart: null as Smooth | null });
  const particles = useRef<Particle[]>([]);
  const seenFx = useRef(new Set<number>());
  const shake = useRef(0);

  const map = CHORI_MAPS[view.map];
  const live = view.stage === 'live';
  const countdown = useCountdown(view.stage === 'countdown' ? view.until : null, 10);
  const left = useCountdown(live ? view.until : null, 4);
  const me = view.players.find((p) => p.playerId === meId) ?? null;
  const holder = view.chori.holder ? players.get(view.chori.holder) : null;
  const iHaveIt = view.chori.holder === meId && !!meId;

  /* ── efectos ──────────────────────────────────────────────────────────── */
  useEffect(() => {
    for (const fx of view.fx) {
      if (seenFx.current.has(fx.id)) continue;
      seenFx.current.add(fx.id);
      if (serverNow() - fx.at > 1200) continue;
      const mine = fx.playerId === meId || fx.by === meId;
      switch (fx.kind) {
        case 'grab':
          if (fx.playerId === meId) sfx.grab();
          burst(particles.current, fx.x, fx.y, 10, ['#fde047', '#fb923c', '#ffffff'], 160, 0.5);
          break;
        case 'steal':
          if (mine) sfx.steal();
          else sfx.clack();
          burst(particles.current, fx.x, fx.y, 14, ['#ffffff', '#fca5a5', '#fde047'], 220, 0.45);
          if (fx.playerId === meId) shake.current = 9;
          break;
        case 'sprint':
          if (fx.playerId === meId) sfx.dash();
          break;
        case 'bump':
          if (fx.playerId === meId) {
            sfx.stomp();
            shake.current = 14;
          }
          burst(particles.current, fx.x, fx.y, 16, ['#e5e7eb', '#a8a29e'], 200, 0.5);
          break;
        case 'dog':
        case 'dogbite':
          sfx.bark();
          break;
        case 'dogdrop':
          if (fx.playerId === meId) sfx.good();
          break;
        case 'cart':
          sfx.honk();
          break;
        case 'smoke':
          sfx.sizzle();
          break;
        case 'run':
          sfx.pick();
          break;
      }
    }
    if (seenFx.current.size > 400) seenFx.current = new Set(view.fx.map((f) => f.id));
  }, [view.fx, meId]);

  /* ── controles: teclado ───────────────────────────────────────────────── */
  const keys = useRef({ up: false, down: false, left: false, right: false });
  const stick = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const sent = useRef('0:0');

  const sync = () => {
    const k = keys.current;
    let x = (k.right ? 1 : 0) - (k.left ? 1 : 0) + stick.current.x;
    let y = (k.down ? 1 : 0) - (k.up ? 1 : 0) + stick.current.y;
    const l = Math.hypot(x, y);
    if (l > 1) {
      x /= l;
      y /= l;
    }
    const key = `${x.toFixed(2)}:${y.toFixed(2)}`;
    if (key === sent.current) return;
    sent.current = key;
    api.send('input', { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 });
  };

  const sprint = () => {
    const v = snap.current;
    const mine = v.players.find((p) => p.playerId === meId);
    if (v.stage !== 'live' || !mine || serverNow() < mine.sprintReadyAt - 80) return;
    api.send('sprint');
  };

  useEffect(() => {
    const map: Record<string, keyof typeof keys.current> = {
      ArrowUp: 'up', KeyW: 'up',
      ArrowDown: 'down', KeyS: 'down',
      ArrowLeft: 'left', KeyA: 'left',
      ArrowRight: 'right', KeyD: 'right',
    };
    const down = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const k = map[e.code];
      if (k) {
        e.preventDefault();
        if (!keys.current[k]) {
          keys.current[k] = true;
          sync();
        }
      } else if (e.code === 'Space' || e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyJ') {
        e.preventDefault();
        if (!e.repeat) sprint();
      }
    };
    const up = (e: KeyboardEvent) => {
      const k = map[e.code];
      if (k && keys.current[k]) {
        keys.current[k] = false;
        sync();
      }
    };
    const blur = () => {
      keys.current = { up: false, down: false, left: false, right: false };
      stick.current = { x: 0, y: 0 };
      sync();
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── controles: joystick táctil (tocás en cualquier lado y arrastrás) ─── */
  const joy = useRef<{ id: number; ox: number; oy: number; x: number; y: number } | null>(null);
  const onDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') return;
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    joy.current = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY };
  };
  const onMove = (e: React.PointerEvent) => {
    const j = joy.current;
    if (!j || j.id !== e.pointerId) return;
    j.x = e.clientX;
    j.y = e.clientY;
    const dx = j.x - j.ox;
    const dy = j.y - j.oy;
    const l = Math.hypot(dx, dy);
    stick.current = l < 8 ? { x: 0, y: 0 } : { x: (dx / l) * Math.min(1, l / 50), y: (dy / l) * Math.min(1, l / 50) };
    sync();
  };
  const onUp = (e: React.PointerEvent) => {
    if (joy.current?.id !== e.pointerId) return;
    joy.current = null;
    stick.current = { x: 0, y: 0 };
    sync();
  };

  /* ── canvas ───────────────────────────────────────────────────────────── */
  const scale = size.w ? Math.min(size.w / CH.W, size.h / CH.H) : 0;
  const cw = Math.round(CH.W * scale);
  const ch = Math.round(CH.H * scale);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !cw) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = cw * dpr;
    canvas.height = ch * dpr;
    canvas.style.width = `${cw}px`;
    canvas.style.height = `${ch}px`;
  }, [cw, ch]);

  const floor = useMemo(() => {
    if (!cw) return null;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const c = document.createElement('canvas');
    c.width = cw * dpr;
    c.height = ch * dpr;
    const g = c.getContext('2d');
    if (!g) return null;
    g.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    paintFloor(g, map, view.map);
    return c;
  }, [map, view.map, cw, ch, scale]);

  useRaf((dt) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas || !cw) return;
    const dpr = canvas.width / cw;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    if (shake.current > 0.3) {
      ctx.translate((Math.random() - 0.5) * shake.current * dpr, (Math.random() - 0.5) * shake.current * dpr);
      shake.current *= Math.pow(0.003, dt);
    }
    if (floor) ctx.drawImage(floor, 0, 0);
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, ctx.getTransform().e, ctx.getTransform().f);
    paint(ctx, {
      v: snap.current,
      map,
      smooth: smooth.current,
      things: things.current,
      particles: particles.current,
      players,
      meId,
      dt,
      scale,
      joy: joy.current,
      canvas,
    });
    ctx.restore();
  });

  const ranking = [...view.players].sort((a, b) => b.held - a.held);
  const sprintPct = me ? Math.max(0, Math.min(1, 1 - (me.sprintReadyAt - serverNow()) / CH.SPRINT_COOLDOWN)) : 1;

  return (
    <div className="ch">
      <header className="ch__top">
        <span className="chip">📍 {map.name}</span>
        <div className={`ch__holder ${iHaveIt ? 'ch__holder--me' : ''}`}>
          <span className="ch__holdericon">🌭</span>
          {iHaveIt ? (
            <b>¡Lo tenés vos! Corré</b>
          ) : holder ? (
            <span>
              Lo tiene <b>{holder.name}</b>
            </span>
          ) : view.chori.dog ? (
            <b>¡Lo tiene el perro!</b>
          ) : view.chori.z < 0 ? (
            <span className="muted">Se lo llevó el perro…</span>
          ) : (
            <b>¡Está en el piso!</b>
          )}
        </div>
        {me && (
          <div className="tq__stat">
            <span className="label">Tus segundos</span>
            <strong className="tnum ch__secs">{(me.held / 1000).toFixed(1)}</strong>
          </div>
        )}
        {live && <Timer ms={left} urgentAt={15_000} />}
      </header>

      <div className="ch__body">
        <div className="ch__stage" ref={wrapRef}>
          <canvas
            ref={canvasRef}
            className="ch__canvas"
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            onContextMenu={(e) => e.preventDefault()}
          />

          {view.event && live && (
            <div className="ch__warn anim-pop" key={view.event.at}>
              {EVENT_TEXT[view.event.kind]}
            </div>
          )}

          {view.stage === 'countdown' && (
            <div className="sm__overlay">
              <div className="sm__count anim-pop" key={Math.ceil(countdown / 1000)}>
                {Math.max(1, Math.ceil(countdown / 1000))}
              </div>
              <p className="sm__ready">Prendiendo la parrilla</p>
            </div>
          )}
        </div>

        <aside className="ch__side panel">
          <h3 className="card__title">Segundos con el chori</h3>
          <ol className="plist">
            {ranking.map((r, i) => {
              const p = players.get(r.playerId);
              if (!p) return null;
              return (
                <li key={r.playerId} className={`prow ${r.playerId === meId ? 'prow--me' : ''}`}>
                  <RankBadge rank={i + 1} />
                  <span className="tq__swatch" style={{ background: `hsl(${p.avatar.hue} 75% 55%)` }} />
                  <Avatar avatar={p.avatar} size={24} offline={!p.connected} />
                  <span className="grow prow__name">{p.name}</span>
                  {view.chori.holder === r.playerId && <span aria-label="lo tiene">🌭</span>}
                  <span className="prow__score tnum">{(r.held / 1000).toFixed(1)}</span>
                </li>
              );
            })}
          </ol>
          <div className="tq__reload">
            <span className="label">Pique</span>
            <div className="tq__reloadbar">
              <div className="tq__reloadfill ch__sprintfill" style={{ width: `${sprintPct * 100}%` }} />
            </div>
          </div>
          <p className="hint ch__help">WASD / flechas para correr · espacio o shift para el pique · chocá al que lo tiene</p>
        </aside>
      </div>

      <footer className="ch__controls">
        <span className="hint">Tocá y arrastrá sobre la cancha para moverte</span>
        <button
          className="ch__sprint"
          disabled={!live}
          onPointerDown={(e) => {
            e.preventDefault();
            sprint();
          }}
        >
          <b>PIQUE</b>
          <span className="ch__sprintbar" style={{ ['--p' as string]: sprintPct }} />
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
    list.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: l, max: l, size: 3 + Math.random() * 4, color: colors[Math.floor(Math.random() * colors.length)] });
  }
  if (list.length > 500) list.splice(0, list.length - 500);
}

/* ── piso y obstáculos (fijo) ─────────────────────────────────────────────── */

function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const k = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + k, y);
  g.arcTo(x + w, y, x + w, y + h, k);
  g.arcTo(x + w, y + h, x, y + h, k);
  g.arcTo(x, y + h, x, y, k);
  g.arcTo(x, y, x + w, y, k);
  g.closePath();
}

function paintFloor(g: CanvasRenderingContext2D, map: ChoriMap, index: number): void {
  const [a, b] = map.floor;
  g.fillStyle = a;
  g.fillRect(0, 0, CH.W, CH.H);
  g.fillStyle = b;
  if (index === 0) {
    // Baldosas del quincho.
    for (let y = 0; y < CH.H; y += 80) for (let x = (y / 80) % 2 ? 0 : 80; x < CH.W; x += 160) g.fillRect(x, y, 80, 80);
    g.strokeStyle = 'rgba(0,0,0,0.12)';
    g.lineWidth = 2;
    for (let x = 0; x <= CH.W; x += 80) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, CH.H);
      g.stroke();
    }
    for (let y = 0; y <= CH.H; y += 80) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(CH.W, y);
      g.stroke();
    }
  } else if (index === 1) {
    // Cancha de fútbol con sus líneas.
    for (let x = 0; x < CH.W; x += 200) g.fillRect(x, 0, 100, CH.H);
    g.strokeStyle = 'rgba(255,255,255,0.55)';
    g.lineWidth = 5;
    g.strokeRect(40, 40, CH.W - 80, CH.H - 80);
    g.beginPath();
    g.moveTo(CH.W / 2, 40);
    g.lineTo(CH.W / 2, CH.H - 40);
    g.stroke();
    g.beginPath();
    g.arc(CH.W / 2, CH.H / 2, 150, 0, TAU);
    g.stroke();
    g.strokeRect(40, CH.H / 2 - 160, 160, 320);
    g.strokeRect(CH.W - 200, CH.H / 2 - 160, 160, 320);
  } else {
    // Adoquines de la plaza.
    g.strokeStyle = 'rgba(0,0,0,0.14)';
    g.lineWidth = 2;
    for (let y = 0; y < CH.H; y += 40) {
      for (let x = (y / 40) % 2 ? -30 : 0; x < CH.W; x += 60) {
        rr(g, x + 2, y + 2, 56, 36, 8);
        g.fillStyle = (x * 7 + y * 3) % 5 === 0 ? b : 'rgba(255,255,255,0.03)';
        g.fill();
        g.stroke();
      }
    }
  }

  // Viñeta.
  const vg = g.createRadialGradient(CH.W / 2, CH.H / 2, CH.H * 0.3, CH.W / 2, CH.H / 2, CH.W * 0.7);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.35)');
  g.fillStyle = vg;
  g.fillRect(0, 0, CH.W, CH.H);

  // Sombras primero, después los objetos.
  g.fillStyle = 'rgba(0,0,0,0.28)';
  for (const o of map.obstacles) {
    if ('r' in o) {
      rr(g, o.r[0] + 6, o.r[1] + 9, o.r[2], o.r[3], 8);
      g.fill();
    } else {
      g.beginPath();
      g.arc(o.c[0] + 6, o.c[1] + 9, o.c[2], 0, TAU);
      g.fill();
    }
  }

  for (const o of map.obstacles) {
    if ('r' in o) {
      const [x, y, w, h] = o.r;
      if (o.kind === 'table') {
        g.fillStyle = '#92400e';
        rr(g, x, y, w, h, 8);
        g.fill();
        // Mantel cuadrillé.
        g.save();
        rr(g, x + 6, y + 6, w - 12, h - 12, 6);
        g.clip();
        g.fillStyle = '#fef2f2';
        g.fillRect(x, y, w, h);
        g.fillStyle = 'rgba(220, 38, 38, 0.75)';
        for (let yy = y; yy < y + h; yy += 18) for (let xx = x + ((yy - y) / 18) % 2 * 18; xx < x + w; xx += 36) g.fillRect(xx, yy, 18, 18);
        g.restore();
        g.font = '22px serif';
        g.fillStyle = '#000';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('🍷', x + w * 0.3, y + h / 2);
        g.fillText('🥖', x + w * 0.7, y + h / 2);
      } else if (o.kind === 'bench') {
        g.fillStyle = '#78350f';
        rr(g, x, y, w, h, 6);
        g.fill();
        g.strokeStyle = '#a16207';
        g.lineWidth = 3;
        const horiz = w > h;
        for (let i = 1; i < 3; i++) {
          g.beginPath();
          if (horiz) {
            g.moveTo(x + 4, y + (h / 3) * i);
            g.lineTo(x + w - 4, y + (h / 3) * i);
          } else {
            g.moveTo(x + (w / 3) * i, y + 4);
            g.lineTo(x + (w / 3) * i, y + h - 4);
          }
          g.stroke();
        }
      } else if (o.kind === 'grill') {
        g.fillStyle = '#292524';
        rr(g, x, y, w, h, 8);
        g.fill();
        const coal = g.createLinearGradient(x, y, x, y + h);
        coal.addColorStop(0, '#f97316');
        coal.addColorStop(1, '#b91c1c');
        g.fillStyle = coal;
        rr(g, x + 8, y + 8, w - 16, h - 16, 4);
        g.fill();
        g.strokeStyle = '#57534e';
        g.lineWidth = 2;
        for (let xx = x + 14; xx < x + w - 8; xx += 10) {
          g.beginPath();
          g.moveTo(xx, y + 6);
          g.lineTo(xx, y + h - 6);
          g.stroke();
        }
        g.fillStyle = '#7c2d12';
        for (let xx = x + 24; xx < x + w - 20; xx += 34) {
          rr(g, xx, y + h / 2 - 6, 26, 12, 6);
          g.fill();
        }
      } else if (o.kind === 'cooler') {
        g.fillStyle = '#2563eb';
        rr(g, x, y, w, h, 8);
        g.fill();
        g.fillStyle = '#f8fafc';
        rr(g, x + 6, y + 6, w - 12, 10, 4);
        g.fill();
      }
    } else {
      const [x, y, r] = o.c;
      if (o.kind === 'tree') {
        g.fillStyle = '#166534';
        g.beginPath();
        g.arc(x, y, r, 0, TAU);
        g.fill();
        g.fillStyle = '#15803d';
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * TAU;
          g.beginPath();
          g.arc(x + Math.cos(a) * r * 0.45, y + Math.sin(a) * r * 0.45, r * 0.5, 0, TAU);
          g.fill();
        }
        g.fillStyle = 'rgba(255,255,255,0.12)';
        g.beginPath();
        g.arc(x - r * 0.3, y - r * 0.3, r * 0.4, 0, TAU);
        g.fill();
      } else if (o.kind === 'chair') {
        g.fillStyle = '#a16207';
        g.beginPath();
        g.arc(x, y, r, 0, TAU);
        g.fill();
        g.strokeStyle = '#713f12';
        g.lineWidth = 3;
        g.stroke();
      } else if (o.kind === 'round') {
        g.fillStyle = '#92400e';
        g.beginPath();
        g.arc(x, y, r, 0, TAU);
        g.fill();
        g.fillStyle = '#fefce8';
        g.beginPath();
        g.arc(x, y, r - 7, 0, TAU);
        g.fill();
        g.font = '26px serif';
        g.fillStyle = '#000';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('🥗', x, y);
      } else if (o.kind === 'fountain') {
        g.fillStyle = '#d6d3d1';
        g.beginPath();
        g.arc(x, y, r, 0, TAU);
        g.fill();
        g.fillStyle = '#38bdf8';
        g.beginPath();
        g.arc(x, y, r - 14, 0, TAU);
        g.fill();
        g.fillStyle = '#a8a29e';
        g.beginPath();
        g.arc(x, y, 22, 0, TAU);
        g.fill();
      } else if (o.kind === 'barrel') {
        g.fillStyle = '#7c2d12';
        g.beginPath();
        g.arc(x, y, r, 0, TAU);
        g.fill();
        g.strokeStyle = '#44403c';
        g.lineWidth = 4;
        g.beginPath();
        g.arc(x, y, r - 7, 0, TAU);
        g.stroke();
      }
    }
  }
}

/* ── lo que se mueve ──────────────────────────────────────────────────────── */

interface PaintArgs {
  v: ChoriView;
  map: ChoriMap;
  smooth: Map<string, Smooth>;
  things: { chori: Smooth | null; dog: Smooth | null; cart: Smooth | null };
  particles: Particle[];
  players: Map<string, PlayerPublic>;
  meId: string | null;
  dt: number;
  scale: number;
  joy: { ox: number; oy: number; x: number; y: number } | null;
  canvas: HTMLCanvasElement;
}

function follow(s: Smooth | null, x: number, y: number, vx: number, vy: number, elapsed: number, dt: number): Smooth {
  const tx = x + vx * elapsed;
  const ty = y + vy * elapsed;
  if (!s || Math.hypot(s.x - tx, s.y - ty) > 200) return { x: tx, y: ty };
  const k = Math.min(1, dt * 18);
  s.x += (tx - s.x) * k;
  s.y += (ty - s.y) * k;
  return s;
}

function paint(ctx: CanvasRenderingContext2D, a: PaintArgs): void {
  const { v, map, smooth, things, particles, players, meId, dt, scale, joy, canvas } = a;
  const now = serverNow();
  const elapsed = Math.max(0, Math.min(0.1, (now - v.t) / 1000));

  // Humo de las parrillas siempre, chiquito.
  for (const o of map.obstacles) {
    if (o.kind !== 'grill' || !('r' in o) || Math.random() > 0.25) continue;
    particles.push({
      x: o.r[0] + Math.random() * o.r[2],
      y: o.r[1] + o.r[3] / 2,
      vx: (Math.random() - 0.5) * 20,
      vy: -30 - Math.random() * 30,
      life: 1.4,
      max: 1.4,
      size: 8 + Math.random() * 10,
      color: 'rgba(230,230,230,0.35)',
    });
  }

  /* jugadores */
  const ordered = [...v.players].sort((x, y) => (x.playerId === meId ? 1 : 0) - (y.playerId === meId ? 1 : 0));
  for (const p of ordered) {
    const s = follow(smooth.get(p.playerId) ?? null, p.x, p.y, p.vx, p.vy, elapsed, dt);
    smooth.set(p.playerId, s);
    drawRunner(ctx, p, s, players.get(p.playerId), p.playerId === meId, v.chori.holder === p.playerId, now);
  }

  /* chori en el piso */
  const c = v.chori;
  if (!c.holder && !c.dog && c.z >= 0) {
    things.chori = follow(things.chori, c.x, c.y, c.vx, c.vy, elapsed, dt);
    const s = things.chori;
    const pulse = 0.5 + 0.5 * Math.sin(now / 160);
    const glow = ctx.createRadialGradient(s.x, s.y, 4, s.x, s.y, 44);
    glow.addColorStop(0, `rgba(253, 224, 71, ${0.55 + pulse * 0.3})`);
    glow.addColorStop(1, 'rgba(253, 224, 71, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 44, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(s.x, s.y + 10, 16, 6, 0, 0, TAU);
    ctx.fill();
    ctx.font = '34px serif';
    ctx.fillStyle = '#000';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.save();
    ctx.translate(s.x, s.y - c.z - 4 - pulse * 3);
    ctx.rotate(Math.sin(now / 300) * 0.2);
    ctx.fillText('🌭', 0, 0);
    ctx.restore();
  } else {
    things.chori = null;
  }

  /* perro */
  if (v.dog) {
    things.dog = follow(things.dog, v.dog.x, v.dog.y, v.dog.vx, v.dog.vy, elapsed, dt);
    const s = things.dog;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(s.x, s.y + 14, 20, 7, 0, 0, TAU);
    ctx.fill();
    ctx.save();
    ctx.translate(s.x, s.y + Math.abs(Math.sin(now / 70)) * -4);
    // El emoji mira a la izquierda: se da vuelta si va para la derecha.
    if (v.dog.vx > 0) ctx.scale(-1, 1);
    ctx.font = '42px serif';
    ctx.fillStyle = '#000';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🐕', 0, 0);
    if (v.dog.hasChori) {
      ctx.font = '24px serif';
      ctx.fillStyle = '#000';
      ctx.fillText('🌭', -22, 4);
    }
    ctx.restore();
  } else {
    things.dog = null;
  }

  /* carrito del vendedor */
  if (v.cart) {
    things.cart = follow(things.cart, v.cart.x, v.cart.y, v.cart.vx, v.cart.vy, elapsed, dt);
    const s = things.cart;
    const ang = Math.atan2(v.cart.vy, v.cart.vx);
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      const px = -Math.cos(ang) * 60 - Math.sin(ang) * i * 22;
      const py = -Math.sin(ang) * 60 + Math.cos(ang) * i * 22;
      ctx.moveTo(px, py);
      ctx.lineTo(px - Math.cos(ang) * 40, py - Math.sin(ang) * 40);
      ctx.stroke();
    }
    ctx.rotate(ang);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    rr(ctx, -40, -26, 86, 60, 10);
    ctx.fill();
    ctx.fillStyle = '#f8fafc';
    rr(ctx, -44, -32, 86, 60, 10);
    ctx.fill();
    ctx.fillStyle = '#ef4444';
    for (let i = 0; i < 4; i++) ctx.fillRect(-44 + i * 22, -32, 11, 60);
    ctx.restore();
    ctx.font = '34px serif';
    ctx.fillStyle = '#000';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🧑‍🍳', s.x - Math.cos(ang) * 54, s.y - Math.sin(ang) * 54);
    ctx.font = '30px serif';
    ctx.fillStyle = '#000';
    ctx.fillText('🛒', s.x, s.y);
  } else {
    things.cart = null;
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
    p.vx *= Math.pow(0.1, dt);
    ctx.globalAlpha = Math.max(0, p.life / p.max);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * (p.color.startsWith('rgba(230') ? 2 - p.life / p.max : 1), 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  /* nombres */
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const fs = Math.max(12, 12 / scale);
  ctx.font = `800 ${fs}px Outfit, sans-serif`;
  for (const p of v.players) {
    const s = smooth.get(p.playerId);
    if (!s) continue;
    const isMe = p.playerId === meId;
    const label = isMe ? 'VOS' : short(players.get(p.playerId)?.name ?? '—');
    const w = ctx.measureText(label).width + fs;
    const y = s.y - CH.PLAYER_R - fs * 1.2;
    ctx.fillStyle = 'rgba(8,6,14,0.7)';
    rr(ctx, s.x - w / 2, y - fs * 0.7, w, fs * 1.4, fs * 0.7);
    ctx.fill();
    ctx.fillStyle = isMe ? '#fde047' : '#fff';
    ctx.fillText(label, s.x, y + 1);
  }

  /* humareda: tapa media cancha */
  const sm = v.smoke;
  if (sm) {
    const fade = Math.min(1, (now - sm.from) / 800, (sm.until - now) / 1200);
    if (fade > 0) {
      const half = sm.side === 'left' || sm.side === 'right' ? [CH.W / 2, CH.H] : [CH.W, CH.H / 2];
      const x0 = sm.side === 'right' ? CH.W / 2 : 0;
      const y0 = sm.side === 'bottom' ? CH.H / 2 : 0;
      ctx.save();
      ctx.globalAlpha = fade;
      const grad =
        sm.side === 'left' || sm.side === 'right'
          ? ctx.createLinearGradient(sm.side === 'left' ? CH.W / 2 + 60 : CH.W / 2 - 60, 0, sm.side === 'left' ? CH.W / 2 - 80 : CH.W / 2 + 80, 0)
          : ctx.createLinearGradient(0, sm.side === 'top' ? CH.H / 2 + 60 : CH.H / 2 - 60, 0, sm.side === 'top' ? CH.H / 2 - 80 : CH.H / 2 + 80);
      grad.addColorStop(0, 'rgba(203, 213, 225, 0)');
      grad.addColorStop(1, 'rgba(203, 213, 225, 0.97)');
      ctx.fillStyle = grad;
      const ex = sm.side === 'left' ? 60 : sm.side === 'right' ? -60 : 0;
      const ey = sm.side === 'top' ? 60 : sm.side === 'bottom' ? -60 : 0;
      ctx.fillRect(x0 + Math.min(0, ex), y0 + Math.min(0, ey), half[0] + Math.abs(ex), half[1] + Math.abs(ey));
      // Bocanadas que se mueven.
      for (let i = 0; i < 26; i++) {
        const bx = x0 + ((i * 173.3 + now / 25) % (half[0] + 120)) - 60;
        const by = y0 + ((i * 97.7 + Math.sin(now / 900 + i) * 40) % half[1]);
        const r = 70 + (i % 5) * 18;
        ctx.fillStyle = `rgba(${226 - (i % 3) * 14}, ${232 - (i % 3) * 14}, ${240 - (i % 3) * 14}, 0.55)`;
        ctx.beginPath();
        ctx.arc(bx, by, r, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  /* joystick táctil */
  if (joy) {
    const rect = canvas.getBoundingClientRect();
    const ox = (joy.ox - rect.left) / scale;
    const oy = (joy.oy - rect.top) / scale;
    const dx = joy.x - joy.ox;
    const dy = joy.y - joy.oy;
    const l = Math.hypot(dx, dy);
    const k = l > 50 ? 50 / l : 1;
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3 / scale;
    ctx.beginPath();
    ctx.arc(ox, oy, 50 / scale, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(ox + (dx * k) / scale, oy + (dy * k) / scale, 20 / scale, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

function drawRunner(
  ctx: CanvasRenderingContext2D,
  p: ChoriPlayer,
  s: Smooth,
  pl: PlayerPublic | undefined,
  isMe: boolean,
  holding: boolean,
  now: number,
): void {
  const hue = pl?.avatar.hue ?? 30;
  const R = CH.PLAYER_R;
  const sprinting = now < p.sprintUntil;
  const stunned = now < p.stunUntil;

  // Estela del pique.
  if (sprinting) {
    const sp = Math.hypot(p.vx, p.vy) || 1;
    for (let i = 1; i <= 4; i++) {
      ctx.fillStyle = `hsla(${hue} 90% 65% / ${0.25 - i * 0.05})`;
      ctx.beginPath();
      ctx.arc(s.x - (p.vx / sp) * i * 14, s.y - (p.vy / sp) * i * 14, R * (1 - i * 0.12), 0, TAU);
      ctx.fill();
    }
  }

  if (holding) {
    const pulse = 0.5 + 0.5 * Math.sin(now / 120);
    const glow = ctx.createRadialGradient(s.x, s.y, R * 0.5, s.x, s.y, R * 2.6);
    glow.addColorStop(0, `rgba(253, 224, 71, ${0.5 + pulse * 0.3})`);
    glow.addColorStop(1, 'rgba(253, 224, 71, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(s.x, s.y, R * 2.6, 0, TAU);
    ctx.fill();
  }

  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(s.x + 3, s.y + 8, R, R * 0.7, 0, 0, TAU);
  ctx.fill();

  const body = ctx.createRadialGradient(s.x - R * 0.4, s.y - R * 0.4, 2, s.x, s.y, R);
  body.addColorStop(0, `hsl(${hue} 80% 70%)`);
  body.addColorStop(1, `hsl(${hue} 70% 45%)`);
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(s.x, s.y, R, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = isMe ? '#fde047' : 'rgba(0,0,0,0.45)';
  ctx.lineWidth = isMe ? 3.5 : 2;
  ctx.stroke();

  // Manitos hacia donde mira.
  const ax = Math.cos(p.a);
  const ay = Math.sin(p.a);
  ctx.fillStyle = `hsl(${hue} 70% 40%)`;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(s.x + ax * R * 0.8 - ay * side * R * 0.7, s.y + ay * R * 0.8 + ax * side * R * 0.7, 6, 0, TAU);
    ctx.fill();
  }

  ctx.font = `${Math.round(R * 1.15)}px serif`;
  ctx.fillStyle = '#000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(stunned ? '😵' : pl?.avatar.face ?? '🙂', s.x, s.y + 1);

  if (holding) {
    ctx.save();
    ctx.translate(s.x + ax * R * 1.15, s.y + ay * R * 1.15);
    ctx.rotate(Math.sin(now / 90) * 0.25);
    ctx.font = '26px serif';
    ctx.fillStyle = '#000';
    ctx.fillText('🌭', 0, 0);
    ctx.restore();
  }

  if (stunned) {
    ctx.fillStyle = '#fde047';
    ctx.font = '14px serif';
    for (let i = 0; i < 3; i++) {
      const a = now / 150 + (i * TAU) / 3;
      ctx.fillText('✦', s.x + Math.cos(a) * R * 1.1, s.y - R * 0.9 + Math.sin(a) * R * 0.4);
    }
  }
}

function short(name: string): string {
  return name.length > 10 ? `${name.slice(0, 9)}…` : name;
}
