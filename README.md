# Blasteroids

A browser-based multiplayer space arena in the spirit of *Asteroids*, with a modern neon look.
Players customise a ship with a budget of credits, then join a shared, server-authoritative
battle against each other and optional AI bots. Matches last a fixed time, kills score points,
and power-ups that drop around the arena give temporary boosts until you die.

See [DESIGN.md](DESIGN.md) for the full game and technical design.

## Quick start

Requirements: Node.js 18 or newer (tested on 22) on Linux, macOS or Windows.

```bash
npm install
npm start            # http://localhost:8080
```

Open the URL in one or more browser tabs (or on other machines on your network), set up a ship
and press **Launch**.

Run the test suite with:

```bash
npm test
```

## Controls

| Key | Action |
| --- | --- |
| `W` / `↑` | Thrust |
| `S` / `↓` | Brake / reverse thrust |
| `A` `D` / `←` `→` | Turn |
| `Space` | Fire laser |
| `X`, `Enter` or `Shift` | Fire torpedo |
| `C` | Cloak |
| `Tab` (hold) | Full scoreboard |
| `Esc` | Back to the hangar to re-customise |

## Configuration

All settings are environment variables read by `server/index.js`.

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8080` | HTTP/WebSocket port |
| `HOST` | `0.0.0.0` | Bind address |
| `MATCH_SECONDS` | `300` | Length of each match |
| `INTERMISSION_SECONDS` | `3` | Results screen between matches |
| `CREDITS` | `100` | Customisation credits per player |
| `BOTS` | `3` | Bots present at start-up |
| `MAX_BOTS` | `12` | Upper limit players can raise the bot count to |
| `BOT_SKILL` | `pilot` | Starting bot skill: `rookie`, `pilot`, `veteran` or `ace` |
| `ALLOW_BOT_CONTROL` | `true` | Set to `false` to stop players changing the bot count and skill |
| `MAX_PLAYERS` | `32` | Maximum simultaneous human players |
| `TICK_HZ` | `60` | Simulation rate |
| `SNAPSHOT_HZ` | `20` | State broadcast rate |

`GET /health` returns a small JSON status for load balancers and monitoring.

## Running on a Linux server

### systemd

```bash
sudo useradd --system --home /opt/blasteroids --shell /usr/sbin/nologin blasteroids
sudo git clone https://github.com/brendanbignell/Blasteroids /opt/blasteroids
cd /opt/blasteroids && sudo npm ci --omit=dev
sudo cp deploy/blasteroids.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now blasteroids
```

Edit the `Environment=` lines in the unit file to change match length, bots and so on.
Put nginx, Caddy or any other reverse proxy in front of it for TLS; WebSocket upgrade must be
passed through (the client connects to `/ws` on the same origin). A sample nginx location block
is in `deploy/nginx.conf.example`.

### Docker

```bash
docker build -t blasteroids -f deploy/Dockerfile .
docker run -d --name blasteroids -p 8080:8080 -e BOTS=4 -e MATCH_SECONDS=240 blasteroids
```

## Project layout

```
server/   Node.js game server (HTTP static files + WebSocket + simulation)
shared/   Ship stat model shared by server and browser
client/   Browser client (vanilla ES modules, Canvas 2D)
test/     node:test suites for the stat model and the simulation
deploy/   systemd unit, Dockerfile and nginx example
```
