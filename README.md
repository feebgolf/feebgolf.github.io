# feebgolf 🃏 — feebgolf.github.io

A static site for playing card games with your people over the internet. No
server, no accounts: the site is plain HTML/CSS/JS on GitHub Pages, and players
connect directly to each other with WebRTC ([PeerJS](https://peerjs.com), free
public broker).

| game | players | status |
|---|---|---|
| **Golf** (six-card) | 2–4 | playable |
| **Gin Rummy** (multi-deck, knocker vs. everyone) | 2–8 | playable |
| **Mahjong** (Hong Kong) | 4 | playable |

The host picks the game when they create the room; joiners get whatever the
host is running. Games in progress are registered but not offered in the menu.

## How to play

- **Create game** → pick a game, and you get a 4-letter room code (and a
  copyable invite link).
- Friends **Join** with the code. The host starts once enough players are in.
- The lobby shows the **house rules** for that game. The host can change them
  before the deal; everyone else sees them read-only.
- The host's browser runs the game; if the host closes their tab, the game ends.
  A player who accidentally refreshes can rejoin with the same name.

### Golf house rules

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

Two of these are lobby toggles: whether a matching column cancels, and whether
last round's loser opens the next one.

### Gin rummy house rules

This is the group version, not two-handed gin: **everyone plays against the
knocker at once**, and the deck count grows with the table.

- Decks scale so the stock is always worth drawing from — 2–3 players use one
  deck (2 players is exactly the classic 52-card game), 4–7 use two, 8 use
  three.
- Everyone gets 10 cards; one card is turned up to start the discard.
- On your turn, **draw** from the stock or **take** the discard, then throw one
  card away. You can't throw back the card you just took from the discard.
- **Melds** are three or more of a rank, or three or more in sequence in one
  suit (aces are low and runs don't wrap). Everything unmelded is *deadwood*:
  A = 1, face cards = 10, the rest at face value.
- **Knock** when the throw would leave you with 10 deadwood or less. Zero
  deadwood is **gin**.
- Then every opponent lays off what they can onto your melds — automatically,
  and never against gin — and pays you the difference between their deadwood
  and yours. If anyone *matches or beats* you, they **undercut**: they collect
  the difference plus 25 instead, and you get nothing from them.
- Gin pays a 25 bonus from each opponent. Running the stock out with nobody
  knocking is a dead hand: nobody scores.
- Highest running total wins. The knock limit, both bonuses, whether layoffs
  are allowed, and whether identical cards (from different decks) can form a
  set are all lobby toggles.

Your hand shows its melds tinted and a live deadwood count, so you can see
where you stand without doing the arithmetic.

### Mahjong house rules

Hong Kong / Cantonese, four players, with the common faan patterns rather than
the full table.

- 144 tiles (136 without flowers). Everyone gets 13; the dealer opens.
- Draw from the wall, then discard. Drawing a flower sets it aside and you take
  a replacement.
- After every discard there's a short window in which anyone may **pung**
  (a triplet) or **kong** (four), the player to the discarder's left may
  **chow** (a run), and anyone who can may declare **mahjong**. Mahjong beats
  kong beats pung beats chow; between equal claims the seat nearest the
  discarder wins. Anyone with nothing to claim is passed automatically, so the
  table only ever waits on a real decision — and the window closes on its own
  when the clock runs out.
- You can also declare a **concealed kong** from your own hand, or add a fourth
  tile to a pung you've already exposed. Either draws a replacement.
- A winning hand is four sets and a pair, or **seven pairs**, or **thirteen
  orphans**. It must be worth at least the minimum faan (3 by default) to be
  declared at all.
- **Faan**: all one suit 7 · all honours 10 · thirteen orphans 13 · seven pairs
  4 · mixed one suit 3 · all pungs 3 · all chows 1 · each dragon pung 1 · seat
  wind pung 1 · prevailing wind pung 1 · fully concealed 1 · self-draw 1 · each
  flower 1. Faan converts to points on the Hong Kong table (3 faan = 8, 4 = 16,
  … 13 = 384), or straight across as points if you prefer.
- **Paying**: on a self-draw all three losers pay the hand's value each. On a
  discard the winner collects the same total, and the house rule decides
  whether the discarder carries it alone or the three split it.
- The dealer keeps the deal after winning or after a washed-out hand;
  otherwise it passes left, and a full circuit moves the prevailing wind on.
- Highest running total wins.

Not included, deliberately: robbing the kong, last-tile bonuses, and the rare
limit hands (nine gates, heavenly hand, the great dragons and so on).

Tiles are drawn as a number over its suit mark (5 萬) rather than from the
Unicode mahjong block, because several of those code points default to emoji
presentation and a hand ends up a mix of flat glyphs and big coloured images
depending on the platform. Each tile's Unicode glyph is in its tooltip.

## Development

```sh
python3 -m http.server 8000
```

- Game: http://localhost:8000 — open two tabs (one normal, one incognito) to
  play yourself. `file://` won't work; ES modules need a real origin.
- **Dev mode:** http://localhost:8000/?dev=1 — a local hot-seat game with a
  "play as" switcher and no networking. Good for UI work. Add `&mode=gin` to
  hot-seat another game, and `&seats=8` to fill the table up to that game's
  maximum — which is how an 8-player gin hand gets tested without eight
  browser windows.
- Engine tests: http://localhost:8000/test.html (same tests as
  `node js/run-tests.mjs`). Both take a mode filter — `?mode=golf` and
  `node js/run-tests.mjs golf`.

### Code layout

| file | role |
|---|---|
| `js/main.js` | coordinator; the host runs the authoritative game state |
| `js/net.js` | PeerJS transport — no DOM, no rules |
| `js/ui.js` | the shell: menu, lobby, overlay chrome, toasts — no rules |
| `js/modes/registry.js` | the catalogue: the only place that knows which games exist |
| `js/modes/<game>/engine.js` | that game's pure rules — no DOM, no network |
| `js/modes/<game>/view.js` | that game's table: DOM + input, no rules |
| `js/cards.js` `js/cardui.js` `js/fx.js` | shared deck, card DOM, card-flight animations |
| `js/settings.js` | house-rule schemas: defaults and validation |
| `js/modes/contract-tests.js` | the interface every engine must satisfy |

Adding a game means writing an engine, a view and a test file under
`js/modes/<game>/`, then one entry in the registry. The engine is DOM-free so
`node js/run-tests.mjs` can run it; the view is the only half a guest
downloads, because guests never hold an engine.

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
- Bumping `?v=` on the `index.html` script tag busts `main.js` but **not the
  modules it imports**, so right after a deploy a browser can pair new
  `main.js` with a cached `ui.js`. Pages sets the same ~10 min max-age on
  everything, so it clears itself; a hard reload fixes it immediately. Worth
  fixing properly (an import map listing every module against one version) if
  it ever bites mid-game.

## Deploying

1. Create the GitHub account/org `feebgolf` and a **public** repo named
   `feebgolf.github.io`.
2. Push this directory to `main`. Pages for `*.github.io` repos deploys
   automatically from the root (check Settings → Pages if not).
3. Done: https://feebgolf.github.io (HTTPS by default, which WebRTC requires).
   Pages caches for ~10 min — bump the `?v=` query on the script/style tags in
   `index.html` when shipping changes.
