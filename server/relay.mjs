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
//    { k: 'join', room, role }   first message; registers the socket
//    <anything else>             forwarded verbatim to the other peer
//  WS protocol (relay -> client):
//    { k: 'ready' }   both players are present, start the handshake
//    { k: 'full' }    the room already has two players
//    { k: 'bye' }     the other player disconnected
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

/** room code -> Set of sockets (max 2). */
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

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg && msg.k === 'join') {
      room = String(msg.room ?? '');
      let set = rooms.get(room);
      if (!set) {
        set = new Set();
        rooms.set(room, set);
      }
      if (set.size >= 2) {
        ws.send(JSON.stringify({ k: 'full' }));
        ws.close();
        return;
      }
      set.add(ws);
      if (set.size === 2) {
        for (const peer of set) {
          if (peer.readyState === peer.OPEN) peer.send(JSON.stringify({ k: 'ready' }));
        }
      }
      return;
    }

    // Forward everything else to the other peer in the room.
    const set = room ? rooms.get(room) : null;
    if (!set) return;
    for (const peer of set) {
      if (peer !== ws && peer.readyState === peer.OPEN) peer.send(raw.toString());
    }
  });

  ws.on('close', () => {
    const set = room ? rooms.get(room) : null;
    if (!set) return;
    set.delete(ws);
    for (const peer of set) {
      if (peer.readyState === peer.OPEN) peer.send(JSON.stringify({ k: 'bye' }));
    }
    if (set.size === 0) rooms.delete(room);
  });
});

httpServer.listen(PORT, () => {
  console.log(`PVP DIMIR relay + game server on http://localhost:${PORT}  (WebSocket at /ws)`);
});
