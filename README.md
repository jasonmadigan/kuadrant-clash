# Kuadrant Clash

A tiny, dependency-free rooftop fighting game, extracted from the Kuadrant Console Plugin easter egg.

## Play it

[jasonmadigan.github.io](https://jasonmadigan.github.io/kuadrant-clash)

## Run it locally

Open `index.html` directly, or serve the repository with any static file server.
The JavaScript, CSS, fighter portraits, and multiplayer handshake are embedded
in the file, so there is no build step or application server.

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

## Multiplayer

Multiplayer uses a manual WebRTC handshake so it can run from a completely
static site:

1. The host chooses **Multiplayer**, picks a fighter, and sends the generated
   challenge link to the other player.
2. The guest opens the link, picks a fighter, and sends the generated answer
   code back to the host.
3. The host pastes that answer into the original game tab and selects
   **Connect**.

Keep both game tabs open during the exchange. The WebRTC offer is stored in the
challenge URL fragment, so it is not sent to the static web host. After the
answer is pasted, match inputs and state travel directly between the browsers
over encrypted WebRTC data channels.

The default ICE configuration uses Cloudflare's public STUN endpoint for NAT
discovery. There is deliberately no TURN relay, so multiplayer may not connect
between some restrictive corporate or mobile networks.

## Deploy it

Copy `index.html` to any static host. For local testing with Python installed:

```sh
python3 -m http.server 8000
```

Then visit <http://localhost:8000>.

## Important policy note

Jason is unavailable after noon. Lunch service has commenced and the controller will not negotiate.
