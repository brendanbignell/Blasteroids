import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBuild, deriveStats, buildCost, emptyBuild, PRESETS, ABILITY_KEYS, MAX_POINTS, CREDITS_DEFAULT } from '../shared/stats.js';

test('empty build is valid and costs nothing', () => {
  const v = validateBuild(emptyBuild());
  assert.equal(v.ok, true);
  assert.equal(buildCost(v.build), 0);
});

test('presets all fit within the default credit budget', () => {
  for (const [name, preset] of Object.entries(PRESETS)) {
    const v = validateBuild(preset);
    assert.equal(v.ok, true, `${name}: ${v.error}`);
    assert.ok(buildCost(v.build) <= CREDITS_DEFAULT, `${name} costs ${buildCost(v.build)}`);
  }
});

test('rejects builds that exceed the credit budget', () => {
  const b = emptyBuild();
  b.laserDamage = 50; b.maxHp = 50; b.shields = 1;
  const v = validateBuild(b);
  assert.equal(v.ok, false);
  assert.match(v.error, /credits/);
});

test('rejects more than the per-ability cap and garbage values', () => {
  assert.equal(validateBuild({ ...emptyBuild(), cloak: MAX_POINTS + 1 }).ok, false);
  assert.equal(validateBuild({ ...emptyBuild(), cloak: -1 }).ok, false);
  assert.equal(validateBuild({ ...emptyBuild(), cloak: 'lots' }).ok, false);
  assert.equal(validateBuild(null).ok, false);
  assert.equal(validateBuild({ ...emptyBuild(), cloak: 10.4 }).build.cloak, 10);
});

test('honours a custom credit budget', () => {
  const b = { ...emptyBuild(), maxHp: 50, shields: 50, laserDamage: 50 };
  assert.equal(validateBuild(b, 100).ok, false);
  assert.equal(validateBuild(b, 150).ok, true);
});

test('more points always means better (or smaller) stats', () => {
  const lo = deriveStats(emptyBuild());
  const hi = {};
  for (const k of ABILITY_KEYS) hi[k] = MAX_POINTS;
  const h = deriveStats(hi);
  assert.ok(h.accel > lo.accel && h.maxSpeed > lo.maxSpeed);
  assert.ok(h.turnRate > lo.turnRate);
  assert.ok(h.radius < lo.radius);
  assert.ok(h.shield > lo.shield && h.shield < 1);
  assert.ok(h.laserRange > lo.laserRange && h.laserDamage > lo.laserDamage);
  assert.ok(h.torpedoRange > lo.torpedoRange && h.torpedoDamage > lo.torpedoDamage);
  assert.ok(h.cloakDuration > 0 && lo.cloakDuration === 0);
  assert.ok(h.maxHp > lo.maxHp && h.hpRegen > lo.hpRegen);
});

test('boosts stack on top of the build and rapid fire shortens the laser cooldown', () => {
  const base = deriveStats(PRESETS.Balanced);
  const boosted = deriveStats(PRESETS.Balanced, { laserDamage: 12, rapidFire: 1 });
  assert.ok(boosted.laserDamage > base.laserDamage);
  assert.ok(boosted.laserCooldown < base.laserCooldown);
});
