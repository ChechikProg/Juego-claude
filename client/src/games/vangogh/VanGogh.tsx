import { useEffect, useRef, useState } from 'react';
import type { Stroke, VanGoghView } from '@shared/types';
import { api } from '@/net/socket';
import { useCountdown } from '@/lib/hooks';
import { sfx } from '@/lib/sfx';
import { usePlayerMap, useStore } from '@/state/store';
import { Avatar, Modal, RankBadge, Timer, TimerBar } from '@/components/ui';
import { DrawingPad, DrawingView } from './Canvas';

const DRAW_TOTAL = 120_000;

export function VanGogh({ view }: { view: VanGoghView }): JSX.Element {
  switch (view.stage) {
    case 'prompt':
      return <Prompt v={view} />;
    case 'draw':
      return <Draw v={view} />;
    case 'rank':
      return <Rank v={view} key={view.round} />;
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

/* ── Ranking: ordenar los dibujos de los demás ────────────────────────────── */

type RankV = Extract<VanGoghView, { stage: 'rank' }>;

function Rank({ v }: { v: RankV }): JSX.Element {
  const left = useCountdown(v.endsAt, 5);
  const players = usePlayerMap();
  /** orden local, de mejor a peor (ids anónimos) */
  const [order, setOrder] = useState<string[]>(() => v.myOrder ?? []);
  const [zoom, setZoom] = useState<string | null>(null);
  const submitted = v.myOrder !== null;
  const total = v.cards.length;
  const complete = total > 0 && order.length === total;
  const confirmed = useRef(v.myOrder);
  confirmed.current = v.myOrder;
  const lastBeep = useRef(0);

  useEffect(() => {
    sfx.reveal();
  }, []);

  useEffect(() => {
    const s = Math.ceil(left / 1000);
    if (s <= 5 && s > 0 && lastBeep.current !== s) {
      lastBeep.current = s;
      sfx.urgent();
    }
  }, [left]);

  // Apenas el orden está completo lo mandamos; si lo tocás de nuevo, lo retiramos.
  useEffect(() => {
    if (complete) {
      if (!sameOrder(order, confirmed.current)) api.send('rank', { order });
    } else if (confirmed.current !== null) {
      api.send('rank', { order: null });
    }
  }, [order, complete]);

  const toggle = (id: string) => {
    if (order.includes(id)) {
      sfx.back();
      setOrder(order.filter((x) => x !== id));
      return;
    }
    const next = [...order, id];
    if (next.length === total) sfx.good();
    else sfx.star(Math.min(5, next.length));
    setOrder(next);
  };

  const byId = new Map(v.cards.map((c) => [c.id, c]));
  const zoomed = zoom ? byId.get(zoom) : null;
  const zoomPos = zoom ? order.indexOf(zoom) : -1;

  return (
    <div className="vg-rank">
      <header className="vg-rank__top">
        <span className="chip">Ronda {v.round} de {v.totalRounds}</span>
        <div className="vg-word vg-word--sm">
          <span className="label">La palabra era</span>
          <strong>{v.word}</strong>
        </div>
        <div className="vg-rank__timer">
          <Timer ms={left} urgentAt={10_000} />
          <TimerBar ms={left} total={v.totalMs} />
        </div>
      </header>

      <p className="vg-rank__help">
        <b>Ordená los dibujos del mejor al peor.</b> Tocalos en orden: el primero que toques queda 1º. Tocá uno ya
        elegido para sacarlo.
      </p>

      <div className="vg-rank__body">
        {total === 0 ? (
          <div className="vg-rank__grid vg-rank__grid--empty">
            <p className="hint">Esta ronda no tenés dibujos para rankear. Esperá a los demás.</p>
          </div>
        ) : (
          <div className="vg-rank__grid" role="list">
            {v.cards.map((card, i) => {
              const pos = order.indexOf(card.id);
              return (
                <div
                  key={card.id}
                  role="listitem"
                  className={`vg-card ${pos >= 0 ? 'vg-card--on' : ''} ${pos === 0 ? 'vg-card--first' : ''} anim-rise`}
                  style={{ animationDelay: `${i * 60}ms` }}
                >
                  <button
                    className="vg-card__hit"
                    onClick={() => toggle(card.id)}
                    aria-label={
                      pos >= 0
                        ? `Dibujo en el puesto ${pos + 1}. Tocá para sacarlo.`
                        : `Elegir este dibujo como ${order.length + 1}º`
                    }
                  >
                    <DrawingView strokes={card.strokes} animate duration={1400} delay={i * 140} />
                  </button>
                  {pos >= 0 ? (
                    <span className={`vg-card__badge vg-card__badge--${Math.min(pos + 1, 4)}`}>{pos + 1}º</span>
                  ) : (
                    <span className="vg-card__next" aria-hidden>
                      {order.length + 1}º
                    </span>
                  )}
                  <button className="vg-card__zoom" onClick={() => setZoom(card.id)} aria-label="Ver en grande">
                    🔍
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <aside className="vg-rank__side">
          {total > 0 && (
            <section className="vg-ladder card">
              <h3 className="card__title">Tu ranking</h3>
              <ol className="vg-ladder__list">
                {Array.from({ length: total }, (_, i) => {
                  const id = order[i];
                  const card = id ? byId.get(id) : null;
                  return (
                    <li key={i} className={`vg-ladder__slot ${card ? 'vg-ladder__slot--on' : ''}`}>
                      <span className={`vg-ladder__pos vg-ladder__pos--${Math.min(i + 1, 4)}`}>{i + 1}º</span>
                      {card ? (
                        <button
                          className="vg-ladder__thumb"
                          onClick={() => toggle(card.id)}
                          aria-label={`Sacar el ${i + 1}º`}
                        >
                          <DrawingView strokes={card.strokes} />
                        </button>
                      ) : (
                        <span className="vg-ladder__empty">{i === order.length ? 'tocá un dibujo' : '—'}</span>
                      )}
                    </li>
                  );
                })}
              </ol>
              <div className="vg-ladder__foot">
                {submitted ? (
                  <span className="chip chip--good">✓ Enviado</span>
                ) : complete ? (
                  <span className="chip">Enviando…</span>
                ) : (
                  <span className="hint">Faltan {total - order.length}</span>
                )}
                <button
                  className="btn btn--sm btn--ghost"
                  disabled={order.length === 0}
                  onClick={() => {
                    sfx.back();
                    setOrder([]);
                  }}
                >
                  ↺ De nuevo
                </button>
              </div>
            </section>
          )}

          <section className="vg-rank__status card">
            <div className="vg-ready__faces">
              {v.submittedIds.map((id) => {
                const p = players.get(id);
                return p ? <Avatar key={id} avatar={p.avatar} size={26} /> : null;
              })}
            </div>
            <span className="chip nowrap">
              {v.submittedIds.length}/{v.rankersTotal} terminaron
            </span>
          </section>

          {v.mine && (
            <section className="vg-mine card">
              <h3 className="card__title">Tu obra</h3>
              <div className="vg-mine__frame">
                <DrawingView strokes={v.mine} />
              </div>
              <p className="hint">A vos mismo no te podés rankear.</p>
            </section>
          )}
        </aside>
      </div>

      <Modal open={!!zoomed} onClose={() => setZoom(null)}>
        {zoomed && (
          <div className="vg-zoom">
            <div className="vg-zoom__frame">
              <DrawingView strokes={zoomed.strokes} />
            </div>
            <div className="vg-zoom__foot">
              <span className="chip">{zoomPos >= 0 ? `Lo tenés ${zoomPos + 1}º` : 'Sin puesto todavía'}</span>
              <span className="grow" />
              <button className="btn btn--ghost" onClick={() => setZoom(null)}>
                Cerrar
              </button>
              <button
                className={`btn ${zoomPos >= 0 ? 'btn--ghost' : 'btn--green'}`}
                onClick={() => {
                  toggle(zoomed.id);
                  setZoom(null);
                }}
              >
                {zoomPos >= 0 ? 'Sacarlo del ranking' : `Ponerlo ${order.length + 1}º`}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function sameOrder(a: string[], b: string[] | null): boolean {
  return !!b && a.length === b.length && a.every((x, i) => x === b[i]);
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

      {v.noContest && (
        <p className="vg-gallery__note">
          Con menos de 3 artistas no hay con qué comparar: todo dibujo entregado se lleva el puntaje completo.
        </p>
      )}

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
                {i < 3 && !v.noContest && <div className={`vg-art__medal vg-art__medal--${i + 1}`}>{i + 1}º</div>}
              </div>
              <div className="vg-art__foot">
                {p && <Avatar avatar={p.avatar} size={28} offline={!p.connected} />}
                <span className="grow prow__name">{p?.name ?? '—'}</span>
                {!v.noContest && (
                  <span className="vg-art__stats tnum" title="Puesto promedio y veces que salió primero">
                    {e.avgPlace !== null ? `#${e.avgPlace.toFixed(1)}` : 'sin votos'}
                    {e.firsts > 0 && ` · 🥇${e.firsts}`}
                  </span>
                )}
                <span className="vg-art__gain tnum">+{e.gained}</span>
              </div>
              {!v.noContest && (
                <div className="vg-art__meter" aria-hidden>
                  <span style={{ width: `${e.score}%` }} />
                </div>
              )}
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
