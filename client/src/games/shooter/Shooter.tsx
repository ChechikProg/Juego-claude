import { useEffect, useMemo, useRef } from 'react';
import { SH, SH_MAPS, WEAPONS, platformAt, type ShMap } from '@shared/shooter';
import type { PlayerPublic, ShFighter, ShooterView, ShWeapon } from '@shared/types';
import { api, serverNow } from '@/net/socket';
import { useCountdown, useRaf, useSize } from '@/lib/hooks';
import { sfx } from '@/lib/sfx';
import { usePlayerMap, useStore } from '@/state/store';
import { Avatar, RankBadge, Timer } from '@/components/ui';

const TAU = Math.PI * 2;
const PAD_X = 70;
const PAD_Y = 40;

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
  gravity?: number;
}

type Key = 'left' | 'right' | 'fire';

export function Shooter({ view }: { view: ShooterView }): JSX.Element {
  const players = usePlayerMap();
  const meId = useStore((s) => s.playerId);
  const [wrapRef, size] = useSize<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const snap = useRef(view);
  snap.current = view;

  const map = SH_MAPS[view.map] ?? SH_MAPS[0];
  const smooth = useRef(new Map<string, Smooth>());
  const particles = useRef<Particle[]>([]);
  const seenFx = useRef(new Set<number>());
  const shake = useRef(0);
  const held = useRef<Record<Key, boolean>>({ left: false, right: false, fire: false });

  const live = view.stage === 'live';
  const countdown = useCountdown(view.stage === 'countdown' ? view.until : null, 10);
  const left = useCountdown(live ? view.until : null, 4);
  const me = view.fighters.find((f) => f.playerId === meId);
  const respawnIn = useCountdown(me && !me.alive && me.lives > 0 ? me.respawnAt : null, 10);
  const nadeIn = useCountdown(me && live ? me.nadeReadyAt : null, 10);

  /* ── efectos: sonido y partículas ──────────────────────────────────── */
  useEffect(() => {
    for (const fx of view.fx) {
      if (seenFx.current.has(fx.id)) continue;
      seenFx.current.add(fx.id);
      const mine = fx.playerId === meId;
      switch (fx.kind) {
        case 'shot':
          if (fx.weapon === 'shotgun') sfx.shotgun();
          else if (fx.weapon === 'sniper') sfx.sniper();
          else if (mine || Math.random() < 0.5) sfx.pew();
          burst(particles.current, fx.x, fx.y, fx.weapon === 'shotgun' ? 10 : 4, ['#fff7ae', '#fdba74'], 160, 0.15, (fx.dir ?? 1) * 0.6);
          break;
        case 'hit':
          sfx.hitmark();
          burst(particles.current, fx.x, fx.y, 8, ['#ffffff', '#fde047', '#f472b6'], 220, 0.3, fx.dir ?? 0);
          if (mine) shake.current = Math.max(shake.current, 6);
          break;
        case 'boom': {
          sfx.boom();
          burst(particles.current, fx.x, fx.y, 46, ['#fde047', '#fb923c', '#ef4444', '#52525b', '#ffffff'], 420, 0.8);
          shake.current = Math.max(shake.current, 14);
          break;
        }
        case 'fall':
          sfx.fall();
          if (mine) shake.current = 16;
          splash(particles.current, fx.x, fx.y, fx.dir ?? 0, players.get(fx.playerId ?? '')?.avatar.hue ?? 300);
          break;
        case 'spawn':
          if (mine) sfx.spawn();
          break;
        case 'pickup':
          if (mine) sfx.pickup();
          burst(particles.current, fx.x, fx.y, 14, ['#fde047', '#4ade80', '#ffffff'], 200, 0.5);
          break;
        case 'jump':
          if (mine) sfx.jump();
          break;
        case 'toss':
          if (mine) sfx.toss();
          break;
        case 'crate':
          sfx.bell();
          break;
      }
    }
    if (seenFx.current.size > 500) seenFx.current = new Set(view.fx.map((f) => f.id));
  }, [view.fx, meId, players]);

  /* ── controles ─────────────────────────────────────────────────────── */
  const setHeld = (k: Key, down: boolean) => {
    if (held.current[k] === down) return;
    held.current[k] = down;
    api.send(k, { down });
  };
  const jump = () => api.send('jump');
  const drop = () => api.send('drop');
  const nade = () => api.send('nade');

  useEffect(() => {
    const map: Record<string, Key> = {
      ArrowLeft: 'left', KeyA: 'left',
      ArrowRight: 'right', KeyD: 'right',
      KeyJ: 'fire', KeyF: 'fire',
    };
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      const k = map[e.code];
      if (k) {
        e.preventDefault();
        setHeld(k, true);
        return;
      }
      if (e.repeat) return;
      if (e.code === 'ArrowUp' || e.code === 'KeyW' || e.code === 'Space') {
        e.preventDefault();
        jump();
      } else if (e.code === 'ArrowDown' || e.code === 'KeyS') {
        e.preventDefault();
        drop();
      } else if (e.code === 'KeyK' || e.code === 'KeyG') {
        e.preventDefault();
        nade();
      }
    };
    const up = (e: KeyboardEvent) => {
      const k = map[e.code];
      if (k) setHeld(k, false);
    };
    const blur = () => {
      held.current = { left: false, right: false, fire: false };
      api.send('stop');
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

  /* ── canvas ────────────────────────────────────────────────────────── */
  const scale = size.w ? Math.min(size.w / (SH.W + PAD_X * 2), size.h / (SH.H + PAD_Y * 2)) : 0;
  const cw = Math.round((SH.W + PAD_X * 2) * scale);
  const ch = Math.round((SH.H + PAD_Y * 2) * scale);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !cw) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = cw * dpr;
    canvas.height = ch * dpr;
    canvas.style.width = `${cw}px`;
    canvas.style.height = `${ch}px`;
  }, [cw, ch]);

  const backdrop = useMemo(() => {
    if (!cw) return null;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const c = document.createElement('canvas');
    c.width = cw * dpr;
    c.height = ch * dpr;
    const g = c.getContext('2d');
    if (!g) return null;
    g.setTransform(dpr * scale, 0, 0, dpr * scale, PAD_X * dpr * scale, PAD_Y * dpr * scale);
    paintBackdrop(g, map);
    return c;
  }, [cw, ch, scale, map]);

  useRaf((dt) => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx || !cw) return;
    paint(ctx, {
      v: snap.current,
      map,
      backdrop,
      scale,
      smooth: smooth.current,
      particles: particles.current,
      players,
      meId,
      dt,
      shake,
    });
  });

  /* ── interfaz ──────────────────────────────────────────────────────── */
  const real = view.fighters.filter((f) => !f.playerId.startsWith('dummy-'));
  const ranking = [...real].sort((a, b) => {
    const la = a.lives > 0 ? 1 : 0;
    const lb = b.lives > 0 ? 1 : 0;
    return lb - la || b.lives - a.lives || b.kills - a.kills || (a.place ?? 99) - (b.place ?? 99);
  });
  const weapon = me ? WEAPONS[me.weapon] : WEAPONS.pistol;
  const nadePct = me ? Math.max(0, Math.min(1, 1 - nadeIn / SH.NADE_COOLDOWN)) : 1;
  const solo = real.length <= 1;

  return (
    <div className="sh">
      <header className="sh__top">
        <span className="chip">🗺️ {map.name}</span>
        {me && (
          <div className="sh__lives" aria-label={`${me.lives} vidas`}>
            {Array.from({ length: Math.max(0, me.lives) }, (_, i) => (
              <span key={i}>❤️</span>
            ))}
            {me.lives <= 0 && <span className="muted">sin vidas</span>}
          </div>
        )}
        {me && (
          <div className="sh__weapon">
            <span className="sh__weaponicon">{weapon.icon}</span>
            <span>
              <b>{weapon.name}</b>
              <span className="muted tnum">{me.ammo < 0 ? ' ∞' : ` ×${me.ammo}`}</span>
            </span>
          </div>
        )}
        {me && (
          <div className="sh__nade" title="Granada">
            <span>💣</span>
            <div className="sh__nadebar">
              <div className={`sh__nadefill ${nadePct >= 1 ? 'sh__nadefill--ready' : ''}`} style={{ width: `${nadePct * 100}%` }} />
            </div>
          </div>
        )}
        {live && <Timer ms={left} urgentAt={20_000} />}
      </header>

      <div className="sh__body">
        <div className="sh__stage" ref={wrapRef}>
          <canvas
            ref={canvasRef}
            className="sh__canvas"
            onPointerDown={(e) => {
              if (e.pointerType !== 'mouse') return;
              e.preventDefault();
              sfx.wake();
              if (e.button === 2) nade();
              else setHeld('fire', true);
            }}
            onPointerUp={(e) => {
              if (e.pointerType === 'mouse' && e.button !== 2) setHeld('fire', false);
            }}
            onPointerLeave={() => setHeld('fire', false)}
            onContextMenu={(e) => e.preventDefault()}
          />

          {view.stage === 'countdown' && (
            <div className="sh__overlay">
              <div className="sh__mapname anim-pop">
                <b>{map.name}</b>
                <span>{map.tag}</span>
              </div>
              <div className="sm__count anim-pop" key={Math.ceil(countdown / 1000)}>
                {Math.max(1, Math.ceil(countdown / 1000))}
              </div>
              <p className="sm__ready">{solo ? 'Práctica: revoleá a los muñecos' : 'Tiralos de las plataformas'}</p>
            </div>
          )}

          {live && me && !me.alive && (
            <div className="tq__dead anim-fade">
              {me.lives > 0 ? (
                <>
                  <span>💫 Te caíste</span>
                  <b className="tnum">Volvés en {Math.max(1, Math.ceil(respawnIn / 1000))}</b>
                </>
              ) : (
                <>
                  <span>☠️ Sin vidas</span>
                  <b>Quedaste {me.place ?? '—'}º</b>
                </>
              )}
            </div>
          )}

          <ul className="tq__feed" aria-live="polite">
            {view.feed.map((k) => {
              const killer = k.killer ? nameOf(k.killer, players) : null;
              const victim = nameOf(k.victim, players);
              const involved = k.killer === meId || k.victim === meId;
              return (
                <li key={k.id} className={`tq__kill anim-fade ${involved ? 'sh__kill--me' : ''}`}>
                  {killer ? (
                    <>
                      <b>{killer}</b> 👋 <b>{victim}</b>
                    </>
                  ) : (
                    <>
                      <b>{victim}</b> se cayó solo 🙃
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        <aside className="sh__side panel">
          <h3 className="card__title">Luchadores</h3>
          <ol className="plist">
            {ranking.map((f, i) => {
              const p = players.get(f.playerId);
              if (!p) return null;
              return (
                <li key={f.playerId} className={`prow ${f.playerId === meId ? 'prow--me' : ''} ${f.lives <= 0 ? 'cp__out' : ''}`}>
                  <RankBadge rank={f.lives > 0 ? i + 1 : f.place ?? i + 1} />
                  <Avatar avatar={p.avatar} size={24} offline={!p.connected} />
                  <span className="grow prow__name">{p.name}</span>
                  <span className="sh__hearts" aria-label={`${f.lives} vidas`}>
                    {f.lives > 0 ? '❤️'.repeat(Math.min(6, f.lives)) : '☠️'}
                  </span>
                  <span className="prow__score tnum" title="Bajas">
                    {f.kills}
                  </span>
                </li>
              );
            })}
          </ol>
          <p className="hint sh__help">
            A D mover · W / espacio saltar (doble) · S bajar · J o click disparar · K o click derecho granada
          </p>
        </aside>
      </div>

      <p className="sh__rotate">📱↻ Girá el celu para ver el mapa más grande</p>

      <footer className="sh__controls">
        <div className="sh__dpad">
          {(
            [
              ['left', '◀'],
              ['right', '▶'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              className="tq__btn sh__btn"
              disabled={!live}
              onPointerDown={(e) => {
                e.preventDefault();
                setHeld(k, true);
              }}
              onPointerUp={() => setHeld(k, false)}
              onPointerLeave={() => setHeld(k, false)}
              onPointerCancel={() => setHeld(k, false)}
              aria-label={k === 'left' ? 'Izquierda' : 'Derecha'}
            >
              {label}
            </button>
          ))}
          <button
            className="tq__btn sh__btn"
            disabled={!live}
            onPointerDown={(e) => {
              e.preventDefault();
              drop();
            }}
            aria-label="Bajar"
          >
            ▼
          </button>
        </div>
        <div className="sh__actions">
          <button
            className="sh__act sh__act--nade"
            disabled={!live}
            onPointerDown={(e) => {
              e.preventDefault();
              nade();
            }}
          >
            💣
          </button>
          <button
            className="sh__act sh__act--jump"
            disabled={!live}
            onPointerDown={(e) => {
              e.preventDefault();
              jump();
            }}
          >
            SALTO
          </button>
          <button
            className="sh__act sh__act--fire"
            disabled={!live}
            onPointerDown={(e) => {
              e.preventDefault();
              setHeld('fire', true);
            }}
            onPointerUp={() => setHeld('fire', false)}
            onPointerLeave={() => setHeld('fire', false)}
            onPointerCancel={() => setHeld('fire', false)}
          >
            FUEGO
          </button>
        </div>
      </footer>
    </div>
  );
}

function nameOf(id: string, players: Map<string, PlayerPublic>): string {
  if (id.startsWith('dummy-')) return `Muñeco ${id.slice(6)}`;
  return players.get(id)?.name ?? '—';
}

/* ── partículas ───────────────────────────────────────────────────────────── */

function burst(list: Particle[], x: number, y: number, n: number, colors: string[], speed: number, life: number, bias = 0): void {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU;
    const v = speed * (0.3 + Math.random() * 0.7);
    const l = life * (0.5 + Math.random() * 0.6);
    list.push({
      x,
      y,
      vx: Math.cos(a) * v + bias * speed,
      vy: Math.sin(a) * v,
      life: l,
      max: l,
      size: 2.5 + Math.random() * 4,
      color: colors[Math.floor(Math.random() * colors.length)],
    });
  }
  if (list.length > 700) list.splice(0, list.length - 700);
}

/** Chorro de colores en el borde por donde se cayó alguien. */
function splash(list: Particle[], x: number, y: number, dir: number, hue: number): void {
  const colors = [`hsl(${hue} 90% 60%)`, `hsl(${hue} 90% 75%)`, '#ffffff'];
  const bx = dir < 0 ? 0 : dir > 0 ? SH.W : x;
  const by = dir === 0 ? Math.min(SH.H, Math.max(0, y)) : y;
  for (let i = 0; i < 40; i++) {
    const spread = (Math.random() - 0.5) * 1.1;
    const base = dir < 0 ? 0 : dir > 0 ? Math.PI : -Math.PI / 2;
    const a = base + spread;
    const v = 300 + Math.random() * 500;
    list.push({ x: bx, y: by, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.9, max: 0.9, size: 4 + Math.random() * 5, color: colors[i % 3], gravity: 900 });
  }
}

/* ── dibujo ───────────────────────────────────────────────────────────────── */

function paintBackdrop(g: CanvasRenderingContext2D, map: ShMap): void {
  const W = SH.W + PAD_X * 2;
  const H = SH.H + PAD_Y * 2;
  const x0 = -PAD_X;
  const y0 = -PAD_Y;
  let seed = map.name.length * 97 + 11;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };

  if (map.theme === 'neon') {
    const sky = g.createLinearGradient(0, y0, 0, y0 + H);
    sky.addColorStop(0, '#0b0620');
    sky.addColorStop(0.6, '#2a0f45');
    sky.addColorStop(1, '#4c1d5c');
    g.fillStyle = sky;
    g.fillRect(x0, y0, W, H);
    for (let i = 0; i < 120; i++) {
      g.fillStyle = `rgba(255,255,255,${0.2 + rand() * 0.6})`;
      g.fillRect(x0 + rand() * W, y0 + rand() * H * 0.55, 1.6, 1.6);
    }
    // Luna.
    g.fillStyle = '#fdf4ff';
    g.beginPath();
    g.arc(1320, 120, 52, 0, TAU);
    g.fill();
    g.fillStyle = '#2a0f45';
    g.beginPath();
    g.arc(1345, 105, 48, 0, TAU);
    g.fill();
    // Ciudad lejana y cercana.
    for (const [layer, color, base] of [
      [0, '#22103a', 520],
      [1, '#170a28', 600],
    ] as const) {
      let x = x0;
      while (x < x0 + W) {
        const bw = 50 + rand() * 90;
        const bh = (layer ? 160 : 230) + rand() * (layer ? 220 : 260);
        g.fillStyle = color;
        g.fillRect(x, base - bh + (layer ? 200 : 120), bw, H);
        // Ventanitas encendidas.
        for (let wy = base - bh + (layer ? 215 : 135); wy < base + 300; wy += 16) {
          for (let wx = x + 7; wx < x + bw - 7; wx += 13) {
            if (rand() < 0.18) {
              g.fillStyle = rand() < 0.5 ? 'rgba(253, 224, 71, 0.55)' : 'rgba(244, 114, 182, 0.5)';
              g.fillRect(wx, wy, 6, 8);
            }
          }
        }
        x += bw + 6;
      }
    }
    // Cartel de neón.
    g.save();
    g.font = '900 64px Bungee, Outfit, sans-serif';
    g.textAlign = 'center';
    g.shadowColor = '#f472b6';
    g.shadowBlur = 30;
    g.fillStyle = 'rgba(244, 114, 182, 0.75)';
    g.fillText('ASHOOTATEE', 800, 110);
    g.restore();
  } else if (map.theme === 'temple') {
    const sky = g.createLinearGradient(0, y0, 0, y0 + H);
    sky.addColorStop(0, '#3b1e6e');
    sky.addColorStop(0.45, '#c2417a');
    sky.addColorStop(0.75, '#ff9a5a');
    sky.addColorStop(1, '#ffd29a');
    g.fillStyle = sky;
    g.fillRect(x0, y0, W, H);
    const sun = g.createRadialGradient(800, 560, 20, 800, 560, 260);
    sun.addColorStop(0, 'rgba(255, 244, 200, 0.95)');
    sun.addColorStop(0.35, 'rgba(255, 200, 120, 0.6)');
    sun.addColorStop(1, 'rgba(255, 160, 90, 0)');
    g.fillStyle = sun;
    g.fillRect(x0, y0, W, H);
    // Islitas lejanas.
    for (let i = 0; i < 9; i++) {
      const ix = x0 + rand() * W;
      const iy = 140 + rand() * 380;
      const iw = 40 + rand() * 120;
      g.fillStyle = `rgba(80, 30, 90, ${0.25 + rand() * 0.25})`;
      g.beginPath();
      g.moveTo(ix, iy);
      g.lineTo(ix + iw, iy);
      g.lineTo(ix + iw * 0.6, iy + iw * 0.6);
      g.lineTo(ix + iw * 0.35, iy + iw * 0.5);
      g.closePath();
      g.fill();
    }
    // Nubes.
    for (let i = 0; i < 14; i++) {
      const cx = x0 + rand() * W;
      const cy = 80 + rand() * 600;
      g.fillStyle = 'rgba(255, 236, 220, 0.18)';
      for (let k = 0; k < 4; k++) {
        g.beginPath();
        g.ellipse(cx + k * 34, cy + (k % 2) * 8, 46, 18, 0, 0, TAU);
        g.fill();
      }
    }
  } else {
    const sky = g.createLinearGradient(0, y0, 0, y0 + H);
    sky.addColorStop(0, '#1e1b3a');
    sky.addColorStop(0.55, '#5b2160');
    sky.addColorStop(1, '#a83a6f');
    g.fillStyle = sky;
    g.fillRect(x0, y0, W, H);
    // Chimeneas y vigas.
    g.fillStyle = '#2a1736';
    for (let i = 0; i < 8; i++) {
      const cx = x0 + 80 + i * 230 + rand() * 60;
      const chh = 220 + rand() * 260;
      g.fillRect(cx, 900 - chh, 46, chh);
      g.fillStyle = 'rgba(255,255,255,0.05)';
      for (let k = 0; k < 3; k++) {
        g.beginPath();
        g.arc(cx + 23 + k * 18, 900 - chh - 30 - k * 34, 22 + k * 8, 0, TAU);
        g.fill();
      }
      g.fillStyle = '#2a1736';
    }
    g.strokeStyle = 'rgba(244, 114, 182, 0.18)';
    g.lineWidth = 6;
    for (let x = x0; x < x0 + W; x += 120) {
      g.beginPath();
      g.moveTo(x, 40);
      g.lineTo(x + 120, 40);
      g.lineTo(x + 60, 110);
      g.closePath();
      g.stroke();
    }
    // Engranajes.
    for (const [gx, gy, gr] of [
      [200, 160, 70],
      [1420, 200, 90],
      [820, 600, 60],
    ]) {
      g.fillStyle = 'rgba(30, 15, 40, 0.55)';
      g.beginPath();
      for (let k = 0; k < 24; k++) {
        const ang = (k / 24) * TAU;
        const rr = k % 2 ? gr : gr * 0.82;
        g.lineTo(gx + Math.cos(ang) * rr, gy + Math.sin(ang) * rr);
      }
      g.closePath();
      g.fill();
    }
  }

  // Velo sobre el fondo para que las plataformas y los personajes resalten.
  g.fillStyle = map.theme === 'temple' ? 'rgba(30, 10, 40, 0.18)' : 'rgba(8, 4, 18, 0.38)';
  g.fillRect(x0, y0, W, H);

  // El vacío de abajo: se oscurece hacia el abismo.
  const abyss = g.createLinearGradient(0, SH.H - 120, 0, SH.H + PAD_Y);
  abyss.addColorStop(0, 'rgba(5, 3, 12, 0)');
  abyss.addColorStop(1, 'rgba(5, 3, 12, 0.85)');
  g.fillStyle = abyss;
  g.fillRect(x0, SH.H - 120, W, 120 + PAD_Y);
}

interface PaintArgs {
  v: ShooterView;
  map: ShMap;
  backdrop: HTMLCanvasElement | null;
  scale: number;
  smooth: Map<string, Smooth>;
  particles: Particle[];
  players: Map<string, PlayerPublic>;
  meId: string | null;
  dt: number;
  shake: React.MutableRefObject<number>;
}

function paint(ctx: CanvasRenderingContext2D, a: PaintArgs): void {
  const { v, map, backdrop, scale, smooth, particles, players, meId, dt, shake } = a;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const now = serverNow();
  const clock = v.stage === 'countdown' ? 0 : now - v.clock0;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  if (backdrop) ctx.drawImage(backdrop, 0, 0);

  let sx = 0;
  let sy = 0;
  if (shake.current > 0.2) {
    sx = (Math.random() - 0.5) * shake.current;
    sy = (Math.random() - 0.5) * shake.current;
    shake.current *= Math.pow(0.003, dt);
  }
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, (PAD_X * scale + sx) * dpr, (PAD_Y * scale + sy) * dpr);

  /* ── plataformas ── */
  for (const p of map.platforms) {
    const pos = platformAt(p, clock);
    drawPlatform(ctx, map.theme, pos.x, pos.y, p.w, p.h, !!p.period, now);
  }

  /* ── cajas ── */
  for (const c of v.crates) {
    drawCrate(ctx, c.x, c.y, c.weapon, c.landed, now);
  }

  /* ── luchadores ── */
  const elapsed = Math.max(0, Math.min(0.1, (now - v.t) / 1000));
  const k = Math.min(1, dt * 18);
  for (const f of v.fighters) {
    const tx = f.x + f.vx * elapsed;
    const ty = f.y + (f.grounded ? 0 : f.vy * elapsed);
    let sm = smooth.get(f.playerId);
    if (!sm || Math.hypot(tx - sm.x, ty - sm.y) > 140 || !f.alive) {
      sm = { x: tx, y: ty };
      smooth.set(f.playerId, sm);
    } else {
      sm.x += (tx - sm.x) * k;
      sm.y += (ty - sm.y) * k;
    }
    if (!f.alive) continue;
    drawFighter(ctx, f, sm, players.get(f.playerId), f.playerId === meId, now, 1 / scale);
  }

  /* ── balas ── */
  for (const b of v.bullets) {
    const bx = b.x + b.vx * elapsed;
    const by = b.y + b.vy * elapsed;
    const color = bulletColor(b.kind, players.get(b.owner)?.avatar.hue ?? 50);
    const len = b.kind === 'sniper' ? 46 : b.kind === 'minigun' ? 14 : 20;
    const sp = Math.hypot(b.vx, b.vy) || 1;
    ctx.strokeStyle = color;
    ctx.lineWidth = b.kind === 'sniper' ? 5 : 4;
    ctx.lineCap = 'round';
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx - (b.vx / sp) * len, by - (b.vy / sp) * len);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(bx, by, 2.6, 0, TAU);
    ctx.fill();
  }

  /* ── granadas ── */
  for (const n of v.nades) {
    const nx = n.x + n.vx * elapsed;
    const ny = n.y + (n.vy === 0 ? 0 : n.vy * elapsed);
    const left = n.boomAt - now;
    // Zona de peligro que se va llenando.
    const t = 1 - Math.max(0, Math.min(1, left / SH.NADE_FUSE));
    ctx.beginPath();
    ctx.arc(nx, ny, SH.NADE_RADIUS * t, 0, TAU);
    ctx.fillStyle = `rgba(239, 68, 68, ${0.06 + t * 0.08})`;
    ctx.fill();
    ctx.strokeStyle = `rgba(239, 68, 68, ${0.25 + t * 0.4})`;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(nx, ny, SH.NADE_R, 0, TAU);
    ctx.fillStyle = '#27272a';
    ctx.fill();
    ctx.strokeStyle = '#71717a';
    ctx.lineWidth = 2;
    ctx.stroke();
    const blink = left < 500 ? Math.sin(now / 30) > 0 : Math.sin(now / 90) > 0;
    ctx.beginPath();
    ctx.arc(nx + 3, ny - 4, 3, 0, TAU);
    ctx.fillStyle = blink ? '#ef4444' : '#7f1d1d';
    ctx.fill();
  }

  /* ── efectos de anillo ── */
  for (const fx of v.fx) {
    const age = (now - fx.at) / 1000;
    if (age < 0) continue;
    if (fx.kind === 'boom' && age < 0.5) {
      const t = age / 0.5;
      const g = ctx.createRadialGradient(fx.x, fx.y, 0, fx.x, fx.y, SH.NADE_RADIUS * (0.4 + t * 0.6));
      g.addColorStop(0, `rgba(255, 250, 220, ${0.9 * (1 - t)})`);
      g.addColorStop(0.5, `rgba(253, 160, 60, ${0.6 * (1 - t)})`);
      g.addColorStop(1, 'rgba(239, 68, 68, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, SH.NADE_RADIUS, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, 20 + t * SH.NADE_RADIUS, 0, TAU);
      ctx.strokeStyle = `rgba(255, 255, 255, ${1 - t})`;
      ctx.lineWidth = 6 * (1 - t);
      ctx.stroke();
    } else if (fx.kind === 'spawn' && age < 0.6) {
      const t = age / 0.6;
      const p = fx.playerId ? players.get(fx.playerId) : null;
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, 50 * (1 - t) + 16, 0, TAU);
      ctx.strokeStyle = `hsla(${p?.avatar.hue ?? 300} 90% 70% / ${1 - t})`;
      ctx.lineWidth = 3;
      ctx.stroke();
    } else if (fx.kind === 'shot' && age < 0.07) {
      ctx.beginPath();
      ctx.arc(fx.x + (fx.dir ?? 1) * 6, fx.y, fx.weapon === 'shotgun' || fx.weapon === 'sniper' ? 16 : 10, 0, TAU);
      ctx.fillStyle = 'rgba(255, 240, 170, 0.9)';
      ctx.fill();
    }
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
    if (p.gravity) p.vy += p.gravity * dt;
    else {
      p.vx *= Math.pow(0.05, dt);
      p.vy *= Math.pow(0.05, dt);
    }
    ctx.globalAlpha = Math.max(0, p.life / p.max);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;

  /* ── indicadores de los que están fuera de la pantalla ── */
  for (const f of v.fighters) {
    if (!f.alive) continue;
    const sm = smooth.get(f.playerId);
    if (!sm) continue;
    const above = sm.y - SH.HEIGHT < -PAD_Y;
    const side = sm.x < -PAD_X ? -1 : sm.x > SH.W + PAD_X ? 1 : 0;
    if (!above && !side) continue;
    const ix = Math.max(-PAD_X + 24, Math.min(SH.W + PAD_X - 24, sm.x));
    const iy = Math.max(-PAD_Y + 24, Math.min(SH.H - 24, sm.y - SH.HEIGHT / 2));
    const p = players.get(f.playerId);
    ctx.beginPath();
    ctx.arc(ix, iy, 18, 0, TAU);
    ctx.fillStyle = `hsla(${p?.avatar.hue ?? 0} 80% 50% / 0.85)`;
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.font = '18px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(p?.avatar.face ?? '🙂', ix, iy + 1);
  }
}

function bulletColor(kind: ShWeapon, hue: number): string {
  if (kind === 'sniper') return '#67e8f9';
  if (kind === 'shotgun') return '#fdba74';
  if (kind === 'minigun') return '#fde047';
  return `hsl(${hue} 95% 70%)`;
}

function drawPlatform(ctx: CanvasRenderingContext2D, theme: ShMap['theme'], x: number, y: number, w: number, h: number, moving: boolean, now: number): void {
  if (theme === 'neon') {
    // Resplandor debajo: separa la plataforma de los edificios del fondo.
    const under = ctx.createLinearGradient(0, y + h, 0, y + h + 40);
    under.addColorStop(0, 'rgba(244, 114, 182, 0.28)');
    under.addColorStop(1, 'rgba(244, 114, 182, 0)');
    ctx.fillStyle = under;
    ctx.fillRect(x + 8, y + h, w - 16, 40);
    const body = ctx.createLinearGradient(0, y, 0, y + h);
    body.addColorStop(0, '#4a2a7a');
    body.addColorStop(1, '#22113d');
    ctx.fillStyle = body;
    roundRect(ctx, x, y, w, h, 6);
    ctx.fill();
    ctx.strokeStyle = 'rgba(244, 114, 182, 0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + 6, y + h - 1);
    ctx.lineTo(x + w - 6, y + h - 1);
    ctx.stroke();
    // Borde de neón.
    ctx.save();
    ctx.shadowColor = '#22d3ee';
    ctx.shadowBlur = 18;
    ctx.strokeStyle = '#a5f3fc';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(x + 3, y + 2.5);
    ctx.lineTo(x + w - 3, y + 2.5);
    ctx.stroke();
    ctx.restore();
    if (h > 30) {
      for (let wx = x + 20; wx < x + w - 20; wx += 34) {
        ctx.fillStyle = Math.sin(wx * 13.7) > 0.2 ? 'rgba(244, 114, 182, 0.55)' : 'rgba(253, 224, 71, 0.35)';
        ctx.fillRect(wx, y + 14, 14, 10);
      }
    }
    return;
  }
  if (theme === 'temple') {
    ctx.fillStyle = '#6b4f3a';
    ctx.beginPath();
    ctx.moveTo(x, y + 6);
    ctx.lineTo(x + w, y + 6);
    ctx.lineTo(x + w - 18, y + h);
    ctx.lineTo(x + w * 0.6, y + h + h * 0.8);
    ctx.lineTo(x + w * 0.35, y + h + h * 0.6);
    ctx.lineTo(x + 18, y + h);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    for (let bx = x + 14; bx < x + w - 14; bx += 46) ctx.fillRect(bx, y + 14, 2, h - 14);
    // Pasto arriba.
    ctx.fillStyle = '#57b55d';
    roundRect(ctx, x - 3, y, w + 6, 10, 5);
    ctx.fill();
    ctx.fillStyle = '#7bd47f';
    ctx.fillRect(x + 4, y, w - 8, 3);
    return;
  }
  // Fábrica.
  ctx.fillStyle = moving ? '#3f3a52' : '#34304a';
  roundRect(ctx, x, y, w, h, 4);
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, 8);
  ctx.clip();
  for (let sx = x - 20 + ((now / 30) % 20) * (moving ? 1 : 0); sx < x + w; sx += 20) {
    ctx.fillStyle = '#facc15';
    ctx.beginPath();
    ctx.moveTo(sx, y + 8);
    ctx.lineTo(sx + 10, y);
    ctx.lineTo(sx + 20, y);
    ctx.lineTo(sx + 10, y + 8);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  ctx.fillStyle = '#1f1b2e';
  for (let bx = x + 10; bx < x + w - 10; bx += 28) {
    ctx.beginPath();
    ctx.arc(bx, y + h - 8, 3, 0, TAU);
    ctx.fill();
  }
  if (moving) {
    const on = Math.sin(now / 200) > 0;
    ctx.fillStyle = on ? '#f472b6' : '#831843';
    ctx.beginPath();
    ctx.arc(x + 8, y + h / 2 + 2, 4, 0, TAU);
    ctx.arc(x + w - 8, y + h / 2 + 2, 4, 0, TAU);
    ctx.fill();
  }
}

function drawCrate(ctx: CanvasRenderingContext2D, x: number, y: number, weapon: ShWeapon, landed: boolean, now: number): void {
  const s = SH.CRATE_SIZE;
  if (!landed) {
    // Paracaídas.
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x - s / 2, y - s);
    ctx.lineTo(x - 26, y - s - 34);
    ctx.moveTo(x + s / 2, y - s);
    ctx.lineTo(x + 26, y - s - 34);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y - s - 34, 30, Math.PI, 0);
    ctx.fillStyle = '#f472b6';
    ctx.fill();
    ctx.fillStyle = '#fbcfe8';
    ctx.beginPath();
    ctx.arc(x, y - s - 34, 30, Math.PI + 1.05, Math.PI + 2.1);
    ctx.lineTo(x, y - s - 34);
    ctx.fill();
  }
  const bob = landed ? 0 : Math.sin(now / 300) * 2;
  ctx.fillStyle = '#b45309';
  roundRect(ctx, x - s / 2, y - s + bob, s, s, 4);
  ctx.fill();
  ctx.strokeStyle = '#78350f';
  ctx.lineWidth = 2.5;
  ctx.strokeRect(x - s / 2 + 3, y - s + 3 + bob, s - 6, s - 6);
  ctx.font = '17px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(WEAPONS[weapon].icon, x, y - s / 2 + bob + 1);
  if (landed) {
    const glow = 0.4 + 0.3 * Math.sin(now / 160);
    ctx.strokeStyle = `rgba(253, 224, 71, ${glow})`;
    ctx.lineWidth = 2;
    roundRect(ctx, x - s / 2 - 3, y - s - 3, s + 6, s + 6, 6);
    ctx.stroke();
  }
}

function drawFighter(
  ctx: CanvasRenderingContext2D,
  f: ShFighter,
  sm: Smooth,
  p: PlayerPublic | undefined,
  isMe: boolean,
  now: number,
  ui: number,
): void {
  const dummy = f.playerId.startsWith('dummy-');
  const hue = dummy ? 30 : p?.avatar.hue ?? 200;
  const w = SH.HALF_W * 2;
  const h = SH.HEIGHT;
  const x = sm.x;
  const y = sm.y;
  const shielded = now < f.shieldUntil;
  const hurt = now - f.hitAt < 140;

  // Sombra en el piso.
  if (f.grounded) {
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(x, y + 1, w * 0.55, 4, 0, 0, TAU);
    ctx.fill();
  }

  ctx.save();
  ctx.translate(x, y);
  if (shielded) ctx.globalAlpha = 0.6 + 0.3 * Math.sin(now / 60);

  // Squash & stretch según la velocidad vertical.
  const stretch = f.grounded ? 1 : Math.max(0.85, Math.min(1.18, 1 + -f.vy / 4000));
  ctx.scale(1 / stretch, stretch);

  // Patitas.
  const step = f.grounded && Math.abs(f.vx) > 30 ? Math.sin(now / 70) * 4 : 0;
  ctx.fillStyle = `hsl(${hue} 45% 28%)`;
  roundRect(ctx, -w * 0.32 + step, -8, 8, 8, 3);
  ctx.fill();
  roundRect(ctx, w * 0.06 - step, -8, 8, 8, 3);
  ctx.fill();

  // Cuerpo.
  const body = ctx.createLinearGradient(-w / 2, -h, w / 2, 0);
  body.addColorStop(0, hurt ? '#ffffff' : dummy ? '#d6a46a' : `hsl(${hue} 80% 64%)`);
  body.addColorStop(1, hurt ? '#fecaca' : dummy ? '#8a5a2b' : `hsl(${hue} 75% 44%)`);
  ctx.fillStyle = body;
  roundRect(ctx, -w / 2, -h, w, h - 5, w * 0.48);
  ctx.fill();
  ctx.lineWidth = isMe ? 2.5 : 1.4;
  ctx.strokeStyle = isMe ? '#fde047' : 'rgba(0,0,0,0.45)';
  ctx.stroke();

  // Cara.
  ctx.font = `${Math.round(w * 0.78)}px serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(dummy ? '🎯' : p?.avatar.face ?? '🙂', f.face * 2, -h * 0.62);

  // Arma en la mano.
  ctx.save();
  ctx.translate(f.face * (w * 0.42), -h * 0.45);
  ctx.scale(f.face, 1);
  ctx.scale(w / 30, w / 30);
  drawGun(ctx, f.weapon, now < f.readyAt);
  ctx.restore();

  ctx.restore();

  // Escudo de reaparición.
  if (shielded) {
    const pulse = 0.5 + 0.5 * Math.sin(now / 90);
    ctx.beginPath();
    ctx.ellipse(x, y - h / 2, w * 0.95, h * 0.72, 0, 0, TAU);
    ctx.strokeStyle = `hsla(${hue} 90% 75% / ${0.5 + pulse * 0.4})`;
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  // Nombre y vidas.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Los textos se miden en píxeles de pantalla, no de mundo: si no, en pantallas chicas no se leen.
  const label = isMe ? 'VOS' : dummy ? 'MUÑECO' : short(p?.name ?? '—');
  ctx.font = `800 ${12 * ui}px Outfit, sans-serif`;
  const tw = ctx.measureText(label).width + 12 * ui;
  const tagY = y - h - 8 * ui - 8 * ui;
  ctx.fillStyle = 'rgba(8, 6, 14, 0.72)';
  roundRect(ctx, x - tw / 2, tagY - 8 * ui, tw, 16 * ui, 8 * ui);
  ctx.fill();
  ctx.fillStyle = isMe ? '#fde047' : '#ffffff';
  ctx.fillText(label, x, tagY + 0.5 * ui);
  if (!dummy && f.lives > 0) {
    ctx.font = `${10 * ui}px serif`;
    ctx.fillStyle = '#fb7185';
    ctx.fillText('♥'.repeat(Math.min(6, f.lives)), x, tagY - 15 * ui);
  }
}

function drawGun(ctx: CanvasRenderingContext2D, weapon: ShWeapon, recoil: boolean): void {
  const r = recoil ? -2 : 0;
  ctx.fillStyle = '#1f2937';
  if (weapon === 'shotgun') {
    roundRect(ctx, r, -4, 26, 7, 2);
    ctx.fill();
    ctx.fillStyle = '#92400e';
    roundRect(ctx, r - 8, -3, 10, 9, 2);
    ctx.fill();
  } else if (weapon === 'minigun') {
    roundRect(ctx, r, -6, 24, 11, 3);
    ctx.fill();
    ctx.fillStyle = '#9ca3af';
    for (let i = 0; i < 3; i++) ctx.fillRect(r + 20, -5 + i * 4, 9, 2);
  } else if (weapon === 'sniper') {
    roundRect(ctx, r, -3, 34, 5, 2);
    ctx.fill();
    ctx.fillStyle = '#22d3ee';
    ctx.fillRect(r + 8, -8, 10, 4);
  } else if (weapon === 'nades') {
    ctx.beginPath();
    ctx.arc(6, 0, 6, 0, TAU);
    ctx.fill();
  } else {
    roundRect(ctx, r, -3, 16, 6, 2);
    ctx.fill();
    ctx.fillRect(r + 1, 1, 5, 7);
  }
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
  return name.length > 10 ? `${name.slice(0, 9)}…` : name;
}
