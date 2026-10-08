import type { Stroke } from '@shared/types';

/**
 * El lienzo es transparente y el "papel" vive en el CSS del contenedor:
 * así la goma puede usar `destination-out` y revelar el fondo de verdad.
 */
export function drawStroke(
  ctx: CanvasRenderingContext2D,
  s: Stroke,
  w: number,
  h: number,
  upTo = Infinity,
): void {
  const p = s.p;
  const pts = Math.min(p.length / 2, upTo);
  if (pts < 1) return;

  ctx.globalCompositeOperation = s.e ? 'destination-out' : 'source-over';
  ctx.strokeStyle = s.c;
  ctx.fillStyle = s.c;
  ctx.lineWidth = Math.max(1, s.w * w);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (pts === 1) {
    ctx.beginPath();
    ctx.arc(p[0] * w, p[1] * h, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  const last = (pts - 1) * 2;
  ctx.beginPath();
  ctx.moveTo(p[0] * w, p[1] * h);
  for (let i = 2; i < last - 1; i += 2) {
    const x = p[i] * w;
    const y = p[i + 1] * h;
    const nx = p[i + 2] * w;
    const ny = p[i + 3] * h;
    // Curvas suaves pasando por los puntos medios: sin esquinas feas.
    ctx.quadraticCurveTo(x, y, (x + nx) / 2, (y + ny) / 2);
  }
  ctx.lineTo(p[last] * w, p[last + 1] * h);
  ctx.stroke();
}

export function paintStrokes(
  ctx: CanvasRenderingContext2D,
  strokes: Stroke[],
  w: number,
  h: number,
): void {
  ctx.clearRect(0, 0, w, h);
  for (const s of strokes) drawStroke(ctx, s, w, h);
  ctx.globalCompositeOperation = 'source-over';
}

/** Dibuja sólo los primeros `budget` puntos, para el efecto de "se va dibujando". */
export function paintProgressive(
  ctx: CanvasRenderingContext2D,
  strokes: Stroke[],
  w: number,
  h: number,
  budget: number,
): void {
  ctx.clearRect(0, 0, w, h);
  let left = budget;
  for (const s of strokes) {
    if (left <= 0) break;
    const count = s.p.length / 2;
    drawStroke(ctx, s, w, h, Math.min(count, left));
    left -= count;
  }
  ctx.globalCompositeOperation = 'source-over';
}

export function totalPoints(strokes: Stroke[]): number {
  let n = 0;
  for (const s of strokes) n += s.p.length / 2;
  return n;
}

/** Prepara el canvas para la densidad de pantalla y devuelve el contexto. */
export function setupCanvas(
  canvas: HTMLCanvasElement,
  w: number,
  h: number,
): CanvasRenderingContext2D | null {
  const dpr = Math.min(2.5, window.devicePixelRatio || 1);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}
