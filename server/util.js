import { WORLD } from '../shared/stats.js';

export const rand = (lo, hi) => lo + Math.random() * (hi - lo);
export const randInt = (lo, hi) => Math.floor(rand(lo, hi + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export function wrapPos(e) {
  const { width, height } = WORLD;
  if (e.x < 0) e.x += width; else if (e.x >= width) e.x -= width;
  if (e.y < 0) e.y += height; else if (e.y >= height) e.y -= height;
}

/** Shortest signed delta on a wrapping axis. */
export function wrapDelta(d, size) {
  const half = size / 2;
  if (d > half) return d - size;
  if (d < -half) return d + size;
  return d;
}

/** Toroidal vector from a to b. */
export function delta(a, b) {
  return {
    dx: wrapDelta(b.x - a.x, WORLD.width),
    dy: wrapDelta(b.y - a.y, WORLD.height),
  };
}

export function dist(a, b) {
  const { dx, dy } = delta(a, b);
  return Math.hypot(dx, dy);
}

export function angleDiff(from, to) {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function sanitizeName(raw, fallback = 'Pilot') {
  if (typeof raw !== 'string') return fallback;
  const cleaned = raw.replace(/[^\p{L}\p{N} _\-.'!]/gu, '').trim().slice(0, 16);
  return cleaned || fallback;
}

export function sanitizeColor(raw, fallback) {
  if (typeof raw === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw)) return raw.toLowerCase();
  return fallback;
}
