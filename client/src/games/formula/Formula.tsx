import { useEffect, useMemo, useRef, useState } from 'react';
import { F99, TRACKS, driveStep, nearestSample, trackGeo, type DriveState, type TrackDef, type TrackGeo } from '@shared/formula';
import type { F99Car, F99Item, F99View, PlayerPublic } from '@shared/types';
import { api, serverNow } from '@/net/socket';
import { formatClock, useCountdown, useRaf, useSize } from '@/lib/hooks';
import { sfx } from '@/lib/sfx';
import { usePlayerMap, useStore } from '@/state/store';
import { Avatar, RankBadge } from '@/components/ui';

const TAU = Math.PI * 2;
/** cuántas unidades de mundo se ven a lo ancho (en pantallas grandes) */
const VIEW_SPAN = 1050;

export const ITEM_META: Record<F99Item, { icon: string; name: string }> = {
  turbo: { icon: '🍄', name: 'Turbo' },
  banana: { icon: '🍌', name: 'Banana' },
  oil: { icon: '🛢️', name: 'Aceite' },
  missile: { icon: '🚀', name: 'Misil' },
  bomb: { icon: '💣', name: 'Bomba' },
  zap: { icon: '⚡', name: 'Rayo' },
  shield: { icon: '🛡️', name: 'Escudo' },
};
const ROLL_ICONS = Object.values(ITEM_META).map((m) => m.icon);
const ROLL_MS = 750;

interface Smooth {
  x: number;
  y: number;
  a: number;
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
  grow?: number;
}

interface Deco {
  x: number;
  y: number;
  r: number;
  k: number;
}

