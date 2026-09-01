# Golf 🃏 — feebgolf.github.io

A static site for playing the six-card card game **Golf** with 2–4 players over
the internet. No server, no accounts: the site is plain HTML/CSS/JS on GitHub
Pages, and players connect directly to each other with WebRTC
([PeerJS](https://peerjs.com), free public broker).

## How to play

- **Create game** → you get a 4-letter room code (and a copyable invite link).
- Friends **Join** with the code. The host starts the game with 2–4 players.
- The host's browser runs the game; if the host closes their tab, the game ends.
  A player who accidentally refreshes can rejoin with the same name.

### House rules

- Everyone gets 6 face-down cards in a 2×3 grid; one card starts the discard.
- Before play, everyone flips 2 of their own cards. A random player goes first
  in round 1; after that, the loser of the previous round goes first.
- On your turn, either:
  1. **Take the discard** and swap it with any of your 6 cards, or
  2. **Draw** from the deck, then either **swap** it with any of your cards,
     or **discard it and flip** one of your face-down cards.
- When someone's last card is face up, every other player gets one more turn,
  then all cards are revealed and scored.
- **Scoring:** number cards = face value · A = 1 · **2 = −2** · J/Q = 10 · K = 0.
  Two cards of the same rank in a **column** cancel to 0 (yes, even two 2s).
  Lowest total wins; ties happen. Play as many rounds as you like — the
  scoreboard keeps a running total.
- If the deck runs out, the discard pile (minus its top card) is reshuffled.

## Development

```sh
python3 -m http.server 8000
```

- Game: http://localhost:8000 — open two tabs (one normal, one incognito) to
  play yourself. `file://` won't work; ES modules need a real origin.
- **Dev mode:** http://localhost:8000/?dev=1 — a local 3-player hot-seat game
  with a "play as" switcher and no networking. Good for UI work.
- Engine tests: http://localhost:8000/test.html (same tests as
  `node js/run-tests.mjs`).

### Code layout

| file | role |
|---|---|
| `js/game.js` | pure rules engine — no DOM, no network |
| `js/net.js` | PeerJS transport — no DOM, no rules |
| `js/ui.js` | view → DOM rendering + input — no network, no rules |
| `js/main.js` | coordinator; the host runs the authoritative game state |

The host sends each player a **redacted** view: face-down card values never
leave the host's tab, so guests can't cheat via devtools. (The host machine
holds the deck and is trusted — it's a card game with your girlfriend, not a
casino.)

## Known limitations

- The free PeerJS broker has no TURN relay, so a small fraction of
  connections fail on restrictive NATs (most commonly two players on
  *different* mobile-carrier networks). Home wifi is fine. If it ever matters,
  add TURN `iceServers` to the `new Peer(...)` config in `js/net.js`.
- The game lives in the host's tab: host closes tab ⇒ game over.

## Deploying

1. Create the GitHub account/org `feebgolf` and a **public** repo named
   `feebgolf.github.io`.
2. Push this directory to `main`. Pages for `*.github.io` repos deploys
   automatically from the root (check Settings → Pages if not).
3. Done: https://feebgolf.github.io (HTTPS by default, which WebRTC requires).
   Pages caches for ~10 min — bump the `?v=` query on the script/style tags in
   `index.html` when shipping changes.
