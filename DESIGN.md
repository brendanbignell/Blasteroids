# Blasteroids — Game & Technical Design

## 1. Overview

Blasteroids is a top-down, 2D, real-time multiplayer space shooter. Every player pilots a
single ship in one shared arena; the look is a modern take on *Asteroids*: neon-outlined vector
ships, glowing lasers, drifting rocks and a parallax starfield. The game runs in any modern
browser and connects over WebSockets to a Node.js server (Linux-friendly, no native
dependencies) that owns the authoritative game state.

Core loop:

1. **Hangar** – pick a call sign, colour and hull style, spend credits on eleven ship abilities.
2. **Launch** – join the arena mid-match; respawn in a quiet spot with brief invulnerability.
3. **Fight** – score a point per kill, grab power-ups, survive.
4. **Match end** – results after the fixed match time, 3 s intermission, scores reset, repeat.

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

### Hull styles

Players choose a purely cosmetic hull: Arrowhead, Explorer (saucer and nacelles), X-Fighter,
Interceptor (ball cockpit, hexagonal panels), Wedge Cruiser, Saucer or Retro Vector. All are
drawn procedurally in `client/js/shipart.js` within the same collision radius, so the choice
never affects gameplay. The server validates the choice and reserves the drone hull for bots.

## 3. Combat

* **Lasers** are the precise weapon: fast (900 px/s), thin beam streaks in the shooter's
  colour, range from the build, 4 shots/s.
* **Torpedoes** are the area weapon: slow (360 px/s) pulsing plasma orbs with an ember trail,
  a proximity fuse and splash damage with linear falloff, shown by a shockwave ring the size
  of the blast. The owner takes half damage from their own blast, so point-blank use is risky.
  A light **seeker** locks onto the nearest visible enemy within 420 px and ±57° of its
  heading and curves toward it at up to 1.6 rad/s, so a torpedo fired roughly at someone will
  chase them but can be out-turned. The locked player sees a red reticle on the torpedo and a
  flashing MISSILE LOCK warning.
* **Cloak** makes a ship disappear from everyone else's snapshots entirely (not just
  transparent on the client, so no "see cloaked ships" hack is possible). Weapons are locked
  while cloaked, so cloak is for escaping or repositioning, not ambushing. Pressing `C` again
  drops the cloak early, and the cooldown runs from when the cloak actually ends. Bots and torpedo
  seekers cannot target cloaked ships.
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
(`server/bot.js`) that makes a decision every reaction interval:

* pick the nearest, weakest, visible (non-cloaked, non-protected) enemy within sight range;
* lead the target for laser shots, with an aim error re-rolled each decision around a per-bot
  bias; keep a stand-off distance; plan turns so they stop on target instead of overshooting;
* use torpedoes at mid range, cloak when low on health (higher skills only);
* steer away from asteroids; otherwise chase power-ups or wander between waypoints.

**Skill levels** (`BOT_SKILLS` in `shared/stats.js`) apply server-wide:

| Level | Reaction | Aim error | Leads target | Sight | Build credits |
| --- | --- | --- | --- | --- | --- |
| Rookie | 0.35–0.5 s | ±0.4 rad | no | 650 px | 60 % |
| Pilot (default) | 0.2–0.3 s | ±0.22 rad | half | 850 px | 80 % |
| Veteran | 0.08–0.16 s | ±0.12 rad | fully | 1100 px | 100 % |
| Ace | 0.05–0.08 s | ±0.04 rad | fully | 1300 px | 100 % |

Against a weaving pilot who never shoots back, three bots score roughly 1 / 3 / 5.5 / 6 kills
per two minutes from Rookie to Ace. Changing the level re-budgets existing bots immediately.

The server starts with `BOTS` bots (default 3) at `BOT_SKILL` (default `pilot`). Players can
change the bot count (0–`MAX_BOTS`) and skill from the hangar, rate limited, unless the
operator sets `ALLOW_BOT_CONTROL=false`.

Bots are visually distinct: they always fly a reserved drone hull with a red scanning eye,
their names carry a ⚙ and are italic, and they are diamonds on the minimap.

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
* **Interpolation**: other ships, projectiles and rocks are drawn 100 ms behind the server
  clock, linearly interpolating positions (with wrap-aware deltas) and angles between the last
  30 snapshots. Snapshots are placed by their server timestamp `t` against a smoothed estimate
  of the server clock, not by arrival time, so network jitter doesn't make motion stutter.
* **Prediction**: the local ship responds to input immediately. The client runs the same
  movement code as the server (`shared/physics.js`) at the server tick rate, tagging every
  tick with the current input sequence number. Snapshots carry the ship's exact state plus the
  input `seq` the server is using and how many `ticks` it has applied it for; the client resets
  to that state and replays only the ticks the server hasn't simulated yet
  (`client/js/predict.js`). Small corrections (collisions, timing) are blended out over a few
  frames; large ones (respawn) snap. Only movement is predicted — firing, damage and
  collisions remain purely server-side, so cheating is no easier than before.
* **Visuals**: parallax starfield (four tiled layers), nebula gradients, procedurally drawn
  ships with glow, engine flames, shield rings, hit flashes, particle explosions, camera shake,
  seeded asteroid polygons cached per rock id, minimap with viewport rectangle.
* **Sound** (`client/js/audio.js`): every effect is synthesised live with the Web Audio API
  (oscillators and filtered noise, no audio files). World sounds fade with distance from the
  camera (silent beyond ~1300 px) and pan left/right; other players' sounds are scheduled
  100 ms late to match the interpolated visuals, while our own play immediately. Effects cover
  lasers, torpedo launch and blast, ship explosions, hits, rock breaks, fizzles, power-up
  spawns and pickups, spawning, cloaking, kill confirmation, death, match start/end, a looping
  engine for our own thrust and a beeping missile-lock warning. Audio starts on the first key
  press or click (browser autoplay rules); `M` mutes, the hangar has a volume slider, and both
  are remembered in `localStorage`. At most 28 one-shot sounds play at once.
* **Music** (`client/js/music.js`): a procedural synthwave loop in A minor at 112 BPM, played
  by a step sequencer that schedules notes ~120 ms ahead on the audio clock. Every 4 bars it
  picks a new chord progression and arpeggio shape, and a pentatonic lead improvises in
  alternating 8-bar phrases, so it doesn't repeat exactly. Intensity follows the game: pad and
  slow arpeggio in the hangar and on the results screen; bass, drums, 16th-note arpeggio with
  echo and the lead during a match; four-on-the-floor kick, faster hats and a brighter filter
  in the last 30 s. Layers crossfade over ~1.5 s. Music has its own volume (mixed ~6 dB under
  the effects by default), `M` mutes everything, and it pauses while the tab is hidden.
* Reconnects automatically with backoff and drops back to the hangar if the socket closes.

### Protocol (JSON over WebSocket)

Client → server: `join {name,color,theme,build}`, `input {input:{thrust,reverse,left,right,fire,torpedo,cloak}, seq}`,
`leave`, `setBots {count}`, `setBotSkill {skill}`, `ping {t}`.

Server → client: `welcome {id,config}`, `lobby {...standings, match}`, `joined`, `left`,
`error {message}`, `state {t, match, ships, lasers, torps, items, rocks, players, events}`,
`pong`.

## 8. Possible extensions

* Predicting the local player's own shots so lasers appear instantly at the nose.
* Binary snapshot encoding and interest management (only send what is near the viewer) for
  larger player counts.
* Teams, capture points, or king-of-the-hill variants on top of the same simulation.
* Persistent accounts and leaderboards across matches.
* Optional sample-based sound packs on top of the synthesised audio.
