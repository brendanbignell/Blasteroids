// Shared between the server (Node) and the browser client.
// Defines the ship customisation model and how ability points turn into stats.

export const CREDITS_DEFAULT = 100;
export const MAX_POINTS = 50;
// Temporary power-up boosts may push an ability beyond the build cap, up to this.
export const MAX_EFFECTIVE_POINTS = 75;

export const WORLD = { width: 4200, height: 3000 };

export const ABILITIES = [
  { key: 'acceleration', label: 'Acceleration', desc: 'Engine thrust and top speed.' },
  { key: 'turnSpeed', label: 'Turning speed', desc: 'How fast the ship rotates.' },
  { key: 'size', label: 'Size', desc: 'More points = smaller ship, harder to hit.' },
  { key: 'shields', label: 'Shields', desc: 'Percentage of incoming damage absorbed.' },
  { key: 'laserRange', label: 'Laser range', desc: 'How far laser bolts travel.' },
  { key: 'laserDamage', label: 'Laser damage', desc: 'Damage per laser bolt.' },
  { key: 'torpedoRange', label: 'Torpedo range', desc: 'How far torpedoes travel before fizzling.' },
  { key: 'torpedoDamage', label: 'Torpedo damage', desc: 'Direct-hit damage; splash falls off with distance.' },
  { key: 'cloak', label: 'Cloaking time', desc: 'How long you can stay invisible per activation.' },
  { key: 'maxHp', label: 'Max hit points', desc: 'Hull strength.' },
  { key: 'hpRegen', label: 'HP recovery rate', desc: 'Hit points regenerated per second.' },
];

export const ABILITY_KEYS = ABILITIES.map((a) => a.key);

export function emptyBuild() {
  const b = {};
  for (const k of ABILITY_KEYS) b[k] = 0;
  return b;
}

export function buildCost(build) {
  let total = 0;
  for (const k of ABILITY_KEYS) total += build[k] || 0;
  return total;
}

/**
 * Sanitise a build coming from an untrusted client.
 * Returns { ok, build, error }.
 */
export function validateBuild(input, credits = CREDITS_DEFAULT) {
  const build = emptyBuild();
  if (!input || typeof input !== 'object') {
    return { ok: false, build, error: 'Build must be an object' };
  }
  for (const k of ABILITY_KEYS) {
    const raw = Number(input[k] ?? 0);
    if (!Number.isFinite(raw)) return { ok: false, build, error: `Invalid value for ${k}` };
    const v = Math.round(raw);
    if (v < 0 || v > MAX_POINTS) {
      return { ok: false, build, error: `${k} must be between 0 and ${MAX_POINTS}` };
    }
    build[k] = v;
  }
  const cost = buildCost(build);
  if (cost > credits) {
    return { ok: false, build, error: `Build costs ${cost} credits but only ${credits} are available` };
  }
  return { ok: true, build, error: null };
}

/**
 * Turn ability points (plus temporary boosts) into concrete gameplay numbers.
 * All distances are world pixels, time in seconds.
 */
export function deriveStats(build, boosts = {}) {
  const p = (key) => {
    const v = (build[key] || 0) + (boosts[key] || 0);
    return Math.max(0, Math.min(MAX_EFFECTIVE_POINTS, v));
  };
  const rapid = boosts.rapidFire || 0;
  return {
    accel: 150 + p('acceleration') * 6, // px/s^2
    maxSpeed: 230 + p('acceleration') * 4, // px/s
    turnRate: 2.2 + p('turnSpeed') * 0.08, // rad/s
    radius: Math.max(8, 22 - p('size') * 0.24), // px
    shield: Math.min(0.8, p('shields') * 0.01), // fraction of damage absorbed
    laserRange: 260 + p('laserRange') * 8,
    laserDamage: 8 + p('laserDamage') * 0.5,
    laserCooldown: 0.25 * Math.pow(0.75, rapid),
    laserSpeed: 760,
    torpedoRange: 320 + p('torpedoRange') * 10,
    torpedoDamage: 25 + p('torpedoDamage') * 1.5,
    torpedoSplash: 70,
    torpedoCooldown: 2.5,
    torpedoSpeed: 380,
    cloakDuration: p('cloak') * 0.2,
    cloakCooldown: 12,
    maxHp: 100 + p('maxHp') * 3,
    hpRegen: p('hpRegen') * 0.3, // hp/s
  };
}

