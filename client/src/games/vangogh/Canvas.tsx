import { useCallback, useEffect, useRef, useState } from 'react';
import { BRUSH_SIZES, PALETTE } from '@shared/constants';
import type { Stroke } from '@shared/types';
import { paintProgressive, paintStrokes, setupCanvas, totalPoints } from '@/lib/draw';
import { useRaf, useSize } from '@/lib/hooks';
import { sfx } from '@/lib/sfx';

const ASPECT = 4 / 3;
/** distancia mínima entre puntos, en píxeles de pantalla */
const MIN_STEP = 2.2;

/* ── Lienzo editable ──────────────────────────────────────────────────────── */

interface DrawingPadProps {
  onStroke: (s: Stroke) => void;
  onUndo: () => void;
  onClear: () => void;
  disabled?: boolean;
}

export function DrawingPad({ onStroke, onUndo, onClear, disabled }: DrawingPadProps): JSX.Element {
  const [wrapRef, size] = useSize<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);

  const strokes = useRef<Stroke[]>([]);
  const live = useRef<Stroke | null>(null);
  const lastPt = useRef<{ x: number; y: number } | null>(null);

  const [color, setColor] = useState(PALETTE[1]);
  const [sizeIdx, setSizeIdx] = useState(1);
  const [eraser, setEraser] = useState(false);
  const [count, setCount] = useState(0);

  const box = fitBox(size.w, size.h);

  const repaint = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const all = live.current ? [...strokes.current, live.current] : strokes.current;
    paintStrokes(ctx, all, box.w, box.h);
  }, [box.w, box.h]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || box.w === 0) return;
    ctxRef.current = setupCanvas(canvas, box.w, box.h);
    repaint();
  }, [box.w, box.h, repaint]);

  const toLocal = (e: React.PointerEvent): { x: number; y: number } => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };

  const start = (e: React.PointerEvent) => {
    if (disabled || e.button > 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const { x, y } = toLocal(e);
    live.current = {
      c: eraser ? '#000000' : color,
      w: BRUSH_SIZES[sizeIdx] * (eraser ? 1.7 : 1),
      p: [round(x), round(y)],
      ...(eraser ? { e: 1 as const } : {}),
    };
    lastPt.current = { x: x * box.w, y: y * box.h };
    sfx.wake();
    repaint();
  };

  const move = (e: React.PointerEvent) => {
    if (!live.current) return;
    const { x, y } = toLocal(e);
    const px = x * box.w;
    const py = y * box.h;
    const prev = lastPt.current;
    if (prev && Math.hypot(px - prev.x, py - prev.y) < MIN_STEP) return;
    lastPt.current = { x: px, y: py };
    live.current.p.push(round(x), round(y));
    if (live.current.p.length > 3600) end(e);
    else repaint();
  };

  const end = (e: React.PointerEvent) => {
    const s = live.current;
    live.current = null;
    lastPt.current = null;
    if (!s) return;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* el puntero ya se soltó solo */
    }
    strokes.current.push(s);
    setCount(strokes.current.length);
    onStroke(s);
    repaint();
  };

  const undo = () => {
    if (strokes.current.length === 0) return;
    sfx.back();
    strokes.current.pop();
    setCount(strokes.current.length);
    onUndo();
    repaint();
  };

  const clear = () => {
    if (strokes.current.length === 0) return;
    sfx.back();
    strokes.current = [];
    setCount(0);
    onClear();
    repaint();
  };

  // Ctrl+Z mientras se dibuja
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="pad">
      <div className="pad__stage" ref={wrapRef}>
        <div className="paper" style={{ width: box.w, height: box.h }}>
          <canvas
            ref={canvasRef}
            className="paper__canvas"
            onPointerDown={start}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
            style={{ cursor: disabled ? 'not-allowed' : 'crosshair', touchAction: 'none' }}
          />
          {disabled && <div className="paper__lock">Entregado ✓</div>}
        </div>
      </div>

      <div className="tools">
        <div className="tools__colors">
          {PALETTE.map((c) => (
            <button
              key={c}
              className={`swatch ${c === color && !eraser ? 'swatch--on' : ''}`}
              style={{ background: c }}
              onClick={() => {
                sfx.tap();
                setColor(c);
                setEraser(false);
              }}
              aria-label={`Color ${c}`}
              aria-pressed={c === color && !eraser}
              disabled={disabled}
            />
          ))}
        </div>

        <div className="tools__row">
          <div className="tools__sizes">
            {BRUSH_SIZES.map((s, i) => (
              <button
                key={s}
                className={`sizebtn ${i === sizeIdx ? 'sizebtn--on' : ''}`}
                onClick={() => {
                  sfx.tap();
                  setSizeIdx(i);
                }}
                aria-label={`Grosor ${i + 1}`}
                aria-pressed={i === sizeIdx}
                disabled={disabled}
              >
                <span style={{ width: 4 + i * 5, height: 4 + i * 5 }} />
              </button>
            ))}
          </div>

          <button
            className={`btn btn--sm ${eraser ? 'btn--accent' : 'btn--ghost'}`}
            onClick={() => {
              sfx.tap();
              setEraser((v) => !v);
            }}
            aria-pressed={eraser}
            disabled={disabled}
          >
            🩹 Goma
          </button>
          <button className="btn btn--sm btn--ghost" onClick={undo} disabled={disabled || count === 0}>
            ↩ Deshacer
          </button>
          <button className="btn btn--sm btn--ghost" onClick={clear} disabled={disabled || count === 0}>
            🗑 Limpiar
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Lienzo de sólo lectura ───────────────────────────────────────────────── */

interface ViewProps {
  strokes: Stroke[];
  /** revela los trazos progresivamente, como si se dibujara solo */
  animate?: boolean;
  /** duración de ese reveal en ms */
  duration?: number;
  className?: string;
}

export function DrawingView({ strokes, animate, duration = 1500, className = '' }: ViewProps): JSX.Element {
  const [wrapRef, size] = useSize<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const startedAt = useRef(performance.now());
  const total = totalPoints(strokes);
  const box = fitBox(size.w, size.h);

  useEffect(() => {
    startedAt.current = performance.now();
  }, [strokes]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || box.w === 0) return;
    ctxRef.current = setupCanvas(canvas, box.w, box.h);
    if (!animate) paintStrokes(ctxRef.current!, strokes, box.w, box.h);
  }, [box.w, box.h, strokes, animate]);

  useRaf(() => {
    const ctx = ctxRef.current;
    if (!ctx || box.w === 0) return;
    const t = (performance.now() - startedAt.current) / duration;
    if (t >= 1) {
      paintStrokes(ctx, strokes, box.w, box.h);
      return;
    }
    paintProgressive(ctx, strokes, box.w, box.h, Math.ceil(total * easeOut(t)));
  }, !!animate);

  return (
    <div className={`pad__stage ${className}`} ref={wrapRef}>
      <div className="paper" style={{ width: box.w, height: box.h }}>
        <canvas ref={canvasRef} className="paper__canvas" />
        {strokes.length === 0 && <div className="paper__empty">en blanco 😐</div>}
      </div>
    </div>
  );
}

/* ── helpers ──────────────────────────────────────────────────────────────── */

function fitBox(w: number, h: number): { w: number; h: number } {
  if (!w || !h) return { w: 0, h: 0 };
  const byWidth = { w, h: w / ASPECT };
  return byWidth.h <= h ? byWidth : { w: h * ASPECT, h };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 2.2);
}