export function Formula({ view }: { view: F99View }): JSX.Element {
  const players = usePlayerMap();
  const meId = useStore((s) => s.playerId);
  const [wrapRef, size] = useSize<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const miniRef = useRef<HTMLCanvasElement>(null);

  const snap = useRef(view);
  snap.current = view;

  const def = TRACKS[view.track] ?? TRACKS[0];
  const geo = useMemo(() => trackGeo(view.track), [view.track]);
  const path = useMemo(() => trackPath(geo), [geo]);
  const decos = useMemo(() => buildDecos(geo, view.track), [geo, view.track]);
  const grass = useRef<{ track: number; pattern: CanvasPattern | null }>({ track: -1, pattern: null });

  const smooth = useRef(new Map<string, Smooth>());
  const pred = useRef<(DriveState & { idx: number }) | null>(null);
  const cam = useRef<{ x: number; y: number } | null>(null);
  const particles = useRef<Particle[]>([]);
  const seenFx = useRef(new Set<number>());
  const shake = useRef(0);
  const flash = useRef(0);
  const keys = useRef({ up: false, down: false, left: false, right: false });
  const sentInput = useRef('0:0');
  const input = useRef({ throttle: 0, steer: 0 });

  const me = view.cars.find((c) => c.playerId === meId);
  const racing = view.stage === 'race';
  const countdown = useCountdown(view.stage === 'countdown' ? view.startAt : null, 20);
  const graceLeft = useCountdown(racing && view.until ? view.until : null, 4);
  const podiumLeft = useCountdown(view.stage === 'podium' ? view.until : null, 4);
  const [clock, setClock] = useState(0);

  // Reloj de carrera (no hace falta a 60 fps).
  useEffect(() => {
    const id = setInterval(() => setClock(Math.max(0, serverNow() - snap.current.startAt)), 100);
    return () => clearInterval(id);
  }, []);

  /* ── ruleta del objeto ─────────────────────────────────────────────── */
  const [rolling, setRolling] = useState(false);
  const lastItemAt = useRef(0);
  useEffect(() => {
    if (!me?.item || me.itemAt === lastItemAt.current) return;
    lastItemAt.current = me.itemAt;
    if (serverNow() - me.itemAt > ROLL_MS) return;
    setRolling(true);
    const tick = setInterval(() => sfx.itemRoll(), 70);
    const done = setTimeout(() => {
      clearInterval(tick);
      setRolling(false);
      sfx.item();
    }, ROLL_MS);
    return () => {
      clearInterval(tick);
      clearTimeout(done);
      setRolling(false);
    };
  }, [me?.item, me?.itemAt]);

  /* ── efectos: sonidos y partículas ─────────────────────────────────── */
  useEffect(() => {
    for (const fx of view.fx) {
      if (seenFx.current.has(fx.id)) continue;
      seenFx.current.add(fx.id);
      const mine = fx.playerId === meId;
      switch (fx.kind) {
        case 'pickup':
          if (mine) sfx.pick();
          burst(particles.current, fx.x, fx.y, 12, ['#fde047', '#f472b6', '#38bdf8', '#ffffff'], 180, 0.5);
          break;
        case 'boost':
          if (mine) sfx.boost();
          break;
        case 'pad':
          if (mine) sfx.boost();
          break;
        case 'spin':
          if (mine) {
            sfx.spin();
            shake.current = 8;
          }
          break;
        case 'boom':
          sfx.boom();
          burst(particles.current, fx.x, fx.y, 34, ['#fde047', '#fb923c', '#ef4444', '#44403c'], 300, 0.8);
          shake.current = Math.max(shake.current, 7);
          break;
        case 'zap':
          sfx.zap();
          if (!mine) flash.current = 1;
          break;
        case 'lap':
          if (mine) sfx.lap();
          break;
        case 'finish':
          if (mine) sfx.fanfare();
          else sfx.lap();
          break;
        case 'block':
          if (mine) sfx.good();
          break;
        case 'drop':
          if (mine) sfx.drop();
          break;
        case 'launch':
          sfx.missile();
          break;
      }
    }
    if (seenFx.current.size > 500) seenFx.current = new Set(view.fx.map((f) => f.id));
  }, [view.fx, meId]);

  // Semáforo de largada.
  const lastLight = useRef(-1);
  useEffect(() => {
    if (view.stage !== 'countdown') {
      lastLight.current = -1;
      return;
    }
    const lit = lightsOn(countdown);
    if (lit !== lastLight.current) {
      if (lit > 0 && lit < 4) sfx.light();
      lastLight.current = lit;
    }
  }, [countdown, view.stage]);
  const prevStage = useRef(view.stage);
  useEffect(() => {
    if (prevStage.current === 'countdown' && view.stage === 'race') sfx.go();
    prevStage.current = view.stage;
  }, [view.stage]);

  // Carrera nueva: limpiamos predicción y cámara.
  useEffect(() => {
    pred.current = null;
    cam.current = null;
    smooth.current.clear();
    particles.current = [];
  }, [view.race]);

  /* ── controles ─────────────────────────────────────────────────────── */
  const syncInput = () => {
    const k = keys.current;
    const throttle = (k.up ? 1 : 0) - (k.down ? 1 : 0);
    const steer = (k.right ? 1 : 0) - (k.left ? 1 : 0);
    input.current = { throttle, steer };
    const key = `${throttle}:${steer}`;
    if (key === sentInput.current) return;
    sentInput.current = key;
    api.send('input', { throttle, steer });
  };

  const setKey = (k: keyof typeof keys.current, down: boolean) => {
    if (keys.current[k] === down) return;
    keys.current[k] = down;
    syncInput();
  };

  const fireItem = () => {
    const v = snap.current;
    const mine = v.cars.find((c) => c.playerId === meId);
    if (v.stage !== 'race' || !mine?.item) return;
    if (serverNow() - mine.itemAt < ROLL_MS) return;
    api.send('use');
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
      } else if (e.code === 'Space' || e.code === 'KeyJ' || e.code === 'KeyE') {
        e.preventDefault();
        if (!e.repeat) fireItem();
      }
    };
    const up = (e: KeyboardEvent) => {
      const k = map[e.code];
      if (k) setKey(k, false);
    };
    const blur = () => {
      keys.current = { up: false, down: false, left: false, right: false };
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

  /* ── canvas ────────────────────────────────────────────────────────── */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !size.w) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = size.w * dpr;
    canvas.height = size.h * dpr;
    canvas.style.width = `${size.w}px`;
    canvas.style.height = `${size.h}px`;
  }, [size.w, size.h]);

  const mini = useMemo(() => {
    const w = 170;
    const sx = w / (geo.maxX - geo.minX);
    const h = Math.round((geo.maxY - geo.minY) * sx);
    return { w, h, s: sx };
  }, [geo]);

  useEffect(() => {
    const c = miniRef.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = mini.w * dpr;
    c.height = mini.h * dpr;
    c.style.width = `${mini.w}px`;
    c.style.height = `${mini.h}px`;
  }, [mini]);

  useRaf((dt) => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx || !size.w) return;
    const v = snap.current;
    const now = serverNow();

    if (grass.current.track !== v.track) {
      grass.current = { track: v.track, pattern: grassPattern(ctx, def) };
    }

    // Predicción del auto propio con la misma física del servidor.
    const mine = v.cars.find((c) => c.playerId === meId);
    if (mine && v.stage === 'race') {
      const elapsed = Math.max(0, Math.min(0.12, (now - v.t) / 1000));
      const sx = mine.x + mine.vx * elapsed;
      const sy = mine.y + mine.vy * elapsed;
      let p = pred.current;
      if (!p || Math.hypot(p.x - sx, p.y - sy) > 70 || now < mine.spinUntil) {
        p = { ...toDrive(mine), x: sx, y: sy, idx: -1 };
      } else {
        Object.assign(p, {
          spinUntil: mine.spinUntil,
          spinDir: mine.spinDir,
          boostUntil: mine.boostUntil,
          padUntil: mine.padUntil,
          shrinkUntil: mine.shrinkUntil,
          oilUntil: mine.oilUntil,
        });
      }
      const near = nearestSample(geo, p.x, p.y, p.idx, 26);
      p.idx = near.i;
      p.offTrack = near.d > geo.width / 2 + F99.CAR_R * 0.2;
      const done = mine.finishedAt !== null;
      driveStep(p, done ? 0 : input.current.throttle, done ? 0 : input.current.steer, dt, now);
      // Corrección suave hacia lo que dice el servidor.
      const k = Math.min(1, dt * 4);
      p.x += (sx - p.x) * k;
      p.y += (sy - p.y) * k;
      p.vx += (mine.vx - p.vx) * k;
      p.vy += (mine.vy - p.vy) * k;
      p.a += angDiff(mine.a, p.a) * Math.min(1, dt * 3);
      pred.current = p;
    } else {
      pred.current = null;
    }

    paint(ctx, {
      v,
      def,
      geo,
      path,
      decos,
      pattern: grass.current.pattern,
      w: size.w,
      h: size.h,
      smooth: smooth.current,
      pred: pred.current,
      cam,
      particles: particles.current,
      players,
      meId,
      dt,
      shake,
      flash,
      now,
    });

    const mctx = miniRef.current?.getContext('2d');
    if (mctx) paintMini(mctx, v, geo, mini, players, meId);
  });

  /* ── interfaz ──────────────────────────────────────────────────────── */
  const ranking = [...view.cars].sort((a, b) => a.place - b.place);
  const itemShown = me?.item ? ITEM_META[me.item] : null;
  const speed = me ? Math.hypot(me.vx, me.vy) : 0;
  const finished = me?.finishedAt != null;

  return (
    <div className="f9">
      <div className="f9__stage" ref={wrapRef}>
        <canvas ref={canvasRef} className="f9__canvas" />

        <div className="f9__hud f9__hud--tl">
          {me && (
            <div className="f9__place">
              <b className="tnum">{me.place}º</b>
              <span>/ {view.cars.length}</span>
            </div>
          )}
          {me && (
            <div className="f9__lap">
              <span className="label">Vuelta</span>
              <b className="tnum">
                {finished ? view.laps : me.lap}/{view.laps}
              </b>
            </div>
          )}
          <div className="f9__clock tnum">{racing || view.stage === 'podium' ? formatClockMs(clock) : '0:00.0'}</div>
        </div>

        <div className="f9__hud f9__hud--tr">
          <button
            className={`f9__item ${itemShown && !rolling ? 'f9__item--ready' : ''}`}
            onPointerDown={(e) => {
              e.preventDefault();
              fireItem();
            }}
            disabled={!itemShown || rolling || !racing}
            aria-label={itemShown ? `Usar ${itemShown.name}` : 'Sin objeto'}
          >
            {rolling ? <RollingIcon /> : itemShown ? itemShown.icon : '❓'}
          </button>
          <span className="f9__itemname">{rolling ? '…' : itemShown ? itemShown.name : 'sin objeto'}</span>
        </div>

        <div className="f9__hud f9__hud--bl">
          <canvas ref={miniRef} className="f9__mini" />
        </div>

        <div className="f9__hud f9__hud--br">
          <div className="f9__speed">
            <div className="f9__speedfill" style={{ width: `${Math.min(100, (speed / (F99.MAX_SPEED * F99.BOOST_MULT)) * 100)}%` }} />
          </div>
          <span className="f9__kmh tnum">{Math.round(speed * 0.6)} km/h</span>
        </div>

        {view.stage === 'countdown' && (
          <div className="f9__overlay">
            <div className="f9__trackname anim-pop">
              <b>{def.theme.name}</b>
              <span>
                {def.theme.tag} · carrera {view.race} de {view.totalRaces}
              </span>
            </div>
            <div className="f9__lights" aria-label="Semáforo">
              {[0, 1, 2].map((i) => (
                <span key={i} className={`f9__light ${lightsOn(countdown) > i ? 'f9__light--on' : ''}`} />
              ))}
            </div>
            <p className="sm__ready">↑ acelerar · ← → doblar · espacio objeto</p>
          </div>
        )}

        {racing && view.until && !finished && (
          <div className="f9__grace anim-fade">🏁 La carrera se cierra en {Math.ceil(graceLeft / 1000)}s</div>
        )}

        {racing && finished && me && (
          <div className="f9__banner anim-pop">
            <b>¡Llegaste {me.place}º!</b>
            <span>Esperando al resto…</span>
          </div>
        )}

        {view.stage === 'podium' && view.raceResults && (
          <div className="f9__overlay f9__overlay--dim">
            <div className="card f9__podium anim-pop">
              <h3 className="card__title">
                🏁 {def.theme.name} ·{' '}
                {view.race < view.totalRaces ? `próxima carrera en ${Math.ceil(podiumLeft / 1000)}` : 'final'}
              </h3>
              <ol className="plist">
                {view.raceResults.map((r) => {
                  const p = players.get(r.playerId);
                  if (!p) return null;
                  return (
                    <li key={r.playerId} className={`prow ${r.playerId === meId ? 'prow--me' : ''}`}>
                      <RankBadge rank={r.place} />
                      <Avatar avatar={p.avatar} size={28} />
                      <span className="grow prow__name">{p.name}</span>
                      <span className="f9__time tnum">{r.time !== null ? formatClockMs(r.time) : 'no llegó'}</span>
                      <span className="prow__score tnum">+{r.points}</span>
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>
        )}
      </div>

      <aside className="f9__side panel">
        <h3 className="card__title">Posiciones</h3>
        <ol className="plist">
          {ranking.map((c) => {
            const p = players.get(c.playerId);
            if (!p) return null;
            return (
              <li key={c.playerId} className={`prow ${c.playerId === meId ? 'prow--me' : ''}`}>
                <RankBadge rank={c.place} />
                <span className="tq__swatch" style={{ background: `hsl(${p.avatar.hue} 80% 55%)` }} />
                <Avatar avatar={p.avatar} size={24} offline={!p.connected} />
                <span className="grow prow__name">{p.name}</span>
                <span className="f9__lapchip tnum">{c.finishedAt !== null ? '🏁' : `V${c.lap}`}</span>
                <span className="prow__score tnum">{view.totals[c.playerId] ?? 0}</span>
              </li>
            );
          })}
        </ol>
        <p className="hint f9__help">↑/W acelera · ↓/S frena · ←→/AD dobla · espacio usa el objeto</p>
      </aside>

      <footer className="f9__controls">
        <div className="f9__steer">
          {(
            [
              ['left', '◀'],
              ['right', '▶'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              className="f9__btn"
              onPointerDown={(e) => {
                e.preventDefault();
                setKey(k, true);
              }}
              onPointerUp={() => setKey(k, false)}
              onPointerLeave={() => setKey(k, false)}
              onPointerCancel={() => setKey(k, false)}
              aria-label={k === 'left' ? 'Doblar a la izquierda' : 'Doblar a la derecha'}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="f9__pedals">
          <button
            className="f9__btn f9__btn--brake"
            onPointerDown={(e) => {
              e.preventDefault();
              setKey('down', true);
            }}
            onPointerUp={() => setKey('down', false)}
            onPointerLeave={() => setKey('down', false)}
            onPointerCancel={() => setKey('down', false)}
            aria-label="Frenar"
          >
            FRENO
          </button>
          <button
            className="f9__btn f9__btn--gas"
            onPointerDown={(e) => {
              e.preventDefault();
              setKey('up', true);
            }}
            onPointerUp={() => setKey('up', false)}
            onPointerLeave={() => setKey('up', false)}
            onPointerCancel={() => setKey('up', false)}
            aria-label="Acelerar"
          >
            GAS
          </button>
        </div>
      </footer>
    </div>
  );
}

function RollingIcon(): JSX.Element {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((n) => (n + 1) % ROLL_ICONS.length), 70);
    return () => clearInterval(id);
  }, []);
  return <span className="f9__roll">{ROLL_ICONS[i]}</span>;
}

/* ── helpers ──────────────────────────────────────────────────────────────── */

/** Cuántas luces del semáforo están prendidas (4 = verde). */
function lightsOn(left: number): number {
  if (left <= 0) return 4;
  if (left < 1000) return 3;
  if (left < 2000) return 2;
  if (left < 3000) return 1;
  return 0;
}

function formatClockMs(ms: number): string {
  const tenths = Math.floor((ms % 1000) / 100);
  return `${formatClock(Math.floor(ms / 1000) * 1000)}.${tenths}`;
}

function toDrive(c: F99Car): DriveState {
  return {
    x: c.x,
    y: c.y,
    a: c.a,
    vx: c.vx,
    vy: c.vy,
    spinUntil: c.spinUntil,
    spinDir: c.spinDir,
    boostUntil: c.boostUntil,
    padUntil: c.padUntil,
    shrinkUntil: c.shrinkUntil,
    oilUntil: c.oilUntil,
    offTrack: c.offTrack,
  };
}

function angDiff(a: number, b: number): number {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

function trackPath(geo: TrackGeo): Path2D {
  const p = new Path2D();
  p.moveTo(geo.xs[0], geo.ys[0]);
  for (let i = 1; i < geo.n; i++) p.lineTo(geo.xs[i], geo.ys[i]);
  p.closePath();
  return p;
}

/** Árboles / palmeras / pinos al costado, sin pisar nunca la pista. */
function buildDecos(geo: TrackGeo, seed: number): Deco[] {
  let s = seed * 7919 + 13;
  const rand = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  const out: Deco[] = [];
  const clear = geo.width / 2 + 95;
  const x0 = geo.minX - 300;
  const y0 = geo.minY - 300;
  const w = geo.maxX - geo.minX + 600;
  const h = geo.maxY - geo.minY + 600;
  for (let i = 0; i < 520 && out.length < 170; i++) {
    const x = x0 + rand() * w;
    const y = y0 + rand() * h;
    const r = 16 + rand() * 18;
    if (nearestSample(geo, x, y).d < clear + r) continue;
    if (out.some((d) => Math.hypot(d.x - x, d.y - y) < d.r + r + 6)) continue;
    out.push({ x, y, r, k: rand() });
  }
  return out;
}

function grassPattern(ctx: CanvasRenderingContext2D, def: TrackDef): CanvasPattern | null {
  const c = document.createElement('canvas');
  c.width = 96;
  c.height = 96;
  const g = c.getContext('2d');
  if (!g) return null;
  g.fillStyle = def.theme.grass[0];
  g.fillRect(0, 0, 96, 96);
  g.fillStyle = def.theme.grass[1];
  g.fillRect(0, 0, 48, 96);
  // Motitas para que no se vea plano.
  for (let i = 0; i < 40; i++) {
    g.fillStyle = i % 2 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
    g.fillRect(Math.random() * 96, Math.random() * 96, 2, 2);
  }
  return ctx.createPattern(c, 'repeat');
}

function burst(list: Particle[], x: number, y: number, n: number, colors: string[], speed: number, life: number): void {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU;
    const v = speed * (0.3 + Math.random() * 0.7);
    const l = life * (0.5 + Math.random() * 0.6);
    list.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: l, max: l, size: 3 + Math.random() * 5, color: colors[Math.floor(Math.random() * colors.length)] });
  }
  if (list.length > 600) list.splice(0, list.length - 600);
}

/* ── dibujo ───────────────────────────────────────────────────────────────── */

interface PaintArgs {
  v: F99View;
  def: TrackDef;
  geo: TrackGeo;
  path: Path2D;
  decos: Deco[];
  pattern: CanvasPattern | null;
  w: number;
  h: number;
  smooth: Map<string, Smooth>;
  pred: DriveState | null;
  cam: React.MutableRefObject<{ x: number; y: number } | null>;
  particles: Particle[];
  players: Map<string, PlayerPublic>;
  meId: string | null;
  dt: number;
  shake: React.MutableRefObject<number>;
  flash: React.MutableRefObject<number>;
  now: number;
}

function paint(ctx: CanvasRenderingContext2D, a: PaintArgs): void {
  const { v, def, geo, path, decos, pattern, w, h, smooth, pred, cam, particles, players, meId, dt, shake, flash, now } = a;
  const dpr = ctx.canvas.width / w;
  const scale = Math.max(w, h * 1.25) / VIEW_SPAN;
  const theme = def.theme;

  /* ── autos suavizados ── */
  const elapsed = Math.max(0, Math.min(0.12, (now - v.t) / 1000));
  const k = Math.min(1, dt * 16);
  for (const c of v.cars) {
    const tx = c.x + c.vx * elapsed;
    const ty = c.y + c.vy * elapsed;
    let sm = smooth.get(c.playerId);
    if (!sm || Math.hypot(tx - sm.x, ty - sm.y) > 120) {
      sm = { x: tx, y: ty, a: c.a };
      smooth.set(c.playerId, sm);
    } else {
      sm.x += (tx - sm.x) * k;
      sm.y += (ty - sm.y) * k;
      sm.a += angDiff(c.a, sm.a) * k;
    }
    if (c.playerId === meId && pred) {
      sm.x = pred.x;
      sm.y = pred.y;
      sm.a = pred.a;
    }
  }

  /* ── cámara: sigue a tu auto mirando un poco hacia adelante ── */
  const mine = v.cars.find((c) => c.playerId === meId);
  const mySm = meId ? smooth.get(meId) : undefined;
  let target: { x: number; y: number };
  if (mine && mySm) {
    const vx = pred?.vx ?? mine.vx;
    const vy = pred?.vy ?? mine.vy;
    target = { x: mySm.x + vx * 0.38, y: mySm.y + vy * 0.38 };
  } else {
    // Espectador: sigue al que va primero.
    const leader = [...v.cars].sort((p, q) => p.place - q.place)[0];
    const ls = leader ? smooth.get(leader.playerId) : undefined;
    target = ls ? { x: ls.x, y: ls.y } : { x: (geo.minX + geo.maxX) / 2, y: (geo.minY + geo.maxY) / 2 };
  }
  if (!cam.current) cam.current = { ...target };
  else {
    const ck = Math.min(1, dt * 5);
    cam.current.x += (target.x - cam.current.x) * ck;
    cam.current.y += (target.y - cam.current.y) * ck;
  }
  let shx = 0;
  let shy = 0;
  if (shake.current > 0.2) {
    shx = (Math.random() - 0.5) * shake.current;
    shy = (Math.random() - 0.5) * shake.current;
    shake.current *= Math.pow(0.004, dt);
  }
  const cx = cam.current.x;
  const cy = cam.current.y;
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * (w / 2 - cx * scale + shx), dpr * (h / 2 - cy * scale + shy));
  const vw = w / scale;
  const vh = h / scale;
  const view = { x0: cx - vw / 2 - 60, y0: cy - vh / 2 - 60, x1: cx + vw / 2 + 60, y1: cy + vh / 2 + 60 };

  /* ── pasto ── */
  ctx.fillStyle = pattern ?? theme.grass[0];
  ctx.fillRect(view.x0, view.y0, view.x1 - view.x0, view.y1 - view.y0);

  /* ── pista ── */
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  // Sombra suave del asfalto.
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.lineWidth = geo.width + 34;
  ctx.stroke(path);
  // Pianitos.
  ctx.strokeStyle = theme.curb[0];
  ctx.lineWidth = geo.width + 18;
  ctx.stroke(path);
  ctx.setLineDash([26, 26]);
  ctx.strokeStyle = theme.curb[1];
  ctx.stroke(path);
  ctx.setLineDash([]);
  // Asfalto.
  ctx.strokeStyle = theme.asphalt;
  ctx.lineWidth = geo.width;
  ctx.stroke(path);
  // Bordes blancos.
  ctx.strokeStyle = theme.edge;
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = geo.width - 8;
  ctx.stroke(path);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = theme.asphalt;
  ctx.lineWidth = geo.width - 14;
  ctx.stroke(path);
  // Línea central punteada.
  ctx.setLineDash([34, 46]);
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 3;
  ctx.stroke(path);
  ctx.setLineDash([]);

  /* ── largada a cuadros ── */
  {
    const x = geo.xs[0];
    const y = geo.ys[0];
    const ang = Math.atan2(geo.ty[0], geo.tx[0]);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    const half = geo.width / 2 - 7;
    const sq = 9;
    for (let row = 0; row < 2; row++) {
      for (let yy = -half, c = 0; yy < half; yy += sq, c++) {
        ctx.fillStyle = (c + row) % 2 ? '#111827' : '#f8fafc';
        ctx.fillRect(-sq + row * sq, yy, sq, Math.min(sq, half - yy));
      }
    }
    ctx.restore();
  }

  /* ── flechas de turbo ── */
  for (const p of geo.pads) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.a);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.55)';
    roundRect(ctx, -34, -22, 68, 44, 8);
    ctx.fill();
    const glow = 0.55 + 0.45 * Math.sin(now / 120);
    for (let i = 0; i < 3; i++) {
      const ox = -20 + i * 15;
      ctx.beginPath();
      ctx.moveTo(ox, -14);
      ctx.lineTo(ox + 12, 0);
      ctx.lineTo(ox, 14);
      ctx.lineTo(ox + 5, 0);
      ctx.closePath();
      ctx.fillStyle = `rgba(250, 204, 21, ${0.4 + glow * 0.6 * ((i + 1) / 3)})`;
      ctx.fill();
    }
    ctx.restore();
  }

  /* ── cajas ── */
  geo.boxes.forEach((b, i) => {
    const respawn = v.boxes[i] ?? 0;
    const active = respawn <= now;
    if (!inView(view, b.x, b.y)) return;
    ctx.save();
    ctx.translate(b.x, b.y + (active ? Math.sin(now / 260 + i) * 2 : 0));
    if (!active) {
      const t = 1 - Math.max(0, Math.min(1, (respawn - now) / F99.BOX_RESPAWN));
      ctx.scale(t, t);
      ctx.globalAlpha = 0.5;
    }
    ctx.rotate(now / 900 + i);
    const r = F99.BOX_R;
    const grad = ctx.createLinearGradient(-r, -r, r, r);
    grad.addColorStop(0, `hsl(${(now / 8 + i * 40) % 360} 90% 65%)`);
    grad.addColorStop(1, `hsl(${(now / 8 + i * 40 + 120) % 360} 90% 55%)`);
    ctx.fillStyle = grad;
    roundRect(ctx, -r, -r, r * 2, r * 2, 5);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.rotate(-(now / 900 + i));
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 18px Outfit, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', 0, 1);
    ctx.restore();
  });

  /* ── peligros ── */
  for (const hz of v.hazards) {
    const hx = hz.x + hz.vx * elapsed;
    const hy = hz.y + hz.vy * elapsed;
    if (!inView(view, hx, hy)) continue;
    if (hz.kind === 'oil') {
      ctx.save();
      ctx.translate(hx, hy);
      const g = ctx.createRadialGradient(-6, -6, 2, 0, 0, F99.OIL_R);
      g.addColorStop(0, '#4b5563');
      g.addColorStop(0.6, '#111827');
      g.addColorStop(1, 'rgba(17,24,39,0.6)');
      ctx.fillStyle = g;
      ctx.beginPath();
      for (let i = 0; i < 9; i++) {
        const ang = (i / 9) * TAU;
        const rr = F99.OIL_R * (0.8 + 0.25 * Math.sin(i * 2.7 + hz.id));
        if (i === 0) ctx.moveTo(Math.cos(ang) * rr, Math.sin(ang) * rr);
        else ctx.lineTo(Math.cos(ang) * rr, Math.sin(ang) * rr);
      }
      ctx.closePath();
      ctx.fill();
      // Brillo arcoíris del aceite.
      ctx.strokeStyle = `hsla(${(now / 10) % 360} 80% 70% / 0.35)`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(-4, -3, 10, 5, 0.4, 0, TAU);
      ctx.stroke();
      ctx.restore();
    } else {
      emoji(ctx, hz.kind === 'banana' ? '🍌' : '💣', hx, hy, hz.kind === 'banana' ? 26 : 28, hz.id);
      if (hz.kind === 'bomb') {
        const left = hz.fuseAt - now;
        const blink = left < 600 ? Math.sin(now / 40) > 0 : Math.sin(now / 110) > 0;
        if (blink) {
          ctx.beginPath();
          ctx.arc(hx, hy, F99.BOMB_RADIUS * (1 - Math.max(0, left) / F99.BOMB_FUSE), 0, TAU);
          ctx.strokeStyle = 'rgba(239, 68, 68, 0.45)';
          ctx.lineWidth = 3;
          ctx.stroke();
        }
      }
    }
  }

  /* ── decoración ── */
  for (const d of decos) {
    if (!inView(view, d.x, d.y)) continue;
    drawDeco(ctx, d, theme.deco, theme.decoColor);
  }

  /* ── misiles ── */
  for (const m of v.missiles) {
    const mx = m.x + Math.cos(m.a) * F99.MISSILE_SPEED * elapsed;
    const my = m.y + Math.sin(m.a) * F99.MISSILE_SPEED * elapsed;
    if (Math.random() < 0.8) {
      particles.push({ x: mx - Math.cos(m.a) * 14, y: my - Math.sin(m.a) * 14, vx: (Math.random() - 0.5) * 30, vy: (Math.random() - 0.5) * 30, life: 0.5, max: 0.5, size: 6, color: 'rgba(226,232,240,0.6)', grow: 18 });
    }
    ctx.save();
    ctx.translate(mx, my);
    ctx.rotate(m.a + Math.PI / 4);
    ctx.font = '28px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🚀', 0, 0);
    ctx.restore();
  }

  /* ── partículas de piso (humo, polvo) ── */
  for (const c of v.cars) {
    const sm = smooth.get(c.playerId);
    if (!sm) continue;
    const sp = Math.hypot(c.vx, c.vy);
    const boosting = now < c.boostUntil || now < c.padUntil;
    if (c.offTrack && sp > 60 && Math.random() < 0.5) {
      particles.push({ x: sm.x - Math.cos(sm.a) * 14, y: sm.y - Math.sin(sm.a) * 14, vx: (Math.random() - 0.5) * 40, vy: (Math.random() - 0.5) * 40, life: 0.6, max: 0.6, size: 7, color: theme.deco === 'pines' ? 'rgba(255,255,255,0.7)' : 'rgba(120, 90, 50, 0.45)', grow: 14 });
    }
    if (boosting && Math.random() < 0.9) {
      particles.push({ x: sm.x - Math.cos(sm.a) * 20, y: sm.y - Math.sin(sm.a) * 20, vx: -Math.cos(sm.a) * 120, vy: -Math.sin(sm.a) * 120, life: 0.3, max: 0.3, size: 7, color: Math.random() < 0.5 ? '#fde047' : '#fb923c' });
    }
    if (now < c.spinUntil && Math.random() < 0.6) {
      particles.push({ x: sm.x, y: sm.y, vx: (Math.random() - 0.5) * 60, vy: (Math.random() - 0.5) * 60, life: 0.7, max: 0.7, size: 8, color: 'rgba(203,213,225,0.55)', grow: 20 });
    }
  }
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
    p.vy *= Math.pow(0.1, dt);
    if (p.grow) p.size += p.grow * dt;
    ctx.globalAlpha = Math.max(0, p.life / p.max);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size / 2, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  /* ── autos ── */
  const order = [...v.cars].sort((p, q) => (p.playerId === meId ? 1 : 0) - (q.playerId === meId ? 1 : 0));
  for (const c of order) {
    const sm = smooth.get(c.playerId);
    if (!sm || !inView(view, sm.x, sm.y)) continue;
    drawCar(ctx, c, sm, players.get(c.playerId), c.playerId === meId, now);
  }

  /* ── efectos de anillo ── */
  for (const fx of v.fx) {
    const age = (now - fx.at) / 1000;
    if (age < 0) continue;
    if (fx.kind === 'boom' && age < 0.55) {
      const t = age / 0.55;
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, 18 + t * F99.BOMB_RADIUS, 0, TAU);
      ctx.strokeStyle = `rgba(253, 186, 116, ${1 - t})`;
      ctx.lineWidth = 9 * (1 - t);
      ctx.stroke();
    } else if ((fx.kind === 'lap' || fx.kind === 'pickup') && age < 0.5) {
      const t = age / 0.5;
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, 14 + t * 40, 0, TAU);
      ctx.strokeStyle = `rgba(253, 224, 71, ${1 - t})`;
      ctx.lineWidth = 4 * (1 - t);
      ctx.stroke();
    }
  }

  /* ── nombres ── */
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const c of v.cars) {
    if (c.playerId === meId) continue;
    const sm = smooth.get(c.playerId);
    if (!sm || !inView(view, sm.x, sm.y)) continue;
    const p = players.get(c.playerId);
    const label = `${c.place}º ${short(p?.name ?? '—')}`;
    ctx.font = '800 12px Outfit, sans-serif';
    const tw = ctx.measureText(label).width + 12;
    ctx.fillStyle = 'rgba(8, 10, 14, 0.7)';
    roundRect(ctx, sm.x - tw / 2, sm.y - 42, tw, 17, 8);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, sm.x, sm.y - 33);
  }

  /* ── destello del rayo ── */
  if (flash.current > 0.01) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = `rgba(250, 250, 210, ${flash.current * 0.55})`;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    flash.current *= Math.pow(0.02, dt);
  }
}

