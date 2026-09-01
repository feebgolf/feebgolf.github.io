// tests.js — assertions for the rules engine. Run via test.html in a browser
// or `node js/run-tests.mjs`. Returns [{name, pass, detail}].
import {
  makeDeck, shuffle, cardScore, handScore, cancelledColumns, visibleScore,
  createState, addPlayer, startRound, applyAction, redact, finalScores,
} from './game.js';

// Deterministic LCG so tests are reproducible.
function makeRng(seed = 42) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

const C = (rank, suit = 's', faceUp = true) => ({ rank, suit, faceUp });

function newGame(numPlayers, seed = 42) {
  const state = createState(makeRng(seed));
  for (let i = 0; i < numPlayers; i++) addPlayer(state, 's' + i, 'peer' + i, 'P' + i);
  state.hostSeat = 's0';
  startRound(state);
  return state;
}

function finishSetup(state) {
  for (const p of state.players) {
    applyAction(state, p.seatId, { a: 'flipSetup', i: 0 });
    applyAction(state, p.seatId, { a: 'flipSetup', i: 1 });
  }
}

// Have the current player take a turn that flips/replaces face-down cards
// as slowly as possible (swap drawn into the first face-down card).
function neutralTurn(state) {
  const p = state.players[state.turnIndex];
  const r = applyAction(state, p.seatId, { a: 'drawDeck' });
  if (!r.ok) throw new Error(r.msg);
  const i = p.hand.findIndex((c) => !c.faceUp);
  const idx = i === -1 ? 0 : i;
  const r2 = applyAction(state, p.seatId, { a: 'swapDrawn', i: idx });
  if (!r2.ok) throw new Error(r2.msg);
}

// Force the current player to reveal everything: swap drawn into face-down
// slots until all 6 are face up (multiple turns handled by caller).
function revealAllTurn(state) {
  const p = state.players[state.turnIndex];
  applyAction(state, p.seatId, { a: 'drawDeck' });
  const i = p.hand.findIndex((c) => !c.faceUp);
  applyAction(state, p.seatId, { a: 'swapDrawn', i: i === -1 ? 0 : i });
}

