import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';

import { AVATAR_FACES, MAX_NAME_LENGTH } from '../shared/constants';
import type { Avatar } from '../shared/types';
import { Hub } from './rooms';
import { sanitizeName, sanitizeText } from './util';

const PORT = Number(process.env.PORT) || 3001;
const here = dirname(fileURLToPath(import.meta.url));

const app = express();
const http = createServer(app);

const corsOrigins = (process.env.CORS_ORIGIN ?? 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const io = new Server(http, {
  cors: { origin: corsOrigins, methods: ['GET', 'POST'] },
  maxHttpBufferSize: 5e5,
  pingInterval: 20_000,
  pingTimeout: 25_000,
});

const hub = new Hub(io);

/* ── HTTP ─────────────────────────────────────────────────────────────────── */

app.disable('x-powered-by');
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, uptime: Math.round(process.uptime()), ...hub.stats });
});
app.get('/api/room/:code', (req, res) => {
  const room = hub.get(req.params.code);
  res.json({
    exists: !!room,
    players: room?.connectedPlayers.length ?? 0,
    inProgress: room ? room.phase.kind !== 'lobby' : false,
  });
});

// En producción el mismo proceso sirve el build del cliente. Pedimos que exista
// `assets/` para no confundir el código fuente de `client/` con una compilación.
const clientDir = [join(here, '../client'), join(here, '../dist/client')].find(
  (p) => existsSync(join(p, 'index.html')) && existsSync(join(p, 'assets')),
);

