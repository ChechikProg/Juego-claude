import { useEffect, type CSSProperties } from 'react';
import { GAMES } from '@shared/constants';
import type { GameId } from '@shared/types';
import { useStore } from '@/state/store';
import { GAME_VIEWS } from '@/games';
import { TopBar } from '@/components/TopBar';
import { Aurora, Logo, Spinner, Toasts } from '@/components/ui';
import { Home } from '@/screens/Home';
import { Lobby } from '@/screens/Lobby';
import { FinalPodium, GameIntro, GameResults } from '@/screens/Interlude';

export function App(): JSX.Element {
  const room = useStore((s) => s.room);
  const resuming = useStore((s) => s.resuming);
  const connected = useStore((s) => s.connected);

  // Mientras hay partida en curso no dejamos que se cierre la pestaña sin aviso.
  useEffect(() => {
    const inGame = room && room.phase.kind !== 'lobby';
    if (!inGame) return;
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [room]);

  if (resuming) {
    return (
      <>
        <Aurora />
        <div className="splash">
          <div className="stack" style={{ alignItems: 'center' }}>
            <Logo size="md" />
            <Spinner />
            <p className="hint">{connected ? 'Buscando tu sala…' : 'Conectando…'}</p>
          </div>
        </div>
      </>
    );
  }

  return (
    <div className="app">
      <Aurora />
      <TopBar />
      <Body />
      <Toasts />
    </div>
  );
}

function Body(): JSX.Element {
  const room = useStore((s) => s.room);

  if (!room) {
    return (
      <main className="shell">
        <Home />
      </main>
    );
  }

  const { phase } = room;

  if (phase.kind === 'lobby') {
    return (
      <main className="shell shell--wide">
        <Lobby />
      </main>
    );
  }

  if (phase.kind === 'intro') {
    return (
      <main className="shell">
        <GameIntro gameId={phase.gameId} index={phase.index} total={phase.total} endsAt={phase.endsAt} />
      </main>
    );
  }

  if (phase.kind === 'results') {
    return (
      <main className="shell">
        <GameResults
          gameId={phase.gameId}
          standings={phase.standings}
          endsAt={phase.endsAt}
          index={phase.index}
          total={phase.total}
        />
      </main>
    );
  }

  if (phase.kind === 'final') {
    return (
      <main className="shell">
        <FinalPodium standings={phase.standings} />
      </main>
    );
  }

  return <GameStage gameId={phase.gameId} />;
}

function GameStage({ gameId }: { gameId: GameId }): JSX.Element {
  const view = useStore((s) => s.view);
  const liveId = useStore((s) => s.gameId);
  const me = useStore((s) => s.room?.players.find((p) => p.id === s.playerId));
  const meta = GAMES[gameId];
  const Game = GAME_VIEWS[gameId];

  const style = {
    ['--accent-a']: meta.accent[0],
    ['--accent-b']: meta.accent[1],
    ['--accent-ink']: meta.ink,
  } as CSSProperties;

  if (!view || liveId !== gameId || !Game) {
    return (
      <main className="shell center grow" style={style}>
        <div className="stack" style={{ alignItems: 'center' }}>
          <div className="intro__icon" aria-hidden>{meta.icon}</div>
          <Spinner />
          <p className="hint">Preparando {meta.title}…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="shell shell--wide stage" style={style}>
      {me?.spectator && (
        <div className="stage__spectator">
          👀 Estás mirando. Entrás en el próximo minijuego.
        </div>
      )}
      <Game view={view as never} />
    </main>
  );
}
