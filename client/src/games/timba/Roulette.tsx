import { useEffect, useMemo, useRef, useState } from 'react';
import { CHIPS, ROULETTE_SPIN_MS, ROULETTE_WHEEL, isRed, money } from '@shared/constants';
import type { RouletteBetKind, RouletteView } from '@shared/types';
import { api, serverNow } from '@/net/socket';
import { sfx } from '@/lib/sfx';
import { useOnChange } from '@/lib/hooks';

const SEG = 360 / ROULETTE_WHEEL.length;

/** Columnas 1..12 × 3 filas. Fila 0 = 3,6,9…; fila 2 = 1,4,7… */
const GRID: number[][] = [0, 1, 2].map((r) => Array.from({ length: 12 }, (_, c) => c * 3 + (3 - r)));

const OUTSIDE: { kind: RouletteBetKind; label: string; tone?: 'red' | 'black' }[] = [
  { kind: 'low', label: '1–18' },
  { kind: 'even', label: 'PAR' },
  { kind: 'red', label: 'ROJO', tone: 'red' },
  { kind: 'black', label: 'NEGRO', tone: 'black' },
  { kind: 'odd', label: 'IMPAR' },
  { kind: 'high', label: '19–36' },
];

export function Roulette({ v, balance }: { v: RouletteView; balance: number }): JSX.Element {
  const [chip, setChip] = useState(25);
  const wheelRot = useRef(0);
  const ballRot = useRef(0);
  const [, force] = useState(0);
  const [showResult, setShowResult] = useState(false);

  const betting = v.phase === 'bets';
  const spinning = v.phase === 'spinning';

  // Cuando el servidor manda el número, giramos la rueda hasta dejarlo arriba.
  // La clave es el instante de frenado, que es único por tirada: el paso de
  // 'spinning' a 'result' no la cambia y la rueda gira una sola vez.
  useOnChange(v.phase === 'bets' || v.revealAt === null ? null : v.revealAt, () => {
    if (v.result === null) return;
    const idx = ROULETTE_WHEEL.indexOf(v.result as never);
    if (idx < 0) return;
    const desired = (360 - (idx * SEG + SEG / 2)) % 360;
    const cur = ((wheelRot.current % 360) + 360) % 360;
    let delta = desired - cur;
    if (delta < 0) delta += 360;
    wheelRot.current += 360 * 6 + delta;
    ballRot.current -= 360 * 9;
    setShowResult(false);
    force((n) => n + 1);
    sfx.reel();
  });

  // El cartel del resultado aparece recién cuando la bolita frena.
  useEffect(() => {
    if (v.revealAt === null || v.result === null) {
      setShowResult(false);
      return;
    }
    const wait = Math.max(0, v.revealAt - serverNow());
    const id = setTimeout(() => {
      setShowResult(true);
      if ((v.lastNet ?? 0) > 0) sfx.jackpot();
      else if ((v.lastNet ?? 0) < 0) sfx.bad();
    }, wait);
    return () => clearTimeout(id);
  }, [v.revealAt, v.result, v.lastNet]);

  const wheelBg = useMemo(() => {
    const stops = ROULETTE_WHEEL.map((n, i) => {
      const color = n === 0 ? '#1aa35f' : isRed(n) ? '#c52338' : '#15131f';
      return `${color} ${i * SEG}deg ${(i + 1) * SEG}deg`;
    });
    return `conic-gradient(${stops.join(',')})`;
  }, []);

  const staked = (kind: RouletteBetKind, n?: number): number =>
    v.bets.find((b) => b.kind === kind && b.n === n)?.amount ?? 0;

  const place = (kind: RouletteBetKind, n?: number) => {
    if (!betting || chip > balance) {
      if (chip > balance) sfx.bad();
      return;
    }
    sfx.tap();
    api.send('rl:chip', n === undefined ? { kind, amount: chip } : { kind, n, amount: chip });
  };

  return (
    <div className="rl">
      <div className="rl__left">
        <div className="rl__wheelbox">
          <div
            className="rl__wheel"
            style={{
              background: wheelBg,
              transform: `rotate(${wheelRot.current}deg)`,
              transitionDuration: `${ROULETTE_SPIN_MS}ms`,
            }}
          >
            {/* Los números van en un SVG que gira con la rueda: se leen durante todo el giro. */}
            <svg className="rl__nums" viewBox="0 0 200 200" aria-hidden>
              {ROULETTE_WHEEL.map((n, i) => {
                const a = i * SEG;
                return (
                  <g key={n} transform={`rotate(${a} 100 100)`}>
                    <line x1="100" y1="3" x2="100" y2="60" stroke="rgba(255,215,130,0.45)" strokeWidth="0.6" />
                    <text
                      x="100"
                      y="16"
                      transform={`rotate(${SEG / 2} 100 100)`}
                      textAnchor="middle"
                      className="rl__numtxt"
                    >
                      {n}
                    </text>
                  </g>
                );
              })}
              <circle cx="100" cy="100" r="76" fill="none" stroke="rgba(255,215,130,0.5)" strokeWidth="1" />
              <circle cx="100" cy="100" r="60" fill="rgba(0,0,0,0.28)" />
            </svg>
            <div className="rl__hub" />
          </div>

          <div
            className="rl__ballorbit"
            style={{ transform: `rotate(${ballRot.current}deg)`, transitionDuration: `${ROULETTE_SPIN_MS}ms` }}
          >
            <span className="rl__ball" />
          </div>

          <div className="rl__pointer" aria-hidden />

          {showResult && v.result !== null && (
            <div className={`rl__result anim-pop ${v.result === 0 ? 'rl__result--zero' : isRed(v.result) ? 'rl__result--red' : 'rl__result--black'}`}>
              <span className="rl__resultnum">{v.result}</span>
              {v.lastNet !== null && (
                <span className="rl__resultnet tnum">
                  {v.lastNet > 0 ? `+${money(v.lastNet)}` : v.lastNet < 0 ? money(v.lastNet) : 'sin cambios'}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="rl__history">
          {v.history.length === 0 && <span className="hint">Todavía no giró</span>}
          {v.history.map((n, i) => (
            <span
              key={`${n}-${i}`}
              className={`rl__hist ${n === 0 ? 'rl__hist--zero' : isRed(n) ? 'rl__hist--red' : 'rl__hist--black'}`}
            >
              {n}
            </span>
          ))}
        </div>
      </div>

      <div className="rl__right">
        <div className="rl__table" aria-label="Paño de apuestas">
          <button
            className={`rl__cell rl__cell--zero ${staked('straight', 0) ? 'rl__cell--bet' : ''}`}
            onClick={() => place('straight', 0)}
            disabled={!betting}
          >
            0
            {staked('straight', 0) > 0 && <Chip amount={staked('straight', 0)} />}
          </button>

          <div className="rl__numbers">
            {GRID.flat().map((n) => (
              <button
                key={n}
                className={`rl__cell ${isRed(n) ? 'rl__cell--red' : 'rl__cell--black'} ${staked('straight', n) ? 'rl__cell--bet' : ''}`}
                onClick={() => place('straight', n)}
                disabled={!betting}
              >
                {n}
                {staked('straight', n) > 0 && <Chip amount={staked('straight', n)} />}
              </button>
            ))}
          </div>

          <div className="rl__cols">
            {(['col3', 'col2', 'col1'] as RouletteBetKind[]).map((k) => (
              <button
                key={k}
                className={`rl__cell rl__cell--side ${staked(k) ? 'rl__cell--bet' : ''}`}
                onClick={() => place(k)}
                disabled={!betting}
              >
                2:1
                {staked(k) > 0 && <Chip amount={staked(k)} />}
              </button>
            ))}
          </div>

          <div className="rl__dozens">
            {(['dozen1', 'dozen2', 'dozen3'] as RouletteBetKind[]).map((k, i) => (
              <button
                key={k}
                className={`rl__cell rl__cell--wide ${staked(k) ? 'rl__cell--bet' : ''}`}
                onClick={() => place(k)}
                disabled={!betting}
              >
                {i === 0 ? '1–12' : i === 1 ? '13–24' : '25–36'}
                {staked(k) > 0 && <Chip amount={staked(k)} />}
              </button>
            ))}
          </div>

          <div className="rl__outside">
            {OUTSIDE.map((o) => (
              <button
                key={o.kind}
                className={`rl__cell rl__cell--wide ${o.tone ? `rl__cell--${o.tone}` : ''} ${staked(o.kind) ? 'rl__cell--bet' : ''}`}
                onClick={() => place(o.kind)}
                disabled={!betting}
              >
                {o.label}
                {staked(o.kind) > 0 && <Chip amount={staked(o.kind)} />}
              </button>
            ))}
          </div>
        </div>

        <div className="rl__controls">
          <div className="chips">
            {CHIPS.map((c) => (
              <button
                key={c}
                className={`poker ${chip === c ? 'poker--on' : ''}`}
                data-chip={c}
                disabled={c > balance}
                onClick={() => {
                  sfx.tap();
                  setChip(c);
                }}
              >
                {c}
              </button>
            ))}
          </div>

          <div className="rl__actions">
            <span className="chip tnum">en juego {money(v.staked)}</span>
            <button className="btn btn--sm btn--ghost" disabled={!betting || v.bets.length === 0} onClick={() => { sfx.back(); api.send('rl:undo'); }}>
              ↩
            </button>
            <button className="btn btn--sm btn--ghost" disabled={!betting || v.bets.length === 0} onClick={() => { sfx.back(); api.send('rl:clear'); }}>
              limpiar
            </button>
            <button
              className="btn btn--gold btn--lg grow"
              disabled={!betting || v.bets.length === 0}
              onClick={() => {
                sfx.reel();
                api.send('rl:spin');
              }}
            >
              {spinning ? 'Girando…' : 'Girar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Chip({ amount }: { amount: number }): JSX.Element {
  return <span className="rl__chip tnum">{amount >= 1000 ? `${Math.round(amount / 1000)}k` : amount}</span>;
}
