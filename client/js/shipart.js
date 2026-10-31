// Procedural ship drawing shared by the lobby preview and the game renderer.
//
// Every hull is drawn facing +x in units of the ship's collision radius `r`, staying roughly
// inside a 1.2r circle so the art matches the hitbox. Themes are purely cosmetic.

const BOT_EYE = '#ff3b3b';

// Each theme: engines = flame origins [x, y, halfWidth] (in r units), hull = draw function.
const THEMES = {
  arrowhead: {
    engines: [[-0.6, 0, 0.35]],
    hull(ctx, r) {
      ctx.beginPath();
      ctx.moveTo(r * 1.1, 0);
      ctx.lineTo(-r * 0.75, r * 0.8);
      ctx.lineTo(-r * 0.4, r * 0.3);
      ctx.lineTo(-r * 0.65, 0);
      ctx.lineTo(-r * 0.4, -r * 0.3);
      ctx.lineTo(-r * 0.75, -r * 0.8);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      cockpit(ctx, r * 0.25, 0, r * 0.28, r * 0.16);
    },
  },

  explorer: {
    engines: [[-1.0, 0.58, 0.1], [-1.0, -0.58, 0.1]],
    hull(ctx, r, { color, glow }) {
      // Pylons from the engineering hull out to the nacelles.
      ctx.beginPath();
      for (const s of [-1, 1]) { ctx.moveTo(-r * 0.3, 0); ctx.lineTo(-r * 0.65, s * r * 0.58); }
      ctx.stroke();
      // Nacelles.
      for (const s of [-1, 1]) {
        roundRect(ctx, -r * 1.05, s * r * 0.58 - r * 0.09, r * 0.85, r * 0.18, r * 0.09);
        ctx.fill(); ctx.stroke();
        // Glowing intake at the front of each nacelle.
        ctx.save();
        ctx.fillStyle = '#ff7a4a'; ctx.shadowColor = '#ff7a4a'; ctx.shadowBlur = glow ? 10 : 0;
        ctx.beginPath(); ctx.arc(-r * 0.24, s * r * 0.58, r * 0.075, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
      // Engineering hull and neck.
      ctx.beginPath(); ctx.ellipse(-r * 0.35, 0, r * 0.45, r * 0.17, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-r * 0.1, -r * 0.07); ctx.lineTo(r * 0.2, -r * 0.07); ctx.lineTo(r * 0.2, r * 0.07); ctx.lineTo(-r * 0.1, r * 0.07); ctx.closePath(); ctx.fill(); ctx.stroke();
      // Saucer section with a ring of detail and the bridge dome.
      ctx.beginPath(); ctx.arc(r * 0.5, 0, r * 0.58, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.save();
      ctx.globalAlpha *= 0.45; ctx.lineWidth *= 0.5; ctx.strokeStyle = color;
      ctx.beginPath(); ctx.arc(r * 0.5, 0, r * 0.38, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
      cockpit(ctx, r * 0.5, 0, r * 0.13, r * 0.13);
    },
  },

  xfighter: {
    engines: [[-0.82, 0.14, 0.08], [-0.82, -0.14, 0.08], [-0.78, 0.3, 0.08], [-0.78, -0.3, 0.08]],
    hull(ctx, r, { color }) {
      // Four wings, slightly offset so the X shape reads from above.
      for (const [tipX, tipY, rootX] of [[-0.45, 1.0, -0.1], [-0.65, 0.82, -0.3]]) {
        for (const s of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(r * rootX, s * r * 0.12);
          ctx.lineTo(r * tipX, s * r * tipY);
          ctx.lineTo(r * (tipX - 0.2), s * r * tipY);
          ctx.lineTo(r * (rootX - 0.45), s * r * 0.12);
          ctx.closePath(); ctx.fill(); ctx.stroke();
          // Wingtip cannon.
          ctx.beginPath(); ctx.moveTo(r * (tipX - 0.1), s * r * tipY); ctx.lineTo(r * (tipX + 0.55), s * r * tipY); ctx.stroke();
        }
      }
      // Engine pods.
      for (const s of [-1, 1]) {
        roundRect(ctx, -r * 0.8, s * r * 0.22 - r * 0.13, r * 0.45, r * 0.26, r * 0.08);
        ctx.fill(); ctx.stroke();
      }
      // Long fuselage tapering to the nose.
      ctx.beginPath();
      ctx.moveTo(r * 1.2, 0);
      ctx.lineTo(r * 0.2, r * 0.13);
      ctx.lineTo(-r * 0.8, r * 0.13);
      ctx.lineTo(-r * 0.8, -r * 0.13);
      ctx.lineTo(r * 0.2, -r * 0.13);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.save(); ctx.strokeStyle = color; ctx.globalAlpha *= 0.5; ctx.lineWidth *= 0.5;
      ctx.beginPath(); ctx.moveTo(r * 0.75, 0); ctx.lineTo(r * 0.45, 0); ctx.stroke(); ctx.restore();
      cockpit(ctx, r * 0.05, 0, r * 0.2, r * 0.09);
    },
  },

  interceptor: {
    engines: [[-0.4, 0.09, 0.08], [-0.4, -0.09, 0.08]],
    hull(ctx, r, { color }) {
      // Struts to the side panels.
      ctx.beginPath(); ctx.moveTo(0, -r * 0.8); ctx.lineTo(0, r * 0.8); ctx.stroke();
      // Hexagonal solar panels with ribs.
      for (const s of [-1, 1]) {
        const cy = s * r * 0.92;
        const hx = r * 0.62, hy = r * 0.2;
        ctx.beginPath();
        ctx.moveTo(hx, cy); ctx.lineTo(hx * 0.5, cy + hy); ctx.lineTo(-hx * 0.5, cy + hy);
        ctx.lineTo(-hx, cy); ctx.lineTo(-hx * 0.5, cy - hy); ctx.lineTo(hx * 0.5, cy - hy);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.save(); ctx.strokeStyle = color; ctx.globalAlpha *= 0.45; ctx.lineWidth *= 0.5;
        ctx.beginPath();
        for (const fx of [-0.5, 0, 0.5]) { ctx.moveTo(hx * fx, cy - hy); ctx.lineTo(hx * fx, cy + hy); }
        ctx.moveTo(-hx, cy); ctx.lineTo(hx, cy);
        ctx.stroke(); ctx.restore();
      }
      // Ball cockpit with a segmented front window.
      ctx.beginPath(); ctx.arc(0, 0, r * 0.4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.save(); ctx.strokeStyle = color; ctx.lineWidth *= 0.6;
      ctx.beginPath(); ctx.arc(r * 0.12, 0, r * 0.2, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath();
      for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + Math.PI / 4; ctx.moveTo(r * 0.12, 0); ctx.lineTo(r * 0.12 + Math.cos(a) * r * 0.2, Math.sin(a) * r * 0.2); }
      ctx.stroke(); ctx.restore();
    },
  },

  wedge: {
    engines: [[-0.85, 0, 0.14], [-0.85, 0.36, 0.11], [-0.85, -0.36, 0.11]],
    hull(ctx, r, { color }) {
      ctx.beginPath();
      ctx.moveTo(r * 1.25, 0);
      ctx.lineTo(-r * 0.85, r * 0.72);
      ctx.lineTo(-r * 0.78, 0);
      ctx.lineTo(-r * 0.85, -r * 0.72);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // Centre ridge and panel lines.
      ctx.save(); ctx.strokeStyle = color; ctx.globalAlpha *= 0.45; ctx.lineWidth *= 0.5;
      ctx.beginPath();
      ctx.moveTo(r * 1.1, 0); ctx.lineTo(-r * 0.75, 0);
      for (const f of [0.35, 0.65]) {
        const x = r * (1.25 - f * 2.1);
        const half = r * 0.72 * f;
        ctx.moveTo(x, -half); ctx.lineTo(x, half);
      }
      ctx.stroke(); ctx.restore();
      // Command tower with the crossbar bridge.
      ctx.beginPath(); ctx.rect(-r * 0.7, -r * 0.1, r * 0.35, r * 0.2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.rect(-r * 0.66, -r * 0.3, r * 0.1, r * 0.6); ctx.fill(); ctx.stroke();
      ctx.save(); ctx.fillStyle = 'rgba(255,255,255,0.85)';
      for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(-r * 0.61, s * r * 0.3, r * 0.06, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    },
  },

  saucer: {
    engines: [[-0.85, 0, 0.22]],
    hull(ctx, r, { color, time, glow }) {
      ctx.beginPath(); ctx.arc(0, 0, r * 0.95, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.save(); ctx.strokeStyle = color; ctx.globalAlpha *= 0.4; ctx.lineWidth *= 0.5;
      ctx.beginPath(); ctx.arc(0, 0, r * 0.68, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
      // Chasing rim lights.
      ctx.save();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const on = (Math.floor(time * 8) + i) % 3 === 0;
        ctx.fillStyle = on ? '#fff6a8' : color;
        ctx.globalAlpha *= on ? 1 : 0.5;
        ctx.shadowColor = '#fff6a8'; ctx.shadowBlur = on && glow ? 8 : 0;
        ctx.beginPath(); ctx.arc(Math.cos(a) * r * 0.82, Math.sin(a) * r * 0.82, r * 0.07, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha /= on ? 1 : 0.5;
      }
      ctx.restore();
      // Glowing dome, with a light marking the front.
      ctx.save();
      const dome = ctx.createRadialGradient(-r * 0.1, -r * 0.1, r * 0.05, 0, 0, r * 0.42);
      dome.addColorStop(0, 'rgba(255,255,255,0.95)');
      dome.addColorStop(1, color);
      ctx.fillStyle = dome; ctx.shadowColor = color; ctx.shadowBlur = glow ? 14 : 0;
      ctx.beginPath(); ctx.arc(0, 0, r * 0.38, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(r * 0.82, 0, r * 0.1, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    },
  },

  retro: {
    engines: [[-0.5, 0, 0.22]],
    flat: true, // vector outline, no fill or heavy glow
    hull(ctx, r) {
      ctx.beginPath();
      ctx.moveTo(r * 1.1, 0);
      ctx.lineTo(-r * 0.8, r * 0.68);
      ctx.lineTo(-r * 0.5, 0);
      ctx.lineTo(-r * 0.8, -r * 0.68);
      ctx.closePath();
      ctx.stroke();
    },
  },

  // Bots only: an angular drone with forward mandibles and a red scanning eye.
  drone: {
    engines: [[-0.72, 0.26, 0.12], [-0.72, -0.26, 0.12]],
    hull(ctx, r, { time, glow }) {
      // Mandibles.
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(r * 0.35, s * r * 0.2);
        ctx.lineTo(r * 1.1, s * r * 0.28);
        ctx.lineTo(r * 0.95, s * r * 0.42);
        ctx.lineTo(r * 0.3, s * r * 0.5);
        ctx.closePath(); ctx.fill(); ctx.stroke();
      }
      // Side fins.
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(-r * 0.2, s * r * 0.55);
        ctx.lineTo(-r * 0.55, s * r * 1.0);
        ctx.lineTo(-r * 0.7, s * r * 0.5);
        ctx.closePath(); ctx.fill(); ctx.stroke();
      }
      // Octagonal core.
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
        ctx.lineTo(Math.cos(a) * r * 0.72, Math.sin(a) * r * 0.62);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // Scanning eye: sweeps side to side.
      const sweep = Math.sin(time * 3) * r * 0.16;
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      roundRect(ctx, r * 0.12, -r * 0.3, r * 0.3, r * 0.6, r * 0.12); ctx.fill();
      ctx.fillStyle = BOT_EYE; ctx.shadowColor = BOT_EYE; ctx.shadowBlur = glow ? 12 : 0;
      ctx.beginPath(); ctx.arc(r * 0.27, sweep, r * 0.11, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    },
  },
};

function cockpit(ctx, x, y, rx, ry) {
  ctx.save();
  ctx.shadowBlur = 0;
  ctx.fillStyle = ctx._cloaked ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.85)';
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, rad) {
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function drawFlames(ctx, theme, r, color) {
  for (const [ex, ey, ew] of theme.engines) {
    const flick = 0.8 + Math.random() * 0.5;
    const len = r * (0.8 + flick) * Math.max(0.5, ew / 0.35);
    const x0 = r * ex, y0 = r * ey, w = r * ew;
    const grad = ctx.createLinearGradient(x0, 0, x0 - len, 0);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(0.3, color);
    grad.addColorStop(1, 'rgba(255,120,40,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(x0, y0 - w);
    ctx.lineTo(x0 - len, y0);
    ctx.lineTo(x0, y0 + w);
    ctx.closePath();
    ctx.fill();
  }
}

export function drawShip(ctx, { x, y, angle, radius, color, theme = 'arrowhead', thrust = 0, alpha = 1, cloaked = false, shieldPct = 0, invuln = false, hitFlash = 0, time = 0 }) {
  const t = THEMES[theme] || THEMES.arrowhead;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.globalAlpha = alpha;
  const r = radius;

  // Engine flames / braking jets
  if (thrust === 1) {
    drawFlames(ctx, t, r, color);
  } else if (thrust === 2) {
    ctx.fillStyle = 'rgba(255,200,120,0.7)';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(r * 0.3, s * r * 0.45);
      ctx.lineTo(r * (0.7 + Math.random() * 0.3), s * r * 0.75);
      ctx.lineTo(r * 0.1, s * r * 0.6);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Hull
  ctx.shadowColor = color;
  ctx.shadowBlur = cloaked ? 4 : t.flat ? 6 : 16;
  ctx.lineWidth = Math.max(1.5, r * (t.flat ? 0.09 : 0.11));
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;
  const hull = ctx.createLinearGradient(-r, 0, r, 0);
  hull.addColorStop(0, 'rgba(10,14,28,0.95)');
  hull.addColorStop(1, 'rgba(40,52,90,0.95)');
  ctx.fillStyle = cloaked ? 'rgba(20,24,40,0.25)' : hull;
  ctx._cloaked = cloaked;
  t.hull(ctx, r, { color, time, glow: !cloaked });
  ctx._cloaked = false;
  ctx.shadowBlur = 0;

  ctx.rotate(-angle);

  // Shield ring
  if (shieldPct > 0 && !cloaked) {
    const a = 0.12 + shieldPct / 100 * 0.3 + hitFlash * 0.6;
    ctx.strokeStyle = `rgba(120,180,255,${a})`;
    ctx.lineWidth = 2 + hitFlash * 3;
    ctx.shadowColor = '#7fb3ff';
    ctx.shadowBlur = 10 + hitFlash * 20;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.45, 0, Math.PI * 2);
    ctx.stroke();
  } else if (hitFlash > 0) {
    ctx.strokeStyle = `rgba(255,255,255,${hitFlash * 0.8})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.35, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Spawn protection
  if (invuln) {
    const pulse = 0.5 + 0.5 * Math.sin(time * 12);
    ctx.strokeStyle = `rgba(255,255,255,${0.3 + pulse * 0.5})`;
    ctx.setLineDash([6, 6]);
    ctx.lineDashOffset = -time * 40;
    ctx.lineWidth = 2;
    ctx.shadowBlur = 8;
    ctx.shadowColor = '#fff';
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}
