import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BRUSH_SIZES, PALETTE } from '@shared/constants';
import type { Stroke } from '@shared/types';
import { ProgressivePainter, drawStroke, paintStrokes, setupCanvas, strokesSignature, totalPoints } from '@/lib/draw';
import { useRaf, useSize } from '@/lib/hooks';
import { sfx } from '@/lib/sfx';

const ASPECT = 4 / 3;
/** distancia mínima entre puntos, en píxeles de pantalla */
const MIN_STEP = 2.2;
/** tiene que coincidir con MAX_FILLS de server/games/vangogh.ts */
const MAX_FILLS = 60;

type Tool = 'brush' | 'eraser' | 'fill';

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
  /** capa con todos los trazos confirmados: así el balde no se recalcula en cada movimiento */
  const baseRef = useRef<{ canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null>(null);

  const strokes = useRef<Stroke[]>([]);
  const live = useRef<Stroke | null>(null);
  const lastPt = useRef<{ x: number; y: number } | null>(null);

  const [color, setColor] = useState(PALETTE[1]);
  const [sizeIdx, setSizeIdx] = useState(1);
  const [tool, setTool] = useState<Tool>('brush');
  const [count, setCount] = useState(0);
  const [fills, setFills] = useState(0);

  const box = fitBox(size.w, size.h);

  /** Pega la capa base y, encima, el trazo que se está dibujando. */
  const present = useCallback(() => {
    const ctx = ctxRef.current;
    const base = baseRef.current;
    if (!ctx || !base) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.drawImage(base.canvas, 0, 0);
    ctx.restore();
    if (live.current) {
      drawStroke(ctx, live.current, box.w, box.h);
      ctx.globalCompositeOperation = 'source-over';
    }
  }, [box.w, box.h]);

  /** Re-dibuja la capa base desde cero (al deshacer, limpiar o cambiar de tamaño). */
  const rebuild = useCallback(() => {
    const base = baseRef.current;
    if (!base) return;
    paintStrokes(base.ctx, strokes.current, box.w, box.h);
    present();
  }, [box.w, box.h, present]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || box.w === 0) return;
    ctxRef.current = setupCanvas(canvas, box.w, box.h);
    const off = document.createElement('canvas');
    const offCtx = setupCanvas(off, box.w, box.h);
    baseRef.current = offCtx ? { canvas: off, ctx: offCtx } : null;
    rebuild();
  }, [box.w, box.h, rebuild]);

  const toLocal = (e: React.PointerEvent): { x: number; y: number } => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };

  /** Suma un trazo terminado: lo dibuja sólo en la capa base, sin repintar todo. */
  const commit = (s: Stroke) => {
    strokes.current.push(s);
    setCount(strokes.current.length);
    if (s.f) setFills((n) => n + 1);
    const base = baseRef.current;
    if (base) {
      drawStroke(base.ctx, s, box.w, box.h);
      base.ctx.globalCompositeOperation = 'source-over';
    }
    onStroke(s);
    present();
  };

  const start = (e: React.PointerEvent) => {
    if (disabled || e.button > 0) return;
    const { x, y } = toLocal(e);

    if (tool === 'fill') {
      if (fills >= MAX_FILLS) {
        sfx.bad();
        return;
      }
      sfx.pick();
      commit({ c: color, w: 0, f: 1, p: [round(x), round(y)] });
      return;
    }

    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const eraser = tool === 'eraser';
    live.current = {
      c: eraser ? '#000000' : color,
      w: BRUSH_SIZES[sizeIdx] * (eraser ? 1.7 : 1),
      p: [round(x), round(y)],
      ...(eraser ? { e: 1 as const } : {}),
    };
    lastPt.current = { x: x * box.w, y: y * box.h };
    sfx.wake();
    present();
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
    else present();
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
    commit(s);
  };

  const undo = () => {
    if (strokes.current.length === 0) return;
    sfx.back();
    const removed = strokes.current.pop();
    if (removed?.f) setFills((n) => n - 1);
    setCount(strokes.current.length);
    onUndo();
    rebuild();
  };

  const clear = () => {
    if (strokes.current.length === 0) return;
    sfx.back();
    strokes.current = [];
    setCount(0);
    setFills(0);
    onClear();
    rebuild();
  };

  // Ctrl+Z deshace; B, E y P cambian de herramienta.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo();
        return;
      }
      if (disabled || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'p') setTool('brush');
      else if (k === 'e') setTool('eraser');
      else if (k === 'b' || k === 'g') setTool('fill');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const pickTool = (t: Tool) => {
    sfx.tap();
    setTool((cur) => (cur === t && t !== 'brush' ? 'brush' : t));
  };

  const cursor = disabled ? 'not-allowed' : tool === 'fill' ? 'cell' : 'crosshair';

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
            style={{ cursor, touchAction: 'none' }}
          />
          {disabled && <div className="paper__lock">Entregado ✓</div>}
        </div>
      </div>

      <div className="tools">
        <div className="tools__colors">
          {PALETTE.map((c) => (
            <button
              key={c}
              className={`swatch ${c === color && tool !== 'eraser' ? 'swatch--on' : ''}`}
              style={{ background: c }}
              onClick={() => {
                sfx.tap();
                setColor(c);
                if (tool === 'eraser') setTool('brush');
              }}
              aria-label={`Color ${c}`}
              aria-pressed={c === color && tool !== 'eraser'}
              disabled={disabled}
            />
          ))}
        </div>

        <div className="tools__row">
          <div className="tools__sizes">
            {BRUSH_SIZES.map((s, i) => (
              <button
                key={s}
                className={`sizebtn ${i === sizeIdx && tool !== 'fill' ? 'sizebtn--on' : ''}`}
                onClick={() => {
                  sfx.tap();
                  setSizeIdx(i);
                  if (tool === 'fill') setTool('brush');
                }}
                aria-label={`Grosor ${i + 1}`}
                aria-pressed={i === sizeIdx}
                disabled={disabled}
              >
                <span style={{ width: 4 + i * 5, height: 4 + i * 5 }} />
              </button>
            ))}
          </div>

          <div className="tools__group" role="group" aria-label="Herramienta">
            <button
              className={`btn btn--sm ${tool === 'brush' ? 'btn--accent' : 'btn--ghost'}`}
              onClick={() => pickTool('brush')}
              aria-pressed={tool === 'brush'}
              disabled={disabled}
              title="Pincel (P)"
            >
              🖌️ Pincel
            </button>
            <button
              className={`btn btn--sm ${tool === 'fill' ? 'btn--accent' : 'btn--ghost'}`}
              onClick={() => pickTool('fill')}
              aria-pressed={tool === 'fill'}
              disabled={disabled || fills >= MAX_FILLS}
              title="Balde (B)"
            >
              <span className="tools__bucket" style={{ ['--c' as string]: color }}>🪣</span> Balde
            </button>
            <button
              className={`btn btn--sm ${tool === 'eraser' ? 'btn--accent' : 'btn--ghost'}`}
              onClick={() => pickTool('eraser')}
              aria-pressed={tool === 'eraser'}
              disabled={disabled}
              title="Goma (E)"
            >
              🩹 Goma
            </button>
          </div>

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
  /** espera antes de arrancar el reveal, en ms */
  delay?: number;
  className?: string;
}

