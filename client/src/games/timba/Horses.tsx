import { useEffect, useRef, useState } from 'react';
import { HORSES, HORSE_BETS, HORSE_PAYOUT, money } from '@shared/constants';
import type { HorseTrack, HorsesView } from '@shared/types';
import { api, serverNow } from '@/net/socket';
import { useRaf } from '@/lib/hooks';
import { sfx } from '@/lib/sfx';

/** Posición 0..1 de un caballo a `ms` de la largada. */
function progressAt(track: HorseTrack, ms: number): number {
  if (ms <= 0) return 0;
  const { t, p } = track;
  const last = t.length - 1;
  if (ms >= t[last]) return 1;
  let i = 1;
  while (i < last && t[i] < ms) i++;
  const k = (ms - t[i - 1]) / Math.max(1, t[i] - t[i - 1]);
  return p[i - 1] + (p[i] - p[i - 1]) * k;
}

export function Horses({ v, balance }: { v: HorsesView; balance: number }): JSX.Element {
  const race = v.race;
  const racing = v.phase === 'racing';
  const horseRefs = useRef<(HTMLDivElement | null)[]>([]);
  const rankRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const lastGallop = useRef(0);
  const [gate, setGate] = useState(0);
  const [showResult, setShowResult] = useState(v.phase === 'result');

  // Cuenta regresiva de las gateras + campana de largada.
  useEffect(() => {
    if (!race || v.phase !== 'racing') return;
    const tick = () => {
      const left = race.startAt - serverNow();
      setGate(left > 0 ? Math.ceil(left / 500) : 0);
    };
    tick();
    const id = setInterval(tick, 80);
    const bell = setTimeout(() => sfx.bell(), Math.max(0, race.startAt - serverNow() - 400));
    return () => {
      clearInterval(id);
      clearTimeout(bell);
    };
  }, [race?.startAt, v.phase]);

  // El cartel aparece cuando el ganador cruza la meta.
  useEffect(() => {
    if (!race) {
      setShowResult(false);
      return;
    }
    const wait = Math.max(0, race.finishAt - serverNow());
    const id = setTimeout(() => {
      setShowResult(true);
      if (race.winner === v.horse) sfx.jackpot();
      else sfx.bad();
    }, wait);
    return () => clearTimeout(id);
  }, [race?.startAt]);

  useRaf(() => {
    const now = serverNow();
    const ms = race ? now - race.startAt : 0;
    const prog = HORSES.map((_, i) => (race ? progressAt(race.tracks[i], ms) : 0));
    const order = prog.map((p, i) => ({ p, i })).sort((a, b) => b.p - a.p);
    const running = !!race && ms > 0 && prog.some((p) => p < 1);

    prog.forEach((p, i) => {
      const el = horseRefs.current[i];
      if (!el) return;
      el.style.left = `calc(${(p * 100).toFixed(2)}% - ${(p * 64).toFixed(1)}px)`;
      el.classList.toggle('hr__horse--run', running && p < 1);
      const badge = rankRefs.current[i];
      if (badge) {
        const place = order.findIndex((o) => o.i === i) + 1;
        badge.textContent = race && ms > 0 ? `${place}º` : '';
      }
    });

    if (running && now - lastGallop.current > 110) {
      lastGallop.current = now;
      sfx.gallop();
    }
  });

  const pick = (i: number) => {
    if (racing) return;
    sfx.pick();
    api.send('hr:pick', { horse: i });
  };

  const canRun = !racing && v.horse !== null && balance >= v.bet;
  const winner = race && showResult ? race.winner : null;
  const won = winner !== null && winner === v.horse;

  return (
    <div className="hr">
      <header className="hr__head">
        <div>
          <span className="hr__brand">Hipódromo</span>
          <span className="hint">Elegí un caballo. Si gana, cobrás x{HORSE_PAYOUT}.</span>
        </div>
        <div className="hr__history" aria-label="Últimos ganadores">
          {v.history.length === 0 && <span className="hint">Sin carreras todavía</span>}
          {v.history.map((h, i) => (
            <span key={i} className="hr__histdot" style={{ background: HORSES[h].color }} title={HORSES[h].name}>
              {h + 1}
            </span>
          ))}
        </div>
      </header>

      <div className="hr__track">
        <div className="hr__finish" aria-hidden />
        {HORSES.map((h, i) => (
          <div
            key={i}
            className={`hr__lane ${v.horse === i ? 'hr__lane--mine' : ''} ${winner === i ? 'hr__lane--win' : ''}`}
            onClick={() => pick(i)}
          >
            <span className="hr__lanenum" style={{ background: h.color }}>{i + 1}</span>
            <div className="hr__run">
              <div
                className="hr__horse"
                ref={(el) => {
                  horseRefs.current[i] = el;
                }}
              >
                <span className="hr__silk" style={{ background: h.color, borderColor: h.silk }}>
                  {i + 1}
                </span>
                <span className="hr__emoji" aria-hidden>🐎</span>
                <span
                  className="hr__rank tnum"
                  ref={(el) => {
                    rankRefs.current[i] = el;
                  }}
                />
              </div>
            </div>
          </div>
        ))}

        {racing && gate > 0 && (
          <div className="hr__gate anim-pop" key={gate}>
            {gate > 3 ? 'En las gateras…' : gate}
          </div>
        )}

        {winner !== null && (
          <div className={`hr__result anim-pop ${won ? 'hr__result--win' : ''}`}>
            <span className="hr__resultlabel">{won ? '¡Ganó tu caballo!' : 'Ganó'}</span>
            <span className="hr__resultname">
              <i style={{ background: HORSES[winner].color }}>{winner + 1}</i> {HORSES[winner].name}
            </span>
            {v.lastNet !== null && (
              <span className={`hr__resultnet tnum ${won ? 'tb__up' : 'tb__down'}`}>
                {won ? `+${money(v.lastNet)}` : money(v.lastNet)}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="hr__picker">
        {HORSES.map((h, i) => (
          <button
            key={i}
            className={`hr__card ${v.horse === i ? 'hr__card--on' : ''}`}
            style={{ ['--horse' as string]: h.color }}
            disabled={racing}
            onClick={() => pick(i)}
          >
            <span className="hr__cardnum" style={{ background: h.color, borderColor: h.silk }}>{i + 1}</span>
            <span className="hr__cardname">{h.name}</span>
          </button>
        ))}
      </div>

      <footer className="hr__foot">
        <div className="hr__bets">
          <span className="label">Apuesta</span>
          <div className="hr__betrow">
            {HORSE_BETS.map((b) => (
              <button
                key={b}
                className={`sl__bet ${v.bet === b ? 'hr__bet--on' : ''}`}
                disabled={racing || b > balance}
                onClick={() => {
                  sfx.tap();
                  api.send('hr:bet', { amount: b });
                }}
              >
                {b}
              </button>
            ))}
          </div>
        </div>
        <div className="hr__go">
          <span className="hint tnum">
            {v.horse === null ? 'Elegí un caballo' : `Cobrás ${money(v.bet * HORSE_PAYOUT)} si gana ${HORSES[v.horse].name}`}
          </span>
          <button
            className="btn btn--gold btn--lg"
            disabled={!canRun}
            onClick={() => {
              sfx.pick();
              api.send('hr:run');
            }}
          >
            {racing ? 'Corriendo…' : `¡Largar! · ${money(v.bet)}`}
          </button>
        </div>
      </footer>
    </div>
  );
}