/** Human-readable preview of what a build gives you (used by the lobby UI). */
export function describeStat(key, stats) {
  switch (key) {
    case 'acceleration': return `${Math.round(stats.accel)} px/s², top ${Math.round(stats.maxSpeed)} px/s`;
    case 'turnSpeed': return `${(stats.turnRate * 57.2958).toFixed(0)}°/s`;
    case 'size': return `radius ${stats.radius.toFixed(1)} px`;
    case 'shields': return `${Math.round(stats.shield * 100)}% absorbed`;
    case 'laserRange': return `${Math.round(stats.laserRange)} px`;
    case 'laserDamage': return `${stats.laserDamage.toFixed(1)} per bolt`;
    case 'torpedoRange': return `${Math.round(stats.torpedoRange)} px`;
    case 'torpedoDamage': return `${stats.torpedoDamage.toFixed(0)} direct hit`;
    case 'cloak': return stats.cloakDuration > 0 ? `${stats.cloakDuration.toFixed(1)} s invisible` : 'no cloak';
    case 'maxHp': return `${Math.round(stats.maxHp)} HP`;
    case 'hpRegen': return `${stats.hpRegen.toFixed(1)} HP/s`;
    default: return '';
  }
}

export const PRESETS = {
  Balanced: { acceleration: 10, turnSpeed: 10, size: 5, shields: 10, laserRange: 10, laserDamage: 10, torpedoRange: 5, torpedoDamage: 10, cloak: 0, maxHp: 20, hpRegen: 10 },
  'Glass cannon': { acceleration: 15, turnSpeed: 15, size: 10, shields: 0, laserRange: 10, laserDamage: 35, torpedoRange: 0, torpedoDamage: 15, cloak: 0, maxHp: 0, hpRegen: 0 },
  Tank: { acceleration: 0, turnSpeed: 5, size: 0, shields: 30, laserRange: 0, laserDamage: 10, torpedoRange: 0, torpedoDamage: 0, cloak: 0, maxHp: 40, hpRegen: 15 },
  Scout: { acceleration: 30, turnSpeed: 25, size: 25, shields: 0, laserRange: 10, laserDamage: 5, torpedoRange: 0, torpedoDamage: 0, cloak: 5, maxHp: 0, hpRegen: 0 },
  Assassin: { acceleration: 15, turnSpeed: 10, size: 15, shields: 0, laserRange: 0, laserDamage: 10, torpedoRange: 10, torpedoDamage: 20, cloak: 20, maxHp: 0, hpRegen: 0 },
  Artillery: { acceleration: 5, turnSpeed: 10, size: 0, shields: 10, laserRange: 0, laserDamage: 0, torpedoRange: 30, torpedoDamage: 35, cloak: 0, maxHp: 10, hpRegen: 0 },
};

/**
 * Special items that spawn on the map. Picking one up adds `amount` effective
 * points to `ability` (or applies a special effect) until the player dies.
 */
export const POWERUPS = [
  { type: 'engine', label: 'Engine boost', ability: 'acceleration', amount: 15, color: '#ffb347', glyph: '▲' },
  { type: 'gyro', label: 'Gyro boost', ability: 'turnSpeed', amount: 15, color: '#7ef9ff', glyph: '↻' },
  { type: 'shield', label: 'Shield booster', ability: 'shields', amount: 10, color: '#4f8dff', glyph: '◈' },
  { type: 'laser', label: 'Laser amplifier', ability: 'laserDamage', amount: 12, color: '#ff4f8d', glyph: '✦' },
  { type: 'optics', label: 'Targeting optics', ability: 'laserRange', amount: 15, color: '#ff9bd1', glyph: '◎' },
  { type: 'warhead', label: 'Heavy warheads', ability: 'torpedoDamage', amount: 15, color: '#ff6a3d', glyph: '✹' },
  { type: 'stealth', label: 'Stealth coating', ability: 'cloak', amount: 15, color: '#b48cff', glyph: '◌' },
  { type: 'hull', label: 'Hull plating', ability: 'maxHp', amount: 15, color: '#9dff6a', glyph: '▣' },
  { type: 'nanites', label: 'Repair nanites', ability: 'hpRegen', amount: 12, color: '#6affc9', glyph: '✚' },
  { type: 'rapid', label: 'Rapid fire', ability: 'rapidFire', amount: 1, color: '#fff36a', glyph: '≡' },
  { type: 'repair', label: 'Emergency repair', ability: null, amount: 0, color: '#ffffff', glyph: '♥' },
];

export const POWERUP_BY_TYPE = Object.fromEntries(POWERUPS.map((p) => [p.type, p]));

export const SHIP_COLORS = [
  '#4fd1ff', '#ff5c8a', '#7dff6a', '#ffb347', '#c187ff', '#fff36a', '#ff6a3d', '#6affc9', '#ff9bd1', '#9db7ff',
];

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
