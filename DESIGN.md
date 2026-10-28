# Blasteroids — Game & Technical Design

## 1. Overview

Blasteroids is a top-down, 2D, real-time multiplayer space shooter. Every player pilots a
single ship in one shared arena; the look is a modern take on *Asteroids*: neon-outlined vector
ships, glowing lasers, drifting rocks and a parallax starfield. The game runs in any modern
browser and connects over WebSockets to a Node.js server (Linux-friendly, no native
dependencies) that owns the authoritative game state.

Core loop:

1. **Hangar** – pick a call sign and colour, spend credits on eleven ship abilities.
2. **Launch** – join the arena mid-match; respawn in a quiet spot with brief invulnerability.
3. **Fight** – score a point per kill, grab power-ups, survive.
4. **Match end** – results after the fixed match time, 15 s intermission, scores reset, repeat.

## 2. Ship customisation

Each player receives a budget of **credits** (default 100, server-configurable). Points are
spent on abilities, **up to 50 per ability**. The eleven abilities and the formulas that turn
points `p` into gameplay numbers live in `shared/stats.js`, so the server and client never
disagree:

| Ability | 0 points | 50 points | Formula |
| --- | --- | --- | --- |
| Acceleration | 150 px/s², top 230 px/s | 450 px/s², top 430 px/s | `150 + 6p`, `230 + 4p` |
| Turning speed | 126°/s | 355°/s | `2.2 + 0.08p` rad/s |
| Size | radius 22 px | radius 10 px | `22 − 0.24p` (more points = smaller) |
| Shields | 0 % absorbed | 50 % absorbed | `p %` of incoming damage |
| Laser range | 260 px | 660 px | `260 + 8p` |
| Laser damage | 8 / bolt | 33 / bolt | `8 + 0.5p` (4 bolts/s) |
| Torpedo range | 320 px | 820 px | `320 + 10p` |
| Torpedo damage | 25 | 100 | `25 + 1.5p`, splash radius 70 px, 2.5 s reload |
| Cloaking time | none | 10 s | `0.2p` s per use, 12 s cooldown |
| Max hit points | 100 | 250 | `100 + 3p` |
| HP recovery | 0 | 15 HP/s | `0.3p` HP/s, pauses 1.5 s after being hit |

Design notes:

* The budget forces trade-offs: 100 credits is two maxed abilities, or a spread of ~9 each.
* Presets (Balanced, Glass cannon, Tank, Scout, Assassin, Artillery) give newcomers a start;
  "Random" produces a focused random build; everything is saved in `localStorage`.
* The server re-validates every build (`validateBuild`) — integers, 0–50 each, total within
  the server's credit budget — so a modified client gains nothing.
* Players can return to the hangar at any time (`Esc`) to re-spec, at the cost of leaving the
  match and losing their current temporary boosts (score is kept while the match runs).

## 3. Combat

* **Lasers** are hit-scan-feel projectiles (760 px/s) with range from the build, 4 shots/s.
* **Torpedoes** are slower (380 px/s), have a proximity fuse and splash damage with linear
  falloff; the owner takes half damage from their own blast, so point-blank use is risky.
* **Cloak** makes a ship disappear from everyone else's snapshots entirely (not just
  transparent on the client, so no "see cloaked ships" hack is possible). Firing breaks the
  cloak. Bots cannot target cloaked ships.
* **Asteroids** drift through the arena, block shots, split large → medium → small when
  destroyed, and damage ships on collision proportional to impact speed. They make the arena
  feel alive and give cover.
* **Ramming** deals modest damage to both ships at high closing speed.
* **Kills** award 1 point. Dying to an asteroid or your own torpedo within 5 s of being hit
  credits the last attacker; a pure self-kill costs 1 point (floored at 0).
* **Respawn** after 3 s at the spot farthest from live enemies and rocks, with 2.5 s of spawn
  protection (visible as a dashed ring).

## 4. Power-ups ("special items")

Every 5–10 s (max 8 on the field at once) an item spawns away from players and despawns if not
collected within 35 s. Running over it collects it. Each gives a small boost **until the player
dies** (boosts are cleared on death, not at match end):

| Item | Effect |
| --- | --- |
| Engine boost | +15 effective acceleration points |
| Gyro boost | +15 turning speed |
| Shield booster | +10 shields |
| Laser amplifier | +12 laser damage |
| Targeting optics | +15 laser range |
| Heavy warheads | +15 torpedo damage |
| Stealth coating | +15 cloaking time |
| Hull plating | +15 max HP (and heals by the same amount) |
| Repair nanites | +12 HP recovery |
| Rapid fire | laser reload ×0.75 (stacks) |
| Emergency repair | instant heal of 50 % max HP |

