import { useEffect, useMemo, useRef } from 'react';
import { GAMES, PODIUM_POINTS } from '@shared/constants';
import type { GameId, Standing } from '@shared/types';
import { api } from '@/net/socket';
import { sfx } from '@/lib/sfx';
import { useCountdown } from '@/lib/hooks';
import { useIsHost, usePlayerMap, useStore } from '@/state/store';
import { Avatar, Logo, RankBadge } from '@/components/ui';

/* ── Intro del minijuego ──────────────────────────────────────────────────── */

export function GameIntro({
  gameId,
  index,
  total,
  endsAt,
}: {
  gameId: GameId;
  index: number;
  total: number;
  endsAt: number;
}): JSX.Element {
  const g = GAMES[gameId];
  const left = useCountdown(endsAt, 10);
  const isHost = useIsHost();
  const seconds = Math.ceil(left / 1000);
  const lastBeep = useRef(0);

  useEffect(() => {
    sfx.reveal();
  }, [gameId]);

  useEffect(() => {
    if (seconds <= 3 && seconds > 0 && lastBeep.current !== seconds) {
      lastBeep.current = seconds;
      sfx.tick();
    }
  }, [seconds]);

  return (
    <div
      className="intro"
      style={{ ['--accent-a' as string]: g.accent[0], ['--accent-b' as string]: g.accent[1] }}
    >
      <span className="intro__step anim-fade">
        Minijuego {index + 1} de {total}
      </span>

      <div className="intro__icon anim-pop" aria-hidden>
        {g.icon}
      </div>

      <h1 className="intro__title anim-rise">{g.title}</h1>
      <p className="intro__sub anim-rise" style={{ animationDelay: '80ms' }}>
        {g.subtitle}
      </p>

      <ol className="intro__rules card anim-rise" style={{ animationDelay: '140ms' }}>
        {g.howTo.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ol>

      <div className="intro__prizes anim-rise" style={{ animationDelay: '200ms' }}>
        {PODIUM_POINTS.map((pts, i) => (
          <span key={i} className={`prize prize--${i + 1}`}>
            <b>{i + 1}º</b> {pts} pts
          </span>
        ))}
      </div>

      <div className="intro__go">
        <div className="intro__count">{seconds > 0 ? seconds : '¡Ya!'}</div>
        {isHost && (
          <button className="btn btn--ghost btn--sm" onClick={() => api.skip()}>
            Saltear la intro
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Resultados de un minijuego ───────────────────────────────────────────── */

export function GameResults({
  gameId,
  standings,
  endsAt,
  index,
  total,
}: {
  gameId: GameId;
  standings: Standing[];
  endsAt: number;
  index: number;
  total: number;
}): JSX.Element {
  const g = GAMES[gameId];
  const players = usePlayerMap();
  const isHost = useIsHost();
  const left = useCountdown(endsAt, 4);
  const last = index + 1 >= total;

  useEffect(() => {
    sfx.fanfare();
  }, [gameId]);

  return (
    <div
      className="results"
      style={{ ['--accent-a' as string]: g.accent[0], ['--accent-b' as string]: g.accent[1] }}
    >
      <header className="results__head anim-rise">
        <span className="results__icon" aria-hidden>{g.icon}</span>
        <div>
          <h1 className="results__title">{g.title}</h1>
          <p className="muted">Así quedó el minijuego</p>
        </div>
      </header>

      <ol className="results__list">
        {standings.map((s, i) => {
          const p = players.get(s.playerId);
          if (!p) return null;
          return (
            <li
              key={s.playerId}
              className={`srow ${s.rank <= 3 ? `srow--${s.rank}` : ''} anim-rise`}
              style={{ animationDelay: `${120 + i * 70}ms` }}
            >
              <RankBadge rank={s.rank} />
              <Avatar avatar={p.avatar} size={40} offline={!p.connected} />
              <span className="grow prow__name">{p.name}</span>
              <span className="srow__value tnum">{s.label}</span>
              <span className={`srow__pts ${s.awarded ? '' : 'srow__pts--zero'}`}>
                {s.awarded > 0 ? `+${s.awarded}` : '—'}
              </span>
            </li>
          );
        })}
      </ol>

      <footer className="results__foot">
        <span className="hint">
          {last ? 'Tabla final en' : 'Próximo minijuego en'} {Math.ceil(left / 1000)}s
        </span>
        {isHost && (
          <button className="btn btn--accent" onClick={() => api.skip()}>
            {last ? 'Ver la tabla final' : 'Seguir'}
          </button>
        )}
      </footer>
    </div>
  );
}

/* ── Podio final ──────────────────────────────────────────────────────────── */

export function FinalPodium({ standings }: { standings: Standing[] }): JSX.Element {
  const players = usePlayerMap();
  const isHost = useIsHost();
  const meId = useStore((s) => s.playerId);
  const top = standings.slice(0, 3);
  const rest = standings.slice(3);
  const champion = top[0];
  const iWon = champion?.playerId === meId;

  useEffect(() => {
    sfx.fanfare();
    const t = setTimeout(() => sfx.jackpot(), 700);
    return () => clearTimeout(t);
  }, []);

  // Orden visual del podio: 2º — 1º — 3º
  const podium = useMemo(() => [top[1], top[0], top[2]].filter(Boolean), [top]);

  return (
    <div className="final">
      <Confetti />

      <header className="final__head anim-rise">
        <Logo size="md" />
        <h1 className="final__title">{iWon ? '¡Ganaste vos!' : 'Se terminó'}</h1>
        {champion && players.get(champion.playerId) && (
          <p className="final__sub">
            {iWon ? 'Sos el partidazo de la noche.' : `${players.get(champion.playerId)!.name} se llevó todo.`}
          </p>
        )}
      </header>

      <div className="podium">
        {podium.map((s) => {
          const p = players.get(s.playerId);
          if (!p) return null;
          return (
            <div key={s.playerId} className={`podium__col podium__col--${s.rank}`}>
              <div className="podium__who">
                <Avatar avatar={p.avatar} size={s.rank === 1 ? 72 : 56} crown={s.rank === 1} />
                <span className="podium__name">{p.name}</span>
                <span className="podium__pts tnum">{s.value} pts</span>
              </div>
              <div className="podium__block">
                <span>{s.rank}</span>
              </div>
            </div>
          );
        })}
      </div>

      {rest.length > 0 && (
        <ol className="final__rest card">
          {rest.map((s) => {
            const p = players.get(s.playerId);
            if (!p) return null;
            return (
              <li key={s.playerId} className="prow">
                <RankBadge rank={s.rank} />
                <Avatar avatar={p.avatar} size={34} offline={!p.connected} />
                <span className="grow prow__name">{p.name}</span>
                <span className="prow__score tnum">{s.value}</span>
              </li>
            );
          })}
        </ol>
      )}

      <div className="final__actions">
        {isHost ? (
          <button
            className="btn btn--primary btn--lg btn--shine"
            onClick={() => {
              sfx.pick();
              api.again();
            }}
          >
            Otra partida
          </button>
        ) : (
          <span className="hint">El anfitrión decide si va otra.</span>
        )}
      </div>
    </div>
  );
}

/* ── Papelitos ────────────────────────────────────────────────────────────── */

function Confetti(): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => {
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
    };
    resize();
    window.addEventListener('resize', resize);

    const colors = ['#7c5cff', '#ff4d8d', '#37e2d5', '#ffc93c', '#19c37d', '#ff8a3d'];
    const bits = Array.from({ length: 150 }, () => ({
      x: Math.random() * canvas.width,
      y: -Math.random() * canvas.height,
      w: (6 + Math.random() * 7) * dpr,
      h: (9 + Math.random() * 10) * dpr,
      vy: (55 + Math.random() * 110) * dpr,
      vx: (Math.random() - 0.5) * 40 * dpr,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 5,
      color: colors[Math.floor(Math.random() * colors.length)],
    }));

    let raf = 0;
    let prev = performance.now();
    const started = prev;

    const loop = (t: number) => {
      const dt = Math.min(0.05, (t - prev) / 1000);
      prev = t;
      // Después de 9 segundos dejamos de dibujar: ya festejamos bastante.
      const fade = Math.max(0, 1 - (t - started - 6000) / 3000);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = fade;
      for (const b of bits) {
        b.y += b.vy * dt;
        b.x += b.vx * dt;
        b.rot += b.vr * dt;
        if (b.y > canvas.height + 40) {
          b.y = -30;
          b.x = Math.random() * canvas.width;
        }
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.rot);
        ctx.fillStyle = b.color;
        ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h * (0.5 + Math.abs(Math.cos(b.rot)) * 0.5));
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      if (fade > 0) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return <canvas ref={ref} className="confetti" aria-hidden />;
}
