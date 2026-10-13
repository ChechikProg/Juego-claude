import { useEffect, useRef } from 'react';
import { CLASSIC_KINDS, PIECE_COLORS, POWERS, SHAPES, TT, rotCell } from '@shared/torres';
import type { PlayerPublic, TorresLane, TorresView } from '@shared/types';
import { api, serverNow } from '@/net/socket';
import { formatClock, useCountdown, useRaf, useSize } from '@/lib/hooks';
import { sfx } from '@/lib/sfx';
import { usePlayerMap, useStore } from '@/state/store';
import { Avatar, RankBadge, Timer } from '@/components/ui';

const TAU = Math.PI * 2;
/** celdas visibles a lo ancho en la vista principal */
const VIEW_W = TT.LANE_HALF * 2 + 4;
const VIEW_H_MIN = 21;
const REPEAT_DELAY = 170;
const REPEAT_EVERY = 70;

interface SmoothPiece {
  kind: number;
  flags: number;
  x: number;
  y: number;
  a: number;
  tx: number;
  ty: number;
  ta: number;
}

interface SmoothActive {
  kind: number;
  rot: number;
  golden: boolean;
  x: number;
  y: number;
}

interface LaneCache {
  pieces: Map<number, SmoothPiece>;
  active: SmoothActive | null;
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
  /** confeti: cae despacio y gira */
  spin?: number;
}

interface Floater {
  x: number;
  y: number;
  text: string;
  color: string;
  at: number;
}

/** Nubes fijas del cielo, en coordenadas de mundo. */
const CLOUDS = Array.from({ length: 22 }, (_, i) => ({
  x: ((i * 7.31) % 1) * VIEW_W - VIEW_W / 2 + (i % 3) * 2.1,
  y: 3 + i * 2.3 + ((i * 3.7) % 2),
  r: 0.9 + ((i * 5.13) % 1) * 1.1,
  speed: 0.15 + ((i * 2.71) % 1) * 0.25,
}));

