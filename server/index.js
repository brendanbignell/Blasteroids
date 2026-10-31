// Blasteroids server: serves the browser client and runs the authoritative
// simulation, relaying state to players over WebSockets.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

import { Game } from './game.js';
import { ABILITIES, CREDITS_DEFAULT, MAX_POINTS, WORLD, POWERUPS, SHIP_COLORS, SHIP_THEMES, BOT_SKILLS, BOT_SKILL_BY_KEY, DEFAULT_BOT_SKILL, clamp } from '../shared/stats.js';
import { sanitizeName, sanitizeColor, pick, createRateLimiter } from './util.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const env = (key, def) => (process.env[key] !== undefined && process.env[key] !== '' ? process.env[key] : def);
const CONFIG = {
  port: Number(env('PORT', 8080)),
  host: env('HOST', '0.0.0.0'),
  tickHz: Number(env('TICK_HZ', 60)),
  snapshotHz: Number(env('SNAPSHOT_HZ', 20)),
  matchSeconds: Number(env('MATCH_SECONDS', 300)),
  intermissionSeconds: Number(env('INTERMISSION_SECONDS', 3)),
  credits: Number(env('CREDITS', CREDITS_DEFAULT)),
  bots: Number(env('BOTS', 3)),
  maxBots: Number(env('MAX_BOTS', 12)),
  botSkill: env('BOT_SKILL', DEFAULT_BOT_SKILL),
  maxPlayers: Number(env('MAX_PLAYERS', 32)),
  allowBotControl: env('ALLOW_BOT_CONTROL', 'true') !== 'false',
};

// ----------------------------------------------------------------- static files
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const STATIC_DIRS = {
  '/shared/': path.join(ROOT, 'shared'),
  '/': path.join(ROOT, 'client'),
};

function serveStatic(req, res) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Bad request');
    return;
  }
  if (pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, players: game.humanCount(), bots: game.botCount(), match: game.match.state, remaining: Math.round(game.match.remaining) }));
    return;
  }
  if (pathname === '/') pathname = '/index.html';
  let base = null, rel = null;
  for (const [prefix, dir] of Object.entries(STATIC_DIRS)) {
    if (pathname.startsWith(prefix)) { base = dir; rel = pathname.slice(prefix.length); break; }
  }
  const file = path.normalize(path.join(base, rel));
  if (file !== base && !file.startsWith(base + path.sep)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
    const ext = path.extname(file);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

// ---------------------------------------------------------------------- game
const game = new Game({
  matchSeconds: CONFIG.matchSeconds,
  intermissionSeconds: CONFIG.intermissionSeconds,
  credits: CONFIG.credits,
  maxBots: CONFIG.maxBots,
  botSkill: CONFIG.botSkill,
});
if (!BOT_SKILL_BY_KEY[CONFIG.botSkill]) console.warn(`[config] unknown BOT_SKILL "${CONFIG.botSkill}", using ${game.botSkill}`);
game.setBotCount(clamp(CONFIG.bots, 0, CONFIG.maxBots));

const server = http.createServer(serveStatic);
const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 });

/** @type {Map<import('ws').WebSocket, {id:string, joined:boolean, alive:boolean, name:string}>} */
const clients = new Map();
let nextClientId = 1;

// Bot-count changes are rate limited per connection (allows a few quick clicks) and
// server-wide (so opening many sockets doesn't get around the per-connection limit).
const BOT_LIMIT_PER_CLIENT = { capacity: 4, refillPerSec: 2 };
const botLimitGlobal = createRateLimiter({ capacity: 10, refillPerSec: 2 });

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const ws of clients.keys()) if (ws.readyState === ws.OPEN) ws.send(data);
}

function lobbyInfo() {
  return {
    type: 'lobby',
    players: game.standings().map((p) => ({ name: p.name, color: p.color, score: p.score, bot: p.isBot })),
    humans: game.humanCount(),
    bots: game.botCount(),
    botSkill: game.botSkill,
    match: { state: game.match.state, remaining: Math.round(game.match.remaining), number: game.match.number },
  };
}

