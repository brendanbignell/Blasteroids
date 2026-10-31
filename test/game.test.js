import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { createRateLimiter } from '../server/util.js';
import { emptyBuild, PRESETS, WORLD } from '../shared/stats.js';

const DT = 1 / 60;
const run = (g, seconds) => { for (let i = 0; i < Math.round(seconds / DT); i++) g.step(DT); };
const drain = (g) => { const e = g.events; g.events = []; return e; };

function duel() {
  const g = new Game({ matchSeconds: 60, respawnSeconds: 1, spawnProtectionSeconds: 0, asteroidTarget: 0, maxItems: 0 });
  g.asteroids = [];
  const a = g.addPlayer({ id: 'a', name: 'A', color: '#fff', build: { ...emptyBuild(), laserDamage: 50 } }).player;
  const b = g.addPlayer({ id: 'b', name: 'B', color: '#000', build: emptyBuild() }).player;
  g.step(DT); // spawns both
  // Place B directly in front of A, inside laser range.
  a.x = 1000; a.y = 1000; a.angle = 0; a.vx = a.vy = 0;
  b.x = 1150; b.y = 1000; b.vx = b.vy = 0;
  return { g, a, b };
}

test('rejects invalid builds when a player joins', () => {
  const g = new Game();
  const r = g.addPlayer({ id: 'x', name: 'X', color: '#fff', build: { ...emptyBuild(), maxHp: 60 } });
  assert.equal(r.ok, false);
  assert.equal(g.players.size, 0);
});

test('lasers damage and kill, awarding a point and a respawn', () => {
  const { g, a, b } = duel();
  a.input.fire = true;
  const startHp = b.hp;
  run(g, 0.5);
  assert.ok(b.hp < startHp, 'B should have taken damage');
  run(g, 4);
  const events = drain(g);
  const kill = events.find((e) => e.type === 'kill');
  assert.ok(kill, 'a kill event should have been emitted');
  assert.equal(kill.killer.id, 'a');
  assert.equal(kill.victim.id, 'b');
  assert.ok(a.score >= 1);
  assert.ok(b.deaths >= 1);
  // B respawns after the delay
  a.input.fire = false;
  run(g, 1.5);
  assert.equal(b.alive, true);
  assert.equal(b.hp, b.stats.maxHp);
});

test('shields reduce damage taken', () => {
  const g = new Game({ asteroidTarget: 0, maxItems: 0, spawnProtectionSeconds: 0 });
  g.asteroids = [];
  const tank = g.addPlayer({ id: 't', name: 'T', color: '#fff', build: { ...emptyBuild(), shields: 50 } }).player;
  const soft = g.addPlayer({ id: 's', name: 'S', color: '#fff', build: emptyBuild() }).player;
  g.step(DT);
  g.applyDamage(tank, 20, null, 'laser');
  g.applyDamage(soft, 20, null, 'laser');
  assert.equal(soft.stats.maxHp - soft.hp, 20);
  assert.equal(tank.stats.maxHp - tank.hp, 10);
});

test('spawn protection blocks damage', () => {
  const g = new Game({ asteroidTarget: 0, maxItems: 0, spawnProtectionSeconds: 2 });
  const p = g.addPlayer({ id: 'p', name: 'P', color: '#fff', build: emptyBuild() }).player;
  g.step(DT);
  g.applyDamage(p, 50, null, 'laser');
  assert.equal(p.hp, p.stats.maxHp);
  run(g, 2.1);
  g.applyDamage(p, 50, null, 'laser');
  assert.ok(p.hp < p.stats.maxHp);
});

test('cloaked ships are hidden from other players but visible to themselves', () => {
  const g = new Game({ asteroidTarget: 0, maxItems: 0 });
  const ghost = g.addPlayer({ id: 'g', name: 'G', color: '#fff', build: { ...emptyBuild(), cloak: 50 } }).player;
  g.addPlayer({ id: 'o', name: 'O', color: '#fff', build: emptyBuild() });
  g.step(DT);
  g.setInput('g', { cloak: true });
  g.step(DT);
  assert.ok(ghost.cloakedUntil > g.time);
  const seenByOther = g.snapshotFor('o', []).ships.map((s) => s.id);
  const seenBySelf = g.snapshotFor('g', []).ships.map((s) => s.id);
  assert.ok(!seenByOther.includes('g'));
  assert.ok(seenBySelf.includes('g'));
  // Weapons are locked while cloaked: no shots, cloak stays up, no cooldown used.
  g.setInput('g', { cloak: false, fire: true, torpedo: true });
  run(g, 1);
  assert.equal(g.lasers.length + g.torpedoes.length, 0);
  assert.ok(ghost.cloakedUntil > g.time);
  assert.ok(!g.snapshotFor('o', []).ships.some((s) => s.id === 'g'));
  // Once the cloak runs out, held triggers fire straight away.
  run(g, ghost.cloakedUntil - g.time + 2 * DT);
  assert.ok(g.snapshotFor('o', []).ships.some((s) => s.id === 'g'));
  assert.ok(g.lasers.length > 0 && g.torpedoes.length > 0);
});

