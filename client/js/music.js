// Procedural background music (Web Audio API, no audio files).
//
// A small step sequencer plays a looping synthwave track in A minor. Notes are scheduled a
// little ahead of time on the audio clock (a timer wakes every 25 ms and queues anything due in
// the next 120 ms), so timing stays tight even when the main thread is busy rendering.
//
// Intensity follows the game:
//   0 hangar / results: warm pad and a slow, sparse arpeggio
//   1 in a match:       adds bass, drums, a 16th-note arpeggio with echo and a lead melody
//   2 final 30 seconds: four-on-the-floor kick, faster hats, brighter filter
// Layers crossfade, so changes in intensity never cut in abruptly.

const BPM = 112;
const STEP = 60 / BPM / 4; // one 16th note, in seconds
const LOOKAHEAD = 0.12;

// Chord progressions (4 bars each): root as MIDI note, minor or major triad.
const PROGRESSIONS = [
  [[45, 'm'], [41, 'M'], [48, 'M'], [43, 'M']], // Am  F  C  G
  [[45, 'm'], [40, 'm'], [41, 'M'], [43, 'M']], // Am  Em F  G
  [[38, 'm'], [45, 'm'], [41, 'M'], [40, 'M']], // Dm  Am F  E
  [[41, 'M'], [43, 'M'], [45, 'm'], [45, 'm']], // F   G  Am Am
];
// Arpeggio shapes: indices into [root, 3rd, 5th, root+12, 3rd+12, 5th+12].
const ARPS = [
  [0, 1, 2, 3, 2, 1, 0, 1, 0, 1, 2, 3, 4, 3, 2, 1],
  [0, 2, 3, 2, 0, 2, 4, 2, 0, 2, 3, 5, 3, 2, 1, 2],
  [3, 2, 1, 0, 1, 2, 3, 4, 5, 4, 3, 2, 1, 2, 3, 2],
  [0, 0, 2, 3, 0, 0, 2, 4, 0, 0, 2, 3, 5, 4, 3, 2],
];
const PENTATONIC = [57, 60, 62, 64, 67, 69, 72, 74, 76]; // A minor pentatonic for the lead

const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
const triad = (root, q) => [root, root + (q === 'm' ? 3 : 4), root + 7];

export class Music {
  constructor(sound) {
    this.sound = sound;
    this.intensity = 0;
    this.started = false;
    this.timer = null;
    sound.onUnlock = () => this.start();
    document.addEventListener('visibilitychange', () => this.onVisibility());
  }

  get ctx() { return this.sound.ctx; }

  start() {
    if (this.started || !this.ctx) return;
    this.started = true;
    const ctx = this.ctx;
    // Per-layer gains so intensity changes can crossfade.
    this.layers = {};
    for (const name of ['pad', 'bass', 'arp', 'drums', 'lead']) {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(this.sound.musicBus);
      this.layers[name] = g;
    }
    // Dotted-eighth echo on the arpeggio and lead, darkened on each repeat.
    this.echo = ctx.createDelay(1);
    this.echo.delayTime.value = STEP * 3;
    const fb = ctx.createGain(); fb.gain.value = 0.35;
    const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 2200;
    const wet = ctx.createGain(); wet.gain.value = 0.45;
    this.echo.connect(tone).connect(fb).connect(this.echo);
    tone.connect(wet).connect(this.sound.musicBus);
    // A gentle filter on the pad and arp that opens up with intensity.
    this.brightness = ctx.createBiquadFilter();
    this.brightness.type = 'lowpass'; this.brightness.frequency.value = 1400; this.brightness.Q.value = 0.8;
    this.brightness.connect(this.layers.arp);

    this.step = 0;
    this.bar = 0;
    this.progression = PROGRESSIONS[0];
    this.arp = ARPS[0];
    this.nextTime = ctx.currentTime + 0.1;
    this.applyIntensity(true);
    this.timer = setInterval(() => this.schedule(), 25);
  }

  /** 0 = hangar/results, 1 = match, 2 = final stretch. */
  setIntensity(level) {
    if (level === this.intensity) return;
    this.intensity = level;
    if (this.started) this.applyIntensity(false);
  }

  applyIntensity(immediate) {
    const t = this.ctx.currentTime;
    const fade = immediate ? 0.01 : 1.5;
    const L = this.intensity;
    const target = { pad: L === 0 ? 0.8 : 0.4, bass: L >= 1 ? 0.55 : 0, arp: L === 0 ? 0.32 : 0.3, drums: L >= 1 ? 0.6 : 0, lead: L >= 1 ? 0.28 : 0 };
    for (const [name, v] of Object.entries(target)) this.layers[name].gain.setTargetAtTime(v, t, fade / 3);
    this.brightness.frequency.setTargetAtTime(L === 0 ? 1100 : L === 1 ? 2000 : 3600, t, fade / 3);
  }

  onVisibility() {
    if (!this.started) return;
    // Background tabs throttle timers, which would garble the sequence: pause and resume cleanly.
    if (document.hidden) { clearInterval(this.timer); this.timer = null; }
    else if (!this.timer) { this.nextTime = this.ctx.currentTime + 0.1; this.timer = setInterval(() => this.schedule(), 25); }
  }

