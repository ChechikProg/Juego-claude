import { useState } from 'react';
import { GAMES, GAME_ORDER } from '@shared/constants';
import type { GameId } from '@shared/types';
import { api } from '@/net/socket';
import { sfx } from '@/lib/sfx';
import { useIsHost, useStore } from '@/state/store';
import { Chat } from '@/components/Chat';
import { PlayerList } from '@/components/PlayerList';
import { Avatar } from '@/components/ui';

export function Lobby(): JSX.Element {
  const room = useStore((s) => s.room)!;
  const toast = useStore((s) => s.toast);
  const isHost = useIsHost();
  const [open, setOpen] = useState<GameId | null>(null);

  const { playlist } = room.config;
  const canStart = playlist.length > 0;

  const toggle = (id: GameId) => {
    if (!isHost) return;
    sfx.tap();
    const next = playlist.includes(id) ? playlist.filter((g) => g !== id) : [...playlist, id];
    api.config({ playlist: next });
  };

  const share = async () => {
    const url = `${location.origin}/?sala=${room.code}`;
    const data = { title: 'Partidazo', text: `Entrá a mi sala: ${room.code}`, url };
    try {
      if (navigator.share) await navigator.share(data);
      else {
        await navigator.clipboard.writeText(url);
        toast('Link copiado al portapapeles.', 'good');
      }
    } catch {
      /* el usuario canceló el diálogo de compartir */
    }
  };

  return (
    <div className="lobby">
      <section className="lobby__invite card anim-rise">
        <div className="lobby__invite-text">
          <span className="label">Código de la sala</span>
          <div className="lobby__code">{room.code}</div>
          <p className="hint">Que los demás entren con este código desde la pantalla de inicio.</p>
        </div>
        <div className="lobby__invite-side">
          <div className="lobby__faces">
            {room.players.slice(0, 8).map((p) => (
              <Avatar key={p.id} avatar={p.avatar} size={34} offline={!p.connected} />
            ))}
            {room.players.length > 8 && <span className="chip">+{room.players.length - 8}</span>}
          </div>
          <button className="btn btn--accent" onClick={share}>
            Invitar
          </button>
        </div>
      </section>

      <div className="lobby__grid">
        <section className="card anim-rise" style={{ animationDelay: '60ms' }}>
          <h2 className="card__title">
            Jugadores <span className="chip">{room.players.length}</span>
          </h2>
          <PlayerList players={room.players} canKick={isHost} />
        </section>

        <section className="card anim-rise" style={{ animationDelay: '100ms' }}>
          <h2 className="card__title">
            Minijuegos
            {isHost ? <span className="chip chip--accent">elegís vos</span> : <span className="chip">los elige el anfitrión</span>}
          </h2>

          <div className="picker">
            {GAME_ORDER.map((id) => {
              const g = GAMES[id];
              const on = playlist.includes(id);
              const order = playlist.indexOf(id) + 1;
              return (
                <div
                  key={id}
                  className={`pick ${on ? 'pick--on' : ''}`}
                  style={{ ['--accent-a' as string]: g.accent[0], ['--accent-b' as string]: g.accent[1] }}
                >
                  <button
                    className="pick__main"
                    onClick={() => toggle(id)}
                    disabled={!isHost}
                    aria-pressed={on}
                  >
                    <span className="pick__icon" aria-hidden>{g.icon}</span>
                    <span className="grow">
                      <span className="pick__title">{g.title}</span>
                      <span className="pick__sub">{g.subtitle}</span>
                    </span>
                    {on && <span className="pick__order">{order}</span>}
                  </button>

                  <div className="pick__foot">
                    <button
                      className="btn btn--xs btn--ghost"
                      onClick={() => {
                        sfx.tap();
                        setOpen(open === id ? null : id);
                      }}
                      aria-expanded={open === id}
                    >
                      {open === id ? 'ocultar reglas' : 'cómo se juega'}
                    </button>
                    <Settings id={id} isHost={isHost} />
                  </div>

                  {open === id && (
                    <ol className="rules anim-fade">
                      {g.howTo.map((line, i) => (
                        <li key={i}>{line}</li>
                      ))}
                    </ol>
                  )}
                </div>
              );
            })}
          </div>

          <div className="lobby__start">
            {isHost ? (
              <button
                className="btn btn--primary btn--lg btn--block btn--shine"
                disabled={!canStart}
                onClick={() => {
                  sfx.good();
                  api.start();
                }}
              >
                {canStart ? `Arrancar · ${playlist.length} minijuego${playlist.length > 1 ? 's' : ''}` : 'Elegí al menos uno'}
              </button>
            ) : (
              <div className="lobby__waiting">
                <span className="dot-pulse" aria-hidden />
                Esperando a que el anfitrión arranque…
              </div>
            )}
          </div>
        </section>

        <section className="card lobby__chat anim-rise" style={{ animationDelay: '140ms' }}>
          <h2 className="card__title">Chat</h2>
          <Chat />
        </section>
      </div>
    </div>
  );
}

