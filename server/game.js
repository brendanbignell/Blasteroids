// Authoritative game simulation. Pure logic: no networking in here.

import {
  WORLD, deriveStats, validateBuild, POWERUPS, POWERUP_BY_TYPE, CREDITS_DEFAULT, clamp,
  BOT_SKILL_BY_KEY, DEFAULT_BOT_SKILL, SHIP_THEME_KEYS, BOT_THEME,
} from '../shared/stats.js';
import { moveShip } from '../shared/physics.js';
import { rand, randInt, pick, wrapPos, delta, dist, angleDiff } from './util.js';
import { thinkBot, createBotBrain, randomBotBuild, BOT_NAMES, botColor } from './bot.js';

export const DEFAULTS = {
  matchSeconds: 300,
  intermissionSeconds: 3,
  respawnSeconds: 3,
  spawnProtectionSeconds: 2.5,
  credits: CREDITS_DEFAULT,
  maxItems: 8,
  itemSpawnMin: 5,
  itemSpawnMax: 10,
  itemLifetime: 35,
  asteroidTarget: 14,
  maxBots: 12,
  botSkill: DEFAULT_BOT_SKILL,
  killPoints: 1,
};

const ASTEROID_SIZES = {
  large: { r: 58, hp: 70, splitInto: 'medium', count: 2 },
  medium: { r: 34, hp: 32, splitInto: 'small', count: 2 },
  small: { r: 18, hp: 12, splitInto: null, count: 0 },
};

export class Game {
  constructor(options = {}) {
    this.opts = { ...DEFAULTS, ...options };
    this.players = new Map();
    this.lasers = [];
    this.torpedoes = [];
    this.items = [];
    this.asteroids = [];
    this.events = []; // drained by the network layer every snapshot
    this.time = 0;
    this.nextId = 1;
    this.botCounter = 0;
    this.botSkill = BOT_SKILL_BY_KEY[this.opts.botSkill] ? this.opts.botSkill : DEFAULT_BOT_SKILL;
    this.nextItemAt = this.opts.itemSpawnMin;
    this.nextAsteroidAt = 0;
    this.match = { state: 'playing', remaining: this.opts.matchSeconds, number: 1, results: null, intermission: 0 };
    this.seedAsteroids();
  }

  // ------------------------------------------------------------------ players
  addPlayer({ id, name, color, build, theme, isBot = false }) {
    const v = validateBuild(build, this.opts.credits);
    if (!v.ok) return { ok: false, error: v.error };
    const pid = id ?? `p${this.nextId++}`;
    const player = {
      id: pid, name, color, isBot,
      theme: isBot ? BOT_THEME : (SHIP_THEME_KEYS.includes(theme) ? theme : SHIP_THEME_KEYS[0]),
      build: v.build, boosts: {}, pickups: [],
      stats: null,
      x: 0, y: 0, vx: 0, vy: 0, angle: 0,
      hp: 0, alive: false,
      respawnAt: this.time + 0.01,
      invulnUntil: 0,
      cloakedUntil: 0, cloakReadyAt: 0,
      laserReadyAt: 0, torpedoReadyAt: 0,
      lastCollisionAt: 0,
      input: { thrust: false, reverse: false, left: false, right: false, fire: false, torpedo: false, cloak: false },
      inputSeq: 0, inputTicks: 0, // latest client input sequence and ticks simulated with it
      score: 0, kills: 0, deaths: 0,
      lastHitBy: null, lastHitAt: -Infinity,
      lastDeath: null,
      joinedAt: this.time,
      brain: isBot ? createBotBrain() : null,
    };
    player.stats = deriveStats(player.build, player.boosts);
    this.players.set(pid, player);
    this.events.push({ type: 'join', id: pid, name, isBot });
    return { ok: true, player };
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    this.events.push({ type: 'leave', id, name: p.name });
  }

  setInput(id, input, seq) {
    const p = this.players.get(id);
    if (!p || p.isBot || !input) return;
    if (Number.isInteger(seq)) {
      if (seq < p.inputSeq) return; // stale: a newer input is already in effect
      if (seq > p.inputSeq) { p.inputSeq = seq; p.inputTicks = 0; }
    }
    for (const k of Object.keys(p.input)) p.input[k] = !!input[k];
  }

  humanCount() {
    let n = 0;
    for (const p of this.players.values()) if (!p.isBot) n++;
    return n;
  }

  botCount() {
    let n = 0;
    for (const p of this.players.values()) if (p.isBot) n++;
    return n;
  }