Boosts can push an ability past the 50-point build cap, up to 75 effective points. Collected
boosts show as icons under the HP bar.

## 5. AI bots

Bots are regular players with randomised preset-based builds and a small brain
(`server/bot.js`) that re-evaluates ~8 times per second:

* pick the nearest, weakest, visible (non-cloaked, non-protected) enemy within 1100 px;
* lead the target for laser shots with a per-bot aim error; keep a stand-off distance;
* use torpedoes at mid range, cloak when low on health;
* steer away from asteroids; otherwise chase power-ups or wander between waypoints.

The server starts with `BOTS` bots (default 3). Players can add or remove bots from the hangar
(0–`MAX_BOTS`), unless the operator sets `ALLOW_BOT_CONTROL=false`.

## 6. Match flow

* Each match lasts `MATCH_SECONDS` (default 5 minutes). A timer is always visible; the last 30 s
  pulse red.
* At zero, combat freezes, a results table (points, kills, deaths, winner) is shown for
  `INTERMISSION_SECONDS`, then a new match starts: scores reset, everyone respawns, rocks and
  items are regenerated. Builds are kept.
* Players may join or leave at any point; the lobby shows live standings and the time left.

## 7. Architecture

```
 Browser (client/)                              Linux server (server/)
 ┌──────────────────────────┐   WebSocket JSON  ┌──────────────────────────────┐
 │ main.js  state machine   │ ───── input ────► │ index.js  HTTP static + WS   │
 │ lobby.js customisation   │ ◄── snapshots ─── │ game.js   simulation 60 Hz   │
 │ render.js canvas, interp │                   │ bot.js    AI pilots          │
 │ hud.js   DOM overlay     │                   │ util.js   toroidal maths     │
 │ net.js / input.js        │                   └──────────────────────────────┘
 └──────────────────────────┘                           ▲
            ▲                                           │
            └──────────── shared/stats.js ──────────────┘
```

### Server

* **Authoritative simulation** (`Game.step`) at 60 Hz with fixed time steps; clients only send
  intentions (thrust/turn/fire flags), never positions.
* **Snapshots** at 20 Hz. Each client receives a personalised snapshot (`snapshotFor`) so cloaked
  enemies and other players' cooldowns are never transmitted. Projectiles, rocks and items use
  compact arrays; a 12-ship scene is roughly 3 KB per snapshot.
* **Events** (kills, explosions, pickups, match start/end) are queued during simulation and
  flushed with the next snapshot so clients can play effects exactly once.
* **World** is a 4200 × 3000 torus; everything wraps and all distance maths uses the shortest
  wrapped delta.
* Pure logic is separated from networking, which makes the simulation unit-testable
  (`test/game.test.js` runs hundreds of simulated seconds with 12 bots in well under a second).
* No native modules; the only dependency is `ws`. Runs under systemd or Docker (see `deploy/`).

### Client

* Vanilla ES modules, no build step; Canvas 2D for the world, DOM for the HUD and hangar.
* **Interpolation**: the renderer keeps the last 30 snapshots and renders 100 ms in the past,
  linearly interpolating positions (with wrap-aware deltas) and angles, which hides the 20 Hz
  update rate. There is no client-side prediction; the design accepts ~RTT/2 + 100 ms input
  latency, which is fine for LAN/regional play and keeps the client simple and cheat-free.
* **Visuals**: parallax starfield (four tiled layers), nebula gradients, procedurally drawn
  ships with glow, engine flames, shield rings, hit flashes, particle explosions, camera shake,
  seeded asteroid polygons cached per rock id, minimap with viewport rectangle.
* Reconnects automatically with backoff and drops back to the hangar if the socket closes.

### Protocol (JSON over WebSocket)

Client → server: `join {name,color,build}`, `input {thrust,reverse,left,right,fire,torpedo,cloak}`,
`leave`, `setBots {count}`, `ping {t}`.

Server → client: `welcome {id,config}`, `lobby {...standings, match}`, `joined`, `left`,
`error {message}`, `state {t, match, ships, lasers, torps, items, rocks, players, events}`,
`pong`.

## 8. Possible extensions

* Client-side prediction / reconciliation for the local ship if higher-latency play matters.
* Binary snapshot encoding and interest management (only send what is near the viewer) for
  larger player counts.
* Teams, capture points, or king-of-the-hill variants on top of the same simulation.
* Persistent accounts and leaderboards across matches.
* Sound effects and music (all the event hooks already exist on the client).
