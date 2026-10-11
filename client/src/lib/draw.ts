import type { Stroke } from '@shared/types';

/** Lo que "pesa" un relleno en la animación de reveal, medido en puntos de trazo. */
const FILL_COST = 14;
/** Tolerancia de color del balde, por canal (0..255). */
const FILL_TOLERANCE = 64;
/** Sobre fondo transparente, un píxel con más alfa que esto ya es borde. */
const FILL_ALPHA_EDGE = 44;

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
  if (s.f) {
    if (upTo >= 1) floodFill(ctx, s.p[0], s.p[1], s.c);
    return;
  }

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

export function strokeCost(s: Stroke): number {
  return s.f ? FILL_COST : s.p.length / 2;
}

export function totalPoints(strokes: Stroke[]): number {
  let n = 0;
  for (const s of strokes) n += strokeCost(s);
  return n;
}

/**
 * Reveal progresivo incremental: cada cuadro sólo dibuja lo nuevo en vez de
 * repintar todo desde cero (con rellenos, repintar todo por cuadro es caro).
 * El trazo que está a medio camino se re-dibuja encima de sí mismo; al final
 * conviene un `paintStrokes` limpio.
 */
export class ProgressivePainter {
  private idx = 0;
  private pts = 0;

  constructor(
    private ctx: CanvasRenderingContext2D,
    private strokes: Stroke[],
    private w: number,
    private h: number,
  ) {
    ctx.clearRect(0, 0, w, h);
  }

  advance(budget: number): void {
    const { ctx, strokes, w, h } = this;
    while (this.idx < strokes.length) {
      const s = strokes[this.idx];
      const cost = strokeCost(s);
      if (this.pts + cost <= budget) {
        drawStroke(ctx, s, w, h);
        this.idx += 1;
        this.pts += cost;
        continue;
      }
      if (!s.f) drawStroke(ctx, s, w, h, budget - this.pts);
      break;
    }
    ctx.globalCompositeOperation = 'source-over';
  }
}

/** Firma barata del contenido de un dibujo: cambia sólo si cambian los trazos. */
export function strokesSignature(strokes: Stroke[]): string {
  let hash = 0;
  for (const s of strokes) {
    hash = (hash * 31 + s.p.length + (s.f ? 7 : 0) + (s.e ? 3 : 0)) | 0;
    const p = s.p;
    // Muestreamos algunas coordenadas: alcanza para distinguir dibujos.
    for (let i = 0; i < p.length; i += Math.max(1, Math.floor(p.length / 8))) {
      hash = (hash * 31 + Math.round(p[i] * 1000)) | 0;
    }
  }
  return `${strokes.length}:${hash}`;
}

/* ── balde de pintura ─────────────────────────────────────────────────────── */

function parseHex(hex: string): [number, number, number] {
  let h = hex.replace('#', '');
  if (h.length === 3 || h.length === 4) h = h.slice(0, 3).split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Relleno por inundación con tolerancia, en píxeles reales del canvas (no en
 * coordenadas lógicas): así respeta el antialiasing de los bordes. Después
 * dilata un píxel para tapar el halo semitransparente que deja el borde.
 */
export function floodFill(ctx: CanvasRenderingContext2D, nx: number, ny: number, color: string): void {
  const canvas = ctx.canvas;
  const W = canvas.width;
  const H = canvas.height;
  if (!W || !H) return;
  const sx = Math.floor(nx * W);
  const sy = Math.floor(ny * H);
  if (sx < 0 || sy < 0 || sx >= W || sy >= H) return;

  let img: ImageData;
  try {
    img = ctx.getImageData(0, 0, W, H);
  } catch {
    return;
  }
  const d = img.data;
  const start = (sy * W + sx) * 4;
  const tr = d[start];
  const tg = d[start + 1];
  const tb = d[start + 2];
  const ta = d[start + 3];
  const [fr, fg, fb] = parseHex(color);

  // Ya es de ese color: nada que hacer.
  if (ta > 250 && Math.abs(tr - fr) < 6 && Math.abs(tg - fg) < 6 && Math.abs(tb - fb) < 6) return;

  const transparent = ta < 8;
  const matches = (i: number): boolean => {
    const a = d[i + 3];
    if (transparent) return a < FILL_ALPHA_EDGE;
    return (
      Math.abs(a - ta) < FILL_TOLERANCE &&
      Math.abs(d[i] - tr) < FILL_TOLERANCE &&
      Math.abs(d[i + 1] - tg) < FILL_TOLERANCE &&
      Math.abs(d[i + 2] - tb) < FILL_TOLERANCE
    );
  };

  const filled = new Uint8Array(W * H);
  const stack: number[] = [sx, sy];
  while (stack.length) {
    const y = stack.pop()!;
    let x = stack.pop()!;
    const row = y * W;
    // Retrocedemos hasta el principio del tramo.
    while (x > 0 && !filled[row + x - 1] && matches((row + x - 1) * 4)) x--;
    let up = false;
    let down = false;
    while (x < W && !filled[row + x] && matches((row + x) * 4)) {
      filled[row + x] = 1;
      if (y > 0) {
        const m = !filled[row - W + x] && matches((row - W + x) * 4);
        if (m && !up) stack.push(x, y - 1);
        up = m;
      }
      if (y < H - 1) {
        const m = !filled[row + W + x] && matches((row + W + x) * 4);
        if (m && !down) stack.push(x, y + 1);
        down = m;
      }
      x++;
    }
  }

  // Pintamos lo inundado + un píxel de borde alrededor.
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      const k = row + x;
      let paint = filled[k] === 1;
      if (!paint) {
        paint =
          (x > 0 && filled[k - 1] === 1) ||
          (x < W - 1 && filled[k + 1] === 1) ||
          (y > 0 && filled[k - W] === 1) ||
          (y < H - 1 && filled[k + W] === 1);
        // El halo sólo pisa bordes semitransparentes, nunca un trazo sólido de otro color.
        if (paint && d[k * 4 + 3] > 235) paint = false;
      }
      if (!paint) continue;
      const i = k * 4;
      d[i] = fr;
      d[i + 1] = fg;
      d[i + 2] = fb;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
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
  const ctx = canvas.getContext('2d', { willReadFrequently: false });
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}
