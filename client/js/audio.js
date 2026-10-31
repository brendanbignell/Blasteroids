// Procedural sound effects (Web Audio API, no audio files).
//
// Every sound is synthesised from oscillators and filtered noise. World sounds are positioned
// relative to the camera: they fade with distance and pan left/right. Other players' sounds are
// delayed by the renderer's interpolation delay so they line up with what's on screen; our own
// actions play immediately.

import { WORLD } from '/shared/stats.js';

const STORAGE_KEY = 'blasteroids.audio';
const HEARING_RANGE = 1300; // px: world sounds fade to silence at this distance
const MAX_VOICES = 28; // cap on simultaneous one-shot sounds

function wrapDelta(d, size) {
  const half = size / 2;
  if (d > half) return d - size;
  if (d < -half) return d + size;
  return d;
}

export class Sound {
  constructor() {
    this.ctx = null;
    this.volume = 0.7; // sound effects
    this.musicVolume = 0.5;
    this.muted = false; // mutes everything
    this.onUnlock = null; // called once the AudioContext exists (music hooks in here)
    this.voices = 0;
    this.engine = null;
    this.lockBeepAt = 0;
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (saved) {
        this.volume = Math.max(0, Math.min(1, Number(saved.volume ?? 0.7)));
        this.musicVolume = Math.max(0, Math.min(1, Number(saved.musicVolume ?? 0.5)));
        this.muted = !!saved.muted;
      }
    } catch { /* ignore */ }
    // Browsers only allow audio after a user gesture, so start on the first one.
    const unlock = () => this.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      // Effects (master) and music (musicBus) share a compressor and an overall mute gain.
      this.output = this.ctx.createGain();
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 6;
      comp.connect(this.output).connect(this.ctx.destination);
      this.master = this.ctx.createGain();
      this.master.connect(comp);
      this.musicBus = this.ctx.createGain();
      this.musicBus.connect(comp);
      // One second of white noise, reused by every noise-based sound.
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.applyVolume();
      this.onUnlock?.();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ volume: this.volume, musicVolume: this.musicVolume, muted: this.muted })); } catch { /* ignore */ }
  }

  applyVolume() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.output.gain.setTargetAtTime(this.muted ? 0 : 1, t, 0.02);
    this.master.gain.setTargetAtTime(this.volume * 0.8, t, 0.02);
    this.musicBus.gain.setTargetAtTime(this.musicVolume * 0.2, t, 0.05);
  }

  setVolume(v) { this.volume = Math.max(0, Math.min(1, v)); if (this.volume > 0) this.muted = false; this.applyVolume(); this.persist(); }
  setMusicVolume(v) { this.musicVolume = Math.max(0, Math.min(1, v)); if (this.musicVolume > 0) this.muted = false; this.applyVolume(); this.persist(); }
  toggleMute() { this.muted = !this.muted; this.applyVolume(); this.persist(); return this.muted; }

  get ready() { return !!this.ctx && this.ctx.state === 'running' && !this.muted && this.volume > 0; }

  // ------------------------------------------------------------- building blocks
  /** Output node for one sound: gain for distance, panner for direction. Returns null if inaudible. */
  out(gain, pan = 0, when = 0) {
    if (!this.ready || gain < 0.01 || this.voices >= MAX_VOICES) return null;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    let node = g;
    if (this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(p); p.connect(this.master);
    } else {
      g.connect(this.master);
    }
    this.voices++;
    return { node, t: this.ctx.currentTime + when, done: (secs) => setTimeout(() => { this.voices--; g.disconnect(); }, (when + secs) * 1000 + 50) };
  }

  tone(dest, t, { type = 'sine', f0, f1 = f0, dur, vol = 1, attack = 0.005, curve = 'exp' }) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) {
      if (curve === 'exp') o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
      else o.frequency.linearRampToValueAtTime(f1, t + dur);
    }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t); o.stop(t + dur + 0.02);
  }

  noiseBurst(dest, t, { dur, vol = 1, type = 'lowpass', f0 = 2000, f1 = f0, q = 0.7, attack = 0.005 }) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const filt = this.ctx.createBiquadFilter();
    filt.type = type; filt.Q.value = q;
    filt.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) filt.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filt).connect(g).connect(dest);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.02);
  }

  /** Distance gain and stereo pan for a world position seen from the camera. */
  place(x, y, cam, screenW) {
    const dx = wrapDelta(x - cam.x, WORLD.width), dy = wrapDelta(y - cam.y, WORLD.height);
    const d = Math.hypot(dx, dy);
    const gain = Math.max(0, 1 - d / HEARING_RANGE) ** 1.6;
    return { gain, pan: dx / Math.max(400, screenW * 0.6) };
  }

  // -------------------------------------------------------------------- sounds
  laser(gain, pan, when, own) {
    const o = this.out(gain * (own ? 0.32 : 0.26), pan, when); if (!o) return;
    const base = own ? 1500 : 1250;
    this.tone(o.node, o.t, { type: 'square', f0: base, f1: base * 0.22, dur: 0.11, vol: 0.5 });
    this.tone(o.node, o.t, { type: 'sawtooth', f0: base * 1.5, f1: base * 0.3, dur: 0.08, vol: 0.25 });
    o.done(0.15);
  }

  torpedoLaunch(gain, pan, when) {
    const o = this.out(gain * 0.75, pan, when); if (!o) return;
    this.tone(o.node, o.t, { f0: 210, f1: 55, dur: 0.35, vol: 0.9 });
    this.noiseBurst(o.node, o.t, { dur: 0.45, vol: 0.4, type: 'bandpass', f0: 600, f1: 2400, q: 1.2, attack: 0.03 });
    o.done(0.5);
  }

  torpedoBlast(gain, pan, when) {
    const o = this.out(gain * 1.0, pan, when); if (!o) return;
    this.noiseBurst(o.node, o.t, { dur: 0.9, vol: 1, f0: 3000, f1: 150, attack: 0.004 });
    this.tone(o.node, o.t, { f0: 120, f1: 35, dur: 0.6, vol: 0.9 });
    o.done(1);
  }

  shipExplosion(gain, pan, when) {
    const o = this.out(gain * 1.1, pan, when); if (!o) return;
    this.noiseBurst(o.node, o.t, { dur: 1.5, vol: 1, f0: 4000, f1: 90, attack: 0.003 });
    this.noiseBurst(o.node, o.t + 0.12, { dur: 0.9, vol: 0.5, type: 'bandpass', f0: 900, f1: 200, q: 2 });
    this.tone(o.node, o.t, { f0: 90, f1: 28, dur: 1.1, vol: 1 });
    o.done(1.6);
  }

  hit(gain, pan, when, big) {
    const o = this.out(gain * (big ? 0.55 : 0.35), pan, when); if (!o) return;
    this.noiseBurst(o.node, o.t, { dur: big ? 0.16 : 0.07, vol: 1, type: 'highpass', f0: big ? 900 : 2200, attack: 0.002 });
    if (big) this.tone(o.node, o.t, { type: 'triangle', f0: 260, f1: 90, dur: 0.15, vol: 0.6 });
    o.done(0.2);
  }

  rockBreak(gain, pan, when, r) {
    const o = this.out(gain * 0.6, pan, when); if (!o) return;
    const big = r > 40;
    this.noiseBurst(o.node, o.t, { dur: big ? 0.5 : 0.28, vol: 1, f0: big ? 900 : 1600, f1: 120, attack: 0.003 });
    this.tone(o.node, o.t, { type: 'triangle', f0: big ? 110 : 180, f1: 50, dur: 0.3, vol: 0.5 });
    o.done(0.55);
  }

  fizzle(gain, pan, when) {
    const o = this.out(gain * 0.3, pan, when); if (!o) return;
    this.noiseBurst(o.node, o.t, { dur: 0.25, vol: 0.8, type: 'bandpass', f0: 3000, f1: 400, q: 3 });
    o.done(0.3);
  }

  pickup(own) {
    const o = this.out(own ? 0.5 : 0.18, 0); if (!o) return;
    [660, 880, 1320].forEach((f, i) => this.tone(o.node, o.t + i * 0.06, { type: 'triangle', f0: f, dur: 0.18, vol: 0.7 }));
    o.done(0.4);
  }

  spawn(gain, pan, when) {
    const o = this.out(gain * 0.4, pan, when); if (!o) return;
    this.tone(o.node, o.t, { f0: 180, f1: 900, dur: 0.45, vol: 0.6, attack: 0.08 });
    this.tone(o.node, o.t, { type: 'triangle', f0: 270, f1: 1350, dur: 0.45, vol: 0.25, attack: 0.08 });
    o.done(0.5);
  }

  cloak(gain, pan, when, on) {
    const o = this.out(gain * 0.5, pan, when); if (!o) return;
    this.noiseBurst(o.node, o.t, { dur: 0.5, vol: 0.8, type: 'bandpass', f0: on ? 3500 : 300, f1: on ? 300 : 3500, q: 4, attack: 0.05 });
    this.tone(o.node, o.t, { f0: on ? 700 : 200, f1: on ? 200 : 700, dur: 0.45, vol: 0.3, attack: 0.05 });
    o.done(0.55);
  }

  itemSpawn(gain, pan, when) {
    const o = this.out(gain * 0.22, pan, when); if (!o) return;
    this.tone(o.node, o.t, { type: 'sine', f0: 1760, dur: 0.5, vol: 0.5, attack: 0.01 });
    this.tone(o.node, o.t + 0.08, { type: 'sine', f0: 2640, dur: 0.4, vol: 0.3 });
    o.done(0.6);
  }

  killConfirm() {
    const o = this.out(0.45, 0); if (!o) return;
    this.tone(o.node, o.t, { type: 'square', f0: 880, dur: 0.09, vol: 0.4 });
    this.tone(o.node, o.t + 0.09, { type: 'square', f0: 1320, dur: 0.16, vol: 0.4 });
    o.done(0.3);
  }

  death() {
    const o = this.out(0.5, 0); if (!o) return;
    this.tone(o.node, o.t, { type: 'sawtooth', f0: 440, f1: 70, dur: 0.9, vol: 0.4, curve: 'lin' });
    o.done(1);
  }

  matchStart() {
    const o = this.out(0.45, 0); if (!o) return;
    [523, 659, 784, 1047].forEach((f, i) => this.tone(o.node, o.t + i * 0.1, { type: 'triangle', f0: f, dur: 0.3, vol: 0.6 }));
    o.done(0.7);
  }

  matchEnd() {
    const o = this.out(0.45, 0); if (!o) return;
    [392, 494, 587].forEach((f) => this.tone(o.node, o.t, { type: 'triangle', f0: f, dur: 1.2, vol: 0.4, attack: 0.02 }));
    o.done(1.3);
  }

  /** Short warning beep, repeated by update() while a torpedo is locked on. */
  lockBeep() {
    const o = this.out(0.3, 0); if (!o) return;
    this.tone(o.node, o.t, { type: 'square', f0: 1250, dur: 0.07, vol: 0.4 });
    o.done(0.1);
  }

  // ------------------------------------------------------------- event routing
  /**
   * Play sounds for a snapshot's events.
   * @param ships ships from the newest snapshot (for looking up emitter positions)
   * @param lastPos Map id -> {x, y} of last known ship positions
   */
  handleEvents(events, { selfId, cam, screenW, ships, lastPos, delay }) {
    if (!this.ready) return;
    const posOf = (id) => ships.find((s) => s.id === id && !s.dead) || lastPos.get(id);
    for (const ev of events) {
      const own = ev.id === selfId;
      const when = own ? 0 : delay;
      const at = (x, y) => this.place(x, y, cam, screenW);
      switch (ev.type) {
        case 'laser': case 'torpedo': {
          const p = posOf(ev.id); if (!p) break;
          const { gain, pan } = own ? { gain: 1, pan: 0 } : at(p.x, p.y);
          if (ev.type === 'laser') this.laser(gain, pan, when, own); else this.torpedoLaunch(gain, pan, when);
          break;
        }
        case 'explosion': {
          const { gain, pan } = at(ev.x, ev.y);
          if (ev.ship) this.shipExplosion(gain, pan, delay); else this.torpedoBlast(gain, pan, delay);
          break;
        }
        case 'hit': { const { gain, pan } = at(ev.x, ev.y); this.hit(gain, pan, delay, ev.big); break; }
        case 'rockBreak': { const { gain, pan } = at(ev.x, ev.y); this.rockBreak(gain, pan, delay, ev.r); break; }
        case 'fizzle': { const { gain, pan } = at(ev.x, ev.y); this.fizzle(gain, pan, delay); break; }
        case 'itemSpawn': { const { gain, pan } = at(ev.x, ev.y); this.itemSpawn(gain, pan, delay); break; }
        case 'spawn': { const { gain, pan } = own ? { gain: 1, pan: 0 } : at(ev.x, ev.y); this.spawn(gain, pan, when); break; }
        case 'cloak': {
          const p = posOf(ev.id); if (!p) break;
          const { gain, pan } = own ? { gain: 1, pan: 0 } : at(p.x, p.y);
          this.cloak(gain, pan, when, ev.on);
          break;
        }
        case 'pickup': if (own) this.pickup(true); else { const { gain } = at(ev.x, ev.y); if (gain > 0.3) this.pickup(false); } break;
        case 'kill':
          if (ev.victim?.id === selfId) this.death();
          else if (ev.killer?.id === selfId) this.killConfirm();
          break;
        case 'matchStart': this.matchStart(); break;
        case 'matchEnd': this.matchEnd(); break;
        default: break;
      }
    }
  }

  /**
   * Per-frame update for continuous sounds: our engine and the missile-lock warning.
   * @param thrust 0 none, 1 forward, 2 brake
   */
  update(thrust, lockedOn, active) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (!this.engine && this.noise) {
      // Looping filtered noise plus a low hum, faded in and out with the thrust key.
      const src = this.ctx.createBufferSource();
      src.buffer = this.noise; src.loop = true;
      const filt = this.ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 500; filt.Q.value = 1.5;
      const hum = this.ctx.createOscillator(); hum.type = 'sawtooth'; hum.frequency.value = 55;
      const humGain = this.ctx.createGain(); humGain.gain.value = 0.12;
      const humFilt = this.ctx.createBiquadFilter(); humFilt.type = 'lowpass'; humFilt.frequency.value = 220;
      const g = this.ctx.createGain(); g.gain.value = 0;
      src.connect(filt).connect(g);
      hum.connect(humFilt).connect(humGain).connect(g);
      g.connect(this.master);
      src.start(); hum.start();
      this.engine = { gain: g, filt, hum };
    }
    if (this.engine) {
      const on = active && thrust > 0;
      const level = !on ? 0 : thrust === 1 ? 0.3 : 0.14;
      this.engine.gain.gain.setTargetAtTime(level, now, on ? 0.04 : 0.12);
      this.engine.filt.frequency.setTargetAtTime(thrust === 1 ? 650 : 380, now, 0.1);
      this.engine.hum.frequency.setTargetAtTime(thrust === 1 ? 62 : 48, now, 0.2);
    }
    if (active && lockedOn && now >= this.lockBeepAt) {
      this.lockBeep();
      this.lockBeepAt = now + 0.22;
    }
  }
}
