import type { Stroke, VanGoghEntry, VanGoghView } from '../../shared/types';
import { WORDS, type WordEntry } from '../../shared/words';
import { pick, shuffle } from '../util';
import type { GameContext, GameModule } from './kit';

const PROMPT_MS = 4600;
const DRAW_MS = 120_000;
const VOTE_MS = 13_000;
const REVEAL_MS = 2900;
const RESULTS_MS = 10_000;

const MAX_STROKES = 2200;
const MAX_POINTS = 70_000;
/** puntos internos por estrella promedio (5 estrellas = 100) */
const POINTS_PER_STAR = 20;

interface Canvas {
  strokes: Stroke[];
  points: number;
}

interface VGState {
  stage: 'prompt' | 'draw' | 'vote' | 'roundResults' | 'done';
  round: number;
  totalRounds: number;
  entry: WordEntry;
  used: Set<string>;
  endsAt: number;
  timer: NodeJS.Timeout | null;

  /** artistas de la ronda actual (fijados al arrancar el dibujo) */
  artists: string[];
  canvases: Map<string, Canvas>;
  ready: Set<string>;

  order: string[];
  vIndex: number;
  /** targetId -> (voterId -> 1..5) */
  votes: Map<string, Map<string, number>>;
  reveal: { avg: number; votes: number } | null;

  roundEntries: VanGoghEntry[];
  totals: Map<string, number>;
}

function emptyCanvas(): Canvas {
  return { strokes: [], points: 0 };
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
  const w = typeof o.w === 'number' && Number.isFinite(o.w) ? Math.min(0.3, Math.max(0.001, o.w)) : 0.01;
  const stroke: Stroke = { c: color, w: Math.round(w * 10000) / 10000, p: pts };
  if (o.e === 1) stroke.e = 1;
  return stroke;
}

/** Jugadores que pueden votar un dibujo dado. En solitario uno se puede votar a sí mismo. */
function votersFor(ctx: GameContext, s: VGState, targetId: string): string[] {
  const all = ctx.players().filter((p) => p.connected);
  if (s.artists.length <= 1) return all.map((p) => p.id);
  return all.filter((p) => p.id !== targetId).map((p) => p.id);
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
      timer: null,
      artists: [],
      canvases: new Map(),
      ready: new Set(),
      order: [],
      vIndex: 0,
      votes: new Map(),
      reveal: null,
      roundEntries: [],
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
        canvas.strokes.push(stroke);
        canvas.points += stroke.p.length / 2;
        return;
      }
      if (type === 'undo') {
        const removed = canvas.strokes.pop();
        if (removed) canvas.points -= removed.p.length / 2;
        return;
      }
      if (type === 'clear') {
        canvas.strokes = [];
        canvas.points = 0;
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
          schedule(ctx, s, 900, () => toVoting(ctx, s));
        }
        return;
      }
    }

    if (s.stage === 'vote' && type === 'vote' && !s.reveal) {
      const targetId = s.order[s.vIndex];
      if (!targetId) return;
      const eligible = votersFor(ctx, s, targetId);
      if (!eligible.includes(playerId)) return;
      const value = Math.round(Number((data as { value?: number })?.value ?? 0));
      if (!(value >= 1 && value <= 5)) return;

      let bucket = s.votes.get(targetId);
      if (!bucket) {
        bucket = new Map();
        s.votes.set(targetId, bucket);
      }
      bucket.set(playerId, value);
      ctx.push();

      if (eligible.every((id) => bucket!.has(id))) {
        closeVote(ctx, s);
      }
    }
  },

  leave(ctx, s, playerId) {
    s.ready.delete(playerId);
    // Si el que se fue era el último voto pendiente, no bloqueamos la ronda.
    if (s.stage === 'vote' && !s.reveal) {
      const targetId = s.order[s.vIndex];
      const bucket = s.votes.get(targetId) ?? new Map();
      const eligible = votersFor(ctx, s, targetId);
      if (eligible.length > 0 && eligible.every((id) => bucket.has(id))) closeVote(ctx, s);
    }
    if (s.stage === 'draw') {
      const pending = s.artists.filter((id) => ctx.player(id)?.connected && !s.ready.has(id));
      if (pending.length === 0 && s.artists.length > 0) schedule(ctx, s, 600, () => toVoting(ctx, s));
    }
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

    if (s.stage === 'vote') {
      const targetId = s.order[s.vIndex] ?? '';
      const canvas = s.canvases.get(targetId) ?? emptyCanvas();
      const bucket = s.votes.get(targetId) ?? new Map<string, number>();
      const eligible = votersFor(ctx, s, targetId);
      return {
        stage: 'vote',
        ...base,
        index: s.vIndex,
        count: s.order.length,
        target: { playerId: targetId, strokes: canvas.strokes },
        isMine: targetId === playerId && s.artists.length > 1,
        myVote: bucket.get(playerId) ?? null,
        votesIn: [...bucket.keys()].filter((id) => eligible.includes(id)).length,
        votersTotal: eligible.length,
        reveal: s.reveal,
      };
    }

    if (s.stage === 'roundResults') {
      return {
        stage: 'roundResults',
        ...base,
        entries: s.roundEntries,
        totals: Object.fromEntries(s.totals),
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
  s.votes.clear();
  s.reveal = null;
  s.vIndex = 0;
  s.order = [];
  s.roundEntries = [];

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
    schedule(ctx, s, DRAW_MS, () => toVoting(ctx, s));
    ctx.push();
  });
  ctx.push();
}

function toVoting(ctx: GameContext, s: VGState): void {
  s.stage = 'vote';
  s.vIndex = 0;
  s.reveal = null;
  s.order = shuffle(s.artists.filter((id) => s.canvases.has(id)));
  if (s.order.length === 0) {
    toResults(ctx, s);
    return;
  }
  openVote(ctx, s);
}

function openVote(ctx: GameContext, s: VGState): void {
  s.reveal = null;
  const targetId = s.order[s.vIndex];
  const eligible = votersFor(ctx, s, targetId);
  if (eligible.length === 0) {
    // Nadie puede votar este dibujo: lo mostramos un ratito y seguimos.
    schedule(ctx, s, 2200, () => closeVote(ctx, s));
  } else {
    schedule(ctx, s, VOTE_MS, () => closeVote(ctx, s));
  }
  ctx.push();
}

function closeVote(ctx: GameContext, s: VGState): void {
  if (s.reveal) return;
  const targetId = s.order[s.vIndex];
  const bucket = s.votes.get(targetId) ?? new Map<string, number>();
  const values = [...bucket.values()];
  const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  s.reveal = { avg: Math.round(avg * 100) / 100, votes: values.length };

  schedule(ctx, s, REVEAL_MS, () => {
    s.vIndex += 1;
    if (s.vIndex >= s.order.length) toResults(ctx, s);
    else openVote(ctx, s);
  });
  ctx.push();
}

function toResults(ctx: GameContext, s: VGState): void {
  s.stage = 'roundResults';

  const entries: VanGoghEntry[] = s.order.map((id) => {
    const bucket = s.votes.get(id) ?? new Map<string, number>();
    const values = [...bucket.values()];
    const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    const gained = Math.round(avg * POINTS_PER_STAR);
    s.totals.set(id, (s.totals.get(id) ?? 0) + gained);
    return {
      playerId: id,
      strokes: s.canvases.get(id)?.strokes ?? [],
      avg: Math.round(avg * 100) / 100,
      votes: values.length,
      gained,
    };
  });
  entries.sort((a, b) => b.avg - a.avg);
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