export function runTests() {
  const results = [];
  const test = (name, fn) => {
    try {
      fn();
      results.push({ name, pass: true, detail: '' });
    } catch (e) {
      results.push({ name, pass: false, detail: e.message });
    }
  };
  const eq = (got, want, label = '') => {
    if (got !== want) throw new Error(`${label} expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  };

  // ---- card values ----
  test('A scores 1', () => eq(cardScore(C('A')), 1));
  test('2 scores -2', () => eq(cardScore(C('2')), -2));
  test('K scores 0', () => eq(cardScore(C('K')), 0));
  test('J scores 10', () => eq(cardScore(C('J')), 10));
  test('Q scores 10', () => eq(cardScore(C('Q')), 10));
  test('10 scores 10', () => eq(cardScore(C('10')), 10));
  test('7 scores 7', () => eq(cardScore(C('7')), 7));

  // ---- hand scoring: columns are (0,3),(1,4),(2,5) ----
  test('no pairs: plain sum', () =>
    eq(handScore([C('3'), C('4'), C('5'), C('6'), C('7'), C('8')]), 33));
  test('column pair cancels to 0', () =>
    eq(handScore([C('9', 's'), C('4'), C('5'), C('9', 'h'), C('7'), C('8')]), 24));
  test('pair of 2s in a column scores 0, not -4', () =>
    eq(handScore([C('2', 's'), C('K'), C('K'), C('2', 'h'), C('K'), C('K')]), 0));
  test('K-K column scores 0 either way', () =>
    eq(handScore([C('K', 's'), C('3'), C('4'), C('K', 'h'), C('5'), C('6')]), 18));
  test('single 2 scores -2 within total', () =>
    eq(handScore([C('2'), C('K'), C('K'), C('5'), C('K'), C('K')]), 3));
  test('same rank NOT in same column does not cancel', () =>
    eq(handScore([C('9', 's'), C('9', 'h'), C('K'), C('K'), C('K'), C('K')]), 18));
  test('all three columns cancel = 0', () =>
    eq(handScore([C('J', 's'), C('Q', 's'), C('5', 's'), C('J', 'h'), C('Q', 'h'), C('5', 'h')]), 0));
  test('cancelledColumns reports the right columns', () => {
    const cols = cancelledColumns([C('9', 's'), C('4'), C('5', 's'), C('9', 'h'), C('7'), C('5', 'h')]);
    eq(JSON.stringify(cols), JSON.stringify([0, 2]));
  });

  // ---- deck & dealing ----
  test('makeDeck: 52 unique cards, no jokers', () => {
    const d = makeDeck();
    eq(d.length, 52);
    eq(new Set(d.map((c) => c.rank + c.suit)).size, 52);
  });
  test('shuffle preserves the 52 cards', () => {
    const d = shuffle(makeDeck(), makeRng(7));
    eq(new Set(d.map((c) => c.rank + c.suit)).size, 52);
  });
  test('deal: 2 players -> deck 39, discard 1, 6 cards each face down', () => {
    const s = newGame(2);
    eq(s.deck.length, 52 - 12 - 1);
    eq(s.discard.length, 1);
    eq(s.phase, 'setup');
    for (const p of s.players) {
      eq(p.hand.length, 6);
      eq(p.hand.every((c) => !c.faceUp), true, 'all face down:');
    }
  });
  test('deal: 4 players -> deck 27', () => eq(newGame(4).deck.length, 52 - 24 - 1));

  // ---- setup phase ----
  test('setup: third flip rejected', () => {
    const s = newGame(2);
    applyAction(s, 's0', { a: 'flipSetup', i: 0 });
    applyAction(s, 's0', { a: 'flipSetup', i: 1 });
    eq(applyAction(s, 's0', { a: 'flipSetup', i: 2 }).ok, false);
  });
  test('setup: flipping an already-face-up card rejected', () => {
    const s = newGame(2);
    applyAction(s, 's0', { a: 'flipSetup', i: 0 });
    eq(applyAction(s, 's0', { a: 'flipSetup', i: 0 }).ok, false);
  });
  test('setup: play starts only after everyone flips 2', () => {
    const s = newGame(2);
    applyAction(s, 's0', { a: 'flipSetup', i: 0 });
    applyAction(s, 's0', { a: 'flipSetup', i: 1 });
    eq(s.phase, 'setup');
    applyAction(s, 's1', { a: 'flipSetup', i: 4 });
    applyAction(s, 's1', { a: 'flipSetup', i: 5 });
    eq(s.phase, 'play');
  });
  test('play actions rejected during setup', () => {
    const s = newGame(2);
    eq(applyAction(s, s.players[s.turnIndex].seatId, { a: 'drawDeck' }).ok, false);
  });

  // ---- turn actions ----
  test('out-of-turn action rejected, state unchanged', () => {
    const s = newGame(2);
    finishSetup(s);
    const other = s.players[(s.turnIndex + 1) % 2];
    const before = s.deck.length;
    eq(applyAction(s, other.seatId, { a: 'drawDeck' }).ok, false);
    eq(s.deck.length, before);
  });
  test('takeDiscard swaps: taken card enters grid face up, replaced card tops discard', () => {
    const s = newGame(2);
    finishSetup(s);
    const p = s.players[s.turnIndex];
    const top = s.discard[s.discard.length - 1];
    const replaced = { ...p.hand[2] };
    eq(applyAction(s, p.seatId, { a: 'takeDiscard', i: 2 }).ok, true);
    eq(p.hand[2].rank, top.rank);
    eq(p.hand[2].faceUp, true);
    const newTop = s.discard[s.discard.length - 1];
    eq(newTop.rank, replaced.rank);
    eq(newTop.suit, replaced.suit);
  });
  test('takeDiscard without index rejected (no take-then-discard)', () => {
    const s = newGame(2);
    finishSetup(s);
    eq(applyAction(s, s.players[s.turnIndex].seatId, { a: 'takeDiscard' }).ok, false);
  });
  test('drawDeck twice rejected', () => {
    const s = newGame(2);
    finishSetup(s);
    const p = s.players[s.turnIndex];
    eq(applyAction(s, p.seatId, { a: 'drawDeck' }).ok, true);
    eq(applyAction(s, p.seatId, { a: 'drawDeck' }).ok, false);
  });
  test('takeDiscard after drawing rejected', () => {
    const s = newGame(2);
    finishSetup(s);
    const p = s.players[s.turnIndex];
    applyAction(s, p.seatId, { a: 'drawDeck' });
    eq(applyAction(s, p.seatId, { a: 'takeDiscard', i: 0 }).ok, false);
  });
  test('swapDrawn: drawn card enters grid face up, turn passes', () => {
    const s = newGame(2);
    finishSetup(s);
    const p = s.players[s.turnIndex];
    applyAction(s, p.seatId, { a: 'drawDeck' });
    const drawn = { ...s.drawn };
    eq(applyAction(s, p.seatId, { a: 'swapDrawn', i: 0 }).ok, true);
    eq(p.hand[0].rank, drawn.rank);
    eq(p.hand[0].faceUp, true);
    eq(s.drawn, null);
    eq(s.players[s.turnIndex].seatId !== p.seatId, true, 'turn advanced:');
  });
  test('discardDrawn requires a face-down flip target', () => {
    const s = newGame(2);
    finishSetup(s);
    const p = s.players[s.turnIndex];
    applyAction(s, p.seatId, { a: 'drawDeck' });
    const upIdx = p.hand.findIndex((c) => c.faceUp);
    eq(applyAction(s, p.seatId, { a: 'discardDrawn', i: upIdx }).ok, false);
    const downIdx = p.hand.findIndex((c) => !c.faceUp);
    eq(applyAction(s, p.seatId, { a: 'discardDrawn', i: downIdx }).ok, true);
    eq(p.hand[downIdx].faceUp, true);
  });
  test('discardDrawn without drawing rejected', () => {
    const s = newGame(2);
    finishSetup(s);
    eq(applyAction(s, s.players[s.turnIndex].seatId, { a: 'discardDrawn', i: 0 }).ok, false);
  });

  // ---- reshuffle ----
  test('empty deck reshuffles discard minus top; cards conserved', () => {
    const s = newGame(2);
    finishSetup(s);
    // Move the whole deck onto the discard pile.
    while (s.deck.length) s.discard.push(s.deck.pop());
    const top = s.discard[s.discard.length - 1];
    const discardSize = s.discard.length;
    const p = s.players[s.turnIndex];
    eq(applyAction(s, p.seatId, { a: 'drawDeck' }).ok, true);
    eq(s.discard.length, 1);
    eq(s.discard[0].rank, top.rank, 'old top kept:');
    eq(s.discard[0].suit, top.suit, 'old top kept:');
    eq(s.deck.length, discardSize - 1 - 1); // minus kept top, minus drawn card
    const inHands = s.players.reduce((n, q) => n + q.hand.length, 0);
    eq(s.deck.length + s.discard.length + inHands + 1, 52, 'conservation:');
  });

  // ---- round end: exactly one extra turn per other player ----
  for (const n of [2, 3, 4]) {
    test(`round end ordering with ${n} players`, () => {
      const s = newGame(n, 100 + n);
      finishSetup(s);
      // Let the first player reveal everything over successive turns.
      const finisher = s.players[s.turnIndex];
      const turnsTaken = Object.fromEntries(s.players.map((p) => [p.seatId, 0]));
      let guard = 0;
      while (s.phase === 'play' && guard++ < 200) {
        const cur = s.players[s.turnIndex];
        turnsTaken[cur.seatId]++;
        if (cur.seatId === finisher.seatId) revealAllTurn(s);
        else neutralTurn(s);
      }
      eq(s.phase, 'roundEnd');
      // The finisher took 4 revealing turns (2 up after setup + 4 swaps = 6).
      for (const p of s.players) {
        if (p.seatId !== finisher.seatId) {
          eq(turnsTaken[p.seatId], turnsTaken[finisher.seatId], `equal turns for ${p.seatId}:`);
        }
      }
    });
  }
  test('round end: all cards revealed, scores match handScore, totals accumulate', () => {
    const s = newGame(2, 55);
    finishSetup(s);
    let guard = 0;
    while (s.phase === 'play' && guard++ < 200) revealAllTurn(s);
    eq(s.phase, 'roundEnd');
    for (const p of s.players) {
      eq(p.hand.every((c) => c.faceUp), true, 'revealed:');
      const rs = s.roundScores.find((r) => r.seatId === p.seatId);
      eq(rs.score, handScore(p.hand));
      eq(p.total, rs.score, 'total after round 1:');
    }
    // Next round accumulates.
    const prevTotals = Object.fromEntries(s.players.map((p) => [p.seatId, p.total]));
    startRound(s);
    finishSetup(s);
    guard = 0;
    while (s.phase === 'play' && guard++ < 200) revealAllTurn(s);
    for (const p of s.players) {
      const rs = s.roundScores.find((r) => r.seatId === p.seatId);
      eq(p.total, prevTotals[p.seatId] + rs.score, 'accumulated:');
    }
    eq(s.roundNumber, 2);
  });
  test('actions rejected after round end', () => {
    const s = newGame(2, 55);
    finishSetup(s);
    let guard = 0;
    while (s.phase === 'play' && guard++ < 200) revealAllTurn(s);
    eq(applyAction(s, 's0', { a: 'drawDeck' }).ok, false);
    eq(applyAction(s, 's1', { a: 'drawDeck' }).ok, false);
  });
  // ---- visible (live) score ----
  const D = (rank, suit = 's') => ({ rank, suit, faceUp: false });
  test('visibleScore: all face down = 0', () =>
    eq(visibleScore([D('J'), D('Q'), D('9'), D('10'), D('5'), D('7')]), 0));
  test('visibleScore: face-up cards sum, face-down count 0', () =>
    eq(visibleScore([C('J'), D('Q'), C('2'), D('10'), C('5'), D('7')]), 13));
  test('visibleScore: column cancels only when both cards are face up', () => {
    eq(visibleScore([C('9', 's'), D('4'), D('5'), C('9', 'h'), D('7'), D('8')]), 0);
    eq(visibleScore([C('9', 's'), D('4'), D('5'), D('9', 'h'), D('7'), D('8')]), 9);
  });
  test('visibleScore matches handScore when everything is face up', () => {
    const hand = [C('2', 's'), C('K'), C('4'), C('2', 'h'), C('A'), C('Q')];
    eq(visibleScore(hand), handScore(hand));
  });
  test('redact includes visibleScore per player', () => {
    const s = newGame(2);
    finishSetup(s);
    const v = redact(s, 's0');
    for (const p of v.players) eq(typeof p.visibleScore, 'number');
  });

  // ---- next-round start order ----
  test('loser of the previous round goes first next round', () => {
    const s = newGame(3, 77);
    s.roundScores = [
      { seatId: 's0', score: 3 },
      { seatId: 's1', score: 21 },
      { seatId: 's2', score: 8 },
    ];
    startRound(s);
    eq(s.turnIndex, 1);
    eq(s.log[0].includes('lost last round and goes first'), true, 'log mentions it:');
  });
  test('tied losers: first player is one of them', () => {
    const s = newGame(3, 78);
    s.roundScores = [
      { seatId: 's0', score: 15 },
      { seatId: 's1', score: 15 },
      { seatId: 's2', score: 2 },
    ];
    startRound(s);
    eq(s.turnIndex === 0 || s.turnIndex === 1, true, 'one of the tied losers:');
  });
  test('loser who left the lobby is skipped for first-player pick', () => {
    const s = newGame(2, 79);
    s.roundScores = [
      { seatId: 's0', score: 5 },
      { seatId: 's1', score: 9 },
      { seatId: 'gone', score: 40 }, // pruned player from last round
    ];
    startRound(s);
    eq(s.turnIndex, 1);
  });
  test('played round: highest scorer opens the rematch', () => {
    const s = newGame(2, 81);
    finishSetup(s);
    let guard = 0;
    while (s.phase === 'play' && guard++ < 200) revealAllTurn(s);
    eq(s.phase, 'roundEnd');
    const worst = Math.max(...s.roundScores.map((r) => r.score));
    const loserSeats = s.roundScores.filter((r) => r.score === worst).map((r) => r.seatId);
    startRound(s);
    eq(loserSeats.includes(s.players[s.turnIndex].seatId), true, 'loser opens:');
  });

  test('finalScores sorts lowest first', () => {
    const s = newGame(3);
    s.players[0].total = 12;
    s.players[1].total = 3;
    s.players[2].total = 40;
    const fs = finalScores(s);
    eq(fs[0].seatId, 's1');
    eq(fs[2].seatId, 's2');
  });

  // ---- redaction ----
  test('redact hides face-down card values from everyone', () => {
    const s = newGame(2);
    finishSetup(s);
    for (const viewer of ['s0', 's1']) {
      const v = redact(s, viewer);
      for (const p of v.players) {
        for (const c of p.hand) {
          if (!c.faceUp) eq('rank' in c, false, 'hidden rank:');
          else eq(typeof c.rank, 'string', 'visible rank:');
        }
      }
      eq('deck' in v, false, 'no raw deck:');
      eq('rng' in v, false, 'no rng:');
      eq(typeof v.deckCount, 'number');
    }
  });
  test('redact shows the drawn card only to the drawer', () => {
    const s = newGame(2);
    finishSetup(s);
    const cur = s.players[s.turnIndex];
    const other = s.players[(s.turnIndex + 1) % 2];
    applyAction(s, cur.seatId, { a: 'drawDeck' });
    eq(redact(s, cur.seatId).drawnCard !== null, true, 'drawer sees it:');
    eq(redact(s, other.seatId).drawnCard, null, 'opponent does not:');
    eq(redact(s, other.seatId).drawnBy, cur.seatId, 'but sees who drew:');
  });

  // ---- lastMove (drives UI animations) ----
  test('redact carries lastMove with an increasing seq', () => {
    const s = newGame(2);
    finishSetup(s);
    const p = s.players[s.turnIndex];
    applyAction(s, p.seatId, { a: 'drawDeck' });
    const v1 = redact(s, 's0');
    eq(v1.lastMove.a, 'drawDeck');
    eq(v1.lastMove.seat, p.seatId);
    applyAction(s, p.seatId, { a: 'swapDrawn', i: 2 });
    const v2 = redact(s, 's0');
    eq(v2.lastMove.a, 'swapDrawn');
    eq(v2.lastMove.i, 2);
    eq(v2.lastMove.seq > v1.lastMove.seq, true, 'seq increases:');
  });
  test('rejected actions leave lastMove untouched; new round clears it', () => {
    const s = newGame(2);
    finishSetup(s);
    const p = s.players[s.turnIndex];
    applyAction(s, p.seatId, { a: 'drawDeck' });
    const seq = s.lastMove.seq;
    applyAction(s, p.seatId, { a: 'drawDeck' }); // rejected: already drew
    eq(s.lastMove.seq, seq);
    startRound(s);
    eq(s.lastMove, null);
  });

  // ---- fuzz: random full games never crash, invariants hold ----
  test('fuzz: 40 random games (2-4 players) complete with card conservation', () => {
    for (let g = 0; g < 40; g++) {
      const n = 2 + (g % 3);
      const rng = makeRng(1000 + g);
      const s = createState(rng);
      for (let i = 0; i < n; i++) addPlayer(s, 's' + i, 'p' + i, 'P' + i);
      startRound(s);
      for (const p of s.players) {
        const idxs = [0, 1, 2, 3, 4, 5];
        shuffle(idxs, rng);
        applyAction(s, p.seatId, { a: 'flipSetup', i: idxs[0] });
        applyAction(s, p.seatId, { a: 'flipSetup', i: idxs[1] });
      }
      let guard = 0;
      while (s.phase === 'play' && guard++ < 500) {
        const p = s.players[s.turnIndex];
        const roll = rng();
        let r;
        if (roll < 0.3) {
          r = applyAction(s, p.seatId, { a: 'takeDiscard', i: Math.floor(rng() * 6) });
        } else {
          r = applyAction(s, p.seatId, { a: 'drawDeck' });
          if (r.ok) {
            const downs = p.hand.map((c, i) => (!c.faceUp ? i : -1)).filter((i) => i >= 0);
            if (rng() < 0.5 && downs.length) {
              r = applyAction(s, p.seatId, { a: 'discardDrawn', i: downs[Math.floor(rng() * downs.length)] });
            } else {
              r = applyAction(s, p.seatId, { a: 'swapDrawn', i: Math.floor(rng() * 6) });
            }
          }
        }
        if (!r.ok) throw new Error(`game ${g}: rejected legal-path action: ${r.msg}`);
        const inHands = s.players.reduce((t, q) => t + q.hand.length, 0);
        const held = s.drawn ? 1 : 0;
        if (s.deck.length + s.discard.length + inHands + held !== 52) {
          throw new Error(`game ${g}: card conservation broken`);
        }
      }
      if (s.phase !== 'roundEnd') throw new Error(`game ${g}: never ended`);
    }
  });

  return results;
}
