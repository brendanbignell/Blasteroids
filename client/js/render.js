// World renderer: interpolates server snapshots and draws everything on the canvas.

import { WORLD, POWERUP_BY_TYPE } from '/shared/stats.js';
import { drawShip } from './shipart.js';
import { Starfield } from './starfield.js';
import { Particles } from './particles.js';

const INTERP_DELAY = 0.1; // seconds behind the newest snapshot

function wrapDelta(d, size) {
  const half = size / 2;
  if (d > half) return d - size;
  if (d < -half) return d + size;
  return d;
}
function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.starfield = new Starfield();
    this.particles = new Particles();
    this.snapshots = []; // {recv, data}
    this.cam = { x: WORLD.width / 2, y: WORLD.height / 2 };
    this.selfId = null;
    this.hitFlash = new Map(); // shipId -> intensity
    this.rockShapes = new Map();
    this.shake = 0;
    this.time = 0;
    this.lastSelfPos = null;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = window.innerWidth; this.h = window.innerHeight;
    this.canvas.width = this.w * dpr; this.canvas.height = this.h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  pushSnapshot(data) {
    this.snapshots.push({ recv: performance.now() / 1000, data });
    if (this.snapshots.length > 30) this.snapshots.shift();
    for (const ev of data.events || []) this.handleEvent(ev);
  }

  reset() { this.snapshots = []; this.particles.list = []; this.hitFlash.clear(); }

  handleEvent(ev) {
    switch (ev.type) {
      case 'explosion':
        this.particles.explosion(ev.x, ev.y, ev.color, ev.r);
        if (ev.ship || this.distToCam(ev) < 500) this.shake = Math.max(this.shake, ev.ship ? 10 : 5);
        break;
      case 'rockBreak': this.particles.rockBreak(ev.x, ev.y, ev.r); break;
      case 'hit': this.particles.hit(ev.x, ev.y, ev.color, ev.big); break;
      case 'pickup': this.particles.pickup(ev.x, ev.y, ev.color); break;
      case 'fizzle': this.particles.burst(ev.x, ev.y, '#ffffff', { count: 6, speed: 40, size: 1.5, life: 0.4 }); break;
      case 'spawn': this.particles.spawn({ x: ev.x, y: ev.y, vx: 0, vy: 0, color: '#ffffff', shape: 'ring', size: 60, decay: 1.5, grow: -50 }); break;
      default: break;
    }
  }

  distToCam(p) { return Math.hypot(wrapDelta(p.x - this.cam.x, WORLD.width), wrapDelta(p.y - this.cam.y, WORLD.height)); }

  /** Interpolated view of the world at render time. */
  interpolate() {
    const snaps = this.snapshots;
    if (snaps.length === 0) return null;
    const now = performance.now() / 1000 - INTERP_DELAY;
    let a = snaps[0], b = snaps[0];
    for (let i = 0; i < snaps.length; i++) {
      if (snaps[i].recv <= now) a = snaps[i];
      if (snaps[i].recv >= now) { b = snaps[i]; break; }
      b = snaps[i];
    }
    const span = b.recv - a.recv;
    const t = span > 0 ? Math.min(1, Math.max(0, (now - a.recv) / span)) : 1;
    const A = a.data, B = b.data;

    const ships = [];
    const bById = new Map(B.ships.map((s) => [s.id, s]));
    for (const sa of A.ships) {
      const sb = bById.get(sa.id);
      if (sa.dead) { if (sb && sb.dead) ships.push(sb); else if (!sb) ships.push(sa); continue; }
      if (!sb || sb.dead) { if (t < 1) ships.push(sa); continue; }
      ships.push({
        ...sb,
        x: sa.x + wrapDelta(sb.x - sa.x, WORLD.width) * t,
        y: sa.y + wrapDelta(sb.y - sa.y, WORLD.height) * t,
        a: lerpAngle(sa.a, sb.a, t),
        hp: sa.hp + (sb.hp - sa.hp) * t,
      });
    }
    for (const sb of B.ships) if (!A.ships.some((s) => s.id === sb.id)) ships.push(sb);

    const lerpList = (la, lb) => {
      const map = new Map(la.map((e) => [e[0], e]));
      return lb.map((e) => {
        const p = map.get(e[0]);
        if (!p) return e;
        const out = e.slice();
        out[1] = p[1] + wrapDelta(e[1] - p[1], WORLD.width) * t;
        out[2] = p[2] + wrapDelta(e[2] - p[2], WORLD.height) * t;
        return out;
      });
    };
    const lerpRocks = (la, lb) => {
      const map = new Map(la.map((e) => [e[0], e]));
      return lb.map((e) => {
        const p = map.get(e[0]);
        if (!p) return e;
        const out = e.slice();
        out[1] = p[1] + wrapDelta(e[1] - p[1], WORLD.width) * t;
        out[2] = p[2] + wrapDelta(e[2] - p[2], WORLD.height) * t;
        out[4] = lerpAngle(p[4], e[4], t);
        return out;
      });
    };
    return {
      ships,
      lasers: lerpList(A.lasers, B.lasers),
      torps: lerpList(A.torps, B.torps),
      items: B.items,
      rocks: lerpRocks(A.rocks, B.rocks),
      players: B.players,
      match: B.match,
      latest: B,
    };
  }

  toScreen(x, y) {
    const sx = wrapDelta(x - this.cam.x, WORLD.width) + this.w / 2;
    const sy = wrapDelta(y - this.cam.y, WORLD.height) + this.h / 2;
    if (sx < -200 || sx > this.w + 200 || sy < -200 || sy > this.h + 200) return null;
    return { x: sx, y: sy };
  }

  rockShape(id, seed, r) {
    let s = this.rockShapes.get(id);
    if (s) return s;
    let x = seed;
    const rnd = () => { x = (x * 1103515245 + 12345) & 0x7fffffff; return x / 0x7fffffff; };
    const n = 9 + Math.floor(rnd() * 5);
    const pts = [];
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2;
      const rad = r * (0.72 + rnd() * 0.33);
      pts.push([Math.cos(ang) * rad, Math.sin(ang) * rad]);
    }
    const craters = [];
    for (let i = 0; i < 2 + Math.floor(rnd() * 3); i++) {
      craters.push([(rnd() - 0.5) * r, (rnd() - 0.5) * r, r * (0.1 + rnd() * 0.15)]);
    }
    s = { pts, craters };
    this.rockShapes.set(id, s);
    if (this.rockShapes.size > 300) this.rockShapes.delete(this.rockShapes.keys().next().value);
    return s;
  }

  frame(dt) {
    this.time += dt;
    const ctx = this.ctx;
    const view = this.interpolate();
    const w = this.w, h = this.h;

    // Camera follows self (or the last known position while dead).
    if (view) {
      const me = view.ships.find((s) => s.id === this.selfId);
      if (me && !me.dead) {
        this.lastSelfPos = { x: me.x, y: me.y };
        const lead = 0.12;
        const tx = me.x + (me.vx || 0) * lead, ty = me.y + (me.vy || 0) * lead;
        this.cam.x += wrapDelta(tx - this.cam.x, WORLD.width) * Math.min(1, dt * 6);
        this.cam.y += wrapDelta(ty - this.cam.y, WORLD.height) * Math.min(1, dt * 6);
      }
      this.cam.x = ((this.cam.x % WORLD.width) + WORLD.width) % WORLD.width;
      this.cam.y = ((this.cam.y % WORLD.height) + WORLD.height) % WORLD.height;
    }

    // Shake
    this.shake = Math.max(0, this.shake - dt * 30);
    const shx = (Math.random() - 0.5) * this.shake, shy = (Math.random() - 0.5) * this.shake;

    ctx.save();
    ctx.fillStyle = '#04060d';
    ctx.fillRect(0, 0, w, h);
    ctx.translate(shx, shy);
    this.starfield.draw(ctx, this.cam, w, h, WORLD);

    this.particles.update(dt);
    for (const [id, v] of this.hitFlash) { const nv = v - dt * 4; if (nv <= 0) this.hitFlash.delete(id); else this.hitFlash.set(id, nv); }

    if (view) {
      this.drawItems(ctx, view.items);
      this.drawRocks(ctx, view.rocks);
      this.particles.draw(ctx, (x, y) => this.toScreen(x, y));
      this.drawProjectiles(ctx, view);
      this.drawShips(ctx, view);
    }
    ctx.restore();
    return view;
  }

  drawItems(ctx, items) {
    for (const [id, type, x, y] of items) {
      const s = this.toScreen(x, y);
      if (!s) continue;
      const def = POWERUP_BY_TYPE[type];
      if (!def) continue;
      const pulse = 0.8 + 0.2 * Math.sin(this.time * 5 + id);
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(this.time * 1.2);
      ctx.shadowColor = def.color; ctx.shadowBlur = 18 * pulse;
      ctx.strokeStyle = def.color; ctx.lineWidth = 2;
      ctx.fillStyle = 'rgba(8,12,24,0.9)';
      ctx.beginPath();
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; ctx.lineTo(Math.cos(a) * 14 * pulse, Math.sin(a) * 14 * pulse); }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.rotate(-this.time * 1.2);
      ctx.shadowBlur = 0;
      ctx.fillStyle = def.color;
      ctx.font = 'bold 14px system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(def.glyph, 0, 1);
      ctx.restore();
    }
  }

  drawRocks(ctx, rocks) {
    for (const [id, x, y, r, rot, seed] of rocks) {
      const s = this.toScreen(x, y);
      if (!s) continue;
      const shape = this.rockShape(id, seed, r);
      ctx.save();
      ctx.translate(s.x, s.y); ctx.rotate(rot);
      const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
      g.addColorStop(0, '#7a8699'); g.addColorStop(1, '#2a3140');
      ctx.fillStyle = g; ctx.strokeStyle = '#aab6c8'; ctx.lineWidth = 1.5;
      ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 12;
      ctx.beginPath();
      shape.pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
      ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0; ctx.stroke();
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      for (const [cx, cy, cr] of shape.craters) { ctx.beginPath(); ctx.arc(cx, cy, cr, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    }
  }

  drawProjectiles(ctx, view) {
    const colorOf = new Map(view.players.map((p) => [p.id, p.color]));
    ctx.lineCap = 'round';
    for (const [, x, y, a, owner] of view.lasers) {
      const s = this.toScreen(x, y);
      if (!s) continue;
      const color = colorOf.get(owner) || '#fff';
      ctx.save();
      ctx.translate(s.x, s.y); ctx.rotate(a);
      ctx.shadowColor = color; ctx.shadowBlur = 12;
      ctx.strokeStyle = color; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(6, 0); ctx.stroke();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(-8, 0); ctx.lineTo(6, 0); ctx.stroke();
      ctx.restore();
    }
    for (const [id, x, y, a, owner] of view.torps) {
      const s = this.toScreen(x, y);
      if (!s) continue;
      const color = colorOf.get(owner) || '#fff';
      // trail particles
      if (Math.random() < 0.6) this.particles.spawn({ x: x - Math.cos(a) * 8, y: y - Math.sin(a) * 8, vx: -Math.cos(a) * 40 + (Math.random() - 0.5) * 30, vy: -Math.sin(a) * 40 + (Math.random() - 0.5) * 30, color: Math.random() < 0.5 ? '#ffb347' : color, size: 2.5, decay: 2.5 });
      ctx.save();
      ctx.translate(s.x, s.y); ctx.rotate(a);
      ctx.shadowColor = color; ctx.shadowBlur = 20;
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.ellipse(0, 0, 9, 4.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.ellipse(2, 0, 4, 2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  drawShips(ctx, view) {
    const info = new Map(view.players.map((p) => [p.id, p]));
    for (const s of view.ships) {
      if (s.dead) continue;
      const sc = this.toScreen(s.x, s.y);
      if (!sc) continue;
      const p = info.get(s.id) || {};
      const isSelf = s.id === this.selfId;
      const prevHp = this._prevHp?.get(s.id);
      if (prevHp !== undefined && s.hp < prevHp - 0.5) this.hitFlash.set(s.id, 1);
      drawShip(ctx, {
        x: sc.x, y: sc.y, angle: s.a, radius: s.r, color: p.color || '#fff', thrust: s.th,
        alpha: s.ck ? 0.35 : 1, cloaked: !!s.ck, shieldPct: s.sh, invuln: !!s.inv,
        hitFlash: this.hitFlash.get(s.id) || 0, time: this.time,
      });
      // Name + HP bar
      if (!s.ck || isSelf) {
        ctx.save();
        ctx.globalAlpha = s.ck ? 0.5 : 0.9;
        ctx.font = `${isSelf ? 'bold ' : ''}12px system-ui, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.fillStyle = p.color || '#fff';
        ctx.shadowColor = '#000'; ctx.shadowBlur = 4;
        ctx.fillText(p.name || '', sc.x, sc.y - s.r - 14);
        const bw = Math.max(34, s.r * 2.4), bh = 4;
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(sc.x - bw / 2, sc.y - s.r - 12, bw, bh);
        const frac = Math.max(0, s.hp / s.mhp);
        ctx.fillStyle = frac > 0.5 ? '#7dff6a' : frac > 0.25 ? '#ffb347' : '#ff4f4f';
        ctx.fillRect(sc.x - bw / 2, sc.y - s.r - 12, bw * frac, bh);
        ctx.restore();
      }
    }
    this._prevHp = new Map(view.ships.filter((s) => !s.dead).map((s) => [s.id, s.hp]));
  }

  drawMinimap(mctx, view, mw, mh) {
    mctx.clearRect(0, 0, mw, mh);
    const sx = mw / WORLD.width, sy = mh / WORLD.height;
    mctx.fillStyle = 'rgba(255,255,255,0.25)';
    for (const [, x, y, r] of view.rocks) { mctx.beginPath(); mctx.arc(x * sx, y * sy, Math.max(1.5, r * sx), 0, Math.PI * 2); mctx.fill(); }
    for (const [, type, x, y] of view.items) {
      mctx.fillStyle = POWERUP_BY_TYPE[type]?.color || '#fff';
      mctx.fillRect(x * sx - 1.5, y * sy - 1.5, 3, 3);
    }
    const info = new Map(view.players.map((p) => [p.id, p]));
    for (const s of view.ships) {
      if (s.dead) continue;
      const isSelf = s.id === this.selfId;
      mctx.fillStyle = info.get(s.id)?.color || '#fff';
      mctx.shadowColor = mctx.fillStyle; mctx.shadowBlur = isSelf ? 8 : 4;
      mctx.beginPath(); mctx.arc(s.x * sx, s.y * sy, isSelf ? 3.5 : 2.5, 0, Math.PI * 2); mctx.fill();
      mctx.shadowBlur = 0;
    }
    // viewport rectangle
    mctx.strokeStyle = 'rgba(255,255,255,0.35)'; mctx.lineWidth = 1;
    const vw = this.w * sx, vh = this.h * sy;
    let vx = this.cam.x * sx - vw / 2, vy = this.cam.y * sy - vh / 2;
    mctx.strokeRect(vx, vy, vw, vh);
  }
}
