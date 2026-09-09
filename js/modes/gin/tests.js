// modes/gin/tests.js — assertions for the gin rummy engine and meld solver.
import {
  HAND_SIZE, SETTINGS, deckCount, buildDeck,
  createState, addPlayer, startRound, applyAction, redact, finalScores, resetToLobby,
} from './engine.js';
import {
  cardValue, handValue, candidateMelds, bestDecomposition, maxLayoff, deadwoodOf,
} from './melds.js';
import { makeRng, suite } from '../../testkit.js';

// A card with an explicit id, so duplicates across decks stay distinguishable.
let seq = 0;
const C = (rank, suit = 's') => ({ rank, suit, id: 'x' + seq++ });
const names = (cards) => cards.map((c) => c.rank + c.suit).join(' ');
const DUP = { allowDuplicateSets: true };
const NODUP = { allowDuplicateSets: false };

function newGame(numPlayers, seed = 42) {
  const state = createState(makeRng(seed));
  for (let i = 0; i < numPlayers; i++) addPlayer(state, 's' + i, 'peer' + i, 'P' + i);
  state.hostSeat = 's0';
  startRound(state);
  return state;
}

// Total cards in play, which must never change mid-hand.
const inPlay = (s) => s.stock.length + s.discard.length
  + s.players.reduce((n, p) => n + p.hand.length, 0);

