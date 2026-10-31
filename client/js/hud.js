// DOM-based heads-up display.

import { POWERUP_BY_TYPE } from '/shared/stats.js';

const WEAPON_VERB = { laser: 'lasered', torpedo: 'torpedoed', ram: 'rammed', asteroid: 'crashed into an asteroid' };

export class Hud {
  constructor() {
    this.el = {
      root: document.getElementById('hud'),
      hpFill: document.getElementById('hp-fill'),
      hpText: document.getElementById('hp-text'),
      laser: document.getElementById('meter-laser'),
      torp: document.getElementById('meter-torp'),
      cloak: document.getElementById('meter-cloak'),
      pickups: document.getElementById('pickups'),
      timer: document.getElementById('timer'),
      matchLabel: document.getElementById('match-label'),
      scoreboard: document.getElementById('scoreboard'),
      killfeed: document.getElementById('killfeed'),
      minimap: document.getElementById('minimap'),
      center: document.getElementById('center-msg'),
      lock: document.getElementById('lock-warning'),
      results: document.getElementById('results'),
      net: document.getElementById('net-status'),
    };
    this.mctx = this.el.minimap.getContext('2d');
    this.selfId = null;
    this.feed = [];
    this._lastScoreKey = '';
    this._lastPickupsKey = '';
  }

  show() { this.el.root.hidden = false; }
  hide() { this.el.root.hidden = true; this.el.results.hidden = true; this.el.center.hidden = true; this.el.lock.hidden = true; this.feed = []; this.el.killfeed.innerHTML = ''; }

  addKill(ev) {
    const killer = ev.killer ? `<span style="color:${ev.killer.color}">${esc(ev.killer.name)}</span>` : null;
    const victim = `<span style="color:${ev.victim.color}">${esc(ev.victim.name)}</span>`;
    let html;
    if (killer) html = `${killer}<span class="w">${WEAPON_VERB[ev.weapon] || 'destroyed'}</span>${victim}`;
    else html = `${victim}<span class="w">${ev.weapon === 'asteroid' ? 'crashed into an asteroid' : 'self-destructed'}</span>`;
    const div = document.createElement('div');
    div.className = 'kf' + ((ev.killer && ev.killer.id === this.selfId) || ev.victim.id === this.selfId ? ' me' : '');
    div.innerHTML = html;
    this.el.killfeed.prepend(div);
    this.feed.push({ el: div, until: performance.now() + 7000 });
    while (this.feed.length > 6) this.feed.shift().el.remove();
  }

  addNotice(text, color = '#dfe8ff') {
    const div = document.createElement('div');
    div.className = 'kf';
    div.style.color = color;
    div.textContent = text;
    this.el.killfeed.prepend(div);
    this.feed.push({ el: div, until: performance.now() + 5000 });
    while (this.feed.length > 6) this.feed.shift().el.remove();
  }

