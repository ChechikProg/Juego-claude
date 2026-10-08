import { PHRASES } from '../../shared/phrases';
import type { FraseAnswer, FrasesView } from '../../shared/types';
import { pick, sanitizeText, shortId, shuffle } from '../util';
import type { GameContext, GameModule } from './kit';

const PROMPT_MS = 4200;
const WRITE_MS = 60_000;
const VOTE_MS = 30_000;
const RESULTS_MS = 11_000;
const MAX_ANSWER = 90;

interface Entry {
  /** id anónimo que se usa mientras se vota */
  id: string;
  playerId: string;
  text: string;
}

interface FrState {
  stage: 'prompt' | 'write' | 'vote' | 'roundResults' | 'done';
  round: number;
  totalRounds: number;
  phrase: string;
  used: Set<string>;
  endsAt: number;
  timer: NodeJS.Timeout | null;

  drafts: Map<string, string>;
  ready: Set<string>;
  writers: string[];

  entries: Entry[];
  /** votante -> id de la respuesta elegida */
  votes: Map<string, string>;
  totals: Map<string, number>;
}

export const frases: GameModule<FrState> = {
  id: 'frases',

  create(ctx) {
    return {
      stage: 'prompt',
      round: 0,
      totalRounds: Math.max(1, Math.min(8, ctx.config.frasesRounds || 3)),
      phrase: PHRASES[0],
      used: new Set<string>(),
      endsAt: 0,
      timer: null,
      drafts: new Map(),
      ready: new Set(),
      writers: [],
      entries: [],
      votes: new Map(),
      totals: new Map(ctx.players().map((p) => [p.id, 0] as const)),
    };
  },

  start(ctx, s) {
    startRound(ctx, s);
  },

  event(ctx, s, playerId, type, data) {
    const d = (data ?? {}) as { text?: unknown; id?: unknown; value?: unknown };

    if (s.stage === 'write') {
      if (type === 'draft') {
        if (s.ready.has(playerId)) return;
        s.drafts.set(playerId, sanitizeText(d.text, MAX_ANSWER));
        return;
      }
      if (type === 'ready') {
        const want = d.value !== false;
        const text = sanitizeText(s.drafts.get(playerId), MAX_ANSWER);
        if (want && !text) {
          ctx.toast(playerId, 'Escribí algo antes de dar listo.', 'bad');
          return;
        }
        if (want) s.ready.add(playerId);
        else s.ready.delete(playerId);
        ctx.push();

        const pending = s.writers.filter((id) => ctx.player(id)?.connected && !s.ready.has(id));
        if (pending.length === 0) {
          ctx.toast(null, '¡Todos listos!', 'good');
          schedule(ctx, s, 800, () => toVoting(ctx, s));
        }
        return;
      }
    }

    if (s.stage === 'vote' && type === 'vote') {
      const target = typeof d.id === 'string' ? d.id : '';
      const entry = s.entries.find((e) => e.id === target);
      if (!entry || entry.playerId === playerId) return;
      if (!canVote(ctx, s, playerId)) return;
      s.votes.set(playerId, target);
      ctx.push();

      const voters = voterList(ctx, s);
      if (voters.length > 0 && voters.every((id) => s.votes.has(id))) {
        schedule(ctx, s, 700, () => toResults(ctx, s));
      }
    }
  },

  leave(ctx, s, playerId) {
    s.ready.delete(playerId);
    if (s.stage === 'write') {
      const pending = s.writers.filter((id) => ctx.player(id)?.connected && !s.ready.has(id));
      if (pending.length === 0 && s.writers.length > 0) schedule(ctx, s, 600, () => toVoting(ctx, s));
    }
    if (s.stage === 'vote') {
      const voters = voterList(ctx, s);
      if (voters.length > 0 && voters.every((id) => s.votes.has(id))) {
        schedule(ctx, s, 500, () => toResults(ctx, s));
      }
    }
    ctx.push();
  },

  view(ctx, s, playerId): FrasesView | { stage: 'done' } {
    const base = { round: s.round, totalRounds: s.totalRounds, phrase: s.phrase, endsAt: s.endsAt };

    if (s.stage === 'prompt') return { stage: 'prompt', ...base };

    if (s.stage === 'write') {
      return {
        stage: 'write',
        ...base,
        myAnswer: s.drafts.get(playerId) ?? '',
        iAmReady: s.ready.has(playerId),
        readyIds: [...s.ready],
        writers: s.writers.length,
      };
    }

    if (s.stage === 'vote') {
      const voters = voterList(ctx, s);
      return {
        stage: 'vote',
        ...base,
        answers: s.entries.map(
          (e): FraseAnswer => ({
            id: e.id,
            text: e.text,
            // Los autores se revelan recién en los resultados.
            playerId: e.playerId === playerId ? playerId : null,
            votes: 0,
            voters: [],
          }),
        ),
        myVote: s.votes.get(playerId) ?? null,
        canVote: canVote(ctx, s, playerId),
        votesIn: [...s.votes.keys()].filter((id) => voters.includes(id)).length,
        votersTotal: voters.length,
      };
    }

    if (s.stage === 'roundResults') {
      const tally = new Map<string, string[]>();
      for (const [voter, target] of s.votes) {
        const list = tally.get(target);
        if (list) list.push(voter);
        else tally.set(target, [voter]);
      }
      const answers = s.entries
        .map((e): FraseAnswer => {
          const voters = tally.get(e.id) ?? [];
          return { id: e.id, text: e.text, playerId: e.playerId, votes: voters.length, voters };
        })
        .sort((a, b) => b.votes - a.votes);
      return { stage: 'roundResults', ...base, answers, totals: Object.fromEntries(s.totals) };
    }

    return { stage: 'done' };
  },

  dispose(ctx, s) {
    ctx.timers.cancel(s.timer);
    s.timer = null;
  },
};

