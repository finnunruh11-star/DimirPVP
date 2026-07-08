// =============================================================================
//  RELAY  —  serves the built game AND pairs players for online duels
// -----------------------------------------------------------------------------
//  One process, one port, one tunnel:
//    * HTTP  GET /...   -> serves the built game from ../dist
//    * WS    /ws        -> pairs the two clients of a room and forwards messages
//
//  The relay keeps zero game state — the clients run the deterministic
//  simulation themselves and only relay their decisions.
//
//  Run it:        npm run build   (produces ../dist)
//                 npm run relay
//  Expose it:     cloudflared tunnel --url http://localhost:8787
//                 -> share the wss/https URL; both players open it and the
//                    lobby auto-connects its WebSocket to wss://<host>/ws.
//
//  WS protocol (client -> relay):
//    { k: 'join', room, size }   first message; registers the socket. The first
//                                joiner's `size` (2-4) fixes the room capacity.
//    <anything else>             forwarded verbatim to every other peer
//  WS protocol (relay -> client):
//    { k: 'seat', seat, size }   your seat index (0-based) and the room size
//    { k: 'ready', size }        every seat is filled, start the handshake
//    { k: 'full' }               the room is already at capacity
//    { k: 'bye' }                another player disconnected
// =============================================================================

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT) || 8787;
const DIST_DIR = fileURLToPath(new URL('../dist', import.meta.url));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

/** room code -> { sockets: WebSocket[], capacity: number }. */
const rooms = new Map();

// --- static file server (the built game) -------------------------------------

const httpServer = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/') pathname = '/index.html';

    // Resolve safely inside DIST_DIR (block path traversal).
    const filePath = normalize(join(DIST_DIR, pathname));
    if (!filePath.startsWith(DIST_DIR)) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(
      'Not found. Build the game first (npm run build) so the relay can serve ../dist.\n' +
        'The duel lobby connects over WebSocket at /ws.'
    );
  }
});

// --- WebSocket relay (pairs the two clients of a room) -----------------------

const wss = new WebSocketServer({ noServer: true });

// Keep proxied WebSocket connections (e.g. Cloudflare tunnels) from idling out
// during long reaction windows. Intermediaries close "quiet" sockets after ~100s
// with no traffic, which surfaced as a bogus "Opponent disconnected" mid-game.
// Ping every 30s (browsers auto-reply with pong, so a live-but-idle client stays
// up) and reap only sockets that actually miss a pong.
const HEARTBEAT_MS = 30_000;
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    try {
      ws.ping();
    } catch {
      /* socket already gone */
    }
  }
}, HEARTBEAT_MS);
wss.on('close', () => clearInterval(heartbeat));

httpServer.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname !== '/ws') {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
});

wss.on('connection', (ws) => {
  let room = null;
  // Heartbeat bookkeeping (see the interval above).
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg && msg.k === 'join') {
      room = String(msg.room ?? '');
      let entry = rooms.get(room);
      if (!entry) {
        // The first joiner (the host) fixes the room capacity, clamped 2-4.
        const n = Math.max(2, Math.min(4, Number(msg.size) || 2));
        entry = { sockets: [], capacity: n };
        rooms.set(room, entry);
      }
      if (entry.sockets.length >= entry.capacity) {
        ws.send(JSON.stringify({ k: 'full' }));
        ws.close();
        return;
      }
      const seat = entry.sockets.length;
      entry.sockets.push(ws);
      ws.send(JSON.stringify({ k: 'seat', seat, size: entry.capacity }));
      if (entry.sockets.length === entry.capacity) {
        for (const peer of entry.sockets) {
          if (peer.readyState === peer.OPEN)
            peer.send(JSON.stringify({ k: 'ready', size: entry.capacity }));
        }
      }
      return;
    }

    // Forward everything else to every other peer in the room.
    const entry = room ? rooms.get(room) : null;
    if (!entry) return;
    for (const peer of entry.sockets) {
      if (peer !== ws && peer.readyState === peer.OPEN) peer.send(raw.toString());
    }
  });

  ws.on('close', () => {
    const entry = room ? rooms.get(room) : null;
    if (!entry) return;
    entry.sockets = entry.sockets.filter((p) => p !== ws);
    for (const peer of entry.sockets) {
      if (peer.readyState === peer.OPEN) peer.send(JSON.stringify({ k: 'bye' }));
    }
    if (entry.sockets.length === 0) rooms.delete(room);
  });
});

httpServer.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(
      `\n[relay] Port ${PORT} is already in use — an old relay is probably still running.\n` +
        `        That stale server does NOT have the keepalive fix, so players will keep\n` +
        `        hitting spurious "Opponent disconnected". Stop it first, then retry:\n` +
        `          Windows:  Get-Process node | Stop-Process -Force\n` +
        `        …or just close the old relay's terminal, then run "npm run relay" again.\n`
    );
  } else {
    console.error('[relay] Server error:', err);
  }
  process.exit(1);
});

httpServer.listen(PORT, () => {
  console.log(`PVP DIMIR relay + game server on http://localhost:${PORT}  (WebSocket at /ws)`);
});