  update(view, renderer, { showScores, rtt, connected }) {
    const now = performance.now();
    this.feed = this.feed.filter((f) => { if (f.until < now) { f.el.remove(); return false; } return true; });

    const me = view.ships.find((s) => s.id === this.selfId);
    const match = view.match;

    // Timer
    const rem = Math.ceil(match.remaining);
    this.el.timer.textContent = `${Math.floor(rem / 60)}:${String(rem % 60).padStart(2, '0')}`;
    this.el.timer.classList.toggle('urgent', match.state === 'playing' && rem <= 30);
    this.el.matchLabel.textContent = `Match ${match.number}`;

    // Self status
    if (me && !me.dead) {
      const frac = Math.max(0, me.hp / me.mhp);
      this.el.hpFill.style.width = `${frac * 100}%`;
      this.el.hpFill.className = 'fill' + (frac < 0.25 ? ' low' : frac < 0.5 ? ' mid' : '');
      this.el.hpText.textContent = `${Math.round(me.hp)} / ${me.mhp}${me.self?.regen ? `  (+${me.self.regen.toFixed(1)}/s)` : ''}`;
      const s = me.self || {};
      const cloaked = s.cloakLeft > 0; // weapons are locked while cloaked
      setMeter(this.el.laser, 1, false, cloaked);
      setMeter(this.el.torp, 1 - (s.torpCd || 0) / (s.torpMax || 1), false, cloaked);
      if (!s.cloakDur) setMeter(this.el.cloak, 0, false, true);
      else if (s.cloakLeft > 0) setMeter(this.el.cloak, s.cloakLeft / s.cloakDur, true, false);
      else setMeter(this.el.cloak, 1 - (s.cloakCd || 0) / (s.cloakMax || 1), false, false);
      const pk = (s.pickups || []).join(',');
      if (pk !== this._lastPickupsKey) {
        this._lastPickupsKey = pk;
        this.el.pickups.innerHTML = '';
        for (const t of s.pickups || []) {
          const def = POWERUP_BY_TYPE[t]; if (!def) continue;
          const d = document.createElement('div');
          d.className = 'pu'; d.style.color = def.color; d.title = def.label; d.textContent = def.glyph;
          this.el.pickups.appendChild(d);
        }
      }
    }

    // Centre message (dead / intermission)
    if (match.state === 'ended' && match.results) {
      this.el.center.hidden = true;
      this.showResults(match);
    } else {
      this.el.results.hidden = true;
      if (me && me.dead) {
        const by = me.lastDeath?.by;
        const how = me.lastDeath?.weapon;
        this.el.center.hidden = false;
        this.el.center.innerHTML = `<h2>DESTROYED</h2><p>${by ? `by ${esc(by)}` : how === 'asteroid' ? 'asteroid collision' : 'self-inflicted'}</p><div class="big">${Math.ceil(me.respawnIn)}</div><p>respawning…</p>`;
      } else {
        this.el.center.hidden = true;
      }
    }

    // Scoreboard
    const sorted = [...view.players].sort((a, b) => b.score - a.score || a.deaths - b.deaths);
    const rows = showScores ? sorted : sorted.slice(0, 6);
    const key = rows.map((p) => `${p.id}:${p.score}:${p.kills}:${p.deaths}:${p.alive}`).join('|') + (showScores ? 'F' : 'S');
    if (key !== this._lastScoreKey) {
      this._lastScoreKey = key;
      let html = '<tr><th>Pilot</th><th>Pts</th>' + (showScores ? '<th>K</th><th>D</th>' : '') + '</tr>';
      rows.forEach((p, i) => {
        html += `<tr class="${p.id === this.selfId ? 'me' : ''} ${p.alive ? '' : 'dead'}"><td><span class="dot" style="color:${p.color};background:${p.color}"></span>${esc(p.name)}${p.bot ? '<span class="bot">BOT</span>' : ''}</td><td class="num">${p.score}</td>` + (showScores ? `<td class="num">${p.kills}</td><td class="num">${p.deaths}</td>` : '') + '</tr>';
      });
      if (!showScores && sorted.length > rows.length) html += `<tr><td colspan="2" style="color:var(--muted);font-size:11px">+${sorted.length - rows.length} more · hold Tab</td></tr>`;
      this.el.scoreboard.innerHTML = html;
    }

    renderer.drawMinimap(this.mctx, view, this.el.minimap.width, this.el.minimap.height);
    this.el.lock.hidden = !renderer.lockedOnMe;

    this.el.net.textContent = connected ? `${Math.round(rtt)} ms` : 'reconnecting…';
    this.el.net.classList.toggle('bad', !connected || rtt > 250);
  }

  showResults(match) {
    if (!this.el.results.hidden && this._resultsNumber === match.number) {
      this.el.results.querySelector('.next').textContent = `Next match in ${Math.ceil(match.intermission)}s`;
      return;
    }
    this._resultsNumber = match.number;
    const res = match.results;
    const winner = res[0];
    let rows = '';
    res.forEach((p, i) => {
      rows += `<tr class="${p.id === this.selfId ? 'me' : ''}"><td>${i + 1}.</td><td><span style="color:${p.color}">${esc(p.name)}</span>${p.isBot ? ' <span style="color:var(--muted);font-size:11px">BOT</span>' : ''}</td><td class="num">${p.score} pts</td><td class="num">${p.kills} K / ${p.deaths} D</td></tr>`;
    });
    this.el.results.innerHTML = `<div class="box"><h2>MATCH ${match.number} OVER</h2><div class="winner">${winner ? `🏆 ${esc(winner.name)} wins with ${winner.score} point${winner.score === 1 ? '' : 's'}` : 'No contest'}</div><table>${rows}</table><div class="next">Next match in ${Math.ceil(match.intermission)}s</div></div>`;
    this.el.results.hidden = false;
  }
}

function setMeter(el, frac, active, na) {
  el.style.setProperty('--p', `${Math.max(0, Math.min(1, frac)) * 100}%`);
  el.classList.toggle('active', active);
  el.classList.toggle('na', na);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
