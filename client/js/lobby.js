// Ship customisation screen.

import { ABILITIES, ABILITY_KEYS, MAX_POINTS, PRESETS, buildCost, deriveStats, describeStat, emptyBuild, SHIP_COLORS } from '/shared/stats.js';
import { drawShip } from './shipart.js';

const STORAGE_KEY = 'blasteroids.pilot';

export class Lobby {
  constructor(net, { onLaunch }) {
    this.net = net;
    this.onLaunch = onLaunch;
    this.credits = 100;
    this.build = emptyBuild();
    this.color = SHIP_COLORS[0];
    this.serverBots = 0;
    this.maxBots = 12;
    this.allowBotControl = true;
    this.el = {
      root: document.getElementById('lobby'),
      name: document.getElementById('name'),
      colors: document.getElementById('colors'),
      preview: document.getElementById('ship-preview'),
      abilities: document.getElementById('abilities'),
      presets: document.getElementById('presets'),
      creditsLeft: document.getElementById('credits-left'),
      creditsTotal: document.getElementById('credits-total'),
      creditsBox: document.querySelector('.credits'),
      launch: document.getElementById('launch'),
      error: document.getElementById('lobby-error'),
      status: document.getElementById('server-status'),
      botsCount: document.getElementById('bots-count'),
      botsMinus: document.getElementById('bots-minus'),
      botsPlus: document.getElementById('bots-plus'),
      liveMatch: document.getElementById('live-match'),
      livePlayers: document.getElementById('live-players'),
    };
    this.restore();
    this.buildUI();
    this.refresh();
    this.animatePreview();
  }

