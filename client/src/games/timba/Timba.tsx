import { useEffect, useRef } from 'react';
import { START_BALANCE, money } from '@shared/constants';
import type { TimbaTable, TimbaView } from '@shared/types';
import { api } from '@/net/socket';
import { sfx } from '@/lib/sfx';
import { useCountdown, useRollingNumber } from '@/lib/hooks';
import { usePlayerMap, useStore } from '@/state/store';
import { Avatar, RankBadge, Timer } from '@/components/ui';
import { Blackjack } from './Blackjack';
import { Roulette } from './Roulette';
import { Slots } from './Slots';

const TABLES: { id: TimbaTable; name: string; icon: string; blurb: string }[] = [
  { id: 'blackjack', name: 'Blackjack', icon: '🂡', blurb: 'Llegá a 21 sin pasarte. Paga 3 a 2.' },
  { id: 'roulette', name: 'Ruleta', icon: '🎡', blurb: 'Un solo cero. El pleno paga 35 a 1.' },
  { id: 'slots', name: 'Dulce Bonanza', icon: '🍭', blurb: 'Cluster pays, tumbles y giros gratis.' },
];

export function Timba({ view }: { view: TimbaView }): JSX.Element {
  const left = useCountdown(view.endsAt, 4);
  const balance = useRollingNumber(view.balance, 7);
  const players = usePlayerMap();
  const meId = useStore((s) => s.playerId);
  const lastBell = useRef(false);

  useEffect(() => {
    const s = Math.ceil(left / 1000);
    if (s <= 10 && s > 0 && !lastBell.current) {
      lastBell.current = true;
      sfx.urgent();
    }
  }, [left]);

  const go = (t: TimbaTable) => {
    sfx.pick();
    api.send('table', { t });
  };

  const broke = view.balance < 20;

  return (
    <div className="tb">
      <header className="tb__top">
        <button
          className={`btn btn--sm ${view.table === 'hub' ? 'btn--ghost' : 'btn--accent'}`}
          onClick={() => go('hub')}
          disabled={view.table === 'hub'}
        >
          ← Salón
        </button>

        <div className="tb__balance">
          <span className="label">Tu plata</span>
          <strong className={`tnum ${view.balance >= START_BALANCE ? 'tb__up' : 'tb__down'}`}>
            {money(balance)}
          </strong>
        </div>

        <div className="tb__tabs">
          {TABLES.map((t) => (
            <button
              key={t.id}
              className={`tb__tab ${view.table === t.id ? 'tb__tab--on' : ''}`}
              onClick={() => go(t.id)}
            >
              <span aria-hidden>{t.icon}</span>
              <span className="tb__tabname">{t.name}</span>
            </button>
          ))}
        </div>

        <Timer ms={left} urgentAt={30_000} />
      </header>

      <div className="tb__body">
        <main className="tb__main">
          {view.table === 'hub' && <Hub view={view} onGo={go} />}
          {view.table === 'blackjack' && <Blackjack v={view.bj} balance={view.balance} />}
          {view.table === 'roulette' && <Roulette v={view.rl} balance={view.balance} />}
          {view.table === 'slots' && <Slots v={view.sl} balance={view.balance} />}

          {broke && view.table !== 'hub' && (
            <div className="tb__bailout anim-pop">
              <span>Te quedaste sin fichas.</span>
              <button
                className="btn btn--sm btn--gold"
                onClick={() => {
                  sfx.coin();
                  api.send('bailout');
                }}
              >
                Pedirle al tío
              </button>
            </div>
          )}
        </main>

        <aside className="tb__side">
          <section className="panel">
            <h3 className="card__title">Caja fuerte</h3>
            <ol className="plist">
              {view.board.map((row, i) => {
                const p = players.get(row.playerId);
                if (!p) return null;
                return (
                  <li key={row.playerId} className={`prow ${row.playerId === meId ? 'prow--me' : ''}`}>
                    <RankBadge rank={i + 1} />
                    <Avatar avatar={p.avatar} size={28} offline={!p.connected} />
                    <span className="grow prow__name">{p.name}</span>
                    <span className={`tnum tb__cash ${row.broke ? 'tb__broke' : ''}`}>{money(row.balance)}</span>
                  </li>
                );
              })}
            </ol>
          </section>

          <section className="panel grow tb__feedbox">
            <h3 className="card__title">En vivo</h3>
            <ul className="tb__feed">
              {view.feed.length === 0 && <li className="hint">Todavía no pasó nada jugoso.</li>}
              {view.feed.map((f) => {
                const p = players.get(f.playerId);
                return (
                  <li key={f.id} className={`tb__feeditem tb__feeditem--${f.kind} anim-fade`}>
                    {p && <Avatar avatar={p.avatar} size={22} />}
                    <span className="grow">
                      <b>{p?.name ?? 'Alguien'}</b> {f.text}
                    </span>
                    {f.amount > 0 && <span className="tnum tb__feedamt">+{money(f.amount)}</span>}
                  </li>
                );
              })}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}

/* ── Salón ────────────────────────────────────────────────────────────────── */

function Hub({ view, onGo }: { view: TimbaView; onGo: (t: TimbaTable) => void }): JSX.Element {
  const pnl = view.balance - START_BALANCE;
  return (
    <div className="tb__hub">
      <div className="tb__hubstats">
        <Stat label="Arrancaste con" value={money(START_BALANCE)} />
        <Stat label="Pico máximo" value={money(view.peak)} tone="good" />
        <Stat label="Apostaste" value={money(view.wagered)} />
        <Stat
          label="Resultado"
          value={`${pnl >= 0 ? '+' : ''}${money(pnl)}`}
          tone={pnl > 0 ? 'good' : pnl < 0 ? 'bad' : undefined}
        />
      </div>

      <div className="tb__hubgrid">
        {TABLES.map((t) => (
          <button key={t.id} className="tb__door" onClick={() => onGo(t.id)}>
            <span className="tb__dooricon" aria-hidden>{t.icon}</span>
            <span className="tb__doorname">{t.name}</span>
            <span className="tb__doorblurb">{t.blurb}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }): JSX.Element {
  return (
    <div className="tb__stat">
      <span className="label">{label}</span>
      <strong className={`tnum ${tone === 'good' ? 'tb__up' : tone === 'bad' ? 'tb__down' : ''}`}>{value}</strong>
    </div>
  );
}
