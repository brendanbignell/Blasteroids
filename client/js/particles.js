// Lightweight particle system for explosions, sparks, trails and pickups.

export class Particles {
  constructor() { this.list = []; }

  spawn(p) { this.list.push({ life: 1, decay: 1, size: 2, grav: 0, drag: 0.98, shape: 'dot', ...p, age: 0 }); }

  burst(x, y, color, { count = 20, speed = 200, size = 2.5, life = 0.7, spread = Math.PI * 2, dir = 0 } = {}) {
    for (let i = 0; i < count; i++) {
      const a = dir + (Math.random() - 0.5) * spread;
      const s = speed * (0.3 + Math.random() * 0.9);
      this.spawn({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, color, size: size * (0.5 + Math.random()), decay: 1 / (life * (0.6 + Math.random() * 0.8)) });
    }
  }

  explosion(x, y, color, r) {
    this.burst(x, y, '#ffffff', { count: 10, speed: r * 3, size: 3, life: 0.4 });
    this.burst(x, y, color, { count: 36, speed: r * 4, size: 3, life: 0.9 });
    this.burst(x, y, '#ffb347', { count: 20, speed: r * 2, size: 4, life: 0.6, });
    this.spawn({ x, y, vx: 0, vy: 0, color, shape: 'ring', size: r, decay: 1.8, grow: r * 3 });
    this.spawn({ x, y, vx: 0, vy: 0, color: '#ffffff', shape: 'flash', size: r * 1.5, decay: 6 });
  }

  rockBreak(x, y, r) {
    this.burst(x, y, '#b8c2d0', { count: Math.round(r / 2.5), speed: r * 2, size: 2.5, life: 0.8 });
    this.burst(x, y, '#6f7a8c', { count: Math.round(r / 4), speed: r * 1.2, size: 4, life: 1.0 });
  }

  hit(x, y, color, big) {
    this.burst(x, y, color, { count: big ? 14 : 7, speed: big ? 160 : 90, size: 2, life: 0.35 });
  }

  pickup(x, y, color) {
    this.burst(x, y, color, { count: 24, speed: 120, size: 2.5, life: 0.8 });
    this.spawn({ x, y, vx: 0, vy: 0, color, shape: 'ring', size: 10, decay: 2.5, grow: 60 });
  }

  update(dt) {
    const out = [];
    for (const p of this.list) {
      p.age += dt;
      p.life -= p.decay * dt;
      if (p.life <= 0) continue;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= p.drag; p.vy *= p.drag;
      out.push(p);
    }
    this.list = out;
  }

  draw(ctx, toScreen) {
    for (const p of this.list) {
      const s = toScreen(p.x, p.y);
      if (!s) continue;
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
      if (p.shape === 'ring') {
        ctx.strokeStyle = p.color; ctx.lineWidth = 2 + (1 - p.life) * 2;
        ctx.beginPath(); ctx.arc(s.x, s.y, p.size + (1 - p.life) * p.grow, 0, Math.PI * 2); ctx.stroke();
      } else if (p.shape === 'flash') {
        const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, p.size);
        g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g; ctx.fillRect(s.x - p.size, s.y - p.size, p.size * 2, p.size * 2);
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(s.x, s.y, p.size * (0.4 + 0.6 * p.life), 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }
}
