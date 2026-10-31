import { Net } from './net.js';
import { Input } from './input.js';
import { Lobby } from './lobby.js';
import { Renderer, INTERP_DELAY } from './render.js';
import { Sound } from './audio.js';
import { Music } from './music.js';
import { Hud } from './hud.js';

const net = new Net();
const renderer = new Renderer(document.getElementById('game'));
const hud = new Hud();
const input = new Input(net);
const sound = new Sound();
const music = new Music(sound);

// Sound controls: M toggles mute anywhere outside text fields; the hangar has a volume slider.
const volumeEl = document.getElementById('volume');
const musicEl = document.getElementById('music-volume');
const muteEl = document.getElementById('mute');
const syncSoundUI = () => {
  volumeEl.value = Math.round(sound.volume * 100);
  musicEl.value = Math.round(sound.musicVolume * 100);
  muteEl.textContent = sound.muted || sound.volume === 0 ? '🔇' : '🔊';
  muteEl.title = sound.muted ? 'Unmute (M)' : 'Mute (M)';
};
volumeEl.oninput = () => { sound.unlock(); sound.setVolume(Number(volumeEl.value) / 100); syncSoundUI(); };
musicEl.oninput = () => { sound.unlock(); sound.setMusicVolume(Number(musicEl.value) / 100); syncSoundUI(); };
muteEl.onclick = () => { sound.unlock(); sound.toggleMute(); syncSoundUI(); };
window.addEventListener('keydown', (e) => {
  if (e.code !== 'KeyM' || e.repeat || (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA'))) return;
  sound.toggleMute(); syncSoundUI();
});
syncSoundUI();

let mode = 'lobby'; // 'lobby' | 'game'
let myId = null;
let config = null;

const lobby = new Lobby(net, {
  onLaunch: ({ name, color, theme, build }) => {
    net.send({ type: 'join', name, color, theme, build });
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
  sound.update(0, false, false);
  music.setIntensity(0);
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
  renderer.predictor.setTickHz(config.tickHz);
  lobby.applyConfig(config);
});
net.on('lobby', (msg) => lobby.applyLobbyInfo(msg));
net.on('joined', () => enterGame());
net.on('left', () => enterLobby());
net.on('error', (msg) => lobby.showError(msg.message));
net.on('state', (msg) => {
  if (mode !== 'game') return;
  renderer.pushSnapshot(msg);
  sound.handleEvents(msg.events || [], { selfId: myId, cam: renderer.cam, screenW: renderer.w, ships: msg.ships, lastPos: renderer.lastPos, delay: INTERP_DELAY });
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
window.__blasteroids = { net, renderer, hud, input, lobby, sound, music, get myId() { return myId; }, get mode() { return mode; } };

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (mode === 'game') {
    const latest = renderer.snapshots[renderer.snapshots.length - 1]?.data;
    renderer.predictor.advance(dt, input.state, input.seq, !latest || latest.match.state !== 'playing');
    const view = renderer.frame(dt);
    if (view) hud.update(view, renderer, { showScores: input.showScores, rtt: net.rtt, connected: net.connected, muted: sound.muted });
    const thrust = input.state.thrust ? 1 : input.state.reverse ? 2 : 0;
    sound.update(thrust, renderer.lockedOnMe, !!renderer.predictor.state && latest?.match.state === 'playing');
    // Music: full arrangement during a match, extra drive in the last 30 s, calm on the results screen.
    music.setIntensity(latest?.match.state !== 'playing' ? 0 : latest.match.remaining <= 30 ? 2 : 1);
  } else {
    // Idle starfield drift behind the lobby.
    renderer.cam.x += dt * 12;
    renderer.cam.y += dt * 4;
    renderer.frame(dt);
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
