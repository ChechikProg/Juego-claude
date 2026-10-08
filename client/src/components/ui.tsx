import { useEffect, type CSSProperties, type ReactNode } from 'react';
import type { Avatar as AvatarT } from '@shared/types';
import { formatClock } from '@/lib/hooks';
import { useStore } from '@/state/store';

/* ── Fondo ────────────────────────────────────────────────────────────────── */

export function Aurora(): JSX.Element {
  return (
    <div className="aurora" aria-hidden>
      <div className="blob blob-1" />
      <div className="blob blob-2" />
      <div className="blob blob-3" />
    </div>
  );
}

/* ── Logo ─────────────────────────────────────────────────────────────────── */

export function Logo({ size = 'md' }: { size?: 'sm' | 'md' | 'xl' }): JSX.Element {
  return (
    <span className={`logo logo--${size}`}>
      PARTIDAZO<span className="logo__dot" />
    </span>
  );
}

/* ── Avatar ───────────────────────────────────────────────────────────────── */

interface AvatarProps {
  avatar: AvatarT;
  size?: number;
  crown?: boolean;
  offline?: boolean;
  className?: string;
  style?: CSSProperties;
}

export function Avatar({ avatar, size = 40, crown, offline, className = '', style }: AvatarProps): JSX.Element {
  return (
    <div
      className={`avatar ${offline ? 'avatar--off' : ''} ${className}`}
      style={{ ...style, '--size': `${size}px`, '--hue': avatar.hue } as CSSProperties}
    >
      <span>{avatar.face}</span>
      {crown && <span className="avatar__crown">👑</span>}
    </div>
  );
}

/* ── Insignia de puesto ───────────────────────────────────────────────────── */

export function RankBadge({ rank }: { rank: number }): JSX.Element {
  return <div className={`rank-badge rank-badge--${rank <= 3 ? rank : 'n'}`}>{rank}</div>;
}

/* ── Temporizadores ───────────────────────────────────────────────────────── */

export function Timer({ ms, urgentAt = 10_000 }: { ms: number; urgentAt?: number }): JSX.Element {
  const urgent = ms <= urgentAt;
  return (
    <span className={`timer ${urgent ? 'timer--urgent' : ''}`}>
      <span aria-hidden>⏱</span>
      {formatClock(ms)}
    </span>
  );
}

export function TimerBar({ ms, total }: { ms: number; total: number }): JSX.Element {
  const pct = total > 0 ? Math.max(0, Math.min(100, (ms / total) * 100)) : 0;
  const urgent = ms <= 10_000;
  return (
    <div className="timerbar">
      <div
        className={`timerbar__fill ${urgent ? 'timerbar__fill--urgent' : ''}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/* ── Toasts ───────────────────────────────────────────────────────────────── */

export function Toasts(): JSX.Element {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast--${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

/* ── Modal ────────────────────────────────────────────────────────────────── */

interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  labelledBy?: string;
}

export function Modal({ open, onClose, children, labelledBy }: ModalProps): JSX.Element | null {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="modal-bg" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card modal" role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
        {children}
      </div>
    </div>
  );
}

/* ── Varios ───────────────────────────────────────────────────────────────── */

export function Spinner(): JSX.Element {
  return <div className="spinner" aria-label="Cargando" />;
}

export function Chip({
  children,
  tone,
  className = '',
}: {
  children: ReactNode;
  tone?: 'accent' | 'good' | 'bad' | 'gold';
  className?: string;
}): JSX.Element {
  return <span className={`chip ${tone ? `chip--${tone}` : ''} ${className}`}>{children}</span>;
}

/** Código de sala con botón para copiar el link de invitación. */
export function RoomCode({ code }: { code: string }): JSX.Element {
  const toast = useStore((s) => s.toast);

  const copy = async () => {
    const url = `${location.origin}/?sala=${code}`;
    try {
      await navigator.clipboard.writeText(url);
      toast('Link copiado. Pasalo por el grupo.', 'good');
    } catch {
      toast(`Código: ${code}`, 'info');
    }
  };

  return (
    <div className="code-pill">
      <span className="code-pill__code">{code}</span>
      <button className="btn btn--xs btn--ghost" onClick={copy} title="Copiar invitación">
        copiar
      </button>
    </div>
  );
}
