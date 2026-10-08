import { useEffect, useRef, useState } from 'react';
import type { FrasesView } from '@shared/types';
import { api } from '@/net/socket';
import { useCountdown } from '@/lib/hooks';
import { sfx } from '@/lib/sfx';
import { usePlayerMap, useStore } from '@/state/store';
import { Avatar, RankBadge, Timer, TimerBar } from '@/components/ui';

const WRITE_TOTAL = 60_000;
const MAX_ANSWER = 90;

export function Frases({ view }: { view: FrasesView }): JSX.Element {
  switch (view.stage) {
    case 'prompt':
      return <Prompt v={view} />;
    case 'write':
      return <Write v={view} />;
    case 'vote':
      return <Vote v={view} />;
    case 'roundResults':
      return <Results v={view} />;
    default:
      return <div className="center grow"><p className="hint">Cerrando…</p></div>;
  }
}

/** Parte la frase por el hueco para poder resaltarlo. */
function Phrase({ phrase, fill }: { phrase: string; fill?: string }): JSX.Element {
  const [before, after] = phrase.split('___');
  return (
    <span>
      {before}
      <span className={`fr-blank ${fill ? 'fr-blank--filled' : ''}`}>{fill || '_______'}</span>
      {after ?? ''}
    </span>
  );
}

function Prompt({ v }: { v: Extract<FrasesView, { stage: 'prompt' }> }): JSX.Element {
  const left = useCountdown(v.endsAt, 10);
  useEffect(() => {
    sfx.reveal();
  }, [v.phrase]);

  return (
    <div className="fr-prompt">
      <span className="chip">Ronda {v.round} de {v.totalRounds}</span>
      <p className="vg-prompt__label">Completá la frase</p>
      <h1 className="fr-phrase anim-pop">
        <Phrase phrase={v.phrase} />
      </h1>
      <p className="vg-prompt__go">Teclados listos en {Math.ceil(left / 1000)}…</p>
    </div>
  );
}

function Write({ v }: { v: Extract<FrasesView, { stage: 'write' }> }): JSX.Element {
  const left = useCountdown(v.endsAt, 5);
  const players = usePlayerMap();
  const [text, setText] = useState(v.myAnswer);
  const inputRef = useRef<HTMLInputElement>(null);
  const sentRef = useRef(v.myAnswer);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // El borrador va al servidor con freno para no inundar el socket.
  useEffect(() => {
    if (text === sentRef.current) return;
    const id = setTimeout(() => {
      sentRef.current = text;
      api.send('draft', { text });
    }, 350);
    return () => clearTimeout(id);
  }, [text]);

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!text.trim()) return;
    sentRef.current = text;
    api.send('draft', { text });
    sfx.pick();
    api.send('ready', { value: !v.iAmReady });
  };

  return (
    <div className="fr-write">
      <header className="fr-write__top">
        <div className="grow">
          <span className="label">Ronda {v.round} de {v.totalRounds}</span>
          <h2 className="fr-phrase fr-phrase--sm">
            <Phrase phrase={v.phrase} fill={text.trim() || undefined} />
          </h2>
        </div>
        <div className="vg-draw__timer">
          <Timer ms={left} urgentAt={15_000} />
          <TimerBar ms={left} total={WRITE_TOTAL} />
        </div>
      </header>

      <form className="fr-form" onSubmit={submit}>
        <input
          ref={inputRef}
          className="input fr-input"
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, MAX_ANSWER))}
          placeholder="Escribí tu respuesta…"
          maxLength={MAX_ANSWER}
          disabled={v.iAmReady}
          autoComplete="off"
        />
        <div className="fr-form__foot">
          <span className="hint">{text.length}/{MAX_ANSWER}</span>
          <button
            className={`btn btn--lg ${v.iAmReady ? 'btn--ghost' : 'btn--green'}`}
            disabled={!text.trim()}
          >
            {v.iAmReady ? 'Cambiar respuesta' : '✓ Listo'}
          </button>
        </div>
      </form>

      <div className="fr-ready">
        <div className="vg-ready__faces">
          {v.readyIds.map((id) => {
            const p = players.get(id);
            return p ? <Avatar key={id} avatar={p.avatar} size={26} /> : null;
          })}
        </div>
        <span className="chip">{v.readyIds.length}/{v.writers} listos</span>
      </div>
    </div>
  );
}

function Vote({ v }: { v: Extract<FrasesView, { stage: 'vote' }> }): JSX.Element {
  const left = useCountdown(v.endsAt, 5);

  return (
    <div className="fr-vote">
      <header className="fr-vote__top">
        <h2 className="fr-phrase fr-phrase--sm">
          <Phrase phrase={v.phrase} />
        </h2>
        <div className="row">
          <Timer ms={left} urgentAt={10_000} />
          <span className="chip nowrap">{v.votesIn}/{v.votersTotal} votaron</span>
        </div>
      </header>

      <p className="hint" style={{ textAlign: 'center' }}>
        {v.canVote ? 'Votá la mejor. No podés votarte a vos.' : 'No mandaste respuesta: esta ronda sólo mirás.'}
      </p>

      <ul className="fr-options">
        {v.answers.map((a, i) => {
          const mine = a.playerId !== null;
          const chosen = v.myVote === a.id;
          return (
            <li key={a.id}>
              <button
                className={`fr-option ${chosen ? 'fr-option--on' : ''} ${mine ? 'fr-option--mine' : ''}`}
                disabled={!v.canVote || mine}
                onClick={() => {
                  sfx.star(3);
                  api.send('vote', { id: a.id });
                }}
                style={{ animationDelay: `${i * 55}ms` }}
              >
                <span className="fr-option__text">{a.text}</span>
                {mine && <span className="chip">tuya</span>}
                {chosen && <span className="fr-option__check">✓</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Results({ v }: { v: Extract<FrasesView, { stage: 'roundResults' }> }): JSX.Element {
  const players = usePlayerMap();
  const meId = useStore((s) => s.playerId);
  const left = useCountdown(v.endsAt, 3);
  const best = v.answers[0]?.votes ?? 0;

  useEffect(() => {
    sfx.fanfare();
  }, []);

  return (
    <div className="fr-results">
      <header className="vg-gallery__top">
        <div>
          <h2 className="vg-gallery__title">Ronda {v.round}</h2>
          <p className="muted"><Phrase phrase={v.phrase} /></p>
        </div>
        <span className="chip">
          {v.round < v.totalRounds ? 'Próxima ronda' : 'Cierre'} en {Math.ceil(left / 1000)}s
        </span>
      </header>

      <ul className="fr-podium">
        {v.answers.map((a, i) => {
          const p = a.playerId ? players.get(a.playerId) : null;
          const top = a.votes > 0 && a.votes === best;
          return (
            <li
              key={a.id}
              className={`fr-answer ${top ? 'fr-answer--top' : ''} anim-rise`}
              style={{ animationDelay: `${i * 80}ms` }}
            >
              {top && <span className="fr-answer__crown">👑</span>}
              <p className="fr-answer__text">{a.text}</p>
              <div className="fr-answer__foot">
                {p && <Avatar avatar={p.avatar} size={26} offline={!p.connected} />}
                <span className="grow prow__name">{p?.name ?? '—'}</span>
                <span className="fr-answer__votes tnum">
                  {a.votes} voto{a.votes === 1 ? '' : 's'}
                </span>
              </div>
            </li>
          );
        })}
      </ul>

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
