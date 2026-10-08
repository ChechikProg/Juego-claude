import { useEffect, useState } from 'react';
import { BJ_MIN_BET, CHIPS, money } from '@shared/constants';
import type { BjHand, BlackjackView } from '@shared/types';
import { api } from '@/net/socket';
import { sfx } from '@/lib/sfx';
import { useOnChange } from '@/lib/hooks';
import { CardRow } from './Card';

const OUTCOME_TEXT: Record<NonNullable<BjHand['outcome']>, string> = {
  bj: 'BLACKJACK',
  win: 'GANASTE',
  push: 'EMPATE',
  lose: 'PERDISTE',
};

export function Blackjack({ v, balance }: { v: BlackjackView; balance: number }): JSX.Element {
  const [bet, setBet] = useState(50);

  useOnChange(v.hands.length, () => sfx.card());
  useOnChange(v.phase, (phase) => {
    if (phase === 'settled') {
      const net = v.lastNet ?? 0;
      if (net > 0) sfx.coin();
      else if (net < 0) sfx.bad();
    }
  });

  // No dejamos la apuesta por encima de lo que hay en la mesa.
  useEffect(() => {
    if (bet > balance) setBet(Math.max(BJ_MIN_BET, Math.floor(balance / 10) * 10));
  }, [balance, bet]);

  const betting = v.phase === 'bet' || v.phase === 'settled';
  const canDeal = betting && balance >= Math.max(BJ_MIN_BET, bet) && bet >= BJ_MIN_BET;

  return (
    <div className="bj">
      <div className="bj__felt">
        <div className="bj__dealer">
          <div className="bj__who">
            <span className="label">Croupier</span>
            {v.dealer.length > 0 && (
              <span className="bj__total tnum">{v.dealerTotal || '?'}</span>
            )}
          </div>
          {v.dealer.length > 0 ? <CardRow cards={v.dealer} /> : <EmptySlot text="Esperando la apuesta" />}
        </div>

        <div className="bj__middle">
          {v.phase === 'settled' && v.message && (
            <div className={`bj__banner anim-pop ${(v.lastNet ?? 0) > 0 ? 'bj__banner--win' : (v.lastNet ?? 0) < 0 ? 'bj__banner--lose' : ''}`}>
              <span>{v.message}</span>
              {v.lastNet !== null && v.lastNet !== 0 && (
                <b className="tnum">{v.lastNet > 0 ? '+' : ''}{money(v.lastNet)}</b>
              )}
            </div>
          )}
          {v.phase === 'player' && <div className="bj__hint">El croupier se planta en 17 · Blackjack paga 3 a 2</div>}
        </div>

        <div className="bj__hands">
          {v.hands.length === 0 ? (
            <EmptySlot text="Poné una ficha para arrancar" />
          ) : (
            v.hands.map((h, i) => (
              <div
                key={i}
                className={`bj__hand ${v.phase === 'player' && i === v.active ? 'bj__hand--active' : ''} ${
                  h.outcome ? `bj__hand--${h.outcome}` : ''
                }`}
              >
                <CardRow cards={h.cards} small={v.hands.length > 1} />
                <div className="bj__handinfo">
                  <span className="bj__total tnum">
                    {h.total}
                    {h.soft && !h.bust ? ' / blanda' : ''}
                  </span>
                  <span className="chip tnum">{money(h.bet)}</span>
                  {h.outcome && (
                    <span className={`bj__tag bj__tag--${h.outcome}`}>{OUTCOME_TEXT[h.outcome]}</span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {betting ? (
        <div className="bj__controls">
          <div className="chips" role="group" aria-label="Fichas">
            {CHIPS.map((c) => (
              <button
                key={c}
                className={`poker ${bet === c ? 'poker--on' : ''}`}
                data-chip={c}
                disabled={c > balance}
                onClick={() => {
                  sfx.tap();
                  setBet(c);
                }}
              >
                {c}
              </button>
            ))}
            <button
              className="btn btn--sm btn--ghost"
              disabled={balance < BJ_MIN_BET}
              onClick={() => {
                sfx.tap();
                setBet(Math.max(BJ_MIN_BET, Math.min(balance, bet * 2)));
              }}
            >
              x2
            </button>
            <button
              className="btn btn--sm btn--ghost"
              disabled={balance < BJ_MIN_BET}
              onClick={() => {
                sfx.tap();
                setBet(Math.floor(balance));
              }}
            >
              todo
            </button>
          </div>

          <div className="bj__dealrow">
            <span className="bj__betlabel">
              Apuesta <b className="tnum">{money(bet)}</b>
            </span>
            <button
              className="btn btn--gold btn--lg"
              disabled={!canDeal}
              onClick={() => {
                sfx.card();
                api.send('bj:bet', { amount: bet });
              }}
            >
              Repartir
            </button>
          </div>
        </div>
      ) : (
        <div className="bj__controls bj__controls--actions">
          <button className="btn btn--accent btn--lg" disabled={!v.can.hit} onClick={() => { sfx.card(); api.send('bj:act', { action: 'hit' }); }}>
            Pedir
          </button>
          <button className="btn btn--lg" disabled={!v.can.stand} onClick={() => { sfx.tap(); api.send('bj:act', { action: 'stand' }); }}>
            Plantarse
          </button>
          <button className="btn btn--lg" disabled={!v.can.double || balance < (v.hands[v.active]?.bet ?? 0)} onClick={() => { sfx.coin(); api.send('bj:act', { action: 'double' }); }}>
            Doblar
          </button>
          <button className="btn btn--lg" disabled={!v.can.split || balance < (v.hands[v.active]?.bet ?? 0)} onClick={() => { sfx.card(); api.send('bj:act', { action: 'split' }); }}>
            Dividir
          </button>
        </div>
      )}

      <div className="bj__shoe">
        <span className="hint">Zapato {v.shoePct}%</span>
        <div className="timerbar" style={{ width: 120 }}>
          <div className="timerbar__fill" style={{ width: `${v.shoePct}%` }} />
        </div>
      </div>
    </div>
  );
}

function EmptySlot({ text }: { text: string }): JSX.Element {
  return <div className="bj__empty">{text}</div>;
}