  setBotCount(count) {
    const target = clamp(Math.round(count) || 0, 0, this.opts.maxBots);
    let current = this.botCount();
    while (current < target) { this.addBot(); current++; }
    if (current > target) {
      const bots = [...this.players.values()].filter((p) => p.isBot);
      for (let i = 0; i < current - target; i++) this.removePlayer(bots[bots.length - 1 - i].id);
    }
    return target;
  }

  /** Change bot difficulty; existing bots get a re-budgeted build immediately. */
  setBotSkill(key) {
    if (!BOT_SKILL_BY_KEY[key]) return this.botSkill;
    this.botSkill = key;
    for (const p of this.players.values()) {
      if (!p.isBot) continue;
      p.build = randomBotBuild(this.opts.credits, key);
      p.stats = deriveStats(p.build, p.boosts);
      p.hp = Math.min(p.hp, p.stats.maxHp);
    }
    return key;
  }

  addBot() {
    const idx = this.botCounter++;
    const name = BOT_NAMES[idx % BOT_NAMES.length] + (idx >= BOT_NAMES.length ? ` ${Math.floor(idx / BOT_NAMES.length) + 1}` : '');
    return this.addPlayer({
      id: `bot${idx}`,
      name,
      color: botColor(idx),
      build: randomBotBuild(this.opts.credits, this.botSkill),
      isBot: true,
    });
  }

  // ----------------------------------------------------------------- spawning
  findSpawnPoint(radius) {
    let best = null, bestScore = -1;
    for (let i = 0; i < 12; i++) {
      const cand = { x: rand(0, WORLD.width), y: rand(0, WORLD.height) };
      let minD = Infinity;
      for (const p of this.players.values()) if (p.alive) minD = Math.min(minD, dist(cand, p));
      for (const a of this.asteroids) minD = Math.min(minD, dist(cand, a) - a.r - radius);
      if (minD > bestScore) { bestScore = minD; best = cand; }
    }
    return best;
  }

  respawn(p) {
    const spot = this.findSpawnPoint(p.stats.radius);
    p.x = spot.x; p.y = spot.y;
    p.vx = 0; p.vy = 0;
    p.angle = rand(-Math.PI, Math.PI);
    p.boosts = {};
    p.pickups = [];
    p.stats = deriveStats(p.build, p.boosts);
    p.hp = p.stats.maxHp;
    p.alive = true;
    p.invulnUntil = this.time + this.opts.spawnProtectionSeconds;
    p.cloakedUntil = 0;
    p.cloakReadyAt = this.time;
    p.laserReadyAt = this.time;
    p.torpedoReadyAt = this.time;
    this.events.push({ type: 'spawn', id: p.id, x: p.x, y: p.y });
  }

  seedAsteroids() {
    this.asteroids = [];
    for (let i = 0; i < this.opts.asteroidTarget; i++) {
      const size = i % 3 === 0 ? 'medium' : 'large';
      this.spawnAsteroid(size, { x: rand(0, WORLD.width), y: rand(0, WORLD.height) });
    }
  }

  spawnAsteroid(size, pos) {
    const def = ASTEROID_SIZES[size];
    const speed = rand(10, 45) * (size === 'small' ? 1.6 : size === 'medium' ? 1.3 : 1);
    const dir = rand(-Math.PI, Math.PI);
    const a = {
      id: this.nextId++, size, r: def.r, hp: def.hp,
      x: pos.x, y: pos.y,
      vx: Math.cos(dir) * speed, vy: Math.sin(dir) * speed,
      rot: rand(-Math.PI, Math.PI), spin: rand(-0.6, 0.6),
      seed: randInt(1, 1e6),
    };
    wrapPos(a);
    this.asteroids.push(a);
    return a;
  }

  spawnItem() {
    const def = pick(POWERUPS);
    const pos = this.findSpawnPoint(14);
    const item = { id: this.nextId++, type: def.type, x: pos.x, y: pos.y, expiresAt: this.time + this.opts.itemLifetime };
    this.items.push(item);
    this.events.push({ type: 'itemSpawn', id: item.id, itemType: def.type, x: item.x, y: item.y });
  }