test('torpedo seeker curves toward a visible enemy ahead but ignores cloaked ones', () => {
  const g = new Game({ asteroidTarget: 0, maxItems: 0 });
  g.asteroids = [];
  const shooter = g.addPlayer({ id: 's', name: 'S', color: '#ffffff', build: emptyBuild() }).player;
  const target = g.addPlayer({ id: 't', name: 'T', color: '#ffffff', build: { ...emptyBuild(), cloak: 50 } }).player;
  g.step(DT);
  const place = () => {
    g.torpedoes = [];
    Object.assign(shooter, { x: 1000, y: 1000, vx: 0, vy: 0, angle: 0, torpedoReadyAt: 0, cloakedUntil: 0 });
    // Target ahead but 30 degrees off the torpedo's heading.
    Object.assign(target, { x: 1000 + 300 * Math.cos(0.52), y: 1000 + 300 * Math.sin(0.52), vx: 0, vy: 0, invulnUntil: 0 });
    g.fireTorpedo(shooter);
    shooter.torpedoReadyAt = Infinity; // no more shots
  };

  place();
  run(g, 0.4);
  assert.equal(g.torpedoes[0].targetId, 't');
  assert.ok(g.torpedoes[0].angle > 0.2, `torpedo should curve toward target, angle ${g.torpedoes[0].angle}`);
  assert.equal(g.snapshotFor('t', []).torps[0][5], 't'); // clients learn about the lock

  place();
  target.cloakedUntil = g.time + 5;
  run(g, 0.4);
  assert.equal(g.torpedoes[0].targetId, null);
  assert.ok(Math.abs(g.torpedoes[0].angle) < 1e-9, 'a cloaked target must not be tracked');
});

test('picking up an item boosts a stat until death', () => {
  const g = new Game({ asteroidTarget: 0, maxItems: 0, respawnSeconds: 0.1 });
  g.asteroids = [];
  const p = g.addPlayer({ id: 'p', name: 'P', color: '#fff', build: emptyBuild() }).player;
  g.step(DT);
  const before = p.stats.laserDamage;
  g.items.push({ id: 999, type: 'laser', x: p.x, y: p.y, expiresAt: g.time + 10 });
  g.step(DT);
  assert.equal(g.items.length, 0, 'item should be consumed');
  assert.ok(p.stats.laserDamage > before);
  assert.deepEqual(p.pickups, ['laser']);
  g.kill(p, null, 'asteroid');
  assert.equal(p.stats.laserDamage, before, 'boost should reset on death');
  assert.deepEqual(p.pickups, []);
});

test('items spawn occasionally and expire', () => {
  const g = new Game({ asteroidTarget: 0, itemSpawnMin: 1, itemSpawnMax: 1, itemLifetime: 2, maxItems: 3 });
  run(g, 1.2);
  assert.ok(g.items.length >= 1);
  run(g, 10);
  assert.ok(g.items.length <= 3);
});

test('match ends after the fixed duration, then a new one starts with reset scores', () => {
  const g = new Game({ matchSeconds: 5, intermissionSeconds: 2, asteroidTarget: 0 });
  const p = g.addPlayer({ id: 'p', name: 'P', color: '#fff', build: emptyBuild() }).player;
  p.score = 7;
  run(g, 5.1);
  assert.equal(g.match.state, 'ended');
  assert.equal(g.match.results[0].score, 7);
  assert.ok(drain(g).some((e) => e.type === 'matchEnd'));
  run(g, 2.1);
  assert.equal(g.match.state, 'playing');
  assert.equal(g.match.number, 2);
  assert.equal(p.score, 0);
  assert.ok(drain(g).some((e) => e.type === 'matchStart'));
});

test('bots can be added and removed and actually fight', () => {
  const g = new Game({ matchSeconds: 600 });
  assert.equal(g.setBotCount(6), 6);
  assert.equal(g.botCount(), 6);
  run(g, 90);
  const kills = drain(g).filter((e) => e.type === 'kill');
  assert.ok(kills.length > 0, 'bots should score kills within 90 simulated seconds');
  assert.equal(g.setBotCount(2), 2);
  assert.equal(g.botCount(), 2);
  assert.equal(g.setBotCount(-5), 0);
  assert.equal(g.botCount(), 0);
});

