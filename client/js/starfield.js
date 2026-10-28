// Parallax starfield + nebulae, tiled so it works with a wrapping world.

const TILE = 1024;

function mulberry(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Starfield {
  constructor() {
    this.layers = [
      { parallax: 0.15, count: 140, size: [0.6, 1.2], alpha: 0.5 },
      { parallax: 0.35, count: 90, size: [0.9, 1.8], alpha: 0.75 },
      { parallax: 0.65, count: 45, size: [1.2, 2.6], alpha: 1.0 },
      { parallax: 1.0, count: 18, size: [0.5, 0.9], alpha: 0.35 },
    ];
    this.tiles = this.layers.map((layer, i) => this.makeTile(layer, i + 1));
    this.nebulae = [];
    const rnd = mulberry(99);
    const palette = ['rgba(90,60,200,', 'rgba(40,140,220,', 'rgba(200,60,140,', 'rgba(50,200,170,'];
    for (let i = 0; i < 10; i++) {
      this.nebulae.push({ x: rnd() * 4200, y: rnd() * 3000, r: 380 + rnd() * 500, color: palette[i % palette.length], a: 0.11 + rnd() * 0.08 });
    }
  }

  makeTile(layer, seed) {
    const c = document.createElement('canvas');
    c.width = TILE; c.height = TILE;
    const ctx = c.getContext('2d');
    const rnd = mulberry(seed * 7919);
    for (let i = 0; i < layer.count; i++) {
      const x = rnd() * TILE, y = rnd() * TILE;
      const s = layer.size[0] + rnd() * (layer.size[1] - layer.size[0]);
      const hue = rnd();
      const col = hue < 0.15 ? '255,220,200' : hue < 0.3 ? '200,220,255' : '255,255,255';
      ctx.fillStyle = `rgba(${col},${layer.alpha * (0.6 + rnd() * 0.4)})`;
      ctx.beginPath(); ctx.arc(x, y, s, 0, Math.PI * 2); ctx.fill();
      if (s > 2) {
        ctx.fillStyle = `rgba(${col},0.25)`;
        ctx.beginPath(); ctx.arc(x, y, s * 2.2, 0, Math.PI * 2); ctx.fill();
      }
    }
    return c;
  }

  draw(ctx, cam, w, h, world) {
    // Nebulae (world-anchored, strong parallax)
    for (const n of this.nebulae) {
      const p = 0.3;
      let dx = n.x - cam.x * p, dy = n.y - cam.y * p;
      const W = world.width, H = world.height;
      dx = ((dx % W) + W) % W; dy = ((dy % H) + H) % H;
      // Draw in the copy nearest the screen centre
      const sx = ((dx + W / 2) % W) - W / 2 + w / 2;
      const sy = ((dy + H / 2) % H) - H / 2 + h / 2;
      if (sx < -n.r || sx > w + n.r || sy < -n.r || sy > h + n.r) continue;
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, n.r);
      g.addColorStop(0, n.color + n.a * 1.6 + ')');
      g.addColorStop(0.5, n.color + n.a + ')');
      g.addColorStop(1, n.color + '0)');
      ctx.fillStyle = g;
      ctx.fillRect(sx - n.r, sy - n.r, n.r * 2, n.r * 2);
    }
    // Star layers
    for (let i = 0; i < this.layers.length; i++) {
      const p = this.layers[i].parallax;
      const ox = -((cam.x * p) % TILE), oy = -((cam.y * p) % TILE);
      const tile = this.tiles[i];
      for (let x = ox - TILE; x < w + TILE; x += TILE) {
        for (let y = oy - TILE; y < h + TILE; y += TILE) {
          ctx.drawImage(tile, x, y);
        }
      }
    }
  }
}