  // --------------------------------------------------------------- simulation
  step(dt) {
    this.time += dt;
    this.updateMatch(dt);
    if (this.match.state !== 'playing') {
      // Freeze combat during intermission but keep the world drifting.
      this.moveAsteroids(dt);
      return;
    }

    for (const p of this.players.values()) {
      if (p.isBot) thinkBot(p, this);
      if (!p.alive) {
        if (this.time >= p.respawnAt) this.respawn(p);
        continue;
      }
      this.updateShip(p, dt);
    }

    this.moveProjectiles(dt);
    this.moveAsteroids(dt);
    this.resolveCollisions(dt);
    this.updateItems(dt);
    this.maintainAsteroids();
  }

  updateMatch(dt) {
    const m = this.match;
    if (m.state === 'playing') {
      m.remaining -= dt;
      if (m.remaining <= 0) {
        m.remaining = 0;
        m.state = 'ended';
        m.intermission = this.opts.intermissionSeconds;
        m.results = this.standings();
        this.events.push({ type: 'matchEnd', results: m.results, number: m.number });
      }
    } else {
      m.intermission -= dt;
      if (m.intermission <= 0) this.startNewMatch();
    }
  }

  startNewMatch() {
    const m = this.match;
    m.state = 'playing';
    m.remaining = this.opts.matchSeconds;
    m.number++;
    m.results = null;
    this.lasers = [];
    this.torpedoes = [];
    this.items = [];
    this.seedAsteroids();
    for (const p of this.players.values()) {
      p.score = 0; p.kills = 0; p.deaths = 0;
      p.alive = false;
      p.respawnAt = this.time;
    }
    this.nextItemAt = this.time + this.opts.itemSpawnMin;
    this.events.push({ type: 'matchStart', number: m.number, duration: this.opts.matchSeconds });
  }

  standings() {
    return [...this.players.values()]
      .map((p) => ({ id: p.id, name: p.name, color: p.color, score: p.score, kills: p.kills, deaths: p.deaths, isBot: p.isBot }))
      .sort((a, b) => b.score - a.score || a.deaths - b.deaths || a.name.localeCompare(b.name));
  }

  updateShip(p, dt) {
    const st = p.stats;
    const inp = p.input;

    moveShip(p, inp, st, dt);
    p.inputTicks++;

    // Regen
    if (st.hpRegen > 0 && p.hp < st.maxHp && this.time - p.lastHitAt > 1.5) {
      p.hp = Math.min(st.maxHp, p.hp + st.hpRegen * dt);
    }

    // Cloak
    if (inp.cloak && st.cloakDuration > 0 && this.time >= p.cloakReadyAt && p.cloakedUntil <= this.time) {
      p.cloakedUntil = this.time + st.cloakDuration;
      p.cloakReadyAt = p.cloakedUntil + st.cloakCooldown;
      this.events.push({ type: 'cloak', id: p.id, on: true });
    }

    // Weapons
    if (inp.fire && this.time >= p.laserReadyAt) {
      p.laserReadyAt = this.time + st.laserCooldown;
      this.fireLaser(p);
    }
    if (inp.torpedo && this.time >= p.torpedoReadyAt) {
      p.torpedoReadyAt = this.time + st.torpedoCooldown;
      this.fireTorpedo(p);
    }
  }

  decloak(p) {
    if (p.cloakedUntil > this.time) {
      p.cloakedUntil = this.time;
      this.events.push({ type: 'cloak', id: p.id, on: false });
    }
  }

  fireLaser(p) {
    this.decloak(p);
    const st = p.stats;
    const nose = st.radius + 4;
    this.lasers.push({
      id: this.nextId++, owner: p.id, color: p.color,
      x: p.x + Math.cos(p.angle) * nose, y: p.y + Math.sin(p.angle) * nose,
      vx: Math.cos(p.angle) * st.laserSpeed + p.vx * 0.3,
      vy: Math.sin(p.angle) * st.laserSpeed + p.vy * 0.3,
      angle: p.angle,
      ttl: st.laserRange / st.laserSpeed,
      damage: st.laserDamage,
    });
    this.events.push({ type: 'laser', id: p.id });
  }

  fireTorpedo(p) {
    this.decloak(p);
    const st = p.stats;
    const nose = st.radius + 6;
    this.torpedoes.push({
      id: this.nextId++, owner: p.id, color: p.color,
      x: p.x + Math.cos(p.angle) * nose, y: p.y + Math.sin(p.angle) * nose,
      vx: Math.cos(p.angle) * st.torpedoSpeed + p.vx * 0.5,
      vy: Math.sin(p.angle) * st.torpedoSpeed + p.vy * 0.5,
      angle: p.angle,
      ttl: st.torpedoRange / st.torpedoSpeed,
      damage: st.torpedoDamage,
      splash: st.torpedoSplash,
      armedAt: this.time + 0.15,
    });
    this.events.push({ type: 'torpedo', id: p.id });
  }

