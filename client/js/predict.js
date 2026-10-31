// Client-side prediction for the local ship.
//
// The server is authoritative, but waiting for it makes steering feel laggy (input travels
// to the server, then the result waits for the next snapshot). Instead we simulate our own
// ship locally at the server's tick rate using the same movement code (shared/physics.js),
// recording which input was held for every tick. When a snapshot arrives it says which input
// sequence the server is using and for how many ticks it has applied it; we reset to the
// server's exact state and replay the ticks it hasn't simulated yet. Small disagreements
// (collisions, timing) are blended out over a few frames instead of popping.

import { moveShip } from '/shared/physics.js';
import { WORLD } from '/shared/stats.js';

const SNAP_DISTANCE = 120; // px: bigger corrections (respawn, big hit) snap instantly
const SMOOTHING = 14; // per second: how fast a visual correction is blended away
const MAX_HISTORY = 240; // ticks (4 s at 60 Hz)

function wrapDelta(d, size) {
  const half = size / 2;
  if (d > half) return d - size;
  if (d < -half) return d + size;
  return d;
}
function angleDelta(d) {
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export class Predictor {
  constructor() {
    this.step = 1 / 60;
    this.reset();
  }

  setTickHz(hz) { if (hz > 0) this.step = 1 / hz; }

  reset() {
    this.state = null; // {x, y, vx, vy, angle} after the latest local tick
    this.prev = null; // state one tick earlier; drawing blends prev -> state by acc/step
    this.stats = null; // {turnRate, accel, maxSpeed}
    this.history = []; // [{seq, n, input}] one per locally simulated tick; n = tick index within seq
    this.seqTicks = 0; // ticks simulated so far with the current input seq
    this.lastSeq = -1;
    this.acc = 0;
    this.offset = { x: 0, y: 0, a: 0 }; // visual correction still being blended out
    this.input = {};
  }

  /** Run local ticks for this frame. */
  advance(dt, input, seq, frozen) {
    this.input = input;
    if (!this.state) return;
    // Exponentially blend away any visual correction.
    const k = Math.exp(-SMOOTHING * dt);
    this.offset.x *= k; this.offset.y *= k; this.offset.a *= k;
    if (frozen) { this.acc = 0; return; }
    this.acc = Math.min(this.acc + dt, 0.25);
    while (this.acc >= this.step) {
      const tickInput = { ...input };
      if (seq !== this.lastSeq) { this.lastSeq = seq; this.seqTicks = 0; }
      this.history.push({ seq, n: this.seqTicks++, input: tickInput });
      this.prev = { ...this.state };
      moveShip(this.state, tickInput, this.stats, this.step);
      this.acc -= this.step;
    }
    if (this.history.length > MAX_HISTORY) this.history.splice(0, this.history.length - MAX_HISTORY);
  }

  /** Correct the prediction from our ship's entry in a server snapshot. */
  reconcile(ship) {
    if (!ship || ship.dead || !ship.self || ship.self.px === undefined) { this.reset(); return; }
    const s = ship.self;
    const before = this.display();
    this.stats = { turnRate: s.turnRate, accel: s.accel, maxSpeed: s.maxSpeed };
    this.state = { x: s.px, y: s.py, vx: s.pvx, vy: s.pvy, angle: s.pa };

    // Drop ticks the server has already simulated, then replay the rest on top of its state.
    const pending = this.history.filter((h) => h.seq > s.seq || (h.seq === s.seq && h.n >= s.ticks));
    // If nothing is left to replay, estimate the previous tick from velocity and turn input
    // so drawing keeps moving smoothly instead of pausing for a frame.
    const turn = (this.input.right ? 1 : 0) - (this.input.left ? 1 : 0);
    this.prev = {
      ...this.state,
      x: this.state.x - this.state.vx * this.step,
      y: this.state.y - this.state.vy * this.step,
      angle: this.state.angle - turn * this.stats.turnRate * this.step,
    };
    for (const h of pending) {
      this.prev = { ...this.state };
      moveShip(this.state, h.input, this.stats, this.step);
    }
    this.history = pending;

    // Keep drawing where we were and blend toward the corrected position.
    this.offset = { x: 0, y: 0, a: 0 };
    if (!before) return;
    const after = this.display();
    const dx = wrapDelta(before.x - after.x, WORLD.width);
    const dy = wrapDelta(before.y - after.y, WORLD.height);
    if (Math.hypot(dx, dy) > SNAP_DISTANCE) return;
    this.offset = { x: dx, y: dy, a: angleDelta(before.angle - after.angle) };
  }

  /** Where to draw our ship this frame, or null if we have no prediction. */
  display() {
    if (!this.state) return null;
    // Blend between the last two ticks so motion is smooth at any display refresh rate.
    const p = this.prev || this.state, c = this.state;
    const t = Math.min(1, this.acc / this.step);
    return {
      x: p.x + wrapDelta(c.x - p.x, WORLD.width) * t + this.offset.x,
      y: p.y + wrapDelta(c.y - p.y, WORLD.height) * t + this.offset.y,
      angle: p.angle + angleDelta(c.angle - p.angle) * t + this.offset.a,
      vx: c.vx,
      vy: c.vy,
    };
  }
}