wss.on('connection', (ws, req) => {
  const id = `h${nextClientId++}`;
  const client = { id, joined: false, alive: true, name: null, botLimit: createRateLimiter(BOT_LIMIT_PER_CLIENT) };
  clients.set(ws, client);
  const addr = req.socket.remoteAddress;
  console.log(`[conn] ${id} from ${addr}`);

  send(ws, {
    type: 'welcome',
    id,
    config: {
      credits: CONFIG.credits,
      maxPoints: MAX_POINTS,
      abilities: ABILITIES,
      world: WORLD,
      matchSeconds: CONFIG.matchSeconds,
      tickHz: CONFIG.tickHz,
      maxBots: CONFIG.maxBots,
      allowBotControl: CONFIG.allowBotControl,
      powerups: POWERUPS,
      colors: SHIP_COLORS,
      themes: SHIP_THEMES,
      botSkills: BOT_SKILLS.map((s) => ({ key: s.key, label: s.label })),
    },
  });
  send(ws, lobbyInfo());

  ws.on('pong', () => { client.alive = true; });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (!msg || typeof msg.type !== 'string') return;
    switch (msg.type) {
      case 'join': {
        if (client.joined) return;
        if (game.humanCount() >= CONFIG.maxPlayers) {
          send(ws, { type: 'error', message: 'Server is full, try again shortly.' });
          return;
        }
        const name = sanitizeName(msg.name, `Pilot ${id.slice(1)}`);
        const color = sanitizeColor(msg.color, pick(SHIP_COLORS));
        const result = game.addPlayer({ id, name, color, build: msg.build, theme: msg.theme, isBot: false });
        if (!result.ok) { send(ws, { type: 'error', message: result.error }); return; }
        client.joined = true;
        client.name = name;
        console.log(`[join] ${id} as "${name}"`);
        send(ws, { type: 'joined', id, build: result.player.build });
        break;
      }
      case 'input':
        if (client.joined) game.setInput(id, msg.input, msg.seq);
        break;
      case 'leave':
        if (client.joined) { game.removePlayer(id); client.joined = false; send(ws, { type: 'left' }); }
        break;
      case 'setBots': {
        if (!CONFIG.allowBotControl) { send(ws, { type: 'error', message: 'Bot control is disabled on this server.' }); return; }
        // Over the limit: drop the request and resync this client's displayed count.
        if (!client.botLimit.tryTake() || !botLimitGlobal.tryTake()) { send(ws, lobbyInfo()); return; }
        const n = game.setBotCount(Number(msg.count));
        console.log(`[bots] ${id} set bot count to ${n}`);
        broadcast(lobbyInfo());
        break;
      }
      case 'setBotSkill': {
        if (!CONFIG.allowBotControl) { send(ws, { type: 'error', message: 'Bot control is disabled on this server.' }); return; }
        if (!client.botLimit.tryTake() || !botLimitGlobal.tryTake()) { send(ws, lobbyInfo()); return; }
        const skill = game.setBotSkill(String(msg.skill));
        console.log(`[bots] ${id} set bot skill to ${skill}`);
        broadcast(lobbyInfo());
        break;
      }
      case 'ping':
        send(ws, { type: 'pong', t: msg.t, serverTime: game.time });
        break;
      default:
        break;
    }
  });

  ws.on('close', () => {
    if (client.joined) game.removePlayer(id);
    clients.delete(ws);
    console.log(`[disc] ${id}`);
  });
  ws.on('error', (err) => console.warn(`[ws] ${id}:`, err.message));
});

// ------------------------------------------------------------------- loops
const TICK_MS = 1000 / CONFIG.tickHz;
const MAX_STEP = 0.05;
let last = process.hrtime.bigint();
let acc = 0;
setInterval(() => {
  const now = process.hrtime.bigint();
  let dt = Number(now - last) / 1e9;
  last = now;
  // Catch up in fixed steps; cap to avoid spiral of death after a stall.
  acc = Math.min(acc + dt, 0.25);
  const step = 1 / CONFIG.tickHz;
  while (acc >= step) {
    game.step(Math.min(step, MAX_STEP));
    acc -= step;
  }
}, TICK_MS);

let snapshotCounter = 0;
setInterval(() => {
  const events = game.events;
  game.events = [];
  // Lobby clients only need a refresh about once a second.
  const sendLobby = snapshotCounter++ % CONFIG.snapshotHz === 0;
  const lobbyMsg = sendLobby ? JSON.stringify(lobbyInfo()) : null;
  for (const [ws, client] of clients) {
    if (ws.readyState !== ws.OPEN) continue;
    if (client.joined) {
      ws.send(JSON.stringify({ type: 'state', ...game.snapshotFor(client.id, events) }));
    } else if (lobbyMsg) {
      ws.send(lobbyMsg);
    }
  }
}, 1000 / CONFIG.snapshotHz);

// Heartbeat: drop dead sockets.
setInterval(() => {
  for (const [ws, client] of clients) {
    if (!client.alive) { ws.terminate(); continue; }
    client.alive = false;
    try { ws.ping(); } catch { /* ignore */ }
  }
}, 15000);

server.listen(CONFIG.port, CONFIG.host, () => {
  console.log(`Blasteroids server listening on http://${CONFIG.host}:${CONFIG.port}`);
  console.log(`  match ${CONFIG.matchSeconds}s, credits ${CONFIG.credits}, bots ${game.botCount()} (${game.botSkill}), tick ${CONFIG.tickHz}Hz, snapshots ${CONFIG.snapshotHz}Hz`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`\n${sig} received, shutting down`);
    for (const ws of clients.keys()) ws.close(1001, 'Server shutting down');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  });
}
