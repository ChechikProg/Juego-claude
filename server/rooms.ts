import type { Server, Socket } from 'socket.io';
import { DEFAULT_CONFIG, GAMES, MAX_PLAYERS, ROOM_CODE_LENGTH } from '../shared/constants';
import type {
  Avatar, ChatMessage, GameId, PlayerPublic, RoomConfig, RoomPhase, RoomState, Standing,
} from '../shared/types';
import { getGame } from './games/registry';
import type { GameContext, GameModule, GamePlayer, ResultRow } from './games/kit';
import { TimerBag, buildStandings, roomCode, sanitizeText, shortId, uid } from './util';

const INTRO_MS = 7000;
const RESULTS_MS = 13_000;
/** agrupa los envíos de estado de juego para no saturar el socket */
const FLUSH_MS = 40;
/** una sala sin nadie conectado se borra después de esto */
const EMPTY_TTL_MS = 3 * 60_000;

export interface Player {
  id: string;
  name: string;
  avatar: Avatar;
  socketId: string | null;
  connected: boolean;
  score: number;
  spectator: boolean;
  rtt: number;
  lastSeen: number;
}

interface ActiveGame {
  gameId: GameId;
  mod: GameModule<unknown>;
  state: unknown;
  ctx: GameContext;
  tick: NodeJS.Timeout | null;
  finished: boolean;
}

export class Room {
  readonly code: string;
  hostId = '';
  players = new Map<string, Player>();
  config: RoomConfig = { ...DEFAULT_CONFIG };
  phase: RoomPhase = { kind: 'lobby' };
  chat: ChatMessage[] = [];

  /** transiciones de fase de la partida (intro → juego → resultados) */
  private matchTimers = new TimerBag();
  /** timers del minijuego activo; se tiran enteros al cortarlo */
  private gameTimers = new TimerBag();
  private active: ActiveGame | null = null;
  private playlist: GameId[] = [];
  private index = 0;
  private flushTimer: NodeJS.Timeout | null = null;
  private dirtyAll = false;
  private dirtyIds = new Set<string>();
  emptySince: number | null = null;

  constructor(private io: Server, code: string) {
    this.code = code;
  }

  /* ── jugadores ──────────────────────────────────────────────────────── */

  get connectedPlayers(): Player[] {
    return [...this.players.values()].filter((p) => p.connected);
  }

  addPlayer(socket: Socket, playerId: string | null, name: string, avatar: Avatar): Player | null {
    const existing = playerId ? this.players.get(playerId) : undefined;
    if (existing) {
      existing.socketId = socket.id;
      existing.connected = true;
      existing.name = name;
      existing.avatar = avatar;
      existing.lastSeen = Date.now();
      this.emptySince = null;
      if (this.active) this.active.mod.rejoin?.(this.active.ctx, this.active.state, existing.id);
      this.ensureHost();
      this.broadcastRoom();
      this.pushGame(existing.id);
      return existing;
    }

    if (this.connectedPlayers.length >= MAX_PLAYERS) return null;

    const player: Player = {
      id: playerId || uid(),
      name,
      avatar,
      socketId: socket.id,
      connected: true,
      score: 0,
      // Si entra con la partida en curso, mira este minijuego y entra en el próximo.
      spectator: this.phase.kind !== 'lobby',
      rtt: 0,
      lastSeen: Date.now(),
    };
    this.players.set(player.id, player);
    this.emptySince = null;
    this.ensureHost();
    this.system(`${player.name} entró a la sala`);
    this.broadcastRoom();
    this.pushGame(player.id);
    return player;
  }

  disconnect(playerId: string): void {
    const p = this.players.get(playerId);
    if (!p) return;
    p.connected = false;
    p.socketId = null;
    p.lastSeen = Date.now();
    if (this.phase.kind === 'lobby') {
      this.players.delete(playerId);
      this.system(`${p.name} se fue`);
    } else if (this.active) {
      this.active.mod.leave?.(this.active.ctx, this.active.state, playerId);
    }
    this.ensureHost();
    if (this.connectedPlayers.length === 0) this.emptySince = Date.now();
    this.broadcastRoom();
  }

