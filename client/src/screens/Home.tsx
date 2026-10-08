import { useEffect, useMemo, useRef, useState } from 'react';
import { AVATAR_FACES, GAMES, GAME_ORDER, MAX_NAME_LENGTH, ROOM_CODE_LENGTH } from '@shared/constants';
import { sfx } from '@/lib/sfx';
import { useStore } from '@/state/store';
import { Avatar, Logo } from '@/components/ui';

const FUNNY_NAMES = [
  'Carlitos', 'Tincho', 'Bruja', 'Pepo', 'Lauti', 'Chino', 'Mecha', 'Negro',
  'Flaca', 'Rulo', 'Tano', 'Juani', 'Pali', 'Vasco', 'Pelu', 'Colo',
];

export function Home(): JSX.Element {
  const { name, avatar, setProfile, create, join, busy, joinError, clearJoinError } = useStore();
  const [code, setCode] = useState('');
  const [mode, setMode] = useState<'pick' | 'join'>('pick');
  const codeRef = useRef<HTMLInputElement>(null);

  // Permite invitar con un link directo: /?sala=ABCD
  useEffect(() => {
    const fromUrl = new URLSearchParams(location.search).get('sala');
    if (fromUrl) {
      setCode(fromUrl.toUpperCase().slice(0, ROOM_CODE_LENGTH));
      setMode('join');
      history.replaceState(null, '', location.pathname);
    }
  }, []);

  useEffect(() => {
    if (mode === 'join') codeRef.current?.focus();
  }, [mode]);

  const placeholder = useMemo(() => FUNNY_NAMES[Math.floor(Math.random() * FUNNY_NAMES.length)], []);
  const trimmed = name.trim();
  const ready = trimmed.length > 0 && !busy;

  const ensureName = (): string => {
    if (trimmed) return trimmed;
    setProfile(placeholder, avatar);
    return placeholder;
  };

  const onCreate = async () => {
    sfx.wake();
    sfx.pick();
    ensureName();
    await create();
  };

  const onJoin = async (e?: React.FormEvent) => {
    e?.preventDefault();
    sfx.wake();
    if (code.trim().length < ROOM_CODE_LENGTH) return;
    sfx.pick();
    ensureName();
    await join(code);
  };

  const shuffleAvatar = () => {
    sfx.tap();
    setProfile(name, {
      hue: Math.floor(Math.random() * 360),
      face: AVATAR_FACES[Math.floor(Math.random() * AVATAR_FACES.length)],
    });
  };

  return (
    <div className="home">
      <section className="home__hero anim-rise">
        <Logo size="xl" />
        <p className="home__tag">
          Minijuegos para la previa. Creá una sala, pasá el código
          <br className="only-wide" /> y que gane el que más puntos junte.
        </p>
      </section>

      <section className="card home__card anim-rise" style={{ animationDelay: '60ms' }}>
        <div className="home__identity">
          <button className="home__avatar" onClick={shuffleAvatar} title="Cambiar pinta">
            <Avatar avatar={avatar} size={76} />
            <span className="home__dice" aria-hidden>🎲</span>
          </button>

          <div className="grow stack-sm">
            <label className="label" htmlFor="nombre">Tu nombre</label>
            <input
              id="nombre"
              className="input"
              value={name}
              onChange={(e) => setProfile(e.target.value.slice(0, MAX_NAME_LENGTH), avatar)}
              placeholder={placeholder}
              maxLength={MAX_NAME_LENGTH}
              autoComplete="nickname"
              spellCheck={false}
            />
          </div>
        </div>

        <div className="faces" role="group" aria-label="Elegí una cara">
          {AVATAR_FACES.map((f) => (
            <button
              key={f}
              className={`faces__btn ${f === avatar.face ? 'faces__btn--on' : ''}`}
              onClick={() => {
                sfx.tap();
                setProfile(name, { ...avatar, face: f });
              }}
              aria-pressed={f === avatar.face}
              aria-label={`Cara ${f}`}
            >
              {f}
            </button>
          ))}
        </div>

        <label className="hue">
          <span className="sr-only">Color del avatar</span>
          <input
            type="range"
            min={0}
            max={359}
            value={avatar.hue}
            onChange={(e) => setProfile(name, { ...avatar, hue: Number(e.target.value) })}
          />
        </label>

        <div className="divider" />

        {mode === 'pick' ? (
          <div className="home__actions">
            <button className="btn btn--primary btn--lg btn--block btn--shine" onClick={onCreate} disabled={busy}>
              Crear una sala
            </button>
            <button
              className="btn btn--ghost btn--block"
              onClick={() => {
                sfx.tap();
                clearJoinError();
                setMode('join');
              }}
            >
              Tengo un código
            </button>
          </div>
        ) : (
          <form className="home__actions" onSubmit={onJoin}>
            <input
              ref={codeRef}
              className="input input--code"
              value={code}
              onChange={(e) => {
                clearJoinError();
                setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, ROOM_CODE_LENGTH));
              }}
              placeholder="CÓDIGO"
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              aria-label="Código de sala"
            />
            <button
              className="btn btn--primary btn--lg btn--block"
              disabled={code.length < ROOM_CODE_LENGTH || busy}
            >
              Entrar
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--block"
              onClick={() => {
                sfx.back();
                clearJoinError();
                setMode('pick');
              }}
            >
              Volver
            </button>
          </form>
        )}

        {joinError && <p className="home__error">{joinError}</p>}
        {!ready && !busy && <p className="hint" style={{ textAlign: 'center' }}>Si no ponés nombre te bautizamos nosotros.</p>}
      </section>

      <section className="home__games anim-rise" style={{ animationDelay: '120ms' }}>
        {GAME_ORDER.map((id) => {
          const g = GAMES[id];
          return (
            <article
              key={id}
              className="gamecard"
              style={{ ['--accent-a' as string]: g.accent[0], ['--accent-b' as string]: g.accent[1] }}
            >
              <div className="gamecard__icon" aria-hidden>{g.icon}</div>
              <h3 className="gamecard__title">{g.title}</h3>
              <p className="gamecard__sub">{g.subtitle}</p>
            </article>
          );
        })}
      </section>

      <footer className="home__foot">
        <span>Hecho para jugar entre amigos · 2 a 12 jugadores</span>
      </footer>
    </div>
  );
}
