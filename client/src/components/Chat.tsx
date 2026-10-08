import { useEffect, useRef, useState } from 'react';
import { api } from '@/net/socket';
import { useStore } from '@/state/store';

export function Chat(): JSX.Element {
  const messages = useStore((s) => s.chat);
  const [text, setText] = useState('');
  const logRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  // Sólo autoscrolleamos si el usuario ya estaba abajo de todo.
  useEffect(() => {
    const el = logRef.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const onScroll = () => {
    const el = logRef.current;
    if (el) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = text.trim();
    if (!clean) return;
    api.chat(clean);
    setText('');
    pinned.current = true;
  };

  return (
    <div className="chat">
      <div className="chat__log" ref={logRef} onScroll={onScroll}>
        {messages.length === 0 && <p className="hint">Acá van los mensajes de la sala.</p>}
        {messages.map((m) =>
          m.system ? (
            <p key={m.id} className="chat__msg chat__msg--sys">
              {m.text}
            </p>
          ) : (
            <p key={m.id} className="chat__msg">
              <span className="chat__who">{m.name}</span>
              {m.text}
            </p>
          ),
        )}
      </div>
      <form className="chat__form" onSubmit={submit}>
        <input
          className="input grow"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Escribí algo…"
          maxLength={140}
          aria-label="Mensaje"
        />
        <button className="btn btn--sm btn--primary" disabled={!text.trim()}>
          ↵
        </button>
      </form>
    </div>
  );
}
