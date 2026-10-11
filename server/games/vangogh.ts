import type { RankCard, Stroke, VanGoghEntry, VanGoghView } from '../../shared/types';
import { WORDS, type WordEntry } from '../../shared/words';
import { pick, shortId, shuffle } from '../util';
import type { GameContext, GameModule } from './kit';

const PROMPT_MS = 4600;
const DRAW_MS = 120_000;
/** tiempo para rankear: base + un poco por cada dibujo, con tope */
const RANK_BASE_MS = 24_000;
const RANK_PER_CARD_MS = 6_000;
const RANK_MAX_MS = 80_000;
const RESULTS_MS = 12_000;

const MAX_STROKES = 2200;
const MAX_POINTS = 70_000;
/** los rellenos son caros de dibujar para los demás: tope por dibujo */
export const MAX_FILLS = 60;
/** puntos internos de un dibujo que todos pusieron primero */
const MAX_ROUND_POINTS = 100;

interface Canvas {
  strokes: Stroke[];
  points: number;
  fills: number;
}

interface VGState {
  stage: 'prompt' | 'draw' | 'rank' | 'roundResults' | 'done';
  round: number;
  totalRounds: number;
  entry: WordEntry;
  used: Set<string>;
  endsAt: number;
  rankMs: number;
  timer: NodeJS.Timeout | null;

  /** artistas de la ronda actual (fijados al arrancar el dibujo) */
  artists: string[];
  canvases: Map<string, Canvas>;
  ready: Set<string>;

  /** id anónimo -> autor */
  cardOwner: Map<string, string>;
  /** autor -> id anónimo */
  cardOf: Map<string, string>;
  /** orden al azar en que ve los dibujos cada jugador */
  deck: Map<string, string[]>;
  /** rankeador -> ids de mejor a peor */
  orders: Map<string, string[]>;

  roundEntries: VanGoghEntry[];
  noContest: boolean;
  totals: Map<string, number>;
}

function emptyCanvas(): Canvas {
  return { strokes: [], points: 0, fills: 0 };
}

function sanitizeStroke(raw: unknown): Stroke | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const p = o.p;
  if (!Array.isArray(p) || p.length < 2 || p.length % 2 !== 0 || p.length > 4000) return null;
  const pts: number[] = [];
  for (const v of p) {
    const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
    pts.push(Math.round(Math.min(1.2, Math.max(-0.2, n)) * 1000) / 1000);
  }
  const color = typeof o.c === 'string' ? o.c.slice(0, 24) : '#ffffff';
  if (!/^#[0-9a-fA-F]{3,8}$/.test(color)) return null;

  if (o.f === 1) {
    // Balde: un solo punto, adentro del lienzo.
    const [x, y] = pts;
    if (pts.length !== 2 || x < 0 || x > 1 || y < 0 || y > 1) return null;
    return { c: color, w: 0, f: 1, p: pts };
  }

  const w = typeof o.w === 'number' && Number.isFinite(o.w) ? Math.min(0.3, Math.max(0.001, o.w)) : 0.01;
  const stroke: Stroke = { c: color, w: Math.round(w * 10000) / 10000, p: pts };
  if (o.e === 1) stroke.e = 1;
  return stroke;
}

/** Ids de los dibujos que le tocan rankear a un jugador (todos menos el suyo). */
function cardsFor(s: VGState, playerId: string): string[] {
  const own = s.cardOf.get(playerId);
  return (s.deck.get(playerId) ?? []).filter((id) => id !== own);
}

/** Jugadores que tienen algo para rankear y siguen conectados. */
function rankers(ctx: GameContext, s: VGState): string[] {
  return ctx
    .players()
    .filter((p) => p.connected && cardsFor(s, p.id).length > 0)
    .map((p) => p.id);
}

