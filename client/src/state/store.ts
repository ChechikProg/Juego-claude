import { create } from 'zustand';
import { AVATAR_FACES } from '@shared/constants';
import type { Avatar, ChatMessage, GameId, PlayerPublic, RoomState } from '@shared/types';
import { api, socket } from '@/net/socket';

const LS_ID = 'partidazo:id';
const LS_PROFILE = 'partidazo:profile';
const LS_ROOM = 'partidazo:room';
/** después de esto no intentamos volver solos a la sala */
const REJOIN_TTL = 3 * 60 * 60 * 1000;

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'good' | 'bad';
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* modo incógnito o almacenamiento bloqueado: seguimos sin persistir */
  }
}

function randomAvatar(): Avatar {
  return {
    hue: Math.floor(Math.random() * 360),
    face: AVATAR_FACES[Math.floor(Math.random() * AVATAR_FACES.length)],
  };
}

const savedProfile = read<{ name: string; avatar: Avatar }>(LS_PROFILE, {
  name: '',
  avatar: randomAvatar(),
});

interface State {
  connected: boolean;
  /** true mientras intentamos reconectar automáticamente al recargar */
  resuming: boolean;
  playerId: string | null;
  name: string;
  avatar: Avatar;

  room: RoomState | null;
  gameId: GameId | null;
  view: unknown;
  chat: ChatMessage[];
  toasts: Toast[];
  joinError: string | null;
  busy: boolean;

  setProfile: (name: string, avatar: Avatar) => void;
  create: () => Promise<boolean>;
  join: (code: string) => Promise<boolean>;
  leave: () => void;
  toast: (text: string, kind?: Toast['kind']) => void;
  dropToast: (id: number) => void;
  clearJoinError: () => void;
}

let toastSeq = 1;

export const useStore = create<State>((set, get) => ({
  connected: socket.connected,
  resuming: true,
  playerId: read<string | null>(LS_ID, null),
  name: savedProfile.name,
  avatar: savedProfile.avatar,

  room: null,
  gameId: null,
  view: null,
  chat: [],
  toasts: [],
  joinError: null,
  busy: false,

  setProfile(name, avatar) {
    set({ name, avatar });
    write(LS_PROFILE, { name, avatar });
    if (get().room) api.profile(name, avatar);
  },

  async create() {
    const { name, avatar, playerId } = get();
    set({ busy: true, joinError: null });
    const res = await api.createRoom({ playerId, name, avatar });
    set({ busy: false });
    if (!res?.ok || !res.data) {
      set({ joinError: res?.error ?? 'No se pudo crear la sala.' });
      return false;
    }
    adoptSession(res.data.playerId, res.data.code);
    return true;
  },

  async join(code) {
    const { name, avatar, playerId } = get();
    set({ busy: true, joinError: null });
    const res = await api.joinRoom({ playerId, name, avatar, code: code.trim().toUpperCase() });
    set({ busy: false });
    if (!res?.ok || !res.data) {
      set({ joinError: res?.error ?? 'No se pudo entrar.' });
      return false;
    }
    adoptSession(res.data.playerId, res.data.code);
    return true;
  },

  leave() {
    api.leaveRoom();
    write(LS_ROOM, null);
    set({ room: null, gameId: null, view: null, chat: [] });
  },

  toast(text, kind = 'info') {
    const id = toastSeq++;
    set((s) => ({ toasts: [...s.toasts, { id, text, kind }].slice(-4) }));
    setTimeout(() => get().dropToast(id), 3400);
  },

  dropToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },

  clearJoinError() {
    set({ joinError: null });
  },
}));

function adoptSession(playerId: string, code: string): void {
  write(LS_ID, playerId);
  write(LS_ROOM, { code, at: Date.now() });
  useStore.setState({ playerId, joinError: null });
}

/* ── eventos del servidor ─────────────────────────────────────────────────── */

let bound = false;

export function bindSocket(): void {
  if (bound) return;
  bound = true;
  const { setState, getState } = useStore;

  socket.on('connect', () => {
    setState({ connected: true });
    void resume();
  });

  socket.on('disconnect', () => {
    setState({ connected: false });
  });

  socket.on('room:state', (room: RoomState) => {
    setState({ room });
  });

  socket.on('game:state', (p: { gameId: GameId; view: unknown }) => {
    setState({ gameId: p.gameId, view: p.view });
  });

  socket.on('chat:msg', (m: ChatMessage) => {
    setState((s) => ({ chat: [...s.chat, m].slice(-60) }));
  });

  socket.on('toast', (p: { text: string; kind?: Toast['kind'] }) => {
    getState().toast(p.text, p.kind ?? 'info');
  });

  socket.on('room:closed', (p: { reason: string }) => {
    write(LS_ROOM, null);
    setState({ room: null, gameId: null, view: null, chat: [] });
    getState().toast(p.reason, 'bad');
  });

  // Si el servidor se reinicia, la sala ya no existe: volvemos al inicio.
  socket.io.on('reconnect_failed', () => {
    setState({ resuming: false });
  });

  if (socket.connected) void resume();
  else setTimeout(() => useStore.setState({ resuming: false }), 4000);
}

/** Vuelve solo a la última sala tras recargar la página. */
async function resume(): Promise<void> {
  const st = useStore.getState();
  if (st.room) {
    useStore.setState({ resuming: false });
    return;
  }
  const last = read<{ code: string; at: number } | null>(LS_ROOM, null);
  if (!last || Date.now() - last.at > REJOIN_TTL || !st.name) {
    useStore.setState({ resuming: false });
    return;
  }
  const res = await api.joinRoom({
    playerId: st.playerId,
    name: st.name,
    avatar: st.avatar,
    code: last.code,
  });
  if (res?.ok && res.data) adoptSession(res.data.playerId, res.data.code);
  else write(LS_ROOM, null);
  useStore.setState({ resuming: false });
}

/* ── selectores ───────────────────────────────────────────────────────────── */

export function useMe(): PlayerPublic | null {
  return useStore((s) => s.room?.players.find((p) => p.id === s.playerId) ?? null);
}

export function usePlayers(): PlayerPublic[] {
  return useStore((s) => s.room?.players ?? []);
}

/** Mapa id → jugador, útil en los minijuegos. */
export function usePlayerMap(): Map<string, PlayerPublic> {
  const players = usePlayers();
  return new Map(players.map((p) => [p.id, p]));
}

export function useIsHost(): boolean {
  return useStore((s) => !!s.room && s.room.hostId === s.playerId);
}