if (clientDir) {
  app.use(
    express.static(clientDir, {
      maxAge: '1y',
      setHeaders: (res, path) => {
        if (path.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
      },
    }),
  );
  app.get(/^\/(?!api|socket\.io).*/, (_req, res) => {
    res.sendFile(join(clientDir, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => {
    res.type('text/plain').send('Partidazo API lista. El cliente corre en Vite (npm run dev).');
  });
}

/* ── validación de entrada ────────────────────────────────────────────────── */

function cleanAvatar(raw: unknown): Avatar {
  const o = (raw ?? {}) as Record<string, unknown>;
  const hue = Number(o.hue);
  const face = typeof o.face === 'string' ? o.face : '';
  return {
    hue: Number.isFinite(hue) ? ((Math.round(hue) % 360) + 360) % 360 : Math.floor(Math.random() * 360),
    face: AVATAR_FACES.includes(face) ? face : AVATAR_FACES[0],
  };
}

function cleanId(raw: unknown): string | null {
  const s = typeof raw === 'string' ? raw.trim() : '';
  return /^[0-9a-fA-F-]{8,40}$/.test(s) ? s : null;
}

/** Balde de fichas simple para que nadie inunde el socket. */
class Bucket {
  private tokens: number;
  private last = Date.now();
  constructor(private capacity: number, private perSecond: number) {
    this.tokens = capacity;
  }
  take(): boolean {
    const now = Date.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) / 1000) * this.perSecond);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

/* ── Socket.IO ────────────────────────────────────────────────────────────── */

io.on('connection', (socket) => {
  const limits = {
    game: new Bucket(90, 60),
    chat: new Bucket(6, 1),
    lobby: new Bucket(20, 4),
  };

  const ack = (cb: unknown, payload: unknown): void => {
    if (typeof cb === 'function') (cb as (p: unknown) => void)(payload);
  };

  socket.on('room:create', (raw, cb) => {
    if (!limits.lobby.take()) return ack(cb, { ok: false, error: 'Esperá un segundo.' });
    const name = sanitizeName((raw ?? {}).name);
    const avatar = cleanAvatar((raw ?? {}).avatar);
    const room = hub.create();
    const player = room.addPlayer(socket, cleanId((raw ?? {}).playerId), name, avatar);
    if (!player) return ack(cb, { ok: false, error: 'No se pudo crear la sala.' });

    socket.join(room.channel);
    hub.bind(socket.id, room.code, player.id);
    room.sync(socket, player.id);
    ack(cb, { ok: true, data: { code: room.code, playerId: player.id } });
  });

  socket.on('room:join', (raw, cb) => {
    if (!limits.lobby.take()) return ack(cb, { ok: false, error: 'Esperá un segundo.' });
    const p = raw ?? {};
    const room = hub.get(String(p.code ?? ''));
    if (!room) return ack(cb, { ok: false, error: 'No existe ninguna sala con ese código.' });

    const name = sanitizeName(p.name);
    const avatar = cleanAvatar(p.avatar);
    const player = room.addPlayer(socket, cleanId(p.playerId), name, avatar);
    if (!player) return ack(cb, { ok: false, error: 'La sala está llena.' });

    socket.join(room.channel);
    hub.bind(socket.id, room.code, player.id);
    room.sync(socket, player.id);
    ack(cb, { ok: true, data: { code: room.code, playerId: player.id } });
  });

  socket.on('room:leave', () => {
    const s = hub.unbind(socket.id);
    if (!s) return;
    socket.leave(s.room.channel);
    s.room.remove(s.playerId);
  });

  socket.on('room:config', (patch) => {
    const s = hub.session(socket.id);
    if (!s || !limits.lobby.take()) return;
    s.room.setConfig(s.playerId, (patch ?? {}) as never);
  });

  socket.on('room:profile', (raw) => {
    const s = hub.session(socket.id);
    if (!s || !limits.lobby.take()) return;
    s.room.setProfile(s.playerId, sanitizeName((raw ?? {}).name), cleanAvatar((raw ?? {}).avatar));
  });

  socket.on('room:kick', (raw) => {
    const s = hub.session(socket.id);
    if (!s || !s.room.isHost(s.playerId)) return;
    const target = cleanId((raw ?? {}).playerId);
    if (!target || target === s.playerId) return;
    const victim = s.room.players.get(target);
    if (victim?.socketId) {
      io.to(victim.socketId).emit('room:closed', { reason: 'Te sacaron de la sala.' });
      hub.sessions.delete(victim.socketId);
      io.sockets.sockets.get(victim.socketId)?.leave(s.room.channel);
    }
    s.room.remove(target);
  });

  socket.on('match:start', () => {
    const s = hub.session(socket.id);
    s?.room.startMatch(s.playerId);
  });

  socket.on('match:skip', () => {
    const s = hub.session(socket.id);
    s?.room.skip(s.playerId);
  });

  socket.on('match:ready', (raw) => {
    const s = hub.session(socket.id);
    if (!s || !limits.lobby.take()) return;
    s.room.setReady(s.playerId, (raw ?? {}).value !== false);
  });

  socket.on('match:again', () => {
    const s = hub.session(socket.id);
    s?.room.playAgain(s.playerId);
  });

  socket.on('game:event', (raw) => {
    const s = hub.session(socket.id);
    if (!s || !limits.game.take()) return;
    const p = (raw ?? {}) as { type?: unknown; data?: unknown };
    s.room.gameEvent(s.playerId, p.type, p.data);
  });

  socket.on('chat:send', (raw) => {
    const s = hub.session(socket.id);
    if (!s || !limits.chat.take()) return;
    s.room.chatSend(s.playerId, sanitizeText((raw ?? {}).text, 140));
  });

  socket.on('time:ping', (raw, cb) => {
    const t0 = Number((raw ?? {}).t0) || 0;
    const s = hub.session(socket.id);
    const rtt = Number((raw ?? {}).rtt);
    if (s && Number.isFinite(rtt) && rtt >= 0 && rtt < 5000) {
      const player = s.room.players.get(s.playerId);
      if (player) player.rtt = Math.round(rtt);
    }
    ack(cb, { t0, ts: Date.now() });
  });

  socket.on('disconnect', () => {
    const s = hub.unbind(socket.id);
    if (!s) return;
    s.room.disconnect(s.playerId);
  });
});

/* ── arranque ─────────────────────────────────────────────────────────────── */

http.listen(PORT, () => {
  console.log(`\n  ⚡ Partidazo escuchando en http://localhost:${PORT}`);
  console.log(`  ${clientDir ? `sirviendo el cliente desde ${clientDir}` : 'modo desarrollo: el cliente lo sirve Vite'}`);
  console.log(`  nombres de hasta ${MAX_NAME_LENGTH} caracteres · ${corsOrigins.join(', ')}\n`);
});

const shutdown = (signal: string) => {
  console.log(`\n${signal} recibido, cerrando...`);
  io.close();
  http.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