export const vanGogh: GameModule<VGState> = {
  id: 'vangogh',

  create(ctx) {
    return {
      stage: 'prompt',
      round: 0,
      totalRounds: Math.max(1, Math.min(6, ctx.config.vangoghRounds || 2)),
      entry: WORDS[0],
      used: new Set<string>(),
      endsAt: 0,
      rankMs: 0,
      timer: null,
      artists: [],
      canvases: new Map(),
      ready: new Set(),
      cardOwner: new Map(),
      cardOf: new Map(),
      deck: new Map(),
      orders: new Map(),
      roundEntries: [],
      noContest: false,
      totals: new Map(),
    };
  },

  start(ctx, s) {
    for (const p of ctx.players()) s.totals.set(p.id, 0);
    startRound(ctx, s);
  },

  event(ctx, s, playerId, type, data) {
    if (s.stage === 'draw') {
      const canvas = s.canvases.get(playerId);
      if (!canvas) return;

      if (type === 'stroke') {
        if (canvas.strokes.length >= MAX_STROKES || canvas.points >= MAX_POINTS) return;
        const stroke = sanitizeStroke(data);
        if (!stroke) return;
        if (stroke.f) {
          if (canvas.fills >= MAX_FILLS) return;
          canvas.fills += 1;
        }
        canvas.strokes.push(stroke);
        canvas.points += stroke.p.length / 2;
        return;
      }
      if (type === 'undo') {
        const removed = canvas.strokes.pop();
        if (removed) {
          canvas.points -= removed.p.length / 2;
          if (removed.f) canvas.fills -= 1;
        }
        return;
      }
      if (type === 'clear') {
        canvas.strokes = [];
        canvas.points = 0;
        canvas.fills = 0;
        return;
      }
      if (type === 'ready') {
        const want = (data as { value?: boolean })?.value !== false;
        if (want) s.ready.add(playerId);
        else s.ready.delete(playerId);
        ctx.push();

        const pending = s.artists.filter((id) => {
          const p = ctx.player(id);
          return p?.connected && !s.ready.has(id);
        });
        if (pending.length === 0) {
          ctx.toast(null, '¡Todos listos! Se corta el tiempo.', 'good');
          schedule(ctx, s, 900, () => toRanking(ctx, s));
        }
        return;
      }
    }

    if (s.stage === 'rank' && type === 'rank') {
      const mine = cardsFor(s, playerId);
      if (mine.length === 0) return;
      const raw = (data as { order?: unknown })?.order;

      // null = lo quiere seguir editando
      if (raw === null) {
        if (s.orders.delete(playerId)) ctx.push();
        return;
      }
      if (!Array.isArray(raw) || raw.length !== mine.length) return;
      const order = raw.map(String);
      const set = new Set(order);
      if (set.size !== mine.length || !mine.every((id) => set.has(id))) return;

      s.orders.set(playerId, order);
      ctx.push();
      checkAllRanked(ctx, s);
    }
  },

  leave(ctx, s, playerId) {
    s.ready.delete(playerId);
    if (s.stage === 'draw') {
      const pending = s.artists.filter((id) => ctx.player(id)?.connected && !s.ready.has(id));
      if (pending.length === 0 && s.artists.length > 0) schedule(ctx, s, 600, () => toRanking(ctx, s));
    }
    // Si el que se fue era el único que faltaba rankear, no bloqueamos la ronda.
    if (s.stage === 'rank') checkAllRanked(ctx, s);
    ctx.push();
  },

  view(ctx, s, playerId): VanGoghView | { stage: 'done' } {
    const base = { round: s.round, totalRounds: s.totalRounds, word: s.entry.word, endsAt: s.endsAt };

    if (s.stage === 'prompt') return { stage: 'prompt', ...base, hint: s.entry.hint };

    if (s.stage === 'draw') {
      return {
        stage: 'draw',
        ...base,
        readyIds: [...s.ready],
        iAmReady: s.ready.has(playerId),
        artists: s.artists.length,
      };
    }

    if (s.stage === 'rank') {
      const cards: RankCard[] = cardsFor(s, playerId).map((id) => ({
        id,
        strokes: s.canvases.get(s.cardOwner.get(id) ?? '')?.strokes ?? [],
      }));
      const all = rankers(ctx, s);
      return {
        stage: 'rank',
        ...base,
        totalMs: s.rankMs,
        cards,
        mine: s.canvases.get(playerId)?.strokes ?? null,
        myOrder: s.orders.get(playerId) ?? null,
        submittedIds: all.filter((id) => s.orders.has(id)),
        rankersTotal: all.length,
      };
    }

    if (s.stage === 'roundResults') {
      return {
        stage: 'roundResults',
        ...base,
        entries: s.roundEntries,
        totals: Object.fromEntries(s.totals),
        noContest: s.noContest,
      };
    }

    return { stage: 'done' };
  },

  dispose(ctx, s) {
    ctx.timers.cancel(s.timer);
    s.timer = null;
  },
};

/* ── máquina de estados ───────────────────────────────────────────────────── */

function schedule(ctx: GameContext, s: VGState, ms: number, fn: () => void): void {
  ctx.timers.cancel(s.timer);
  s.endsAt = ctx.now() + ms;
  s.timer = ctx.timers.after(ms, fn);
}

