import { io, type Socket } from 'socket.io-client';
import type { Avatar, Identity, JoinAck, RoomConfig } from '@shared/types';

/**
 * En desarrollo Vite hace de proxy de /socket.io hacia el servidor, así que
 * siempre nos conectamos al mismo origen.
 */
export const socket: Socket = io({
  autoConnect: true,
  transports: ['websocket', 'polling'],
  reconnectionDelay: 600,
  reconnectionDelayMax: 4000,
});

/* ── reloj del servidor ───────────────────────────────────────────────────── */

let offset = 0;
let rtt = 0;
const samples: { offset: number; rtt: number }[] = [];

/** Timestamp del servidor estimado desde el reloj local. */
export function serverNow(): number {
  return Date.now() + offset;
}

export function currentRtt(): number {
  return rtt;
}

function syncClock(): void {
  const t0 = Date.now();
  socket.emit('time:ping', { t0, rtt }, (res: { t0: number; ts: number }) => {
    const t1 = Date.now();
    const sampleRtt = t1 - res.t0;
    const sampleOffset = res.ts - (res.t0 + t1) / 2;
    samples.push({ offset: sampleOffset, rtt: sampleRtt });
    if (samples.length > 7) samples.shift();
    // Nos quedamos con la medición de menor ida y vuelta: es la menos ruidosa.
    const best = samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
    offset = best.offset;
    rtt = Math.round(samples.reduce((a, b) => a + b.rtt, 0) / samples.length);
  });
}

socket.on('connect', () => {
  samples.length = 0;
  syncClock();
  setTimeout(syncClock, 400);
  setTimeout(syncClock, 1200);
});
setInterval(() => {
  if (socket.connected) syncClock();
}, 5000);

/* ── atajos tipados ───────────────────────────────────────────────────────── */

export const api = {
  createRoom(identity: Identity): Promise<JoinAck> {
    return new Promise((resolve) => {
      socket.emit('room:create', identity, resolve);
    });
  },
  joinRoom(identity: Identity & { code: string }): Promise<JoinAck> {
    return new Promise((resolve) => {
      socket.emit('room:join', identity, resolve);
    });
  },
  leaveRoom(): void {
    socket.emit('room:leave');
  },
  config(patch: Partial<RoomConfig>): void {
    socket.emit('room:config', patch);
  },
  profile(name: string, avatar: Avatar): void {
    socket.emit('room:profile', { name, avatar });
  },
  kick(playerId: string): void {
    socket.emit('room:kick', { playerId });
  },
  start(): void {
    socket.emit('match:start');
  },
  skip(): void {
    socket.emit('match:skip');
  },
  again(): void {
    socket.emit('match:again');
  },
  send(type: string, data?: unknown): void {
    socket.emit('game:event', { type, data });
  },
  chat(text: string): void {
    socket.emit('chat:send', { text });
  },
};