  moveProjectiles(dt) {
    for (const list of [this.lasers, this.torpedoes]) {
      for (const pr of list) {
        pr.x += pr.vx * dt; pr.y += pr.vy * dt; pr.ttl -= dt;
        wrapPos(pr);
      }
    }
    this.lasers = this.lasers.filter((l) => l.ttl > 0);
    const expired = this.torpedoes.filter((t) => t.ttl <= 0);
    for (const t of expired) this.events.push({ type: 'fizzle', x: t.x, y: t.y });
    this.torpedoes = this.torpedoes.filter((t) => t.ttl > 0);
  }

  moveAsteroids(dt) {
    for (const a of this.asteroids) {
      a.x += a.vx * dt; a.y += a.vy * dt; a.rot += a.spin * dt;
      wrapPos(a);
    }
  }

  maintainAsteroids() {
    if (this.asteroids.length < this.opts.asteroidTarget - 4 && this.time >= this.nextAsteroidAt) {
      const spot = this.findSpawnPoint(60);
      this.spawnAsteroid('large', spot);
      this.nextAsteroidAt = this.time + 4;
    }
  }

  updateItems(dt) {
    if (this.time >= this.nextItemAt && this.items.length < this.opts.maxItems) {
      this.spawnItem();
      this.nextItemAt = this.time + rand(this.opts.itemSpawnMin, this.opts.itemSpawnMax);
    }
    const before = this.items.length;
    this.items = this.items.filter((it) => it.expiresAt > this.time);
    if (this.items.length !== before) this.events.push({ type: 'itemExpire' });
  }

  // --------------------------------------------------------------- collisions
  resolveCollisions(dt) {
    const alive = [...this.players.values()].filter((p) => p.alive);

    // Lasers vs ships / asteroids
    for (const l of this.lasers) {
      if (l.ttl <= 0) continue;
      for (const p of alive) {
        if (p.id === l.owner || !p.alive) continue;
        if (dist(l, p) < p.stats.radius + 3) {
          this.applyDamage(p, l.damage, this.players.get(l.owner), 'laser');
          this.events.push({ type: 'hit', x: l.x, y: l.y, color: l.color, big: false });
          l.ttl = 0;
          break;
        }
      }
      if (l.ttl <= 0) continue;
      for (const a of this.asteroids) {
        if (dist(l, a) < a.r) {
          this.damageAsteroid(a, l.damage);
          this.events.push({ type: 'hit', x: l.x, y: l.y, color: '#cfd8e3', big: false });
          l.ttl = 0;
          break;
        }
      }
    }
    this.lasers = this.lasers.filter((l) => l.ttl > 0);

    // Torpedoes: proximity fuse against ships and asteroids
    for (const t of this.torpedoes) {
      if (t.ttl <= 0 || this.time < t.armedAt) continue;
      let boom = false;
      for (const p of alive) {
        if (p.id === t.owner || !p.alive) continue;
        if (dist(t, p) < p.stats.radius + 14) { boom = true; break; }
      }
      if (!boom) {
        for (const a of this.asteroids) if (dist(t, a) < a.r + 8) { boom = true; break; }
      }
      if (boom) { this.explodeTorpedo(t); t.ttl = 0; }
    }
    this.torpedoes = this.torpedoes.filter((t) => t.ttl > 0);

    // Ships vs items
    for (const p of alive) {
      if (!p.alive) continue;
      for (const it of this.items) {
        if (it.collected) continue;
        if (dist(p, it) < p.stats.radius + 16) {
          it.collected = true;
          this.collectItem(p, it);
        }
      }
    }
    this.items = this.items.filter((it) => !it.collected);

    // Ships vs asteroids (bounce + impact damage)
    for (const p of alive) {
      if (!p.alive) continue;
      for (const a of this.asteroids) {
        const { dx, dy } = delta(p, a);
        const d = Math.hypot(dx, dy);
        const minD = p.stats.radius + a.r;
        if (d >= minD || d === 0) continue;
        const nx = dx / d, ny = dy / d;
        const rel = (p.vx - a.vx) * nx + (p.vy - a.vy) * ny;
        // push the ship out
        p.x -= nx * (minD - d); p.y -= ny * (minD - d);
        wrapPos(p);
        if (rel > 0) {
          p.vx -= 1.6 * rel * nx; p.vy -= 1.6 * rel * ny;
          a.vx += 0.15 * rel * nx; a.vy += 0.15 * rel * ny;
          if (this.time - p.lastCollisionAt > 0.4) {
            p.lastCollisionAt = this.time;
            const dmg = clamp(rel * 0.08, 2, 30);
            this.applyDamage(p, dmg, null, 'asteroid');
            this.events.push({ type: 'hit', x: p.x + nx * p.stats.radius, y: p.y + ny * p.stats.radius, color: '#cfd8e3', big: rel > 150 });
          }
        }
      }
    }

    // Ships vs ships (soft bounce)
    for (let i = 0; i < alive.length; i++) {
      const a = alive[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < alive.length; j++) {
        const b = alive[j];
        if (!b.alive) continue;
        const { dx, dy } = delta(a, b);
        const d = Math.hypot(dx, dy);
        const minD = a.stats.radius + b.stats.radius;
        if (d >= minD || d === 0) continue;
        const nx = dx / d, ny = dy / d;
        const overlap = (minD - d) / 2;
        a.x -= nx * overlap; a.y -= ny * overlap;
        b.x += nx * overlap; b.y += ny * overlap;
        wrapPos(a); wrapPos(b);
        const rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
        if (rel > 0) {
          a.vx -= rel * nx; a.vy -= rel * ny;
          b.vx += rel * nx; b.vy += rel * ny;
          if (rel > 120) {
            const dmg = clamp(rel * 0.05, 1, 20);
            this.applyDamage(a, dmg, b, 'ram');
            this.applyDamage(b, dmg, a, 'ram');
          }
        }
      }
    }
  }

