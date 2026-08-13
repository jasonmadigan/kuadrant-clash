# Kuadrant Clash

A tiny, dependency-free rooftop fighting game, extracted from the Kuadrant Console Plugin easter egg.

## Play it

[jasonmadigan.github.io](https://jasonmadigan.github.io/kuadrant-clash)

## Run it locally

For Quick Fight and Tournament, open `index.html` directly. The JavaScript, CSS,
and fighter portraits are embedded in the file, so those modes work on any
static host with no build step.

For peer-to-peer multiplayer, start the included signalling server:

```sh
npm start
```

Then visit <http://127.0.0.1:8000>. Choose **Multiplayer**, pick a fighter, and
share the displayed challenge link. The other player opens it and chooses their
fighter. The server exchanges the WebRTC handshake; match inputs and state then
travel directly between the browsers over encrypted WebRTC data channels.

Controls:

- Left / Right arrows: move
- Up arrow: jump
- Down arrow: duck under punches and projectiles
- `A`: punch
- `S`: kick
- `D`: use your fighter's throwable special move
- `Enter`: rematch or continue a tournament
- `R`: return to fighter selection

Quick Fight starts a single match. Tournament mode runs through the available
roster before two boss fights. Health resets between tournament rounds, while
the bosses bring larger health pools, stronger attacks, and more aggressive AI.

Each fighter has a different special, including Policy Bolt, Reconcile Ring,
Frozen Route, TLS Fireball, and Rate Limit Disc. Specials recharge after use.
Jump with horizontal momentum to cross over an opponent and attack from the
other side.

Touch controls appear automatically on touch-first devices and in narrow browser
windows. Mobile layouts support portrait and landscape orientation, including
safe areas around notches and home indicators.

## Multiplayer deployment

The Node server has no third-party dependencies and serves both the game and the
long-poll signalling endpoint. Set `HOST` and `PORT` when deploying it:

```sh
HOST=0.0.0.0 PORT=8080 npm start
```

WebRTC requires HTTPS outside localhost. The default ICE configuration uses
Cloudflare's public STUN endpoint. For reliable connections across restrictive
NATs and firewalls, replace the `kuadrant-ice-servers` meta value in `index.html`
with your own authorized TURN configuration.

If the game remains on a static host such as GitHub Pages, deploy `server.mjs`
separately and set the `kuadrant-signaling-url` meta value to its HTTPS origin.
Challenge links automatically carry that signalling origin to the joining
player.

## Deploy it

For the single-player modes, copy `index.html` to any static host. For example,
with Python installed:

```sh
python3 -m http.server 8000
```

Then visit <http://localhost:8000>.

## Important policy note

Jason is unavailable after noon. Lunch service has commenced and the controller will not negotiate.
