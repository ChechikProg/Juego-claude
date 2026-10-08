import { useState } from 'react';
import { GAMES } from '@shared/constants';
import { useStore } from '@/state/store';
import { isMuted, sfx, toggleMute } from '@/lib/sfx';
import { Logo, Modal, RoomCode } from './ui';
import { PlayerList } from './PlayerList';

export function TopBar(): JSX.Element {
  const room = useStore((s) => s.room);
  const connected = useStore((s) => s.connected);
  const leave = useStore((s) => s.leave);
  const [muted, setMuted] = useState(isMuted());
  const [board, setBoard] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);

  const phase = room?.phase;
  const current =
    phase && 'gameId' in phase ? GAMES[phase.gameId] : null;

  return (
    <header className="topbar">
      <div className="topbar__inner">
        <Logo size="sm" />

        {room && <RoomCode code={room.code} />}

        <div className="topbar__spacer" />

        {room && current && 'index' in phase! && (
          <span className="chip chip--accent nowrap">
            <span aria-hidden>{current.icon}</span>
            {phase.index + 1}/{phase.total}
          </span>
        )}

        {!connected && <span className="chip chip--bad nowrap">sin conexión</span>}

        {room && (
          <button
            className="btn btn--sm btn--ghost"
            onClick={() => {
              sfx.tap();
              setBoard(true);
            }}
            title="Ver la tabla de puntos"
          >
            🏆 <span className="tnum">{room.players.length}</span>
          </button>
        )}

        <button
          className="btn btn--icon btn--ghost"
          onClick={() => {
            const m = toggleMute();
            setMuted(m);
            if (!m) sfx.pick();
          }}
          title={muted ? 'Activar sonido' : 'Silenciar'}
          aria-label={muted ? 'Activar sonido' : 'Silenciar'}
        >
          {muted ? '🔇' : '🔊'}
        </button>

        {room && (
          <button
            className="btn btn--icon btn--ghost"
            onClick={() => setConfirmLeave(true)}
            title="Salir de la sala"
            aria-label="Salir de la sala"
          >
            🚪
          </button>
        )}
      </div>

      <Modal open={board} onClose={() => setBoard(false)} labelledBy="tabla-title">
        <h2 id="tabla-title" style={{ fontSize: 22, marginBottom: 4 }}>
          Tabla de la partida
        </h2>
        <p className="hint" style={{ marginBottom: 16 }}>
          Cada minijuego reparte 10, 5 y 3 puntos.
        </p>
        <PlayerList players={room?.players ?? []} showScore />
      </Modal>

      <Modal open={confirmLeave} onClose={() => setConfirmLeave(false)}>
        <h2 style={{ fontSize: 21, marginBottom: 8 }}>¿Te vas de la sala?</h2>
        <p className="hint" style={{ marginBottom: 18 }}>
          Perdés los puntos de esta partida. Siempre podés volver a entrar con el código.
        </p>
        <div className="row">
          <button className="btn btn--ghost grow" onClick={() => setConfirmLeave(false)}>
            Me quedo
          </button>
          <button
            className="btn btn--red grow"
            onClick={() => {
              setConfirmLeave(false);
              leave();
            }}
          >
            Salir
          </button>
        </div>
      </Modal>
    </header>
  );
}