/* ── máquina de estados ───────────────────────────────────────────────────── */

function schedule(ctx: GameContext, s: FrState, ms: number, fn: () => void): void {
  ctx.timers.cancel(s.timer);
  s.endsAt = ctx.now() + ms;
  s.timer = ctx.timers.after(ms, fn);
}

/** Todos los conectados pueden votar; el autor no puede votarse a sí mismo. */
function voterList(ctx: GameContext, s: FrState): string[] {
  if (s.entries.length <= 1) return [];
  return ctx
    .players()
    .filter((p) => p.connected)
    .map((p) => p.id)
    .filter((id) => s.entries.some((e) => e.playerId !== id));
}

function canVote(ctx: GameContext, s: FrState, playerId: string): boolean {
  return voterList(ctx, s).includes(playerId);
}

function startRound(ctx: GameContext, s: FrState): void {
  s.round += 1;
  s.stage = 'prompt';
  s.drafts.clear();
  s.ready.clear();
  s.votes.clear();
  s.entries = [];

  let phrase = pick(PHRASES);
  let guard = 0;
  while (s.used.has(phrase) && guard++ < 40) phrase = pick(PHRASES);
  s.used.add(phrase);
  s.phrase = phrase;

  s.writers = ctx.players().filter((p) => p.connected).map((p) => p.id);

  schedule(ctx, s, PROMPT_MS, () => {
    s.stage = 'write';
    schedule(ctx, s, WRITE_MS, () => toVoting(ctx, s));
    ctx.push();
  });
  ctx.push();
}

function toVoting(ctx: GameContext, s: FrState): void {
  s.entries = shuffle(
    s.writers
      .map((playerId) => ({ playerId, text: sanitizeText(s.drafts.get(playerId), MAX_ANSWER) }))
      .filter((e) => e.text.length > 0)
      .map((e) => ({ id: shortId(), playerId: e.playerId, text: e.text })),
  );

  if (s.entries.length === 0) {
    ctx.toast(null, 'Nadie escribió nada. Ronda anulada.', 'bad');
    toResults(ctx, s);
    return;
  }

  s.stage = 'vote';
  schedule(ctx, s, VOTE_MS, () => toResults(ctx, s));
  ctx.push();
}

function toResults(ctx: GameContext, s: FrState): void {
  s.stage = 'roundResults';
  for (const target of s.votes.values()) {
    const entry = s.entries.find((e) => e.id === target);
    if (entry) s.totals.set(entry.playerId, (s.totals.get(entry.playerId) ?? 0) + 1);
  }

  schedule(ctx, s, RESULTS_MS, () => {
    if (s.round >= s.totalRounds) {
      s.stage = 'done';
      ctx.finish(
        ctx.players().map((p) => {
          const total = s.totals.get(p.id) ?? 0;
          return { playerId: p.id, value: total, label: `${total} voto${total === 1 ? '' : 's'}` };
        }),
      );
    } else {
      startRound(ctx, s);
    }
  });
  ctx.push();
}