test('world wraps toroidally', () => {
  const g = new Game({ asteroidTarget: 0, maxItems: 0 });
  const p = g.addPlayer({ id: 'p', name: 'P', color: '#fff', build: PRESETS.Scout }).player;
  g.step(DT);
  p.x = WORLD.width - 1; p.y = 5; p.angle = 0; p.vx = 600; p.vy = -600;
  g.step(DT);
  assert.ok(p.x >= 0 && p.x < WORLD.width);
  assert.ok(p.y >= 0 && p.y < WORLD.height);
});

test('long simulation with many bots stays healthy', () => {
  const g = new Game({ matchSeconds: 120, intermissionSeconds: 3 });
  g.setBotCount(12);
  run(g, 300);
  for (const p of g.players.values()) {
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.hp));
  }
  assert.ok(g.match.number >= 3);
  const snap = JSON.stringify(g.snapshotFor('bot0', []));
  assert.ok(snap.length < 20000, `snapshot too large: ${snap.length}`);
});

test('rate limiter allows a burst, then refills over time', () => {
  let t = 0;
  const lim = createRateLimiter({ capacity: 3, refillPerSec: 2, now: () => t });
  assert.deepEqual([lim.tryTake(), lim.tryTake(), lim.tryTake(), lim.tryTake()], [true, true, true, false]);
  t += 400; // 0.8 tokens
  assert.equal(lim.tryTake(), false);
  t += 100; // 1.0 token
  assert.equal(lim.tryTake(), true);
  t += 60_000; // refill is capped at capacity
  assert.deepEqual([lim.tryTake(), lim.tryTake(), lim.tryTake(), lim.tryTake()], [true, true, true, false]);
});

test('snapshot exposes input seq/ticks so clients can replay unacknowledged ticks', async () => {
  const { moveShip } = await import('../shared/physics.js');
  const g = new Game({ asteroidTarget: 0 });
  g.asteroids = [];
  g.addPlayer({ id: 'h', name: 'H', color: '#ffffff', build: PRESETS.Scout });
  run(g, 0.1);
  g.setInput('h', { right: true, thrust: true }, 5);
  g.setInput('h', { left: true }, 3); // stale seq must be ignored
  run(g, 0.25);
  const self = g.snapshotFor('h', []).ships.find((s) => s.id === 'h').self;
  assert.equal(self.seq, 5);
  assert.equal(self.ticks, 15);
  // Replaying the same input from the reported state matches the server exactly.
  const local = { x: self.px, y: self.py, vx: self.pvx, vy: self.pvy, angle: self.pa };
  const stats = { turnRate: self.turnRate, accel: self.accel, maxSpeed: self.maxSpeed };
  for (let i = 0; i < 10; i++) moveShip(local, { right: true, thrust: true }, stats, DT);
  run(g, 10 * DT);
  const p = g.players.get('h');
  assert.ok(Math.abs(local.x - p.x) < 1e-9 && Math.abs(local.angle - p.angle) < 1e-9);
});

test('bot skill: validated, re-budgets existing bots, and scales their credits', async () => {
  const { buildCost } = await import('../shared/stats.js');
  const g = new Game({ asteroidTarget: 0, botSkill: 'ace' });
  g.setBotCount(4);
  const bots = () => [...g.players.values()].filter((p) => p.isBot);
  for (const b of bots()) assert.equal(buildCost(b.build), 100);
  assert.equal(g.setBotSkill('rookie'), 'rookie');
  for (const b of bots()) {
    assert.equal(buildCost(b.build), 60);
    assert.ok(b.hp <= b.stats.maxHp);
  }
  assert.equal(g.setBotSkill('godlike'), 'rookie'); // unknown keys are ignored
  assert.equal(new Game({ botSkill: 'nope' }).botSkill, 'pilot');
  run(g, 20); // bots still behave at the new level
});

test('ship themes: humans pick from the list, bots always fly drones', () => {
  const g = new Game({ asteroidTarget: 0 });
  g.addPlayer({ id: 'a', name: 'A', color: '#ffffff', build: emptyBuild(), theme: 'saucer' });
  g.addPlayer({ id: 'b', name: 'B', color: '#ffffff', build: emptyBuild(), theme: 'drone' });
  g.addPlayer({ id: 'c', name: 'C', color: '#ffffff', build: emptyBuild(), theme: '<script>' });
  g.addBot();
  const themes = Object.fromEntries(g.snapshotFor('a', []).players.map((p) => [p.id, p.theme]));
  assert.equal(themes.a, 'saucer');
  assert.equal(themes.b, 'arrowhead'); // drone is reserved for bots
  assert.equal(themes.c, 'arrowhead');
  assert.equal(themes.bot0, 'drone');
});