  remove(playerId: string): void {
    const p = this.players.get(playerId);
    if (!p) return;
    this.players.delete(playerId);
    if (this.active) this.active.mod.leave?.(this.active.ctx, this.active.state, playerId);
    this.ensureHost();
    if (this.connectedPlayers.length === 0) this.emptySince = Date.now();
    this.broadcastRoom();
  }

  private ensureHost(): void {
    const host = this.players.get(this.hostId);
    if (host?.connected) return;
    const next = this.connectedPlayers[0];
    this.hostId = next ? next.id : '';
  }

  isHost(playerId: string): boolean {
    return this.hostId === playerId;
  }

  setProfile(playerId: string, name: string, avatar: Avatar): void {
    const p = this.players.get(playerId);
    if (!p) return;
    p.name = name;
    p.avatar = avatar;
    this.broadcastRoom();
  }

  /* ── configuración y arranque ───────────────────────────────────────── */

  setConfig(playerId: string, patch: Partial<RoomConfig>): void {
    if (!this.isHost(playerId) || this.phase.kind !== 'lobby') return;
    if (Array.isArray(patch.playlist)) {
      const clean = patch.playlist.filter((g): g is GameId => g in GAMES);
      this.config.playlist = [...new Set(clean)];
    }
    const int = (v: unknown, lo: number, hi: number, cur: number): number => {
      const n = Math.round(Number(v));
      return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : cur;
    };
    if (patch.vangoghRounds !== undefined) this.config.vangoghRounds = int(patch.vangoghRounds, 1, 6, this.config.vangoghRounds);
    if (patch.timbaSeconds !== undefined) this.config.timbaSeconds = int(patch.timbaSeconds, 60, 900, this.config.timbaSeconds);
    if (patch.smashRounds !== undefined) this.config.smashRounds = int(patch.smashRounds, 1, 9, this.config.smashRounds);
    if (patch.piramideSeconds !== undefined) this.config.piramideSeconds = int(patch.piramideSeconds, 30, 600, this.config.piramideSeconds);
    if (patch.frasesRounds !== undefined) this.config.frasesRounds = int(patch.frasesRounds, 1, 8, this.config.frasesRounds);
    this.broadcastRoom();
  }

  startMatch(playerId: string): void {
    if (!this.isHost(playerId) || this.phase.kind !== 'lobby') return;
    if (this.config.playlist.length === 0) {
      this.toast(playerId, 'Elegí al menos un minijuego.', 'bad');
      return;
    }
    if (this.connectedPlayers.length === 0) return;

    for (const p of this.players.values()) {
      p.score = 0;
      p.spectator = false;
    }
    this.playlist = [...this.config.playlist];
    this.index = 0;
    this.goIntro();
  }

  skip(playerId: string): void {
    if (!this.isHost(playerId)) return;
    if (this.phase.kind === 'intro') {
      this.matchTimers.clear();
      this.beginGame();
    } else if (this.phase.kind === 'results') {
      this.matchTimers.clear();
      this.advance();
    }
  }

  playAgain(playerId: string): void {
    if (!this.isHost(playerId)) return;
    if (this.phase.kind !== 'final') return;
    this.resetToLobby();
  }

  private resetToLobby(): void {
    this.stopGame();
    this.matchTimers.clear();
    for (const p of this.players.values()) {
      p.score = 0;
      p.spectator = false;
    }
    this.phase = { kind: 'lobby' };
    this.playlist = [];
    this.index = 0;
    this.broadcastRoom();
  }

  /* ── ciclo de minijuegos ────────────────────────────────────────────── */

  private goIntro(): void {
    const gameId = this.playlist[this.index];
    this.phase = {
      kind: 'intro',
      gameId,
      index: this.index,
      total: this.playlist.length,
      endsAt: Date.now() + INTRO_MS,
    };
    this.broadcastRoom();
    this.matchTimers.after(INTRO_MS, () => this.beginGame());
  }

  private beginGame(): void {
    const gameId = this.playlist[this.index];
    const mod = getGame(gameId);
    if (!mod) {
      this.advance();
      return;
    }
    // Los que entraron a mirar ya juegan a partir de acá.
    for (const p of this.players.values()) if (p.connected) p.spectator = false;

    this.phase = { kind: 'playing', gameId, index: this.index, total: this.playlist.length };

    const ctx = this.makeContext(gameId);
    const state = mod.create(ctx);
    this.active = { gameId, mod, state, ctx, tick: null, finished: false };

    this.broadcastRoom();
    mod.start(ctx, state);

    if (mod.tickHz) {
      const every = Math.max(8, Math.round(1000 / mod.tickHz));
      this.active.tick = this.gameTimers.every(every, () => {
        const a = this.active;
        if (!a || a.finished) return;
        a.mod.tick?.(a.ctx, a.state, every, Date.now());
      });
    }
    this.pushGame();
  }