  explodeTorpedo(t) {
    this.events.push({ type: 'explosion', x: t.x, y: t.y, r: t.splash, color: t.color });
    const owner = this.players.get(t.owner);
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const d = dist(t, p) - p.stats.radius;
      if (d > t.splash) continue;
      const falloff = d <= 0 ? 1 : 1 - d / t.splash;
      const dmg = t.damage * (0.4 + 0.6 * falloff);
      // Self-damage is halved so torpedoes are risky up close but not suicidal.
      this.applyDamage(p, p.id === t.owner ? dmg * 0.5 : dmg, owner, 'torpedo');
    }
    for (const a of this.asteroids) {
      const d = dist(t, a) - a.r;
      if (d > t.splash) continue;
      this.damageAsteroid(a, t.damage * (d <= 0 ? 1 : 1 - d / t.splash));
    }
  }

  damageAsteroid(a, amount) {
    a.hp -= amount;
    if (a.hp > 0) return;
    this.asteroids = this.asteroids.filter((x) => x !== a);
    this.events.push({ type: 'rockBreak', x: a.x, y: a.y, r: a.r });
    const def = ASTEROID_SIZES[a.size];
    if (def.splitInto) {
      for (let i = 0; i < def.count; i++) {
        const child = this.spawnAsteroid(def.splitInto, { x: a.x + rand(-a.r / 2, a.r / 2), y: a.y + rand(-a.r / 2, a.r / 2) });
        child.vx += a.vx; child.vy += a.vy;
        wrapPos(child);
      }
    }
  }

  collectItem(p, item) {
    const def = POWERUP_BY_TYPE[item.type];
    if (!def) return;
    if (def.ability) {
      p.boosts[def.ability] = (p.boosts[def.ability] || 0) + def.amount;
      const before = p.stats.maxHp;
      p.stats = deriveStats(p.build, p.boosts);
      if (p.stats.maxHp > before) p.hp += p.stats.maxHp - before;
    } else if (def.type === 'repair') {
      p.hp = Math.min(p.stats.maxHp, p.hp + p.stats.maxHp * 0.5);
    }
    p.pickups.push(def.type);
    this.events.push({ type: 'pickup', id: p.id, itemType: def.type, x: item.x, y: item.y, color: def.color });
  }

  applyDamage(target, amount, attacker, weapon) {
    if (!target.alive || amount <= 0) return;
    if (this.time < target.invulnUntil) return;
    const dealt = amount * (1 - target.stats.shield);
    target.hp -= dealt;
    target.lastHitAt = this.time;
    if (attacker && attacker !== target) target.lastHitBy = { id: attacker.id, at: this.time };
    if (target.hp <= 0) this.kill(target, attacker, weapon);
  }

  kill(victim, attacker, weapon) {
    victim.alive = false;
    victim.hp = 0;
    victim.deaths++;
    victim.respawnAt = this.time + this.opts.respawnSeconds;
    victim.boosts = {};
    victim.pickups = [];
    victim.stats = deriveStats(victim.build, victim.boosts);
    this.decloak(victim);

    // Environmental deaths credit whoever damaged the victim in the last 5s.
    let killer = attacker && attacker !== victim ? attacker : null;
    if (!killer && victim.lastHitBy && this.time - victim.lastHitBy.at < 5) {
      killer = this.players.get(victim.lastHitBy.id) || null;
    }
    if (killer) {
      killer.kills++;
      killer.score += this.opts.killPoints;
    } else if (attacker === victim) {
      victim.score = Math.max(0, victim.score - 1);
    }
    victim.lastDeath = { by: killer ? killer.name : null, weapon, at: this.time };
    this.events.push({
      type: 'kill',
      victim: { id: victim.id, name: victim.name, color: victim.color },
      killer: killer ? { id: killer.id, name: killer.name, color: killer.color } : null,
      weapon,
    });
    this.events.push({ type: 'explosion', x: victim.x, y: victim.y, r: victim.stats.radius * 3, color: victim.color, ship: true });
  }

  // ----------------------------------------------------------------- snapshot
  /** Build the snapshot visible to `viewerId` (cloaked enemies are omitted). */
  snapshotFor(viewerId, events) {
    const ships = [];
    for (const p of this.players.values()) {
      const cloaked = p.cloakedUntil > this.time;
      const isSelf = p.id === viewerId;
      if (!p.alive) {
        if (isSelf) {
          ships.push({ id: p.id, dead: true, respawnIn: Math.max(0, p.respawnAt - this.time), lastDeath: p.lastDeath });
        }
        continue;
      }
      if (cloaked && !isSelf) continue;
      const s = {
        id: p.id,
        x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10,
        a: Math.round(p.angle * 1000) / 1000,
        vx: Math.round(p.vx), vy: Math.round(p.vy),
        hp: Math.round(p.hp), mhp: Math.round(p.stats.maxHp),
        r: Math.round(p.stats.radius * 10) / 10,
        th: p.input.thrust ? 1 : p.input.reverse ? 2 : 0,
        inv: p.invulnUntil > this.time ? 1 : 0,
        ck: cloaked ? 1 : 0,
        sh: Math.round(p.stats.shield * 100),
      };
      if (isSelf) {
        s.self = {
          // Exact state for client-side prediction / reconciliation.
          px: p.x, py: p.y, pvx: p.vx, pvy: p.vy, pa: p.angle,
          seq: p.inputSeq, ticks: p.inputTicks,
          turnRate: p.stats.turnRate, accel: p.stats.accel, maxSpeed: p.stats.maxSpeed,
          laserCd: Math.max(0, p.laserReadyAt - this.time),
          torpCd: Math.max(0, p.torpedoReadyAt - this.time),
          torpMax: p.stats.torpedoCooldown,
          cloakCd: Math.max(0, p.cloakReadyAt - this.time),
          cloakMax: p.stats.cloakCooldown,
          cloakLeft: Math.max(0, p.cloakedUntil - this.time),
          cloakDur: p.stats.cloakDuration,
          laserRange: p.stats.laserRange,
          torpRange: p.stats.torpedoRange,
          regen: p.stats.hpRegen,
          pickups: p.pickups,
        };
      }
      ships.push(s);
    }
    return {
      t: Math.round(this.time * 1000) / 1000,
      match: { state: this.match.state, remaining: Math.max(0, this.match.remaining), number: this.match.number, intermission: Math.max(0, this.match.intermission), results: this.match.state === 'ended' ? this.match.results : undefined },
      ships,
      lasers: this.lasers.map((l) => [l.id, Math.round(l.x), Math.round(l.y), Math.round(l.angle * 100) / 100, l.owner]),
      torps: this.torpedoes.map((t) => [t.id, Math.round(t.x), Math.round(t.y), Math.round(t.angle * 100) / 100, t.owner]),
      items: this.items.map((i) => [i.id, i.type, Math.round(i.x), Math.round(i.y)]),
      rocks: this.asteroids.map((a) => [a.id, Math.round(a.x), Math.round(a.y), a.r, Math.round(a.rot * 100) / 100, a.seed]),
      players: [...this.players.values()].map((p) => ({ id: p.id, name: p.name, color: p.color, theme: p.theme, score: p.score, kills: p.kills, deaths: p.deaths, bot: p.isBot ? 1 : 0, alive: p.alive ? 1 : 0 })),
      events,
    };
  }
}