function startRound(ctx: GameContext, s: VGState): void {
  s.round += 1;
  s.stage = 'prompt';
  s.ready.clear();
  s.orders.clear();
  s.cardOwner.clear();
  s.cardOf.clear();
  s.deck.clear();
  s.roundEntries = [];
  s.noContest = false;

  let candidate = pick(WORDS);
  let guard = 0;
  while (s.used.has(candidate.word) && guard++ < 60) candidate = pick(WORDS);
  s.used.add(candidate.word);
  s.entry = candidate;

  s.artists = ctx.players().filter((p) => p.connected).map((p) => p.id);
  if (s.artists.length === 0) s.artists = ctx.players().map((p) => p.id);
  s.canvases = new Map(s.artists.map((id) => [id, emptyCanvas()]));

  schedule(ctx, s, PROMPT_MS, () => {
    s.stage = 'draw';
    schedule(ctx, s, DRAW_MS, () => toRanking(ctx, s));
    ctx.push();
  });
  ctx.push();
}

function toRanking(ctx: GameContext, s: VGState): void {
  if (s.stage !== 'draw') return;
  const authors = s.artists.filter((id) => s.canvases.has(id));

  // Con menos de 3 artistas nadie tiene dos dibujos para comparar: no hay ranking.
  if (authors.length < 3) {
    toResults(ctx, s, authors);
    return;
  }

  for (const id of authors) {
    const card = shortId();
    s.cardOwner.set(card, id);
    s.cardOf.set(id, card);
  }
  const ids = [...s.cardOwner.keys()];
  // Cada uno ve los dibujos en un orden propio: así la posición en pantalla no sesga.
  for (const p of ctx.players()) s.deck.set(p.id, shuffle(ids));

  s.stage = 'rank';
  s.rankMs = Math.min(RANK_MAX_MS, RANK_BASE_MS + RANK_PER_CARD_MS * (authors.length - 1));
  schedule(ctx, s, s.rankMs, () => toResults(ctx, s, authors));
  ctx.push();
}

function checkAllRanked(ctx: GameContext, s: VGState): void {
  if (s.stage !== 'rank') return;
  const all = rankers(ctx, s);
  if (all.length === 0 || !all.every((id) => s.orders.has(id))) return;
  // Ya está por cerrar: no reprogramamos.
  if (s.endsAt - ctx.now() <= 1400) return;
  const authors = [...s.cardOwner.values()];
  schedule(ctx, s, 1200, () => toResults(ctx, s, authors));
  ctx.push();
}

/**
 * Puntaje tipo Borda normalizado: en cada ranking, el primero vale 1 y el
 * último 0. El puntaje de un dibujo es el promedio entre todos los que lo
 * rankearon, llevado a 0..100.
 */
function toResults(ctx: GameContext, s: VGState, authors: string[]): void {
  if (s.stage === 'roundResults' || s.stage === 'done') return;
  s.stage = 'roundResults';
  s.noContest = authors.length < 3;

  const sum = new Map<string, number>();
  const places = new Map<string, number[]>();
  const firsts = new Map<string, number>();
  for (const order of s.orders.values()) {
    const m = order.length;
    order.forEach((card, i) => {
      const owner = s.cardOwner.get(card);
      if (!owner) return;
      sum.set(owner, (sum.get(owner) ?? 0) + (m > 1 ? (m - 1 - i) / (m - 1) : 1));
      const list = places.get(owner) ?? [];
      list.push(i + 1);
      places.set(owner, list);
      if (i === 0) firsts.set(owner, (firsts.get(owner) ?? 0) + 1);
    });
  }

  const entries: VanGoghEntry[] = authors.map((id) => {
    const canvas = s.canvases.get(id);
    const strokes = canvas?.strokes ?? [];
    const list = places.get(id) ?? [];
    let score: number;
    if (s.noContest) {
      // Sin rivales para comparar: entregar algo ya vale el puntaje completo.
      score = strokes.length > 0 ? MAX_ROUND_POINTS : 0;
    } else {
      score = list.length ? Math.round(((sum.get(id) ?? 0) / list.length) * MAX_ROUND_POINTS) : 0;
    }
    s.totals.set(id, (s.totals.get(id) ?? 0) + score);
    return {
      playerId: id,
      strokes,
      score,
      firsts: firsts.get(id) ?? 0,
      rankers: list.length,
      avgPlace: list.length ? Math.round((list.reduce((a, b) => a + b, 0) / list.length) * 10) / 10 : null,
      gained: score,
    };
  });
  entries.sort((a, b) => b.score - a.score || b.firsts - a.firsts);
  s.roundEntries = entries;

  schedule(ctx, s, RESULTS_MS, () => {
    if (s.round >= s.totalRounds) {
      s.stage = 'done';
      ctx.finish(
        ctx.players().map((p) => {
          const total = s.totals.get(p.id) ?? 0;
          return { playerId: p.id, value: total, label: `${total} pts` };
        }),
      );
    } else {
      startRound(ctx, s);
    }
  });
  ctx.push();
}