  private stopGame(): void {
    const a = this.active;
    if (!a) return;
    a.finished = true;
    this.gameTimers.clear();
    try {
      a.mod.dispose?.(a.ctx, a.state);
    } catch (err) {
      console.error('[dispose]', err);
    }
    this.active = null;
  }

  private onFinish(rows: ResultRow[]): void {
    const a = this.active;
    if (!a || a.finished) return;
    const gameId = a.gameId;
    this.stopGame();
    this.matchTimers.clear();

    const standings = buildStandings(rows);
    for (const st of standings) {
      const p = this.players.get(st.playerId);
      if (p) p.score += st.awarded;
    }

    this.phase = {
      kind: 'results',
      gameId,
      index: this.index,
      total: this.playlist.length,
      standings,
      endsAt: Date.now() + RESULTS_MS,
    };
    this.broadcastRoom();
    this.matchTimers.after(RESULTS_MS, () => this.advance());
  }

  private advance(): void {
    this.index += 1;
    if (this.index < this.playlist.length) {
      this.goIntro();
      return;
    }
    const standings = this.finalStandings();
    this.phase = { kind: 'final', standings };
    this.broadcastRoom();
  }

  private finalStandings(): Standing[] {
    const rows = [...this.players.values()].map((p) => ({
      playerId: p.id,
      value: p.score,
      label: `${p.score} pts`,
    }));
    // En la tabla final no se reparten más puntos: sólo importa el puesto.
    return buildStandings(rows).map((s) => ({ ...s, awarded: 0 }));
  }

  /* ── input de los minijuegos ────────────────────────────────────────── */

  gameEvent(playerId: string, type: unknown, data: unknown): void {
    const a = this.active;
    if (!a || a.finished) return;
    const p = this.players.get(playerId);
    if (!p || p.spectator) return;
    if (typeof type !== 'string' || type.length > 40) return;
    try {
      a.mod.event(a.ctx, a.state, playerId, type, data);
    } catch (err) {
      console.error(`[game:${a.gameId}]`, err);
    }
  }

  private makeContext(gameId: GameId): GameContext {
    const room = this;
    const toGamePlayer = (p: Player): GamePlayer => ({
      id: p.id,
      name: p.name,
      connected: p.connected,
      rtt: p.rtt,
    });

    return {
      get config() {
        return room.config;
      },
      players: () => [...room.players.values()].filter((p) => !p.spectator).map(toGamePlayer),
      player: (id) => {
        const p = room.players.get(id);
        return p && !p.spectator ? toGamePlayer(p) : undefined;
      },
      timers: room.gameTimers,
      now: () => Date.now(),
      push: () => room.pushGame(),
      pushTo: (id) => room.pushGame(id),
      toast: (id, text, kind) => {
        if (id) room.toast(id, text, kind);
        else room.io.to(room.channel).emit('toast', { text, kind: kind ?? 'info' });
      },
      finish: (rows) => {
        if (room.active?.gameId === gameId) room.onFinish(rows);
      },
    };
  }

  /* ── chat ───────────────────────────────────────────────────────────── */

  chatSend(playerId: string, text: string): void {
    const p = this.players.get(playerId);
    const clean = sanitizeText(text, 140);
    if (!p || !clean) return;
    const msg: ChatMessage = { id: shortId(), playerId: p.id, name: p.name, text: clean, at: Date.now() };
    this.chat.push(msg);
    if (this.chat.length > 60) this.chat.shift();
    this.io.to(this.channel).emit('chat:msg', msg);
  }

  private system(text: string): void {
    const msg: ChatMessage = { id: shortId(), playerId: null, name: '', text, at: Date.now(), system: true };
    this.chat.push(msg);
    if (this.chat.length > 60) this.chat.shift();
    this.io.to(this.channel).emit('chat:msg', msg);
  }