export function Torres({ view }: { view: TorresView }): JSX.Element {
  const players = usePlayerMap();
  const meId = useStore((s) => s.playerId);
  const [wrapRef, size] = useSize<HTMLDivElement>();
  const [miniRef, miniSize] = useSize<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const miniCanvasRef = useRef<HTMLCanvasElement>(null);

  const snap = useRef(view);
  snap.current = view;
  const caches = useRef(new Map<string, LaneCache>());
  const cam = useRef({ bottom: -4 });
  const particles = useRef<Particle[]>([]);
  const floaters = useRef<Floater[]>([]);
  const seenFx = useRef(new Set<number>());
  const round = useRef(view.round);

  const live = view.stage === 'live';
  const countdown = useCountdown(view.stage === 'countdown' ? view.until : null, 10);
  const left = useCountdown(live ? view.until : null, 4);
  const endLeft = useCountdown(view.stage === 'roundEnd' ? view.until : null, 4);

  const myLane = view.lanes.find((l) => l.playerId === meId) ?? null;
  const focusLane = myLane ?? leaderOf(view.lanes);
  const focusId = focusLane?.playerId ?? null;
  const focusLaneRef = useRef<TorresLane | null>(focusLane);
  focusLaneRef.current = focusLane;
  /** para predecir la caída de la pieza propia */
  const fastHeld = useRef(false);

  /* ── caché de piezas: las ajenas llegan con menos frecuencia ──────────── */
  useEffect(() => {
    if (round.current !== view.round) {
      round.current = view.round;
      caches.current.clear();
    }
    for (const lane of view.lanes) {
      let c = caches.current.get(lane.playerId);
      if (!c) {
        c = { pieces: new Map(), active: null };
        caches.current.set(lane.playerId, c);
      }
      if (lane.pieces) {
        const seen = new Set<number>();
        const arr = lane.pieces;
        for (let i = 0; i + 5 < arr.length; i += 6) {
          const id = arr[i];
          const x = arr[i + 2] / 100;
          const y = arr[i + 3] / 100;
          const a = arr[i + 4] / 1000;
          seen.add(id);
          const p = c.pieces.get(id);
          if (p) {
            p.tx = x;
            p.ty = y;
            p.ta = a;
            p.flags = arr[i + 5];
          } else {
            // Si recién se apoyó, arranca donde estaba la pieza activa: no salta.
            const from = c.active && c.active.kind === arr[i + 1] ? c.active : null;
            c.pieces.set(id, {
              kind: arr[i + 1],
              flags: arr[i + 5],
              x: from ? from.x : x,
              y: from ? from.y : y,
              a,
              tx: x,
              ty: y,
              ta: a,
            });
          }
        }
        for (const id of [...c.pieces.keys()]) if (!seen.has(id)) c.pieces.delete(id);
      }
      const a = lane.active;
      if (!a) c.active = null;
      else if (!c.active || c.active.kind !== a.kind || Math.abs(c.active.y - a.y) > 6) {
        c.active = { kind: a.kind, rot: a.rot, golden: a.golden, x: a.x, y: a.y };
      } else {
        c.active.rot = a.rot;
        c.active.golden = a.golden;
      }
    }
  }, [view]);

  /* ── efectos y sonidos ────────────────────────────────────────────────── */
  useEffect(() => {
    for (const fx of view.fx) {
      if (seenFx.current.has(fx.id)) continue;
      seenFx.current.add(fx.id);
      if (serverNow() - fx.at > 1500) continue;
      const mine = fx.playerId === meId;
      const focus = fx.playerId === focusId;
      switch (fx.kind) {
        case 'place':
          if (mine) sfx.thud();
          if (focus && fx.x !== undefined && fx.y !== undefined) dust(particles.current, fx.x, fx.y - 0.6, 7, ['#ffffff', '#e2e8f0']);
          break;
        case 'lost':
          if (mine) sfx.lost();
          if (focus) floaters.current.push({ x: fx.x ?? 0, y: -1, text: '−1 pieza', color: '#fecaca', at: fx.at });
          break;
        case 'golden':
          if (mine) sfx.magic();
          if (focus) dust(particles.current, fx.x ?? 0, fx.y ?? 0, 18, ['#fde047', '#fbbf24', '#ffffff']);
          break;
        case 'power':
          if (mine) sfx.magic();
          break;
        case 'cement':
          if (mine) sfx.cement();
          if (focus) floaters.current.push({ x: 0, y: (fx.y ?? 0) + 1, text: '🧱 ¡Cementada!', color: '#e7e5e4', at: fx.at });
          break;
        case 'curse':
          if (mine) {
            sfx.curse();
            floaters.current.push({ x: 0, y: cam.current.bottom + 10, text: '👻 Pieza maldita', color: '#d8b4fe', at: fx.at });
          }
          break;
        case 'quake':
          if (mine) sfx.quake();
          break;
        case 'finish':
          if (mine) sfx.fanfare();
          else sfx.good();
          if (focus) confetti(particles.current, fx.y ?? TT.GOAL);
          break;
      }
    }
    if (seenFx.current.size > 400) seenFx.current = new Set(view.fx.map((f) => f.id));
  }, [view.fx, meId, focusId]);

  const windKey = view.wind ? view.wind.from : 0;
  useEffect(() => {
    if (windKey) sfx.wind();
  }, [windKey]);

  /* ── controles ────────────────────────────────────────────────────────── */
  const repeat = useRef<{ dir: number; timer: number | null }>({ dir: 0, timer: null });
  const canPlay = () => {
    const v = snap.current;
    const lane = v.lanes.find((l) => l.playerId === meId);
    return v.stage === 'live' && !!lane && lane.finishedAt === null;
  };

  const move = (dir: number) => {
    if (!canPlay()) return;
    api.send('move', { dir });
    sfx.nudge();
  };
  const startMove = (dir: number) => {
    stopMove();
    move(dir);
    const r = repeat.current;
    r.dir = dir;
    r.timer = window.setTimeout(function again() {
      if (repeat.current.dir !== dir) return;
      move(dir);
      repeat.current.timer = window.setTimeout(again, REPEAT_EVERY);
    }, REPEAT_DELAY);
  };
  const stopMove = (dir?: number) => {
    const r = repeat.current;
    if (dir !== undefined && r.dir !== dir) return;
    if (r.timer) clearTimeout(r.timer);
    r.timer = null;
    r.dir = 0;
  };
  const rotate = () => {
    if (!canPlay()) return;
    api.send('rotate');
    sfx.rotate();
  };
  const fast = (on: boolean) => {
    if (!canPlay() && on) return;
    fastHeld.current = on;
    api.send('fast', { on });
  };
  const power = (slot: number) => {
    const lane = snap.current.lanes.find((l) => l.playerId === meId);
    if (!canPlay() || !lane?.powers[slot]) return;
    api.send('power', { slot });
  };

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      switch (e.code) {
        case 'ArrowLeft':
        case 'KeyA':
          e.preventDefault();
          if (!e.repeat) startMove(-1);
          break;
        case 'ArrowRight':
        case 'KeyD':
          e.preventDefault();
          if (!e.repeat) startMove(1);
          break;
        case 'ArrowUp':
        case 'KeyW':
        case 'KeyX':
          e.preventDefault();
          if (!e.repeat) rotate();
          break;
        case 'ArrowDown':
        case 'KeyS':
        case 'Space':
          e.preventDefault();
          if (!e.repeat) fast(true);
          break;
        case 'KeyQ':
        case 'Digit1':
          if (!e.repeat) power(0);
          break;
        case 'KeyE':
        case 'Digit2':
          if (!e.repeat) power(1);
          break;
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') stopMove(-1);
      else if (e.code === 'ArrowRight' || e.code === 'KeyD') stopMove(1);
      else if (e.code === 'ArrowDown' || e.code === 'KeyS' || e.code === 'Space') fast(false);
    };
    const blur = () => {
      stopMove();
      fast(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      stopMove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── canvas ───────────────────────────────────────────────────────────── */
  useEffect(() => fitCanvas(canvasRef.current, size.w, size.h), [size.w, size.h]);
  useEffect(() => fitCanvas(miniCanvasRef.current, miniSize.w, miniSize.h), [miniSize.w, miniSize.h]);

  useRaf((dt) => {
    const v = snap.current;
    const now = serverNow();
    const k = Math.min(1, dt * 16);
    for (const c of caches.current.values()) {
      for (const p of c.pieces.values()) {
        p.x += (p.tx - p.x) * k;
        p.y += (p.ty - p.y) * k;
        p.a = lerpAngle(p.a, p.ta, k);
      }
    }
    for (const lane of v.lanes) {
      const c = caches.current.get(lane.playerId);
      if (!c?.active || !lane.active) continue;
      // La activa cae a velocidad conocida: se predice desde el último snapshot.
      const age = Math.max(0, Math.min(0.12, (now - v.t) / 1000));
      const fall = lane.playerId === meId && fastHeld.current ? TT.FAST_SPEED : TT.FALL_SPEED;
      const ty = lane.active.y - fall * age * 0.6;
      c.active.x += (lane.active.x - c.active.x) * Math.min(1, dt * 24);
      c.active.y += (ty - c.active.y) * Math.min(1, dt * 18);
    }

    const ctx = canvasRef.current?.getContext('2d');
    if (ctx && size.w && focusLaneRef.current) {
      paintMain(ctx, {
        w: size.w,
        h: size.h,
        v,
        lane: focusLaneRef.current,
        cache: caches.current.get(focusLaneRef.current.playerId),
        cam: cam.current,
        particles: particles.current,
        floaters: floaters.current,
        player: players.get(focusLaneRef.current.playerId),
        isMe: focusLaneRef.current.playerId === meId,
        now,
        dt,
      });
    }
    const mctx = miniCanvasRef.current?.getContext('2d');
    if (mctx && miniSize.w) {
      paintRivals(mctx, {
        w: miniSize.w,
        h: miniSize.h,
        v,
        lanes: v.lanes.filter((l) => l.playerId !== focusLaneRef.current?.playerId),
        caches: caches.current,
        players,
        now,
      });
    }
  });

  const ranking = [...view.lanes].sort(
    (a, b) => (a.place ?? 99) - (b.place ?? 99) || b.top - a.top,
  );
  const holdLeft = myLane?.holdSince ? Math.max(0, TT.HOLD_MS - (serverNow() - myLane.holdSince)) : null;

  return (
    <div className="tt">
      <header className="tt__top">
        {view.totalRounds > 1 && (
          <span className="chip">
            Ronda {view.round}/{view.totalRounds}
          </span>
        )}
        {myLane && (
          <div className="tt__height" aria-label={`Altura ${myLane.top.toFixed(1)} de ${view.goal}`}>
            <span className="label">Altura</span>
            <div className="tt__heightbar">
              <div className="tt__heightfill" style={{ width: `${Math.min(100, (myLane.top / view.goal) * 100)}%` }} />
              <div className="tt__heightbest" style={{ left: `${Math.min(100, (myLane.best / view.goal) * 100)}%` }} />
            </div>
            <strong className="tnum">
              {myLane.top.toFixed(1)}
              <span className="muted"> / {view.goal} m</span>
            </strong>
          </div>
        )}
        {myLane && (
          <div className="tt__powers">
            {[0, 1].map((slot) => {
              const pw = myLane.powers[slot];
              return (
                <button
                  key={slot}
                  className={`tt__power ${pw ? 'tt__power--on' : ''}`}
                  disabled={!pw || !live || myLane.finishedAt !== null}
                  onClick={() => power(slot)}
                  title={pw ? `${POWERS[pw].name}: ${POWERS[pw].desc}` : 'Vacío'}
                >
                  <span className="tt__powericon">{pw ? POWERS[pw].icon : '·'}</span>
                  <kbd>{slot === 0 ? 'Q' : 'E'}</kbd>
                </button>
              );
            })}
            <span className="tt__charge" title="Piezas para el próximo poder">
              ✨ {myLane.charge}
            </span>
          </div>
        )}
        {live && <Timer ms={left} urgentAt={30_000} />}
      </header>

      <div className="tt__body">
        <div className="tt__stage" ref={wrapRef}>
          <canvas ref={canvasRef} className="tt__canvas" />

          {view.wind && serverNow() < view.wind.until && (
            <div className="tt__wind anim-fade">
              💨 Viento {view.wind.dir > 0 ? '→' : '←'}
            </div>
          )}

          {holdLeft !== null && live && (
            <div className="tt__hold anim-pop">
              ¡Aguantá! <b className="tnum">{(holdLeft / 1000).toFixed(1)}</b>
            </div>
          )}

          {myLane?.finishedAt !== null && myLane && live && (
            <div className="tt__done anim-pop">
              🏁 ¡Llegaste {myLane.place}º!
              <span className="muted">Mirá cómo sufren los demás</span>
            </div>
          )}

          {!myLane && live && focusLane && (
            <div className="tt__spect">Mirando a {players.get(focusLane.playerId)?.name ?? '—'}</div>
          )}

          {view.stage === 'countdown' && (
            <div className="sm__overlay">
              <div className="sm__count anim-pop" key={Math.ceil(countdown / 1000)}>
                {Math.max(1, Math.ceil(countdown / 1000))}
              </div>
              <p className="sm__ready">
                {view.round > 1 ? `Ronda ${view.round}` : 'Preparando los ladrillos'}
              </p>
            </div>
          )}

          {(view.stage === 'roundEnd' || view.stage === 'done') && view.roundResults && (
            <div className="f9__overlay f9__overlay--dim">
              <div className="card f9__podium anim-pop">
                <h3 className="card__title">
                  🗼 {view.round < view.totalRounds ? `Próxima ronda en ${Math.ceil(endLeft / 1000)}` : 'Resultado final'}
                </h3>
                <ol className="plist">
                  {view.roundResults.map((r) => {
                    const p = players.get(r.playerId);
                    if (!p) return null;
                    return (
                      <li key={r.playerId} className={`prow ${r.playerId === meId ? 'prow--me' : ''}`}>
                        <RankBadge rank={r.place} />
                        <Avatar avatar={p.avatar} size={28} />
                        <span className="grow prow__name">{p.name}</span>
                        <span className="f9__time tnum">
                          {r.time !== null ? `🏁 ${formatClock(r.time)}` : `${r.height.toFixed(1)} m`}
                        </span>
                        <span className="prow__score tnum">+{r.points}</span>
                      </li>
                    );
                  })}
                </ol>
              </div>
            </div>
          )}
        </div>

        <aside className="tt__side panel">
          {view.lanes.length > 1 && (
            <div className="tt__mini" ref={miniRef}>
              <canvas ref={miniCanvasRef} />
            </div>
          )}
          <ol className="plist">
            {ranking.map((l, i) => {
              const p = players.get(l.playerId);
              if (!p) return null;
              return (
                <li key={l.playerId} className={`prow ${l.playerId === meId ? 'prow--me' : ''}`}>
                  <RankBadge rank={l.place ?? i + 1} />
                  <Avatar avatar={p.avatar} size={24} offline={!p.connected} />
                  <span className="grow prow__name">{p.name}</span>
                  <span className="f9__lapchip tnum">{l.finishedAt !== null ? '🏁' : `${l.top.toFixed(1)} m`}</span>
                  {view.totalRounds > 1 && <span className="prow__score tnum">{view.totals[l.playerId] ?? 0}</span>}
                </li>
              );
            })}
          </ol>
          <p className="hint tt__help">← → mover · ↑ girar · ↓ bajar rápido · Q / E poderes</p>
        </aside>
      </div>

      <footer className="tt__controls">
        <button
          className="tt__btn"
          disabled={!live}
          onPointerDown={(e) => {
            e.preventDefault();
            startMove(-1);
          }}
          onPointerUp={() => stopMove(-1)}
          onPointerLeave={() => stopMove(-1)}
          onPointerCancel={() => stopMove(-1)}
          aria-label="Izquierda"
        >
          ◀
        </button>
        <button
          className="tt__btn tt__btn--rot"
          disabled={!live}
          onPointerDown={(e) => {
            e.preventDefault();
            rotate();
          }}
          aria-label="Girar"
        >
          ⟳
        </button>
        <button
          className="tt__btn"
          disabled={!live}
          onPointerDown={(e) => {
            e.preventDefault();
            fastHeld.current = true;
            fast(true);
          }}
          onPointerUp={() => {
            fastHeld.current = false;
            fast(false);
          }}
          onPointerLeave={() => {
            if (fastHeld.current) fast(false);
            fastHeld.current = false;
          }}
          aria-label="Bajar rápido"
        >
          ▼
        </button>
        <button
          className="tt__btn"
          disabled={!live}
          onPointerDown={(e) => {
            e.preventDefault();
            startMove(1);
          }}
          onPointerUp={() => stopMove(1)}
          onPointerLeave={() => stopMove(1)}
          onPointerCancel={() => stopMove(1)}
          aria-label="Derecha"
        >
          ▶
        </button>
      </footer>
    </div>
  );
}

function leaderOf(lanes: TorresLane[]): TorresLane | null {
  let best: TorresLane | null = null;
  for (const l of lanes) {
    if (!best || (l.place ?? 99) < (best.place ?? 99) || ((l.place ?? 99) === (best.place ?? 99) && l.top > best.top)) best = l;
  }
  return best;
}

function fitCanvas(canvas: HTMLCanvasElement | null, w: number, h: number): void {
  if (!canvas || !w || !h) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  canvas.getContext('2d')?.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/* ── partículas ───────────────────────────────────────────────────────────── */

function dust(list: Particle[], x: number, y: number, n: number, colors: string[]): void {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI;
    const v = 1.5 + Math.random() * 3;
    const l = 0.4 + Math.random() * 0.4;
    list.push({
      x: x + (Math.random() - 0.5) * 2,
      y,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v * 0.6,
      life: l,
      max: l,
      size: 0.12 + Math.random() * 0.18,
      color: colors[Math.floor(Math.random() * colors.length)],
    });
  }
  if (list.length > 500) list.splice(0, list.length - 500);
}

function confetti(list: Particle[], y: number): void {
  const colors = ['#f472b6', '#facc15', '#38bdf8', '#4ade80', '#c084fc', '#fb923c'];
  for (let i = 0; i < 90; i++) {
    const l = 1.6 + Math.random() * 1.6;
    list.push({
      x: (Math.random() - 0.5) * VIEW_W,
      y: y + 2 + Math.random() * 6,
      vx: (Math.random() - 0.5) * 3,
      vy: Math.random() * 2,
      life: l,
      max: l,
      size: 0.18 + Math.random() * 0.16,
      color: colors[Math.floor(Math.random() * colors.length)],
      spin: Math.random() * TAU,
    });
  }
}

/* ── dibujo ───────────────────────────────────────────────────────────────── */

function lerpAngle(a: number, b: number, k: number): number {
  const d = ((((b - a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
  return a + d * k;
}

function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const r = Math.round(((pa >> 16) & 255) * (1 - t) + ((pb >> 16) & 255) * t);
  const g = Math.round(((pa >> 8) & 255) * (1 - t) + ((pb >> 8) & 255) * t);
  const bl = Math.round((pa & 255) * (1 - t) + (pb & 255) * t);
  return `rgb(${r},${g},${bl})`;
}

/** Cielo según la altura: mañana abajo, atardecer a mitad de camino, noche estrellada en la cima. */
function skyAt(t: number): [string, string] {
  const stops: [string, string][] = [
    ['#7dd3fc', '#e0f2fe'],
    ['#a5b4fc', '#fbcfe8'],
    ['#f472b6', '#fde68a'],
    ['#4c1d95', '#db2777'],
    ['#0f0a2e', '#3b0764'],
  ];
  const f = Math.max(0, Math.min(stops.length - 1.001, t * (stops.length - 1)));
  const i = Math.floor(f);
  const k = f - i;
  return [mix(stops[i][0], stops[i + 1][0], k), mix(stops[i][1], stops[i + 1][1], k)];
}

function cellsOf(kind: number, rot: number): [number, number][] {
  return SHAPES[kind].map(([x, y]) => rotCell(x, y, rot));
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

/**
 * Dibuja una pieza. El contexto ya está en coordenadas de mundo con y para
 * arriba (escala negativa en y), así que las celdas se dibujan tal cual.
 */
function drawPiece(
  g: CanvasRenderingContext2D,
  kind: number,
  rot: number,
  x: number,
  y: number,
  a: number,
  style: { cement?: boolean; golden?: boolean; ghost?: boolean; detail?: boolean },
  now: number,
): void {
  const cursed = kind >= CLASSIC_KINDS;
  let [face, shade] = PIECE_COLORS[kind] ?? PIECE_COLORS[0];
  if (style.cement) [face, shade] = ['#b8b2ab', '#78716c'];
  else if (style.golden) [face, shade] = ['#fde047', '#d97706'];
  const cells = cellsOf(kind, rot);
  g.save();
  g.translate(x, y);
  g.rotate(a);
  if (style.ghost) g.globalAlpha *= 0.9;
  for (const [cx, cy] of cells) {
    const x0 = cx - 0.5 + 0.03;
    const y0 = cy - 0.5 + 0.03;
    g.fillStyle = shade;
    roundRect(g, x0, y0, 0.94, 0.94, 0.16);
    g.fill();
    g.fillStyle = face;
    roundRect(g, x0 + 0.06, y0 + 0.14, 0.82, 0.74, 0.12);
    g.fill();
    if (style.detail !== false) {
      g.fillStyle = 'rgba(255,255,255,0.35)';
      roundRect(g, x0 + 0.14, y0 + 0.62, 0.3, 0.14, 0.07);
      g.fill();
      if (style.cement) {
        g.fillStyle = 'rgba(68,64,60,0.35)';
        for (let i = 0; i < 4; i++) {
          const px = x0 + 0.2 + (((cx * 7 + cy * 13 + i * 5) % 7) / 7) * 0.55;
          const py = y0 + 0.2 + (((cx * 11 + cy * 3 + i * 7) % 5) / 5) * 0.5;
          g.fillRect(px, py, 0.07, 0.07);
        }
      }
    }
  }
  if (style.golden && !style.cement) {
    const pulse = 0.5 + 0.5 * Math.sin(now / 160);
    g.strokeStyle = `rgba(255, 251, 200, ${0.4 + pulse * 0.5})`;
    g.lineWidth = 0.08;
    for (const [cx, cy] of cells) {
      roundRect(g, cx - 0.47, cy - 0.47, 0.94, 0.94, 0.16);
      g.stroke();
    }
  }
  if (cursed && !style.cement && style.detail !== false) {
    // Carita de fantasma en la celda del medio.
    const [cx, cy] = cells.reduce(
      (best, c) => (Math.hypot(c[0], c[1]) < Math.hypot(best[0], best[1]) ? c : best),
      cells[0],
    );
    for (const side of [-1, 1]) {
      const ex = cx + side * 0.18;
      g.fillStyle = '#f5f3ff';
      g.beginPath();
      g.ellipse(ex, cy + 0.08, 0.1, 0.14, 0, 0, TAU);
      g.fill();
      g.fillStyle = '#1e1b4b';
      g.beginPath();
      g.arc(ex, cy + 0.05, 0.05, 0, TAU);
      g.fill();
    }
  }
  g.restore();
}

interface MainArgs {
  w: number;
  h: number;
  v: TorresView;
  lane: TorresLane;
  cache: LaneCache | undefined;
  cam: { bottom: number };
  particles: Particle[];
  floaters: Floater[];
  player: PlayerPublic | undefined;
  isMe: boolean;
  now: number;
  dt: number;
}

function paintMain(ctx: CanvasRenderingContext2D, a: MainArgs): void {
  const { w, h, v, lane, cache, cam, particles, floaters, player, isMe, now, dt } = a;
  const scale = Math.min(w / VIEW_W, h / VIEW_H_MIN);
  const viewH = h / scale;

  /* cámara: sigue la torre y la pieza que cae */
  const top = Math.max(0, lane.top);
  let target = Math.max(-7.5, top - viewH * 0.5);
  const act = cache?.active;
  if (act && act.y + 2 > target + viewH) target = act.y + 2 - viewH;
  if (lane.finishedAt !== null) target = Math.max(-5.5, TT.GOAL - viewH * 0.6);
  cam.bottom += (target - cam.bottom) * Math.min(1, dt * 3);
  const bottom = cam.bottom;

  const shaking = now < lane.shakeUntil;
  ctx.save();
  if (shaking) ctx.translate((Math.random() - 0.5) * 7, (Math.random() - 0.5) * 3);

  /* cielo */
  const mid = bottom + viewH / 2;
  const [skyTop, skyBottom] = skyAt(mid / (TT.GOAL + 6));
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, skyTop);
  sky.addColorStop(1, skyBottom);
  ctx.fillStyle = sky;
  ctx.fillRect(-10, -10, w + 20, h + 20);

  // Estrellas cuando se hace de noche.
  const night = Math.max(0, Math.min(1, (mid - TT.GOAL * 0.7) / (TT.GOAL * 0.4)));
  if (night > 0) {
    for (let i = 0; i < 60; i++) {
      const sx = ((i * 97.13) % 1) * w;
      const wy = ((i * 37.7) % 40) + TT.GOAL * 0.6;
      const sy = h - (wy - bottom * 0.3) * scale * 0.3;
      if (sy < -5 || sy > h + 5) continue;
      const tw = 0.5 + 0.5 * Math.sin(now / 400 + i);
      ctx.fillStyle = `rgba(255,255,255,${night * (0.35 + tw * 0.5)})`;
      ctx.fillRect(((sx * 7.3) % w + w) % w, sy, 2, 2);
    }
  }

  // A partir de acá: coordenadas de mundo, y para arriba.
  ctx.save();
  ctx.translate(w / 2, h + bottom * scale);
  ctx.scale(scale, -scale);

  /* nubes con parallax */
  for (const c of CLOUDS) {
    const cy = c.y + bottom * 0.45;
    if (cy < bottom - 3 || cy > bottom + viewH + 3) continue;
    const drift = ((((c.x + (now / 1000) * c.speed + VIEW_W / 2) % (VIEW_W + 6)) + VIEW_W + 6) % (VIEW_W + 6)) - VIEW_W / 2 - 3;
    ctx.fillStyle = `rgba(255,255,255,${0.5 - night * 0.3})`;
    ctx.beginPath();
    for (const [ox, oy, k] of [[0, 0, 1], [0.9, -0.2, 0.75], [-0.9, -0.25, 0.65]]) {
      const r = c.r * k;
      ctx.moveTo(drift + c.r * ox + r, cy + c.r * oy);
      ctx.arc(drift + c.r * ox, cy + c.r * oy, r, 0, TAU);
    }
    ctx.fill();
  }

  /* mar de nubes abajo y el pedestal */
  if (bottom < 0) {
    const sea = ctx.createLinearGradient(0, -9, 0, -3);
    sea.addColorStop(0, 'rgba(255,255,255,0.95)');
    sea.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sea;
    ctx.fillRect(-VIEW_W, -12, VIEW_W * 2, 9);
  }
  const bw = TT.BASE_W / 2;
  const bx = 0;
  ctx.fillStyle = '#8b5e3c';
  ctx.beginPath();
  ctx.moveTo(bx - bw + 0.6, -1);
  ctx.lineTo(bx - bw + 1.2, -7);
  ctx.lineTo(bx + bw - 1.2, -7);
  ctx.lineTo(bx + bw - 0.6, -1);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#6b4226';
  for (let i = 0; i < 4; i++) ctx.fillRect(bx - bw + 1.4 + i * 0.9, -6.5 + (i % 2) * 1.6, 0.5, 0.18);
  ctx.fillStyle = '#a3a3a3';
  roundRect(ctx, bx - bw, -1, bw * 2, 1, 0.2);
  ctx.fill();
  ctx.fillStyle = '#4ade80';
  roundRect(ctx, bx - bw - 0.1, -0.28, bw * 2 + 0.2, 0.32, 0.14);
  ctx.fill();

  /* regla de altura */
  ctx.lineWidth = 0.05;
  for (let y = 0; y <= TT.GOAL + 8; y += 1) {
    if (y < bottom - 1 || y > bottom + viewH + 1) continue;
    const big = y % 5 === 0;
    ctx.strokeStyle = night > 0.5 ? 'rgba(255,255,255,0.35)' : 'rgba(15,23,42,0.25)';
    ctx.beginPath();
    ctx.moveTo(-VIEW_W / 2 + 0.3, y);
    ctx.lineTo(-VIEW_W / 2 + (big ? 1.1 : 0.6), y);
    ctx.stroke();
  }

  /* meta */
  const goalY = TT.GOAL;
  const stripes = ['#f472b6', '#fb923c', '#facc15', '#4ade80', '#38bdf8', '#a78bfa'];
  stripes.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(-VIEW_W / 2, goalY - 0.06 + i * 0.07, VIEW_W, 0.07);
  });
  ctx.globalAlpha = 1;
  // banderita
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(TT.LANE_HALF + 0.6, goalY, 0.08, 2.2);
  const wave = Math.sin(now / 200) * 0.12;
  ctx.fillStyle = '#ef4444';
  ctx.beginPath();
  ctx.moveTo(TT.LANE_HALF + 0.68, goalY + 2.2);
  ctx.quadraticCurveTo(TT.LANE_HALF + 1.2, goalY + 2 + wave, TT.LANE_HALF + 1.7, goalY + 1.95);
  ctx.lineTo(TT.LANE_HALF + 0.68, goalY + 1.5);
  ctx.closePath();
  ctx.fill();

  /* guía de caída de la pieza activa */
  if (act) {
    const cells = cellsOf(act.kind, act.rot);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    for (const [cx, cy] of cells) {
      minX = Math.min(minX, cx - 0.5);
      maxX = Math.max(maxX, cx + 0.5);
      minY = Math.min(minY, cy - 0.5);
    }
    const guide = ctx.createLinearGradient(0, act.y + minY, 0, bottom);
    guide.addColorStop(0, isMe ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.14)');
    guide.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = guide;
    ctx.fillRect(act.x + minX, bottom - 1, maxX - minX, act.y + minY - bottom + 1);
  }

  /* piezas */
  if (cache) {
    for (const p of cache.pieces.values()) {
      if (p.y < bottom - 3 || p.y > bottom + viewH + 3) continue;
      drawPiece(ctx, p.kind, (p.flags >> 2) & 3, p.x, p.y, p.a, { cement: !!(p.flags & 1), golden: !!(p.flags & 2) }, now);
    }
    if (act) drawPiece(ctx, act.kind, act.rot, act.x, act.y, 0, { golden: act.golden }, now);
  }

  /* titi, el mono que alienta desde la base */
  ctx.save();
  ctx.scale(1, -1);
  ctx.font = '1.5px serif';
  ctx.fillStyle = '#000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Titi festeja saltando cuando la torre pasa la meta.
  const hop = lane.holdSince !== null || lane.finishedAt !== null ? Math.abs(Math.sin(now / 150)) * 0.6 : 0;
  ctx.fillText('🐒', -0.9, 3.2 - hop);
  ctx.font = '1.2px serif';
  ctx.fillText(player?.avatar.face ?? '🙂', 1, 3.3);
  ctx.restore();

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
    if (p.spin !== undefined) {
      p.vy -= 1.5 * dt;
      p.spin += dt * 8;
    } else {
      p.vx *= Math.pow(0.1, dt);
      p.vy -= 4 * dt;
    }
    ctx.globalAlpha = Math.max(0, Math.min(1, p.life / p.max));
    ctx.fillStyle = p.color;
    if (p.spin !== undefined) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.spin);
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
    } else {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, TAU);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  /* textos en pantalla (no en mundo, para que se lean) */
  const toScreen = (x: number, y: number) => [w / 2 + x * scale, h - (y - bottom) * scale] as const;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = '700 11px Outfit, sans-serif';
  for (let y = 5; y <= TT.GOAL + 5; y += 5) {
    const [, sy] = toScreen(0, y);
    if (sy < 8 || sy > h - 8) continue;
    ctx.fillStyle = night > 0.5 ? 'rgba(255,255,255,0.7)' : 'rgba(15,23,42,0.55)';
    ctx.fillText(`${y} m`, w / 2 + (-VIEW_W / 2 + 1.25) * scale + 2, sy);
  }
  {
    const [, gy] = toScreen(0, TT.GOAL);
    if (gy > 10 && gy < h - 10) {
      ctx.textAlign = 'left';
      ctx.font = '900 13px Outfit, sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.lineWidth = 3;
      const tx = w / 2 - (VIEW_W / 2 - 0.4) * scale;
      ctx.strokeText('META', tx, gy - 12);
      ctx.fillText('META', tx, gy - 12);
    }
    if (gy < 4) {
      // La meta queda arriba de la pantalla: una flechita que dice cuánto falta.
      ctx.textAlign = 'center';
      ctx.font = '800 12px Outfit, sans-serif';
      ctx.fillStyle = 'rgba(15,23,42,0.6)';
      roundRect(ctx, w / 2 - 62, 6, 124, 22, 11);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(`▲ meta a ${Math.max(0, TT.GOAL - lane.top).toFixed(1)} m`, w / 2, 17);
    }
  }

  /* siguiente pieza */
  if (lane.finishedAt === null) {
    const bx2 = w - 74;
    const by2 = 10;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.55)';
    roundRect(ctx, bx2, by2, 64, 70, 12);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.textAlign = 'center';
    ctx.font = '800 9px Outfit, sans-serif';
    ctx.fillText('SIGUIENTE', bx2 + 32, by2 + 11);
    ctx.save();
    ctx.translate(bx2 + 32, by2 + 42);
    ctx.scale(11, -11);
    drawPiece(ctx, lane.next, 0, 0, 0, 0, { golden: lane.nextGolden }, now);
    ctx.restore();
  }

  /* textos flotantes */
  ctx.textAlign = 'center';
  ctx.font = '900 15px Outfit, sans-serif';
  for (let i = floaters.length - 1; i >= 0; i--) {
    const f = floaters[i];
    const age = (now - f.at) / 1000;
    if (age > 1.8) {
      floaters.splice(i, 1);
      continue;
    }
    const [sx, sy] = toScreen(f.x, f.y + age * 1.5);
    ctx.globalAlpha = Math.max(0, 1 - age / 1.8);
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.strokeText(f.text, sx, Math.max(30, sy));
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, sx, Math.max(30, sy));
  }
  ctx.globalAlpha = 1;

  /* viento */
  const wind = v.wind;
  if (wind && now >= wind.from && now < wind.until) {
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    for (let i = 0; i < 14; i++) {
      const speed = 500 + (i % 4) * 140;
      const len = 40 + (i % 3) * 30;
      const yy = ((i * 53.7) % 1) * h * 0.9 + 20 + ((i * 31) % 40);
      let xx = ((now / 1000) * speed + i * 211) % (w + len * 2);
      if (wind.dir < 0) xx = w - xx + len;
      else xx -= len;
      ctx.beginPath();
      ctx.moveTo(xx, yy);
      ctx.lineTo(xx + len * wind.dir, yy);
      ctx.stroke();
    }
  }

  ctx.restore();
}

