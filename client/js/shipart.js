// Procedural ship drawing shared by the lobby preview and the game renderer.

export function drawShip(ctx, { x, y, angle, radius, color, thrust = 0, alpha = 1, cloaked = false, shieldPct = 0, invuln = false, hitFlash = 0, time = 0 }) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.globalAlpha = alpha;
  const r = radius;

  // Engine flame
  if (thrust === 1) {
    const flick = 0.8 + Math.random() * 0.5;
    const grad = ctx.createLinearGradient(-r * 0.6, 0, -r * (1.4 + flick), 0);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(0.3, color);
    grad.addColorStop(1, 'rgba(255,120,40,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(-r * 0.6, -r * 0.35);
    ctx.lineTo(-r * (1.4 + flick), 0);
    ctx.lineTo(-r * 0.6, r * 0.35);
    ctx.closePath();
    ctx.fill();
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
  ctx.shadowBlur = cloaked ? 4 : 16;
  ctx.lineWidth = Math.max(1.5, r * 0.11);
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;
  const hull = ctx.createLinearGradient(-r, 0, r, 0);
  hull.addColorStop(0, 'rgba(10,14,28,0.95)');
  hull.addColorStop(1, 'rgba(40,52,90,0.95)');
  ctx.fillStyle = cloaked ? 'rgba(20,24,40,0.25)' : hull;

  ctx.beginPath();
  ctx.moveTo(r * 1.1, 0);
  ctx.lineTo(-r * 0.75, r * 0.8);
  ctx.lineTo(-r * 0.4, r * 0.3);
  ctx.lineTo(-r * 0.65, 0);
  ctx.lineTo(-r * 0.4, -r * 0.3);
  ctx.lineTo(-r * 0.75, -r * 0.8);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Cockpit
  ctx.shadowBlur = 0;
  ctx.fillStyle = cloaked ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.85)';
  ctx.beginPath();
  ctx.ellipse(r * 0.25, 0, r * 0.28, r * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();

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