  /* ── envío ──────────────────────────────────────────────────────────── */

  get channel(): string {
    return `room:${this.code}`;
  }

  toState(): RoomState {
    const players: PlayerPublic[] = [...this.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      connected: p.connected,
      isHost: p.id === this.hostId,
      score: p.score,
      spectator: p.spectator,
      rtt: p.rtt,
    }));
    players.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    return {
      code: this.code,
      hostId: this.hostId,
      players,
      config: this.config,
      phase: this.phase,
      progress: this.playlist.length ? { index: this.index, total: this.playlist.length } : null,
    };
  }

  broadcastRoom(): void {
    this.io.to(this.channel).emit('room:state', this.toState());
  }

  toast(playerId: string, text: string, kind: 'info' | 'good' | 'bad' = 'info'): void {
    const sid = this.players.get(playerId)?.socketId;
    if (sid) this.io.to(sid).emit('toast', { text, kind });
  }

  /** Marca la vista de juego como sucia; el envío real se agrupa. */
  pushGame(playerId?: string): void {
    if (!this.active) return;
    if (playerId) this.dirtyIds.add(playerId);
    else this.dirtyAll = true;
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      try {
        this.flushGame();
      } catch (err) {
        console.error('[flush]', err);
      }
    }, FLUSH_MS);
  }

  private flushGame(): void {
    const a = this.active;
    if (!a) {
      this.dirtyAll = false;
      this.dirtyIds.clear();
      return;
    }
    const targets = this.dirtyAll
      ? [...this.players.values()]
      : [...this.dirtyIds].map((id) => this.players.get(id)).filter((p): p is Player => !!p);
    this.dirtyAll = false;
    this.dirtyIds.clear();

    for (const p of targets) {
      if (!p.socketId) continue;
      let view: unknown;
      try {
        view = a.mod.view(a.ctx, a.state, p.id);
      } catch (err) {
        console.error(`[view:${a.gameId}]`, err);
        continue;
      }
      this.io.to(p.socketId).emit('game:state', { gameId: a.gameId, view });
    }
  }

  /** Reenvía todo a un socket recién llegado. */
  sync(socket: Socket, playerId: string): void {
    socket.emit('room:state', this.toState());
    for (const m of this.chat.slice(-25)) socket.emit('chat:msg', m);
    const a = this.active;
    if (a) {
      try {
        socket.emit('game:state', { gameId: a.gameId, view: a.mod.view(a.ctx, a.state, playerId) });
      } catch (err) {
        console.error('[sync]', err);
      }
    }
  }

  destroy(): void {
    this.stopGame();
    this.matchTimers.clear();
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
  }
}

/* ── registro global de salas ───────────────────────────────────────────── */

export class Hub {
  rooms = new Map<string, Room>();
  /** socket.id -> { code, playerId } */
  sessions = new Map<string, { code: string; playerId: string }>();

  constructor(private io: Server) {
    setInterval(() => this.sweep(), 30_000).unref?.();
  }

  create(): Room {
    let code = roomCode(ROOM_CODE_LENGTH);
    let guard = 0;
    while (this.rooms.has(code) && guard++ < 50) code = roomCode(ROOM_CODE_LENGTH);
    const room = new Room(this.io, code);
    this.rooms.set(code, room);
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(String(code ?? '').toUpperCase().trim());
  }

  bind(socketId: string, code: string, playerId: string): void {
    this.sessions.set(socketId, { code, playerId });
  }

  unbind(socketId: string): { room: Room; playerId: string } | null {
    const s = this.sessions.get(socketId);
    this.sessions.delete(socketId);
    if (!s) return null;
    const room = this.rooms.get(s.code);
    return room ? { room, playerId: s.playerId } : null;
  }

  session(socketId: string): { room: Room; playerId: string } | null {
    const s = this.sessions.get(socketId);
    if (!s) return null;
    const room = this.rooms.get(s.code);
    return room ? { room, playerId: s.playerId } : null;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      if (room.emptySince && now - room.emptySince > EMPTY_TTL_MS) {
        room.destroy();
        this.rooms.delete(code);
      }
    }
  }

  get stats(): { rooms: number; players: number } {
    let players = 0;
    for (const r of this.rooms.values()) players += r.connectedPlayers.length;
    return { rooms: this.rooms.size, players };
  }
}