interface RivalArgs {
  w: number;
  h: number;
  v: TorresView;
  lanes: TorresLane[];
  caches: Map<string, LaneCache>;
  players: Map<string, PlayerPublic>;
  now: number;
}

/** Las torres de los demás, todas de cuerpo entero y una al lado de la otra. */
function paintRivals(ctx: CanvasRenderingContext2D, a: RivalArgs): void {
  const { w, h, lanes, caches, players, now } = a;
  ctx.clearRect(0, 0, w, h);
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#312e81');
  sky.addColorStop(0.5, '#db2777');
  sky.addColorStop(1, '#7dd3fc');
  ctx.fillStyle = sky;
  ctx.globalAlpha = 0.55;
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = 1;
  if (!lanes.length) return;

  const colW = w / lanes.length;
  const labelH = 26;
  const worldW = TT.LANE_HALF * 2 + 1;
  const worldH = TT.GOAL + 4;
  const scale = Math.min(colW / worldW, (h - labelH - 6) / (worldH + 2));
  const goalScreen = h - labelH - (TT.GOAL + 2) * scale;

  // Línea de meta común.
  ctx.strokeStyle = 'rgba(250, 204, 21, 0.9)';
  ctx.setLineDash([4, 3]);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, goalScreen);
  ctx.lineTo(w, goalScreen);
  ctx.stroke();
  ctx.setLineDash([]);

  lanes.forEach((lane, i) => {
    const cx = colW * (i + 0.5);
    const p = players.get(lane.playerId);
    ctx.save();
    ctx.translate(cx, h - labelH - 2 * scale);
    ctx.scale(scale, -scale);
    const shaking = now < lane.shakeUntil;
    if (shaking) ctx.translate((Math.random() - 0.5) * 0.5, 0);
    ctx.fillStyle = '#a3a3a3';
    ctx.fillRect(-TT.BASE_W / 2, -1, TT.BASE_W, 1);
    ctx.fillStyle = '#8b5e3c';
    ctx.fillRect(-TT.BASE_W / 2 + 0.8, -2, TT.BASE_W - 1.6, 1);
    const c = caches.get(lane.playerId);
    if (c) {
      for (const pc of c.pieces.values()) {
        drawPiece(ctx, pc.kind, (pc.flags >> 2) & 3, pc.x, pc.y, pc.a, { cement: !!(pc.flags & 1), golden: !!(pc.flags & 2), detail: false }, now);
      }
      if (c.active) {
        ctx.globalAlpha = 0.85;
        drawPiece(ctx, c.active.kind, c.active.rot, c.active.x, Math.min(c.active.y, worldH), 0, { golden: c.active.golden, detail: false }, now);
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();

    // Nombre, altura y estado.
    const hue = p?.avatar.hue ?? 200;
    ctx.fillStyle = `hsla(${hue} 70% 55% / 0.9)`;
    roundRect(ctx, cx - colW / 2 + 3, h - labelH + 2, colW - 6, labelH - 4, 8);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 ${colW < 70 ? 10 : 11}px Outfit, sans-serif`;
    const label = lane.finishedAt !== null ? `🏁 ${lane.place}º` : `${p?.avatar.face ?? ''} ${lane.top.toFixed(0)}m`;
    ctx.fillText(label, cx, h - labelH / 2 + 1);
    if (lane.holdSince !== null && lane.finishedAt === null) {
      ctx.fillStyle = '#facc15';
      ctx.font = '900 12px Outfit, sans-serif';
      ctx.fillText('¡!', cx, goalScreen - 10);
    }
  });
}