function inView(v: { x0: number; y0: number; x1: number; y1: number }, x: number, y: number): boolean {
  return x > v.x0 && x < v.x1 && y > v.y0 && y < v.y1;
}

function drawCar(ctx: CanvasRenderingContext2D, c: F99Car, sm: Smooth, p: PlayerPublic | undefined, isMe: boolean, now: number): void {
  const hue = p?.avatar.hue ?? 0;
  const shrunk = now < c.shrinkUntil;
  const s = shrunk ? 0.68 : 1;
  const ghost = c.finishedAt !== null;
  ctx.save();
  ctx.translate(sm.x, sm.y);
  if (ghost) ctx.globalAlpha = 0.45;

  // Escudo.
  if (now < c.shieldUntil) {
    const pulse = 0.5 + 0.5 * Math.sin(now / 90);
    ctx.beginPath();
    ctx.arc(0, 0, 30 * s, 0, TAU);
    ctx.fillStyle = `rgba(56, 189, 248, ${0.12 + pulse * 0.08})`;
    ctx.fill();
    ctx.strokeStyle = `rgba(125, 211, 252, ${0.5 + pulse * 0.4})`;
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  ctx.rotate(sm.a);
  ctx.scale(s, s);

  // Sombra.
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  roundRect(ctx, -19, -11, 42, 26, 9);
  ctx.fill();

  // Ruedas.
  ctx.fillStyle = '#111827';
  for (const [wx, wy] of [
    [-13, -13],
    [-13, 9],
    [11, -13],
    [11, 9],
  ]) {
    roundRect(ctx, wx, wy, 10, 5, 2);
    ctx.fill();
  }

  // Llama del turbo.
  if (now < c.boostUntil || now < c.padUntil) {
    const fl = 10 + Math.random() * 10;
    ctx.beginPath();
    ctx.moveTo(-20, -5);
    ctx.lineTo(-20 - fl, 0);
    ctx.lineTo(-20, 5);
    ctx.closePath();
    ctx.fillStyle = '#fb923c';
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-20, -3);
    ctx.lineTo(-20 - fl * 0.55, 0);
    ctx.lineTo(-20, 3);
    ctx.closePath();
    ctx.fillStyle = '#fde047';
    ctx.fill();
  }

  // Carrocería.
  const body = ctx.createLinearGradient(0, -10, 0, 10);
  body.addColorStop(0, `hsl(${hue} 85% 62%)`);
  body.addColorStop(1, `hsl(${hue} 80% 42%)`);
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(22, 0);
  ctx.quadraticCurveTo(20, -9, 8, -10);
  ctx.lineTo(-16, -10);
  ctx.quadraticCurveTo(-21, -10, -21, -5);
  ctx.lineTo(-21, 5);
  ctx.quadraticCurveTo(-21, 10, -16, 10);
  ctx.lineTo(8, 10);
  ctx.quadraticCurveTo(20, 9, 22, 0);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = isMe ? '#fde047' : 'rgba(0,0,0,0.45)';
  ctx.lineWidth = isMe ? 2.2 : 1.2;
  ctx.stroke();

  // Alerón y franja.
  ctx.fillStyle = `hsl(${hue} 60% 25%)`;
  roundRect(ctx, -24, -11, 5, 22, 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fillRect(10, -2, 10, 4);

  // Cabina con la cara (siempre derecha).
  ctx.beginPath();
  ctx.arc(-3, 0, 7.5, 0, TAU);
  ctx.fillStyle = 'rgba(15,23,42,0.85)';
  ctx.fill();
  ctx.rotate(-sm.a);
  ctx.font = '13px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const off = { x: Math.cos(sm.a) * -3, y: Math.sin(sm.a) * -3 };
  ctx.fillText(p?.avatar.face ?? '🙂', off.x, off.y + 0.5);
  ctx.restore();

  // Estrellitas si está trompeando.
  if (now < c.spinUntil) {
    for (let i = 0; i < 3; i++) {
      const ang = now / 150 + (i * TAU) / 3;
      emoji(ctx, '💫', sm.x + Math.cos(ang) * 18, sm.y - 22 + Math.sin(ang) * 5, 13, 0);
    }
  }
}

function drawDeco(ctx: CanvasRenderingContext2D, d: Deco, kind: TrackDef['theme']['deco'], color: string): void {
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath();
  ctx.ellipse(d.x + 6, d.y + 8, d.r, d.r * 0.8, 0, 0, TAU);
  ctx.fill();
  if (kind === 'pines') {
    for (let i = 0; i < 3; i++) {
      const rr = d.r * (1 - i * 0.28);
      ctx.beginPath();
      for (let k = 0; k < 8; k++) {
        const ang = (k / 8) * TAU + d.k;
        const r2 = k % 2 ? rr * 0.55 : rr;
        if (k === 0) ctx.moveTo(d.x + Math.cos(ang) * r2, d.y + Math.sin(ang) * r2);
        else ctx.lineTo(d.x + Math.cos(ang) * r2, d.y + Math.sin(ang) * r2);
      }
      ctx.closePath();
      ctx.fillStyle = i === 2 ? '#f8fafc' : i === 1 ? '#166534' : color;
      ctx.fill();
    }
    return;
  }
  if (kind === 'palms') {
    ctx.strokeStyle = color;
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    for (let k = 0; k < 6; k++) {
      const ang = (k / 6) * TAU + d.k * 3;
      ctx.beginPath();
      ctx.moveTo(d.x, d.y);
      ctx.quadraticCurveTo(d.x + Math.cos(ang + 0.3) * d.r * 0.7, d.y + Math.sin(ang + 0.3) * d.r * 0.7, d.x + Math.cos(ang) * d.r * 1.1, d.y + Math.sin(ang) * d.r * 1.1);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(d.x, d.y, 5, 0, TAU);
    ctx.fillStyle = '#854d0e';
    ctx.fill();
    return;
  }
  // Árbol: tres círculos.
  for (const [ox, oy, rr, light] of [
    [0, 0, 1, 0],
    [-0.35, -0.3, 0.6, 1],
    [0.3, 0.2, 0.55, 0],
  ] as const) {
    ctx.beginPath();
    ctx.arc(d.x + ox * d.r, d.y + oy * d.r, d.r * rr, 0, TAU);
    ctx.fillStyle = light ? '#2f8f3e' : color;
    ctx.fill();
  }
}

function emoji(ctx: CanvasRenderingContext2D, ch: string, x: number, y: number, size: number, rot: number): void {
  ctx.save();
  ctx.translate(x, y);
  if (rot) ctx.rotate(rot);
  ctx.font = `${size}px serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(ch, 0, 0);
  ctx.restore();
}

function paintMini(
  ctx: CanvasRenderingContext2D,
  v: F99View,
  geo: TrackGeo,
  mini: { w: number; h: number; s: number },
  players: Map<string, PlayerPublic>,
  meId: string | null,
): void {
  const dpr = ctx.canvas.width / mini.w;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(dpr * mini.s, 0, 0, dpr * mini.s, -geo.minX * dpr * mini.s, -geo.minY * dpr * mini.s);
  ctx.beginPath();
  ctx.moveTo(geo.xs[0], geo.ys[0]);
  for (let i = 1; i < geo.n; i++) ctx.lineTo(geo.xs[i], geo.ys[i]);
  ctx.closePath();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = geo.width * 0.45;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(15,23,42,0.9)';
  ctx.lineWidth = geo.width * 0.28;
  ctx.stroke();
  const others = v.cars.filter((c) => c.playerId !== meId);
  const mineCar = v.cars.filter((c) => c.playerId === meId);
  for (const c of [...others, ...mineCar]) {
    const p = players.get(c.playerId);
    ctx.beginPath();
    ctx.arc(c.x, c.y, c.playerId === meId ? 52 : 38, 0, TAU);
    ctx.fillStyle = `hsl(${p?.avatar.hue ?? 0} 85% 58%)`;
    ctx.fill();
    if (c.playerId === meId) {
      ctx.strokeStyle = '#fde047';
      ctx.lineWidth = 16;
      ctx.stroke();
    }
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
