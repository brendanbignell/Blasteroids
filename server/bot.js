// Simple AI pilots. Each bot evaluates its surroundings a few times per second
// and writes a normal input record, so the simulation treats it like a player.

import { PRESETS, ABILITY_KEYS, MAX_POINTS, CREDITS_DEFAULT, SHIP_COLORS, BOT_SKILL_BY_KEY, DEFAULT_BOT_SKILL } from '../shared/stats.js';
import { delta, angleDiff, rand, randInt, pick } from './util.js';

export const BOT_NAMES = [
  'HAL-9000', 'Marvin', 'GLaDOS', 'Wintermute', 'Bender', 'Skynet', 'KITT', 'Ultron',
  'Ava', 'Data', 'Cortana', 'Shodan', 'Mother', 'Deep Thought', 'Robby', 'Tachikoma',
];

/** Random preset-based build, spending `credits` scaled by the skill's budget fraction. */
export function randomBotBuild(credits = CREDITS_DEFAULT, skillKey = DEFAULT_BOT_SKILL) {
  credits = Math.floor(credits * (BOT_SKILL_BY_KEY[skillKey] || BOT_SKILL_BY_KEY[DEFAULT_BOT_SKILL]).credits);
  const base = { ...pick(Object.values(PRESETS)) };
  // Add noise then re-fit to the credit budget.
  for (const k of ABILITY_KEYS) {
    base[k] = Math.max(0, Math.min(MAX_POINTS, base[k] + randInt(-5, 5)));
  }
  let total = ABILITY_KEYS.reduce((s, k) => s + base[k], 0);
  while (total > credits) {
    const k = pick(ABILITY_KEYS.filter((key) => base[key] > 0));
    base[k]--; total--;
  }
  while (total < credits) {
    const k = pick(ABILITY_KEYS.filter((key) => base[key] < MAX_POINTS));
    base[k]++; total++;
  }
  return base;
}

export function createBotBrain() {
  return {
    nextThink: 0,
    targetId: null,
    waypoint: null,
    waypointUntil: 0,
    aimBias: rand(-1, 1), // each bot has a consistent tendency to aim to one side
    aimError: 0,
  };
}

export function botColor(index) {
  return SHIP_COLORS[(index * 3 + 1) % SHIP_COLORS.length];
}

/**
 * Update the bot's input based on the game state.
 * `game` exposes players (Map), items, asteroids, time.
 */
export function thinkBot(bot, game) {
  const brain = bot.brain;
  const input = bot.input;
  if (!bot.alive) {
    input.thrust = input.left = input.right = input.fire = input.torpedo = input.cloak = false;
    return;
  }
  if (game.time < brain.nextThink) return;
  const skill = BOT_SKILL_BY_KEY[game.botSkill] || BOT_SKILL_BY_KEY[DEFAULT_BOT_SKILL];
  brain.nextThink = game.time + rand(skill.think[0], skill.think[1]);
  // Re-roll aim error every decision so weaker bots spray rather than miss consistently.
  brain.aimError = skill.aim * (0.4 * brain.aimBias + rand(-0.6, 0.6));

  const st = bot.stats;

  // --- choose a target -------------------------------------------------
  let target = null;
  let bestScore = Infinity;
  for (const p of game.players.values()) {
    if (p === bot || !p.alive || p.cloakedUntil > game.time || p.invulnUntil > game.time) continue;
    const { dx, dy } = delta(bot, p);
    const d = Math.hypot(dx, dy);
    if (d > skill.sight) continue;
    // Prefer close and weak targets; stick with current target a little.
    let score = d + p.hp * 2;
    if (p.id === brain.targetId) score *= 0.8;
    if (score < bestScore) { bestScore = score; target = p; }
  }
  brain.targetId = target ? target.id : null;

  // --- choose a destination --------------------------------------------
  let desired = null; // {dx, dy}
  let dist = Infinity;
  if (target) {
    const { dx, dy } = delta(bot, target);
    dist = Math.hypot(dx, dy);
    // Lead the target for lasers (weaker bots lead less, so they shoot behind moving ships).
    const t = (dist / st.laserSpeed) * skill.lead;
    desired = { dx: dx + target.vx * t - bot.vx * t, dy: dy + target.vy * t - bot.vy * t };
  } else {
    // Go for a power-up if one is near, otherwise wander.
    let bestItem = null, bestD = 900;
    for (const it of game.items) {
      const { dx, dy } = delta(bot, it);
      const d = Math.hypot(dx, dy);
      if (d < bestD) { bestD = d; bestItem = { dx, dy }; }
    }
    if (bestItem) {
      desired = bestItem; dist = bestD;
    } else {
      if (!brain.waypoint || game.time > brain.waypointUntil) {
        brain.waypoint = { dx: rand(-1200, 1200), dy: rand(-900, 900) };
        brain.waypointUntil = game.time + rand(3, 6);
      }
      desired = brain.waypoint;
      dist = Math.hypot(desired.dx, desired.dy);
      // Move waypoint with the bot so it stays relative.
      brain.waypoint.dx -= bot.vx * 0.12;
      brain.waypoint.dy -= bot.vy * 0.12;
    }
  }

  // --- asteroid avoidance ----------------------------------------------
  let avoid = 0;
  for (const a of game.asteroids) {
    const { dx, dy } = delta(bot, a);
    const d = Math.hypot(dx, dy);
    const danger = a.r + st.radius + 90;
    if (d > danger) continue;
    const ang = Math.atan2(dy, dx);
    const diff = angleDiff(bot.angle, ang);
    if (Math.abs(diff) < 1.0) {
      avoid += diff > 0 ? -1 : 1; // steer away
    }
  }

  // --- steering ----------------------------------------------------------
  let turn = 0;
  let wantThrust = false;
  if (desired) {
    const ang = Math.atan2(desired.dy, desired.dx) + (target ? brain.aimError : 0);
    const diff = angleDiff(bot.angle, ang);
    turn = Math.abs(diff) > 0.05 ? Math.sign(diff) : 0;
    // Plan the turn: re-think when it should be complete rather than overshooting
    // for the whole reaction interval.
    if (turn !== 0) brain.nextThink = Math.min(brain.nextThink, game.time + Math.abs(diff) / st.turnRate);
    const speed = Math.hypot(bot.vx, bot.vy);
    if (target) {
      const standoff = Math.min(st.laserRange * 0.6, 260);
      wantThrust = dist > standoff && Math.abs(diff) < 1.2 && speed < st.maxSpeed * 0.9;
    } else {
      wantThrust = dist > 80 && Math.abs(diff) < 0.8 && speed < st.maxSpeed * 0.7;
    }
  }
  if (avoid !== 0) { turn = avoid; wantThrust = true; }

  input.left = turn < 0;
  input.right = turn > 0;
  input.thrust = wantThrust;
  input.reverse = false;

  // --- weapons -----------------------------------------------------------
  input.fire = false;
  input.torpedo = false;
  input.cloak = false;
  if (target) {
    // Fire when lined up with where the bot *thinks* it should aim, aim error included.
    const ang = Math.atan2(desired.dy, desired.dx) + brain.aimError;
    const diff = Math.abs(angleDiff(bot.angle, ang));
    if (dist < st.laserRange * 0.95 && diff < skill.cone) input.fire = Math.random() < skill.fire;
    if (dist < st.torpedoRange * 0.9 && dist > 120 && diff < skill.cone * 1.6 && Math.random() < skill.torpedo) input.torpedo = true;
    if (skill.cloak && st.cloakDuration > 0 && bot.hp < st.maxHp * 0.4 && game.time >= bot.cloakReadyAt) input.cloak = true;
  }
}