  schedule() {
    const ctx = this.ctx;
    if (ctx.state !== 'running') return;
    // If we fell badly behind (e.g. a long stall), skip ahead rather than playing a burst.
    if (this.nextTime < ctx.currentTime - 0.2) this.nextTime = ctx.currentTime + 0.05;
    while (this.nextTime < ctx.currentTime + LOOKAHEAD) {
      this.playStep(this.step, this.nextTime);
      this.nextTime += STEP;
      this.step = (this.step + 1) % 16;
      if (this.step === 0) this.nextBar();
    }
  }

  nextBar() {
    this.bar++;
    if (this.bar % 4 === 0) {
      // Every 4 bars pick a new progression and arpeggio shape, so the loop keeps evolving.
      this.progression = PROGRESSIONS[Math.floor(Math.random() * PROGRESSIONS.length)];
      this.arp = ARPS[Math.floor(Math.random() * ARPS.length)];
    }
    // The lead plays in alternating 8-bar phrases, leaving room to breathe.
    if (this.bar % 8 === 0) this.leadOn = !this.leadOn;
  }

  playStep(step, t) {
    const [root, q] = this.progression[this.bar % 4];
    const chord = triad(root, q);
    const tones = [...chord, ...chord.map((n) => n + 12)].map((n) => n + 12); // arp register
    const L = this.intensity;

    if (step === 0) this.pad(chord.map((n) => n + 12), t, STEP * 16);

    // Arpeggio: 16ths in a match, 8ths in the hangar.
    if (L >= 1 || step % 2 === 0) {
      const n = tones[this.arp[step]];
      this.pluck(midiHz(n), t, STEP * (L >= 1 ? 0.9 : 1.8), L >= 1 ? 0.5 : 0.4);
    }

    if (L >= 1) {
      // Bass: driving 8ths on the root, jumping an octave on the off-beats.
      if (step % 2 === 0) this.bass(midiHz(root - 12 + (step % 4 === 2 ? 12 : 0)), t, STEP * 1.8);
      // Drums.
      const fourOnFloor = L >= 2;
      if (step % 8 === 0 || (fourOnFloor && step % 4 === 0) || (!fourOnFloor && step === 10)) this.kick(t);
      if (step === 4 || step === 12) this.snare(t);
      if (fourOnFloor ? true : step % 2 === 0) this.hat(t, step % 4 === 2 ? 0.5 : 0.3);
      // Lead: a random walk on the pentatonic scale, mostly 8ths with some held notes.
      if (this.leadOn && step % 2 === 0 && Math.random() < 0.7) {
        this.leadIdx = Math.max(0, Math.min(PENTATONIC.length - 1, (this.leadIdx ?? 4) + Math.floor(Math.random() * 5) - 2));
        const hold = Math.random() < 0.25 ? 4 : 2;
        this.lead(midiHz(PENTATONIC[this.leadIdx]), t, STEP * hold);
      }
    }
  }

  // ---------------------------------------------------------------- instruments
  env(g, t, attack, dur, peak, release = 0.08) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.setValueAtTime(peak, Math.max(t + attack, t + dur - release));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  pad(notes, t, dur) {
    const ctx = this.ctx;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900; f.Q.value = 0.5;
    const g = ctx.createGain();
    this.env(g, t, 0.9, dur + 0.6, 0.12, 0.9);
    f.connect(g).connect(this.layers.pad);
    for (const n of notes) {
      for (const detune of [-7, 7]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth'; o.frequency.value = midiHz(n); o.detune.value = detune;
        o.connect(f); o.start(t); o.stop(t + dur + 0.7);
      }
    }
  }

  pluck(freq, t, dur, vol) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = freq;
    const g = ctx.createGain();
    this.env(g, t, 0.004, dur, vol * 0.25, dur * 0.7);
    o.connect(g); g.connect(this.brightness); g.connect(this.echo);
    o.start(t); o.stop(t + dur + 0.02);
  }

  bass(freq, t, dur) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = freq;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 6;
    f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(160, t + dur);
    const g = ctx.createGain();
    this.env(g, t, 0.005, dur, 0.5, 0.05);
    o.connect(f).connect(g).connect(this.layers.bass);
    o.start(t); o.stop(t + dur + 0.02);
  }

  lead(freq, t, dur) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    this.env(g, t, 0.02, dur, 0.22, dur * 0.4);
    const vib = ctx.createOscillator(); vib.frequency.value = 5.5;
    const vibAmt = ctx.createGain(); vibAmt.gain.value = freq * 0.006;
    vib.connect(vibAmt);
    for (const [type, mul] of [['triangle', 1], ['sawtooth', 2.001]]) {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq * mul;
      vibAmt.connect(o.frequency);
      const og = ctx.createGain(); og.gain.value = mul === 1 ? 1 : 0.12;
      o.connect(og).connect(g);
      o.start(t); o.stop(t + dur + 0.02);
    }
    vib.start(t); vib.stop(t + dur + 0.02);
    g.connect(this.layers.lead); g.connect(this.echo);
  }

  kick(t) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g).connect(this.layers.drums);
    o.start(t); o.stop(t + 0.32);
  }

  noiseHit(t, { type, freq, q = 1, dur, vol }) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this.sound.noise;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.layers.drums);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.02);
  }

  snare(t) {
    this.noiseHit(t, { type: 'bandpass', freq: 1800, q: 0.8, dur: 0.18, vol: 0.45 });
    const o = this.ctx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(140, t + 0.08);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.3, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    o.connect(g).connect(this.layers.drums); o.start(t); o.stop(t + 0.12);
  }

  hat(t, vol) {
    this.noiseHit(t, { type: 'highpass', freq: 7000, dur: 0.05, vol: vol * 0.35 });
  }
}