  restore() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (saved) {
        this.el.name.value = saved.name || '';
        if (SHIP_COLORS.includes(saved.color)) this.color = saved.color;
        if (saved.build) for (const k of ABILITY_KEYS) this.build[k] = Math.max(0, Math.min(MAX_POINTS, saved.build[k] | 0));
      } else {
        Object.assign(this.build, PRESETS.Balanced);
      }
    } catch { Object.assign(this.build, PRESETS.Balanced); }
  }

  persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ name: this.el.name.value, color: this.color, build: this.build })); } catch { /* ignore */ }
  }

  buildUI() {
    // Colour swatches
    for (const c of SHIP_COLORS) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'swatch'; b.style.background = c; b.style.color = c; b.title = c;
      b.onclick = () => { this.color = c; this.refresh(); };
      this.el.colors.appendChild(b);
    }
    // Presets
    for (const [name, preset] of Object.entries(PRESETS)) {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = name;
      b.onclick = () => { this.build = { ...emptyBuild(), ...preset }; this.refresh(); };
      this.el.presets.appendChild(b);
    }
    document.getElementById('randomize').onclick = () => this.randomize();
    document.getElementById('reset').onclick = () => { this.build = emptyBuild(); this.refresh(); };

    // Ability sliders
    this.sliders = {};
    for (const ab of ABILITIES) {
      const row = document.createElement('div');
      row.className = 'ability';
      row.title = ab.desc;
      row.innerHTML = `
        <span class="label">${ab.label}</span>
        <span class="pts" data-pts>0</span>
        <input type="range" min="0" max="${MAX_POINTS}" step="1" value="0" data-key="${ab.key}" />
        <span class="stat" data-stat></span>`;
      const input = row.querySelector('input');
      input.oninput = () => this.setPoints(ab.key, Number(input.value));
      this.el.abilities.appendChild(row);
      this.sliders[ab.key] = { input, pts: row.querySelector('[data-pts]'), stat: row.querySelector('[data-stat]') };
    }

    this.el.name.oninput = () => this.persist();
    this.el.launch.onclick = () => this.launch();
    this.el.botsMinus.onclick = () => this.net.send({ type: 'setBots', count: this.serverBots - 1 });
    this.el.botsPlus.onclick = () => this.net.send({ type: 'setBots', count: this.serverBots + 1 });
  }

  setPoints(key, value) {
    const others = buildCost(this.build) - this.build[key];
    this.build[key] = Math.max(0, Math.min(MAX_POINTS, value, this.credits - others));
    this.refresh();
  }

  randomize() {
    const b = emptyBuild();
    let left = this.credits;
    const keys = [...ABILITY_KEYS].sort(() => Math.random() - 0.5);
    // Weighted random spread: concentrate on 4-7 abilities.
    const focus = keys.slice(0, 4 + Math.floor(Math.random() * 4));
    while (left > 0) {
      const k = focus[Math.floor(Math.random() * focus.length)];
      if (b[k] < MAX_POINTS) { b[k]++; left--; }
      else if (focus.every((f) => b[f] >= MAX_POINTS)) break;
    }
    this.build = b;
    this.refresh();
  }

  refresh() {
    const cost = buildCost(this.build);
    const stats = deriveStats(this.build);
    this.el.creditsLeft.textContent = this.credits - cost;
    this.el.creditsTotal.textContent = this.credits;
    this.el.creditsBox.classList.toggle('over', cost > this.credits);
    for (const k of ABILITY_KEYS) {
      const s = this.sliders[k];
      s.input.value = this.build[k];
      s.pts.textContent = this.build[k];
      s.stat.innerHTML = `<b>${describeStat(k, stats)}</b>`;
    }
    for (const sw of this.el.colors.children) sw.classList.toggle('active', sw.title === this.color);
    this.el.launch.disabled = !this.net.connected || cost > this.credits;
    this.persist();
  }

  applyConfig(cfg) {
    this.credits = cfg.credits;
    this.maxBots = cfg.maxBots;
    this.allowBotControl = cfg.allowBotControl;
    this.el.botsMinus.disabled = this.el.botsPlus.disabled = !cfg.allowBotControl;
    // Clamp a saved build that exceeds this server's credits.
    while (buildCost(this.build) > this.credits) {
      const k = ABILITY_KEYS.find((key) => this.build[key] > 0);
      if (!k) break;
      this.build[k]--;
    }
    this.refresh();
  }

  applyLobbyInfo(info) {
    this.serverBots = info.bots;
    this.el.botsCount.textContent = info.bots;
    this.el.botsMinus.disabled = !this.allowBotControl || info.bots <= 0;
    this.el.botsPlus.disabled = !this.allowBotControl || info.bots >= this.maxBots;
    const m = info.match;
    const mm = Math.floor(m.remaining / 60), ss = String(m.remaining % 60).padStart(2, '0');
    this.el.liveMatch.textContent = m.state === 'playing'
      ? `Match ${m.number} · ${mm}:${ss} left · ${info.humans} pilot${info.humans === 1 ? '' : 's'}, ${info.bots} bot${info.bots === 1 ? '' : 's'}`
      : `Match ${m.number} finished · next one starting soon`;
    this.el.livePlayers.innerHTML = '';
    for (const p of info.players.slice(0, 12)) {
      const li = document.createElement('li');
      li.innerHTML = `<span class="n ${p.bot ? 'bot' : ''}" style="color:${p.color}"></span><span>${p.score}</span>`;
      li.querySelector('.n').textContent = p.name;
      this.el.livePlayers.appendChild(li);
    }
  }

  setStatus(text, cls) {
    this.el.status.textContent = text;
    this.el.status.className = `server-status ${cls || ''}`;
    this.refresh();
  }

  showError(msg) {
    this.el.error.textContent = msg;
    this.el.error.hidden = !msg;
  }

  launch() {
    this.showError('');
    this.onLaunch({ name: this.el.name.value.trim() || 'Pilot', color: this.color, build: { ...this.build } });
  }

  show() { this.el.root.hidden = false; this.visible = true; }
  hide() { this.el.root.hidden = true; this.visible = false; }

  animatePreview() {
    const ctx = this.el.preview.getContext('2d');
    const tick = (t) => {
      if (this.visible !== false) {
        ctx.clearRect(0, 0, 120, 120);
        const stats = deriveStats(this.build);
        drawShip(ctx, { x: 60, y: 60, angle: -Math.PI / 2 + Math.sin(t / 900) * 0.25, radius: stats.radius * 1.6, color: this.color, thrust: 1, shieldPct: stats.shield * 100, time: t / 1000 });
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}
