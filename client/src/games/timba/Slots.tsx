import { useEffect, useMemo, useRef, useState } from 'react';
import { BOMB, SCATTER, SLOT_COLS, SLOT_ROWS, money } from '@shared/constants';
import type { SlotsView } from '@shared/types';
import { api, serverNow } from '@/net/socket';
import { sfx } from '@/lib/sfx';

/** Tienen que coincidir con server/games/timba/slots.ts */
const STEP_MS = 760;
const INTRO_MS = 620;

const BETS = [5, 10, 20, 50, 100, 200, 500];

export function Slots({ v, balance }: { v: SlotsView; balance: number }): JSX.Element {
  const spin = v.spin;
  /** -1 = reels girando, >=0 = índice del paso que se está mostrando */
  const [idx, setIdx] = useState(() => (v.spin ? v.spin.steps.length : 0));
  const [running, setRunning] = useState(false);
  const shownId = useRef<string | null>(null);
  const spinRef = useRef(spin);
  spinRef.current = spin;
  const busyRef = useRef(v.busyUntil);
  busyRef.current = v.busyUntil;

  // Depende sólo del id: cada push del servidor trae un objeto `spin` nuevo y,
  // si el efecto se re-ejecutara, cancelaría los timers y la máquina quedaría
  // trabada en "girando" para siempre.
  useEffect(() => {
    const spin = spinRef.current;
    if (!spin || spin.id === shownId.current) return;
    shownId.current = spin.id;

    // Si el giro ya terminó (por ejemplo, volviste a la mesa), lo mostramos quieto.
    const remaining = busyRef.current - serverNow();
    if (remaining <= 0) {
      setIdx(spin.steps.length);
      setRunning(false);
      return;
    }

    setIdx(-1);
    setRunning(true);
    sfx.reel();

    const timers: ReturnType<typeof setTimeout>[] = [];
    // El servidor no acepta otro giro hasta `busyUntil`: liberamos el botón ahí.
    timers.push(setTimeout(() => setRunning(false), Math.max(remaining, INTRO_MS + spin.steps.length * STEP_MS) + 60));
    timers.push(
      setTimeout(() => {
        setIdx(0);
        if (spin.steps[0]?.wins.length) sfx.cascade(0);
      }, INTRO_MS),
    );
    for (let i = 1; i < spin.steps.length; i++) {
      timers.push(
        setTimeout(() => {
          setIdx(i);
          if (spin.steps[i].wins.length) sfx.cascade(Math.min(i, 6));
        }, INTRO_MS + i * STEP_MS),
      );
    }
    timers.push(
      setTimeout(() => {
        setIdx(spin.steps.length);
        if (spin.freeSpinsAwarded > 0) sfx.jackpot();
        else if (spin.totalWin > 0) sfx.coin();
      }, INTRO_MS + spin.steps.length * STEP_MS),
    );
    return () => {
      timers.forEach(clearTimeout);
      // Si se desmonta a mitad de camino, que no quede trabado al volver.
      setRunning(false);
    };
  }, [spin?.id]);

  const step = spin && idx >= 0 ? spin.steps[Math.min(idx, spin.steps.length - 1)] : null;
  const prev = spin && idx > 0 ? spin.steps[idx - 1] : null;
  const cols = step?.cols ?? v.cols;

  const winning = useMemo(() => {
    const set = new Set<number>();
    if (step) for (const w of step.wins) for (const c of w.cells) set.add(c);
    return set;
  }, [step]);

  /** Premio acumulado hasta el paso que se está mostrando. */
  const runningWin = useMemo(() => {
    if (!spin || idx < 0) return 0;
    let total = 0;
    for (let i = 0; i <= Math.min(idx, spin.steps.length - 1); i++) total += spin.steps[i].stepWin;
    return total;
  }, [spin, idx]);

  const busy = running || v.freeSpinsLeft > 0;
  const canSpin = !busy && balance >= v.bet;
  const finished = spin && (idx >= spin.steps.length || !running) ? spin : null;

  return (
    <div className={`sl ${v.inBonus ? 'sl--bonus' : ''}`}>
      <div className="sl__machine">
        <div className="sl__marquee" aria-hidden>
          {Array.from({ length: 14 }, (_, i) => (
            <span key={i} className={`sl__bulb ${running ? 'sl__bulb--run' : ''}`} style={{ animationDelay: `${i * 70}ms` }} />
          ))}
        </div>

        <div className={`sl__grid ${idx === -1 ? 'sl__grid--spin' : ''}`}>
          {Array.from({ length: SLOT_ROWS }, (_, r) =>
            Array.from({ length: SLOT_COLS }, (_, c) => {
              const cell = cols[c]?.[r] ?? '🍬';
              const index = c * SLOT_ROWS + r;
              const changed = !prev || prev.cols[c]?.[r] !== cell;
              const isBomb = cell.startsWith(BOMB);
              const mult = isBomb ? cell.split(':')[1] : null;
              return (
                <div
                  key={changed ? `${c}-${r}-s${idx}` : `${c}-${r}`}
                  className={[
                    'sl__cell',
                    winning.has(index) ? 'sl__cell--win' : '',
                    cell === SCATTER ? 'sl__cell--scatter' : '',
                    isBomb ? 'sl__cell--bomb' : '',
                    changed ? 'sl__cell--drop' : '',
                  ].join(' ')}
                  style={{ animationDelay: changed ? `${(SLOT_ROWS - r) * 34}ms` : undefined }}
                >
                  {isBomb ? (
                    <>
                      <span className="sl__bombicon">{BOMB}</span>
                      <span className="sl__bombmult">x{mult}</span>
                    </>
                  ) : (
                    cell
                  )}
                </div>
              );
            }),
          )}

          {finished && finished.totalWin > 0 && (
            <div className="sl__bigwin anim-pop">
              <span className="sl__bigwin-label">
                {finished.multiplier > 1 ? `x${finished.multiplier} · ` : ''}
                {finished.totalWin >= finished.bet * 20 ? '¡REVENTASTE LA MÁQUINA!' : 'Ganaste'}
              </span>
              <span className="sl__bigwin-amt tnum">{money(finished.totalWin)}</span>
            </div>
          )}

          {finished && finished.freeSpinsAwarded > 0 && (
            <div className="sl__bonuswin anim-pop">
              🍭 {finished.freeSpinsAwarded} giros gratis
            </div>
          )}
        </div>
      </div>

      <aside className="sl__panel">
        <div className="sl__brand">
          <span className="sl__brandname">Dulce Bonanza</span>
          <span className="hint">8 o más iguales pagan, caigan donde caigan</span>
        </div>

        {v.inBonus && (
          <div className="sl__free anim-pop">
            <b>{v.freeSpinsLeft}</b> giros gratis
            {v.bonusWin > 0 && <span className="tnum"> · {money(v.bonusWin)}</span>}
          </div>
        )}

        <div className="sl__win tnum">
          {idx >= 0 && runningWin > 0 ? (
            <>
              <span className="label">Premio</span>
              <b>{money(runningWin * (finished ? finished.multiplier : 1))}</b>
            </>
          ) : (
            <>
              <span className="label">Último premio</span>
              <b className={v.lastWin > 0 ? '' : 'sl__win--none'}>{v.lastWin > 0 ? money(v.lastWin) : '—'}</b>
            </>
          )}
        </div>

        <div className="sl__bets">
          <span className="label">Apuesta</span>
          <div className="sl__betrow">
            {BETS.map((b) => (
              <button
                key={b}
                className={`sl__bet ${v.bet === b ? 'sl__bet--on' : ''}`}
                disabled={busy || b > balance}
                onClick={() => {
                  sfx.tap();
                  api.send('sl:bet', { amount: b });
                }}
              >
                {b}
              </button>
            ))}
          </div>
        </div>

        <button
          className="sl__spin"
          disabled={!canSpin}
          onClick={() => {
            sfx.reel();
            api.send('sl:spin');
          }}
          aria-label="Girar"
        >
          <span className={busy ? 'sl__spinicon sl__spinicon--on' : 'sl__spinicon'}>↻</span>
          <span>{v.freeSpinsLeft > 0 ? 'GRATIS' : money(v.bet)}</span>
        </button>
      </aside>
    </div>
  );
}
