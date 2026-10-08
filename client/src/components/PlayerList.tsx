import type { ReactNode } from 'react';
import type { PlayerPublic } from '@shared/types';
import { api } from '@/net/socket';
import { useStore } from '@/state/store';
import { Avatar } from './ui';

interface Props {
  players: PlayerPublic[];
  /** muestra el botón de echar (sólo el anfitrión) */
  canKick?: boolean;
  showScore?: boolean;
  /** valor alternativo a mostrar a la derecha */
  renderValue?: (p: PlayerPublic) => ReactNode;
  emptyLabel?: string;
}

export function PlayerList({ players, canKick, showScore, renderValue, emptyLabel }: Props): JSX.Element {
  const meId = useStore((s) => s.playerId);

  if (players.length === 0) {
    return <p className="hint">{emptyLabel ?? 'Todavía no hay nadie.'}</p>;
  }

  return (
    <ul className="plist">
      {players.map((p) => (
        <li
          key={p.id}
          className={`prow ${p.id === meId ? 'prow--me' : ''} ${p.connected ? '' : 'prow--off'}`}
        >
          <Avatar avatar={p.avatar} size={38} crown={p.isHost} offline={!p.connected} />
          <div className="grow">
            <div className="prow__name">
              {p.name}
              {p.id === meId && <span className="muted" style={{ fontWeight: 600 }}> · vos</span>}
            </div>
            <div className="prow__sub">
              {!p.connected
                ? 'desconectado'
                : p.spectator
                  ? 'mirando · entra en el próximo'
                  : p.isHost
                    ? 'anfitrión'
                    : `${p.rtt || '—'} ms`}
            </div>
          </div>
          {renderValue ? renderValue(p) : showScore ? <span className="prow__score tnum">{p.score}</span> : null}
          {canKick && p.id !== meId && (
            <button
              className="btn btn--xs btn--ghost"
              onClick={() => api.kick(p.id)}
              title={`Echar a ${p.name}`}
              aria-label={`Echar a ${p.name}`}
            >
              ✕
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