/* ── Ajustes por minijuego ────────────────────────────────────────────────── */

function Settings({ id, isHost }: { id: GameId; isHost: boolean }): JSX.Element | null {
  const config = useStore((s) => s.room!.config);

  const step = (patch: Record<string, number>) => {
    sfx.tap();
    api.config(patch);
  };

  if (id === 'vangogh') {
    return (
      <Stepper
        label="rondas"
        value={config.vangoghRounds}
        min={1}
        max={6}
        disabled={!isHost}
        onChange={(v) => step({ vangoghRounds: v })}
      />
    );
  }
  if (id === 'timba') {
    return (
      <Stepper
        label="min"
        value={Math.round(config.timbaSeconds / 60)}
        min={1}
        max={15}
        disabled={!isHost}
        onChange={(v) => step({ timbaSeconds: v * 60 })}
      />
    );
  }
  if (id === 'smash') {
    return (
      <Stepper
        label="rondas"
        value={config.smashRounds}
        min={1}
        max={9}
        disabled={!isHost}
        onChange={(v) => step({ smashRounds: v })}
      />
    );
  }
  if (id === 'piramide') {
    return (
      <Stepper
        label="min"
        value={Math.round(config.piramideSeconds / 60)}
        min={1}
        max={10}
        disabled={!isHost}
        onChange={(v) => step({ piramideSeconds: v * 60 })}
      />
    );
  }
  if (id === 'frases') {
    return (
      <Stepper
        label="rondas"
        value={config.frasesRounds}
        min={1}
        max={8}
        disabled={!isHost}
        onChange={(v) => step({ frasesRounds: v })}
      />
    );
  }
  if (id === 'tanque') {
    return (
      <Stepper
        label="min"
        value={Math.round(config.tanqueSeconds / 60)}
        min={1}
        max={10}
        disabled={!isHost}
        onChange={(v) => step({ tanqueSeconds: v * 60 })}
      />
    );
  }
  if (id === 'copa') {
    return (
      <Stepper
        label="rondas"
        value={config.copaRounds}
        min={1}
        max={5}
        disabled={!isHost}
        onChange={(v) => step({ copaRounds: v })}
      />
    );
  }
  if (id === 'formula') {
    return (
      <Stepper
        label={config.formulaRaces === 1 ? 'carrera' : 'carreras'}
        value={config.formulaRaces}
        min={1}
        max={3}
        disabled={!isHost}
        onChange={(v) => step({ formulaRaces: v })}
      />
    );
  }
  if (id === 'shooter') {
    return (
      <Stepper
        label={config.shooterLives === 1 ? 'vida' : 'vidas'}
        value={config.shooterLives}
        min={1}
        max={6}
        disabled={!isHost}
        onChange={(v) => step({ shooterLives: v })}
      />
    );
  }
  return null;
}

interface StepperProps {
  label: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onChange: (v: number) => void;
}

function Stepper({ label, value, min, max, disabled, onChange }: StepperProps): JSX.Element {
  return (
    <div className="stepper">
      <button
        className="stepper__btn"
        disabled={disabled || value <= min}
        onClick={() => onChange(value - 1)}
        aria-label={`Menos ${label}`}
      >
        −
      </button>
      <span className="stepper__value tnum">
        {value} <span className="muted">{label}</span>
      </span>
      <button
        className="stepper__btn"
        disabled={disabled || value >= max}
        onClick={() => onChange(value + 1)}
        aria-label={`Más ${label}`}
      >
        +
      </button>
    </div>
  );
}
