import { useEffect, useRef } from 'react';
import type { Stroke, VanGoghView } from '@shared/types';
import { api } from '@/net/socket';
import { useCountdown } from '@/lib/hooks';
import { sfx } from '@/lib/sfx';
import { usePlayerMap, useStore } from '@/state/store';
import { Avatar, RankBadge, Timer, TimerBar } from '@/components/ui';
import { DrawingPad, DrawingView } from './Canvas';

const DRAW_TOTAL = 120_000;
const VOTE_TOTAL = 13_000;

export function VanGogh({ view }: { view: VanGoghView }): JSX.Element {
  switch (view.stage) {
    case 'prompt':
      return <Prompt v={view} />;
    case 'draw':
      return <Draw v={view} />;
    case 'vote':
      return <Vote v={view} />;
    case 'roundResults':
      return <RoundResults v={view} />;
    default:
      return <div className="center grow"><p className="hint">Cerrando la galería…</p></div>;
  }
}

/* ── Sorteo de la palabra ─────────────────────────────────────────────────── */

function Prompt({ v }: { v: Extract<VanGoghView, { stage: 'prompt' }> }): JSX.Element {
  const left = useCountdown(v.endsAt, 10);

  useEffect(() => {
    sfx.reveal();
  }, [v.word]);

  return (
    <div className="vg-prompt">
      <span className="chip">Ronda {v.round} de {v.totalRounds}</span>
      <p className="vg-prompt__label">Tenés que dibujar</p>
      <h1 className="vg-prompt__word anim-pop">{v.word}</h1>
      <span className="chip chip--accent">{v.hint}</span>
      <p className="vg-prompt__go">Los pinceles en {Math.ceil(left / 1000)}…</p>
    </div>
  );
}

/* ── Dibujo ───────────────────────────────────────────────────────────────── */

function Draw({ v }: { v: Extract<VanGoghView, { stage: 'draw' }> }): JSX.Element {
  const left = useCountdown(v.endsAt, 5);
  const players = usePlayerMap();
  const lastBeep = useRef(0);

  useEffect(() => {
    const s = Math.ceil(left / 1000);
    if (s <= 10 && s > 0 && lastBeep.current !== s) {
      lastBeep.current = s;
      sfx.urgent();
    }
  }, [left]);

  const sendStroke = (s: Stroke) => api.send('stroke', s);

  return (
    <div className="vg-draw">
      <header className="vg-draw__top">
        <div className="vg-word">
          <span className="label">Dibujá</span>
          <strong>{v.word}</strong>
        </div>
        <div className="vg-draw__timer">
          <Timer ms={left} urgentAt={15_000} />
          <TimerBar ms={left} total={DRAW_TOTAL} />
        </div>
        <div className="vg-ready">
          <div className="vg-ready__faces">
            {v.readyIds.map((id) => {
              const p = players.get(id);
              return p ? <Avatar key={id} avatar={p.avatar} size={26} /> : null;
            })}
          </div>
          <span className="chip">
            {v.readyIds.length}/{v.artists} listos
          </span>
        </div>
      </header>

      <DrawingPad
        onStroke={sendStroke}
        onUndo={() => api.send('undo')}
        onClear={() => api.send('clear')}
        disabled={v.iAmReady}
      />

      <div className="vg-draw__foot">
        <button
          className={`btn btn--lg ${v.iAmReady ? 'btn--ghost' : 'btn--green'}`}
          onClick={() => {
            sfx.pick();
            api.send('ready', { value: !v.iAmReady });
          }}
        >
          {v.iAmReady ? 'Seguir dibujando' : '✓ Listo'}
        </button>
        <span className="hint">Si todos dan listo, se corta el tiempo.</span>
      </div>
    </div>
  );
}

/* ── Votación estilo build battle ─────────────────────────────────────────── */