export function DrawingView({ strokes, animate, duration = 1500, delay = 0, className = '' }: ViewProps): JSX.Element {
  const [wrapRef, size] = useSize<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const box = fitBox(size.w, size.h);

  // Cada push del servidor trae un array nuevo con los mismos trazos: usamos una
  // firma del contenido para no reiniciar la animación ni repintar de más.
  const signature = useMemo(() => strokesSignature(strokes), [strokes]);
  const strokesRef = useRef(strokes);
  strokesRef.current = strokes;

  const anim = useRef<{ painter: ProgressivePainter | null; startedAt: number; done: boolean }>({
    painter: null,
    startedAt: 0,
    done: !animate,
  });
  const startedFor = useRef<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || box.w === 0) return;
    const ctx = setupCanvas(canvas, box.w, box.h);
    ctxRef.current = ctx;
    if (!ctx) return;

    const fresh = startedFor.current !== signature;
    startedFor.current = signature;
    if (animate && fresh) {
      anim.current = {
        painter: new ProgressivePainter(ctx, strokesRef.current, box.w, box.h),
        startedAt: performance.now() + delay,
        done: false,
      };
    } else {
      // Cambió el tamaño o ya se animó: pintamos todo de una.
      anim.current = { painter: null, startedAt: 0, done: true };
      paintStrokes(ctx, strokesRef.current, box.w, box.h);
    }
  }, [box.w, box.h, signature, animate, delay]);

  useRaf(() => {
    const a = anim.current;
    const ctx = ctxRef.current;
    if (a.done || !a.painter || !ctx) return;
    const t = (performance.now() - a.startedAt) / duration;
    if (t < 0) return;
    if (t >= 1) {
      a.done = true;
      paintStrokes(ctx, strokesRef.current, box.w, box.h);
      return;
    }
    a.painter.advance(Math.ceil(totalPoints(strokesRef.current) * easeOut(t)));
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
