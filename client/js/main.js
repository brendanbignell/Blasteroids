import { Net } from './net.js';
import { Input } from './input.js';
import { Lobby } from './lobby.js';
import { Renderer } from './render.js';
import { Hud } from './hud.js';

const net = new Net();
const renderer = new Renderer(document.getElementById('game'));
const hud = new Hud();
const input = new Input(net);

let mode = 'lobby'; // 'lobby' | 'game'
let myId = null;
let config = null;

const lobby = new Lobby(net, {
  onLaunch: ({ name, color, build }) => {
    net.send({ type: 'join', name, color, build });
  },
});

function enterGame() {
  mode = 'game';
  renderer.reset();
  renderer.selfId = myId;
  hud.selfId = myId;
  lobby.hide();
  hud.show();
  input.setEnabled(true);
}

function enterLobby() {
  mode = 'lobby';
  input.setEnabled(false);
  hud.hide();
  lobby.show();
}

input.onEscape = () => {
  net.send({ type: 'leave' });
  enterLobby();
};

net.on('open', () => lobby.setStatus('Connected to server', 'ok'));
net.on('close', () => {
  lobby.setStatus('Disconnected — reconnecting…', 'bad');
  if (mode === 'game') enterLobby();
});
net.on('welcome', (msg) => {
  myId = msg.id;
  config = msg.config;
  lobby.applyConfig(config);
});
net.on('lobby', (msg) => lobby.applyLobbyInfo(msg));
net.on('joined', () => enterGame());
net.on('left', () => enterLobby());
net.on('error', (msg) => lobby.showError(msg.message));
net.on('state', (msg) => {
  if (mode !== 'game') return;
  renderer.pushSnapshot(msg);
  for (const ev of msg.events || []) {
    if (ev.type === 'kill') hud.addKill(ev);
    else if (ev.type === 'pickup' && ev.id === myId) hud.addNotice(`Picked up ${labelFor(ev.itemType)}`, ev.color);
    else if (ev.type === 'join' && ev.id !== myId) hud.addNotice(`${ev.name} joined the arena`);
    else if (ev.type === 'leave') hud.addNotice(`${ev.name} left the arena`);
    else if (ev.type === 'matchStart') hud.addNotice(`Match ${ev.number} started — ${Math.round(ev.duration / 60)} minutes, good luck!`, '#7dff6a');
  }
});

function labelFor(type) {
  return config?.powerups?.find((p) => p.type === type)?.label || type;
}

net.connect();

// Debug handle (handy in the devtools console and for automated tests).
window.__blasteroids = { net, renderer, hud, input, lobby, get myId() { return myId; }, get mode() { return mode; } };

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (mode === 'game') {
    const view = renderer.frame(dt);
    if (view) hud.update(view, renderer, { showScores: input.showScores, rtt: net.rtt, connected: net.connected });
  } else {
    // Idle starfield drift behind the lobby.
    renderer.cam.x += dt * 12;
    renderer.cam.y += dt * 4;
    renderer.frame(dt);
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