function Vote({ v }: { v: Extract<VanGoghView, { stage: 'vote' }> }): JSX.Element {
  const left = useCountdown(v.endsAt, 5);
  const players = usePlayerMap();
  const author = players.get(v.target.playerId);
  const locked = !!v.reveal || v.isMine;

  useEffect(() => {
    sfx.card();
  }, [v.index]);

  useEffect(() => {
    if (v.reveal) sfx.reveal();
  }, [v.reveal]);

  return (
    <div className="vg-vote">
      <header className="vg-vote__top">
        <span className="chip">
          Dibujo {v.index + 1} de {v.count}
        </span>
        <div className="vg-word vg-word--sm">
          <span className="label">La palabra era</span>
          <strong>{v.word}</strong>
        </div>
        {!v.reveal && <Timer ms={left} urgentAt={VOTE_TOTAL} />}
      </header>

      <div className="vg-vote__stage">
        <DrawingView strokes={v.target.strokes} animate duration={1300} key={v.target.playerId + v.index} />

        {v.reveal && (
          <div className="vg-reveal anim-pop">
            <div className="vg-reveal__stars">
              {'★'.repeat(Math.round(v.reveal.avg))}
              <span className="vg-reveal__dim">{'★'.repeat(5 - Math.round(v.reveal.avg))}</span>
            </div>
            <div className="vg-reveal__avg tnum">{v.reveal.avg.toFixed(2)}</div>
            <div className="hint">{v.reveal.votes} voto{v.reveal.votes === 1 ? '' : 's'}</div>
          </div>
        )}
      </div>

      <footer className="vg-vote__foot">
        <div className="vg-vote__author">
          {v.reveal && author ? (
            <>
              <Avatar avatar={author.avatar} size={34} />
              <span className="prow__name">{author.name}</span>
            </>
          ) : (
            <span className="hint">¿De quién será? Se revela al cerrar.</span>
          )}
        </div>

        {v.isMine ? (
          <span className="chip chip--accent">Este es tuyo — no podés votarte</span>
        ) : (
          <div className="stars" role="group" aria-label="Puntuá el dibujo">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                className={`star ${v.myVote && n <= v.myVote ? 'star--on' : ''}`}
                disabled={locked}
                onClick={() => {
                  sfx.star(n);
                  api.send('vote', { value: n });
                }}
                aria-label={`${n} estrella${n > 1 ? 's' : ''}`}
                aria-pressed={v.myVote === n}
              >
                ★
              </button>
            ))}
          </div>
        )}

        <span className="chip nowrap">
          {v.votesIn}/{v.votersTotal} votaron
        </span>
      </footer>
    </div>
  );
}

/* ── Galería de la ronda ──────────────────────────────────────────────────── */

function RoundResults({ v }: { v: Extract<VanGoghView, { stage: 'roundResults' }> }): JSX.Element {
  const players = usePlayerMap();
  const meId = useStore((s) => s.playerId);
  const left = useCountdown(v.endsAt, 3);

  useEffect(() => {
    sfx.fanfare();
  }, []);

  return (
    <div className="vg-gallery">
      <header className="vg-gallery__top">
        <div>
          <h2 className="vg-gallery__title">Galería · ronda {v.round}</h2>
          <p className="muted">«{v.word}»</p>
        </div>
        <span className="chip">
          {v.round < v.totalRounds ? 'Próxima ronda' : 'Cierre'} en {Math.ceil(left / 1000)}s
        </span>
      </header>

      <div className="vg-gallery__grid">
        {v.entries.map((e, i) => {
          const p = players.get(e.playerId);
          return (
            <article
              key={e.playerId}
              className={`vg-art ${e.playerId === meId ? 'vg-art--me' : ''} anim-rise`}
              style={{ animationDelay: `${i * 70}ms` }}
            >
              <div className="vg-art__frame">
                <DrawingView strokes={e.strokes} />
                {i < 3 && <div className={`vg-art__medal vg-art__medal--${i + 1}`}>{i + 1}º</div>}
              </div>
              <div className="vg-art__foot">
                {p && <Avatar avatar={p.avatar} size={28} offline={!p.connected} />}
                <span className="grow prow__name">{p?.name ?? '—'}</span>
                <span className="vg-art__stars tnum">★ {e.avg.toFixed(2)}</span>
                <span className="vg-art__gain tnum">+{e.gained}</span>
              </div>
            </article>
          );
        })}
      </div>

      <section className="vg-gallery__totals card">
        <h3 className="card__title">Acumulado del minijuego</h3>
        <ol className="plist">
          {Object.entries(v.totals)
            .sort((a, b) => b[1] - a[1])
            .map(([id, total], i) => {
              const p = players.get(id);
              if (!p) return null;
              return (
                <li key={id} className={`prow ${id === meId ? 'prow--me' : ''}`}>
                  <RankBadge rank={i + 1} />
                  <Avatar avatar={p.avatar} size={30} offline={!p.connected} />
                  <span className="grow prow__name">{p.name}</span>
                  <span className="prow__score tnum">{total}</span>
                </li>
              );
            })}
        </ol>
      </section>
    </div>
  );
}