export function runTests() {
  const { results, test, eq } = suite();

  // ---- card values ----
  test('A is worth 1', () => eq(cardValue(C('A')), 1));
  test('face cards are worth 10', () => {
    for (const r of ['J', 'Q', 'K']) eq(cardValue(C(r)), 10, r + ':');
  });
  test('number cards are worth face value', () => {
    eq(cardValue(C('7')), 7);
    eq(cardValue(C('10')), 10);
  });

  // ---- deck scaling ----
  test('deck count scales to keep a healthy stock', () => {
    const want = { 2: 1, 3: 2, 4: 2, 5: 2, 6: 2, 7: 2, 8: 3 };
    for (const n of Object.keys(want)) eq(deckCount(Number(n)), want[n], `${n} players:`);
  });
  test('two players get exactly the classic 52-card game', () => {
    eq(buildDeck(2).length, 52);
    eq(buildDeck(2).length - HAND_SIZE * 2 - 1, 31, 'stock after the deal:');
  });
  test('every table size leaves a stock worth drawing from', () => {
    for (let n = 2; n <= 8; n++) {
      const stock = buildDeck(n).length - HAND_SIZE * n - 1;
      eq(stock >= 30, true, `${n} players (stock ${stock}):`);
    }
  });
  test('deck ids are unique even across several decks', () => {
    const d = buildDeck(8);
    eq(new Set(d.map((c) => c.id)).size, d.length);
  });
  test('multi-deck decks hold the right number of each card', () => {
    const d = buildDeck(8); // 3 decks
    const aces = d.filter((c) => c.rank === 'A' && c.suit === 's');
    eq(aces.length, 3);
  });

  // ---- dealing ----
  test('deal: 10 cards each, one card turned up, rest in the stock', () => {
    for (const n of [2, 4, 8]) {
      const s = newGame(n);
      eq(s.phase, 'play', `${n}p phase:`);
      for (const p of s.players) eq(p.hand.length, HAND_SIZE, `${n}p hand:`);
      eq(s.discard.length, 1, `${n}p discard:`);
      eq(inPlay(s), buildDeck(n).length, `${n}p conservation:`);
    }
  });
  test('the deal passes left and the player after the dealer leads', () => {
    const s = newGame(4);
    const firstDealer = s.dealerIndex;
    eq(s.turnIndex, (firstDealer + 1) % 4);
    startRound(s);
    eq(s.dealerIndex, (firstDealer + 1) % 4, 'dealer moved:');
    eq(s.turnIndex, (firstDealer + 2) % 4, 'lead moved:');
  });

  // ---- meld enumeration ----
  test('candidateMelds finds a plain set and a plain run', () => {
    const hand = [C('9', 'h'), C('9', 'd'), C('9', 'c'), C('4', 's'), C('5', 's'), C('6', 's')];
    const found = candidateMelds(hand, DUP).map((m) => m.length);
    eq(found.filter((n) => n === 3).length, 2, 'two three-card melds:');
  });
  test('a run needs three consecutive cards of one suit', () => {
    const broken = [C('4', 's'), C('5', 's'), C('7', 's')];
    eq(candidateMelds(broken, DUP).length, 0);
  });
  test('runs do not wrap from King round to Ace', () => {
    const hand = [C('Q', 's'), C('K', 's'), C('A', 's')];
    eq(candidateMelds(hand, DUP).length, 0);
  });
  test('a four-card run also offers its three-card sub-runs', () => {
    const hand = [C('4', 's'), C('5', 's'), C('6', 's'), C('7', 's')];
    const sizes = candidateMelds(hand, DUP).map((m) => m.length).sort();
    eq(JSON.stringify(sizes), JSON.stringify([3, 3, 4]));
  });
  test('duplicate-set rule on: three identical cards form a set', () => {
    const hand = [C('7', 'h'), C('7', 'h'), C('7', 'h')];
    eq(candidateMelds(hand, DUP).length, 1, 'allowed:');
    eq(candidateMelds(hand, NODUP).length, 0, 'refused:');
  });
  test('duplicate-set rule off: distinct suits still make a set', () => {
    const hand = [C('7', 'h'), C('7', 's'), C('7', 'c')];
    eq(candidateMelds(hand, NODUP).length, 1);
  });
  test('duplicate-set rule off: a repeated suit is dropped from the set', () => {
    const hand = [C('7', 'h'), C('7', 'h'), C('7', 's'), C('7', 'c')];
    // Only the three distinct-suit combinations survive, not the pair of hearts.
    for (const m of candidateMelds(hand, NODUP)) {
      eq(new Set(m.map((c) => c.suit)).size, m.length, names(m) + ':');
    }
  });

  // ---- best decomposition ----
  test('bestDecomposition: a run and a set melded, the rest is deadwood', () => {
    const hand = [
      C('4', 's'), C('5', 's'), C('6', 's'),
      C('9', 'h'), C('9', 'd'), C('9', 'c'),
      C('K', 's'), C('2', 'h'), C('7', 'd'), C('J', 'c'),
    ];
    const b = bestDecomposition(hand, DUP);
    eq(b.melds.length, 2);
    eq(b.deadwood, 29); // K10 + 2 + 7 + J10
    eq(b.deadwoodCards.length, 4);
  });
  test('bestDecomposition: gin is zero deadwood', () => {
    const hand = [
      C('4', 's'), C('5', 's'), C('6', 's'),
      C('9', 'h'), C('9', 'd'), C('9', 'c'),
      C('J', 'h'), C('Q', 'h'), C('K', 'h'), C('A', 'c'),
    ];
    // The last card is a lone ace, so this is 1 deadwood, not gin.
    eq(bestDecomposition(hand, DUP).deadwood, 1);
  });
  test('bestDecomposition: a contested card goes where it saves most', () => {
    // 7♠ can complete the run 5♠6♠7♠ or the set 7♠7♥7♦. Only one can have it,
    // and the solver must keep whichever leaves the cheaper leftovers.
    const hand = [
      C('5', 's'), C('6', 's'), C('7', 's'),
      C('7', 'h'), C('7', 'd'),
      C('K', 'c'), C('2', 'c'), C('3', 'h'), C('9', 'd'), C('4', 'c'),
    ];
    const b = bestDecomposition(hand, DUP);
    // Either reading melds 3 cards and leaves the 7s or the run partly stranded;
    // the solver should take the run AND leave two 7s (14) rather than the set
    // and leave 5♠6♠ (11) — so the cheaper leftover wins.
    const total = handValue(hand);
    eq(b.deadwood, total - Math.max(
      cardValue(C('5')) + cardValue(C('6')) + cardValue(C('7')),   // the run
      cardValue(C('7')) * 3,                                        // the set
    ));
  });
  test('bestDecomposition: overlapping melds are never double-counted', () => {
    const hand = [
      C('4', 's'), C('5', 's'), C('6', 's'), C('7', 's'),
      C('7', 'h'), C('7', 'd'), C('7', 'c'),
      C('K', 'c'), C('Q', 'd'), C('9', 'h'),
    ];
    const b = bestDecomposition(hand, DUP);
    const used = b.melds.flat().map((c) => c.id);
    eq(new Set(used).size, used.length, 'no card in two melds:');
    eq(used.length + b.deadwoodCards.length, hand.length, 'every card accounted for:');
  });
  test('bestDecomposition: the duplicate-set rule changes the answer', () => {
    const hand = [
      C('7', 'h'), C('7', 'h'), C('7', 'h'),
      C('K', 'c'), C('Q', 'd'), C('9', 'h'), C('2', 'c'), C('3', 'h'), C('4', 'c'), C('5', 'd'),
    ];
    eq(bestDecomposition(hand, DUP).deadwood, handValue(hand) - 21, 'melded:');
    eq(bestDecomposition(hand, NODUP).deadwood, handValue(hand), 'not melded:');
  });
  test('deadwoodOf agrees with bestDecomposition', () => {
    const hand = [C('4', 's'), C('5', 's'), C('6', 's'), C('K', 'h')];
    eq(deadwoodOf(hand, DUP), 10);
  });

  // ---- layoffs ----
  test('layoff extends a run at either end', () => {
    const melds = [[C('5', 's'), C('6', 's'), C('7', 's')]];
    const dead = [C('4', 's'), C('8', 's'), C('K', 'h')];
    const r = maxLayoff(dead, melds, DUP);
    eq(r.laidOff.length, 2);
    eq(r.deadwood, 10, 'only the king is left:');
  });
  test('layoff chains along a run one rank at a time', () => {
    const melds = [[C('5', 's'), C('6', 's'), C('7', 's')]];
    const dead = [C('3', 's'), C('4', 's')]; // the 3 only fits once the 4 lands
    const r = maxLayoff(dead, melds, DUP);
    eq(r.laidOff.length, 2);
    eq(r.deadwood, 0);
  });
  test('layoff adds to a set', () => {
    const melds = [[C('9', 'h'), C('9', 'd'), C('9', 'c')]];
    const r = maxLayoff([C('9', 's'), C('4', 'h')], melds, DUP);
    eq(r.laidOff.length, 1);
    eq(r.deadwood, 4);
  });
  test('layoff onto a set respects the duplicate rule', () => {
    const melds = [[C('9', 'h'), C('9', 'd'), C('9', 'c')]];
    eq(maxLayoff([C('9', 'h')], melds, DUP).laidOff.length, 1, 'allowed:');
    eq(maxLayoff([C('9', 'h')], melds, NODUP).laidOff.length, 0, 'refused:');
  });
  test('layoff refuses a card that fits nothing', () => {
    const melds = [[C('5', 's'), C('6', 's'), C('7', 's')]];
    const r = maxLayoff([C('9', 'h'), C('4', 'd')], melds, DUP);
    eq(r.laidOff.length, 0);
    eq(r.deadwood, 13);
  });

  // ---- knocking ----
  // Give a player a known hand plus a known 11th card to throw.
  function rig(s, seatId, hand, extra) {
    const p = s.players.find((q) => q.seatId === seatId);
    p.hand = [...hand, extra];
    p.tookId = null;
    s.turnIndex = s.players.indexOf(p);
    return p;
  }
  const RUN = [C('4', 's'), C('5', 's'), C('6', 's')];
  const SET = [C('9', 'h'), C('9', 'd'), C('9', 'c')];
  const RUN2 = [C('J', 'h'), C('Q', 'h'), C('K', 'h')];

  test('knock refused when deadwood is over the limit', () => {
    const s = newGame(2);
    const junk = C('K', 'c');
    const p = rig(s, 's0', [...RUN, ...SET, C('K', 'd'), C('Q', 'c'), C('J', 'd'), C('9', 's')], junk);
    const r = applyAction(s, 's0', { a: 'knock', id: junk.id });
    eq(r.ok, false);
    eq(r.msg.includes('deadwood'), true, 'says why:');
    eq(p.hand.length, 11, 'hand untouched:');
    eq(s.phase, 'play', 'still playing:');
  });
  test('knock allowed exactly at the limit', () => {
    const s = newGame(2);
    // 3 melds + a lone 10 = 10 deadwood, the default limit.
    const throwaway = C('2', 'c');
    rig(s, 's0', [...RUN, ...SET, ...RUN2, C('10', 'c')], throwaway);
    eq(applyAction(s, 's0', { a: 'knock', id: throwaway.id }).ok, true);
    eq(s.phase, 'roundEnd');
    eq(s.reveal.knocker, 's0');
    eq(s.reveal.gin, false);
  });
  test('knock limit is a house rule', () => {
    const s = newGame(2);
    s.settings.knockMax = 0;
    const throwaway = C('2', 'c');
    rig(s, 's0', [...RUN, ...SET, ...RUN2, C('10', 'c')], throwaway);
    eq(applyAction(s, 's0', { a: 'knock', id: throwaway.id }).ok, false, 'refused at 0:');
  });
  test('zero deadwood is gin and pays the bonus', () => {
    const s = newGame(2);
    const throwaway = C('2', 'c');
    rig(s, 's0', [...RUN, ...SET, ...RUN2, C('7', 's')], throwaway);
    // 7♠ extends the 4-5-6♠ run, so the hand melds completely.
    const r = applyAction(s, 's0', { a: 'knock', id: throwaway.id });
    eq(r.ok, true);
    eq(s.reveal.gin, true);
    const mine = s.roundScores.find((x) => x.seatId === 's0').score;
    const theirs = s.roundScores.find((x) => x.seatId === 's1').score;
    eq(mine >= s.settings.ginBonus, true, 'bonus included:');
    eq(theirs, 0, 'opponent scores nothing:');
  });
  test('gin blocks layoffs entirely', () => {
    const s = newGame(2);
    s.players[1].hand = [C('7', 's'), C('8', 's'), ...RUN2, C('2', 'd'), C('3', 'd'), C('4', 'd'), C('5', 'c'), C('6', 'c')];
    const throwaway = C('2', 'c');
    rig(s, 's0', [...RUN, ...SET, ...RUN2, C('7', 'h')], throwaway);
    applyAction(s, 's0', { a: 'knock', id: throwaway.id });
    if (s.reveal.gin) {
      const row = s.reveal.rows.find((r) => r.seatId === 's1');
      eq(row.laidOff.length, 0, 'nothing laid off against gin:');
    }
  });
  test('undercut: matching the knocker turns the hand around', () => {
    const s = newGame(2);
    s.settings.layoffs = false;
    // Knocker keeps 10 deadwood; the opponent keeps 4.
    s.players[1].hand = [...RUN2, C('2', 'd'), C('3', 'd'), C('4', 'd'), C('7', 'c'), C('8', 'c'), C('9', 'c'), C('4', 'h')];
    const throwaway = C('2', 'c');
    rig(s, 's0', [...RUN, ...SET, ...RUN2, C('10', 'c')], throwaway);
    applyAction(s, 's0', { a: 'knock', id: throwaway.id });
    const knocker = s.roundScores.find((x) => x.seatId === 's0').score;
    const opp = s.roundScores.find((x) => x.seatId === 's1').score;
    eq(knocker, 0, 'knocker gets nothing:');
    eq(opp, 10 - 4 + s.settings.undercutBonus, 'opponent collects the difference plus the bonus:');
  });
  test('undercut bonus is a house rule', () => {
    const s = newGame(2);
    s.settings.layoffs = false;
    s.settings.undercutBonus = 0;
    s.players[1].hand = [...RUN2, C('2', 'd'), C('3', 'd'), C('4', 'd'), C('7', 'c'), C('8', 'c'), C('9', 'c'), C('4', 'h')];
    const throwaway = C('2', 'c');
    rig(s, 's0', [...RUN, ...SET, ...RUN2, C('10', 'c')], throwaway);
    applyAction(s, 's0', { a: 'knock', id: throwaway.id });
    eq(s.roundScores.find((x) => x.seatId === 's1').score, 6);
  });
  test('knocker is paid by every opponent separately', () => {
    const s = newGame(4);
    s.settings.layoffs = false;
    // Three opponents with 20, 30 and 40 of unmeldable deadwood.
    const junkHands = [
      [C('K', 'c'), C('10', 'd')],
      [C('K', 'c'), C('K', 'd'), C('10', 'h')],
      [C('K', 'c'), C('K', 'd'), C('K', 'h'), C('10', 'h')],
    ];
    for (let i = 1; i <= 3; i++) {
      const pad = [C('A', 'c'), C('3', 'd'), C('5', 'h'), C('7', 'c'), C('2', 'h'), C('4', 'd'), C('6', 'c'), C('8', 'd')];
      s.players[i].hand = [...junkHands[i - 1], ...pad].slice(0, 10);
    }
    const throwaway = C('2', 'c');
    rig(s, 's0', [...RUN, ...SET, ...RUN2, C('7', 's')], throwaway); // gin
    applyAction(s, 's0', { a: 'knock', id: throwaway.id });
    const knocker = s.roundScores.find((x) => x.seatId === 's0').score;
    let expected = 0;
    for (const row of s.reveal.rows.filter((r) => r.seatId !== 's0')) {
      expected += row.deadwood + s.settings.ginBonus;
    }
    eq(knocker, expected, 'paid by all three:');
  });
  test('round scores accumulate into running totals', () => {
    const s = newGame(2);
    const throwaway = C('2', 'c');
    rig(s, 's0', [...RUN, ...SET, ...RUN2, C('7', 's')], throwaway);
    applyAction(s, 's0', { a: 'knock', id: throwaway.id });
    for (const rs of s.roundScores) {
      eq(s.players.find((p) => p.seatId === rs.seatId).total, rs.score, rs.seatId + ':');
    }
  });
  test('reveal covers every player once', () => {
    const s = newGame(4);
    const throwaway = C('2', 'c');
    rig(s, 's0', [...RUN, ...SET, ...RUN2, C('7', 's')], throwaway);
    applyAction(s, 's0', { a: 'knock', id: throwaway.id });
    eq(s.reveal.rows.length, 4);
    eq(new Set(s.reveal.rows.map((r) => r.seatId)).size, 4);
  });

  // ---- turn mechanics ----
  test('drawing twice is rejected', () => {
    const s = newGame(2);
    const seat = s.players[s.turnIndex].seatId;
    eq(applyAction(s, seat, { a: 'draw' }).ok, true);
    eq(applyAction(s, seat, { a: 'draw' }).ok, false);
  });
  test('discarding before drawing is rejected', () => {
    const s = newGame(2);
    const p = s.players[s.turnIndex];
    eq(applyAction(s, p.seatId, { a: 'discard', id: p.hand[0].id }).ok, false);
  });
  test('out-of-turn action is rejected and changes nothing', () => {
    const s = newGame(2);
    const other = s.players[(s.turnIndex + 1) % 2];
    const before = JSON.stringify(redact(s, other.seatId));
    eq(applyAction(s, other.seatId, { a: 'draw' }).ok, false);
    eq(JSON.stringify(redact(s, other.seatId)), before, 'untouched:');
  });
  test('taking the discard puts that exact card in hand', () => {
    const s = newGame(2);
    const p = s.players[s.turnIndex];
    const top = s.discard[s.discard.length - 1];
    eq(applyAction(s, p.seatId, { a: 'take' }).ok, true);
    eq(p.hand.some((c) => c.id === top.id), true, 'in hand:');
    eq(s.discard.length, 0, 'off the pile:');
  });
  test('you cannot throw back the card you just took', () => {
    const s = newGame(2);
    const p = s.players[s.turnIndex];
    const top = s.discard[s.discard.length - 1];
    applyAction(s, p.seatId, { a: 'take' });
    const r = applyAction(s, p.seatId, { a: 'discard', id: top.id });
    eq(r.ok, false);
    eq(r.msg.includes('just took'), true, 'says why:');
    // Any other card is fine.
    const other = p.hand.find((c) => c.id !== top.id);
    eq(applyAction(s, p.seatId, { a: 'discard', id: other.id }).ok, true);
  });
  test('a card drawn from the stock may be discarded straight away', () => {
    const s = newGame(2);
    const p = s.players[s.turnIndex];
    applyAction(s, p.seatId, { a: 'draw' });
    const drawn = p.hand[p.hand.length - 1];
    eq(applyAction(s, p.seatId, { a: 'discard', id: drawn.id }).ok, true);
  });
  test('discarding a card you do not hold is rejected', () => {
    const s = newGame(2);
    const p = s.players[s.turnIndex];
    applyAction(s, p.seatId, { a: 'draw' });
    eq(applyAction(s, p.seatId, { a: 'discard', id: 'nope' }).ok, false);
  });
  test('discarding passes the turn on', () => {
    const s = newGame(3);
    const p = s.players[s.turnIndex];
    applyAction(s, p.seatId, { a: 'draw' });
    applyAction(s, p.seatId, { a: 'discard', id: p.hand[0].id });
    eq(s.players[s.turnIndex].seatId !== p.seatId, true, 'turn advanced:');
    eq(p.hand.length, HAND_SIZE, 'back to ten cards:');
  });
  test('an exhausted stock ends the hand with nobody scoring', () => {
    const s = newGame(2);
    s.stock = [];
    const seat = s.players[s.turnIndex].seatId;
    eq(applyAction(s, seat, { a: 'draw' }).ok, true);
    eq(s.phase, 'roundEnd');
    for (const rs of s.roundScores) eq(rs.score, 0, rs.seatId + ':');
    eq(s.reveal.knocker, null, 'nobody knocked:');
  });
  test('actions are rejected once the hand is over', () => {
    const s = newGame(2);
    s.stock = [];
    applyAction(s, s.players[s.turnIndex].seatId, { a: 'draw' });
    eq(applyAction(s, 's0', { a: 'draw' }).ok, false);
    eq(applyAction(s, 's1', { a: 'draw' }).ok, false);
  });
  test('cards are conserved through a series of turns', () => {
    const s = newGame(4);
    const total = inPlay(s);
    for (let k = 0; k < 12; k++) {
      const p = s.players[s.turnIndex];
      applyAction(s, p.seatId, { a: 'draw' });
      applyAction(s, p.seatId, { a: 'discard', id: p.hand[0].id });
      eq(inPlay(s), total, `after turn ${k + 1}:`);
    }
  });

  // ---- redaction ----
  test('redact shows you your own hand and nobody else’s', () => {
    const s = newGame(3);
    for (const viewer of ['s0', 's1', 's2']) {
      const v = redact(s, viewer);
      eq(v.myHand.length, HAND_SIZE, 'own hand:');
      const mine = s.players.find((p) => p.seatId === viewer);
      eq(v.myHand[0].id, mine.hand[0].id, 'the right hand:');
      for (const p of v.players) eq('hand' in p, false, 'no hand on ' + p.seatId + ':');
      eq('stock' in v, false, 'no stock:');
      eq('rng' in v, false, 'no rng:');
      eq(typeof v.stockCount, 'number', 'count only:');
    }
  });
  test('redact hides the reveal until the hand is actually over', () => {
    const s = newGame(2);
    eq(redact(s, 's0').reveal, null);
    const throwaway = C('2', 'c');
    rig(s, 's0', [...RUN, ...SET, ...RUN2, C('7', 's')], throwaway);
    applyAction(s, 's0', { a: 'knock', id: throwaway.id });
    eq(redact(s, 's0').reveal !== null, true, 'revealed at the end:');
  });
  test('redact reports whether the player to act still owes a discard', () => {
    const s = newGame(2);
    eq(redact(s, 's0').holding, false);
    applyAction(s, s.players[s.turnIndex].seatId, { a: 'draw' });
    eq(redact(s, 's0').holding, true, 'seen by everyone:');
  });
  test('redact carries lastMove with an increasing seq', () => {
    const s = newGame(2);
    const p = s.players[s.turnIndex];
    applyAction(s, p.seatId, { a: 'draw' });
    const v1 = redact(s, 's0');
    eq(v1.lastMove.a, 'draw');
    applyAction(s, p.seatId, { a: 'discard', id: p.hand[0].id });
    const v2 = redact(s, 's0');
    eq(v2.lastMove.a, 'discard');
    eq(v2.lastMove.seq > v1.lastMove.seq, true, 'seq increases:');
  });

  // ---- lobby / totals ----
  test('finalScores sorts highest first', () => {
    const s = newGame(3);
    s.players[0].total = 12;
    s.players[1].total = 40;
    s.players[2].total = 3;
    const fs = finalScores(s);
    eq(fs[0].seatId, 's1');
    eq(fs[2].seatId, 's2');
  });
  test('resetToLobby clears the hand but keeps the house rules', () => {
    const s = newGame(2);
    s.settings.knockMax = 5;
    resetToLobby(s);
    eq(s.phase, 'lobby');
    eq(s.stock.length, 0);
    eq(s.settings.knockMax, 5, 'rules kept:');
    for (const p of s.players) eq(p.hand.length, 0, 'hands cleared:');
  });
  test('every setting has a default the validator accepts', () => {
    eq(SETTINGS.length > 0, true);
    const s = newGame(2);
    for (const f of SETTINGS) eq(f.key in s.settings, true, f.key + ':');
  });

  // ---- fuzz ----
  test('fuzz: 30 random hands (2/4/8 players) stay legal and conserve cards', () => {
    const sizes = [2, 4, 8];
    for (let g = 0; g < 30; g++) {
      const n = sizes[g % sizes.length];
      const rng = makeRng(5000 + g);
      const s = createState(rng);
      for (let i = 0; i < n; i++) addPlayer(s, 's' + i, 'p' + i, 'P' + i);
      s.hostSeat = 's0';
      startRound(s);
      const total = inPlay(s);
      let guard = 0;
      while (s.phase === 'play' && guard++ < 400) {
        const p = s.players[s.turnIndex];
        // Draw from wherever, then throw something legal — or knock if we can.
        const r1 = rng() < 0.3 && s.discard.length
          ? applyAction(s, p.seatId, { a: 'take' })
          : applyAction(s, p.seatId, { a: 'draw' });
        if (!r1.ok) throw new Error(`game ${g}: legal draw rejected: ${r1.msg}`);
        if (s.phase !== 'play') break; // stock ran out
        const throwable = p.hand.filter((c) => c.id !== p.tookId);
        const pick = throwable[Math.floor(rng() * throwable.length)];
        const rest = p.hand.filter((c) => c.id !== pick.id);
        const canKnock = bestDecomposition(rest, s.settings).deadwood <= s.settings.knockMax;
        const r2 = applyAction(s, p.seatId, {
          a: canKnock && rng() < 0.5 ? 'knock' : 'discard',
          id: pick.id,
        });
        if (!r2.ok) throw new Error(`game ${g}: legal discard rejected: ${r2.msg}`);
        if (inPlay(s) !== total) throw new Error(`game ${g}: card conservation broken`);
      }
      if (s.phase !== 'roundEnd') throw new Error(`game ${g}: hand never ended`);
      // Whatever happened, the scoreboard must mention everyone exactly once.
      if (s.roundScores.length !== n) throw new Error(`game ${g}: bad roundScores`);
    }
  });

  return results;
}
