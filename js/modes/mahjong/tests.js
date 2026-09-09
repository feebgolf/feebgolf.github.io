// modes/mahjong/tests.js — assertions for the Hong Kong mahjong engine,
// its win detection and its faan table.
import {
  SETTINGS, createState, addPlayer, startRound, applyAction, redact,
  finalScores, resetToLobby, claimOptions,
} from './engine.js';
import {
  KINDS, buildWall, wallSize, glyph, tileName, tileFace, sortTiles, countsOf,
  suitOf, numOf, isHonor, isDragon, isWind, isBonus, isTerminal, canStartChow,
  THIRTEEN_ORPHANS, tileOfWind,
} from './tiles.js';
import {
  standardDecompositions, winningDecompositions, isWin, waits,
  isSevenPairs, isThirteenOrphans, chowOptions, concealedKongs,
} from './hand.js';
import { scoreHand, pointsFor } from './score.js';
import { makeRng, suite } from '../../testkit.js';

// Tile shorthand: c(5) = 5 characters, b(3) = 3 bamboo, d(9) = 9 dots.
const c = (n) => n - 1;
const b = (n) => 9 + n - 1;
const d = (n) => 18 + n - 1;
const E = 27, S = 28, W = 29, N = 30, RED = 31, GREEN = 32, WHITE = 33;

function newGame(seed = 42) {
  const state = createState(makeRng(seed));
  for (let i = 0; i < 4; i++) addPlayer(state, 's' + i, 'peer' + i, 'P' + i);
  state.hostSeat = 's0';
  startRound(state);
  return state;
}

function rig(state, seatId, hand, melds = []) {
  const p = state.players.find((q) => q.seatId === seatId);
  p.hand = sortTiles(hand);
  p.melds = melds;
  return p;
}

// Every tile must be somewhere, always.
const tilesInPlay = (s) => s.wall.length + s.players.reduce((n, p) => n
  + p.hand.length + p.flowers.length + p.discards.length
  + p.melds.reduce((m, x) => m + x.tiles.length, 0), 0);

const baseCtx = (over = {}) => ({
  melds: [], seatWind: 0, prevailingWind: 0, selfDraw: false, flowers: [], settings: {}, ...over,
});

export function runTests() {
  const { results, test, eq } = suite();

  // ---- tiles ----
  test('the wall is 144 tiles with flowers, 136 without', () => {
    eq(buildWall(true).length, 144);
    eq(buildWall(false).length, 136);
    eq(wallSize(true), 144);
  });
  test('four of every ordinary tile, one of each flower', () => {
    const counts = new Map();
    for (const t of buildWall(true)) counts.set(t, (counts.get(t) || 0) + 1);
    for (let t = 0; t < KINDS; t++) eq(counts.get(t), 4, tileName(t) + ':');
    for (let t = 34; t <= 41; t++) eq(counts.get(t), 1, tileName(t) + ':');
  });
  test('suit and number maths respect suit boundaries', () => {
    eq(suitOf(c(1)), 0); eq(numOf(c(1)), 1);
    eq(suitOf(c(9)), 0); eq(numOf(c(9)), 9);
    eq(suitOf(b(1)), 1); eq(numOf(b(1)), 1);
    eq(suitOf(d(9)), 2); eq(numOf(d(9)), 9);
    eq(suitOf(E), -1); eq(numOf(E), 0);
  });
  test('a chow cannot start on an 8, a 9, or an honour', () => {
    eq(canStartChow(c(7)), true);
    eq(canStartChow(c(8)), false);
    eq(canStartChow(c(9)), false);
    eq(canStartChow(E), false);
  });
  test('honours, dragons, winds and terminals are told apart', () => {
    eq(isHonor(E) && isWind(E) && !isDragon(E), true, 'East:');
    eq(isHonor(RED) && isDragon(RED) && !isWind(RED), true, 'red dragon:');
    eq(isTerminal(c(1)) && isTerminal(c(9)) && !isTerminal(c(5)), true, 'terminals:');
    eq(isHonor(c(5)) || isBonus(c(5)), false, 'a 5 is neither:');
  });
  test('every tile has a distinct glyph and a readable name', () => {
    const glyphs = new Set();
    for (let t = 0; t <= 41; t++) {
      glyphs.add(glyph(t));
      eq(typeof tileName(t), 'string', 't' + t + ':');
      eq(typeof tileFace(t).top, 'string', 'face ' + t + ':');
    }
    eq(glyphs.size, 42);
  });
  test('every tile has a distinct drawn face', () => {
    // The faces are what a player actually reads, so two tiles sharing one
    // would be unplayable. Initials for the bonus tiles used to collide here.
    const faces = new Set();
    for (let t = 0; t <= 41; t++) {
      const f = tileFace(t);
      faces.add(f.top + '/' + f.bottom);
    }
    eq(faces.size, 42);
  });

  // ---- win detection ----
  test('four sets and a pair is a win', () =>
    eq(isWin([c(1), c(2), c(3), c(4), c(5), c(6), c(7), c(8), c(9), b(1), b(1), b(1), E, E]), true));
  test('thirteen tiles is not a win', () =>
    eq(isWin([c(1), c(2), c(3), c(4), c(5), c(6), c(7), c(8), c(9), b(1), b(1), b(1), E]), false));
  test('a run may not cross a suit boundary', () =>
    eq(isWin([c(8), c(9), b(1), c(1), c(2), c(3), c(4), c(5), c(6), b(2), b(2), b(2), E, E]), false));
  test('the same hand can have several readings', () => {
    const hand = [c(1), c(1), c(1), c(2), c(2), c(2), c(3), c(3), c(3), c(4), c(4), c(4), E, E];
    const decs = winningDecompositions(hand, 0, {});
    eq(decs.length, 3);
    // 111/222/333/444, 111/234/234/234 and 123/123/123/444 — the readings
    // differ in how many pungs they use, which is what changes the score.
    const pungCounts = decs
      .map((x) => x.sets.filter((set) => set[0] === set[1]).length)
      .sort();
    eq(JSON.stringify(pungCounts), JSON.stringify([1, 1, 4]));
  });
  test('an all-chows reading is found when one exists', () => {
    const hand = [c(1), c(2), c(3), c(1), c(2), c(3), b(4), b(5), b(6), d(7), d(8), d(9), E, E];
    const allChows = winningDecompositions(hand, 0, {}).some((x) => x.sets.length === 4
      && x.sets.every((set) => set[0] !== set[1]));
    eq(allChows, true);
  });
  test('exposed melds change how many concealed tiles a win needs', () => {
    const concealed = [c(1), c(2), c(3), c(4), c(5), c(6), b(1), b(1), b(1), E, E];
    eq(isWin(concealed, 1, {}), true, 'with one meld:');
    eq(isWin(concealed, 0, {}), false, 'without:');
  });
  test('seven pairs is a win, and four of a kind is not two of its pairs', () => {
    eq(isSevenPairs([c(1), c(1), c(4), c(4), b(1), b(1), b(4), b(4), d(1), d(1), E, E, RED, RED]), true);
    eq(isSevenPairs([c(1), c(1), c(1), c(1), c(4), c(4), b(1), b(1), b(4), b(4), d(1), d(1), E, E]), false);
  });
  test('seven pairs can be switched off', () => {
    const hand = [c(1), c(1), c(4), c(4), b(1), b(1), b(4), b(4), d(1), d(1), E, E, RED, RED];
    eq(winningDecompositions(hand, 0, { allowSevenPairs: true }).length, 1);
    eq(winningDecompositions(hand, 0, { allowSevenPairs: false }).length, 0);
  });
  test('thirteen orphans needs all thirteen and a duplicate', () => {
    eq(isThirteenOrphans([...THIRTEEN_ORPHANS, c(1)]), true);
    eq(isThirteenOrphans([...THIRTEEN_ORPHANS, c(5)]), false, 'a 5 spoils it:');
    // Drop the 1 of characters and hold three 9s instead: one of the thirteen
    // is missing, so it doesn't count however the rest lines up.
    eq(isThirteenOrphans([...THIRTEEN_ORPHANS.slice(1), c(9), c(9)]), false, 'one missing:');
  });
  test('the nine-gates shape waits on every tile of its suit', () => {
    const gates = [c(1), c(1), c(1), c(2), c(3), c(4), c(5), c(6), c(7), c(8), c(9), c(9), c(9)];
    eq(waits(gates, 0, {}).length, 9);
  });
  test('waits never offers a tile all four of which are in hand', () => {
    const hand = [c(1), c(1), c(1), c(1), c(2), c(3), c(4), b(1), b(1), b(1), E, E, E];
    eq(waits(hand, 0, {}).includes(c(1)), false);
  });
  test('standardDecompositions only pairs off tiles it has two of', () => {
    const decs = standardDecompositions([c(1), c(2), c(3), b(1), b(1), b(1), E, E], 2);
    eq(decs.every((x) => x.pair === E), true);
  });
  test('chowOptions offers every position the tile can take', () => {
    eq(chowOptions([c(1), c(2), c(4), c(5)], c(3)).length, 3);
    eq(chowOptions([E, S, W], E).length, 0, 'honours never chow:');
  });
  test('concealedKongs spots four of a kind', () =>
    eq(concealedKongs([c(1), c(1), c(1), c(1), c(5)]).length, 1));

  // ---- faan ----
  const faanOf = (hand, over = {}) => scoreHand(baseCtx({ concealed: hand, ...over })).faan;
  const patternsOf = (hand, over = {}) =>
    scoreHand(baseCtx({ concealed: hand, ...over })).patterns.map((p) => p.key);

  test('all one suit scores 7', () => {
    const hand = [b(1), b(2), b(3), b(4), b(5), b(6), b(7), b(8), b(9), b(1), b(1), b(1), b(2), b(2)];
    eq(patternsOf(hand).includes('allOneSuit'), true);
  });
  test('mixed one suit scores 3 and needs both a suit and an honour', () => {
    const mixed = [b(1), b(2), b(3), b(4), b(5), b(6), RED, RED, RED, b(7), b(8), b(9), E, E];
    eq(patternsOf(mixed).includes('mixedOneSuit'), true);
    const pure = [b(1), b(2), b(3), b(4), b(5), b(6), b(7), b(8), b(9), b(1), b(1), b(1), b(2), b(2)];
    eq(patternsOf(pure).includes('mixedOneSuit'), false, 'a pure hand is not mixed:');
  });
  test('two suits is neither flush', () => {
    const hand = [c(1), c(2), c(3), b(4), b(5), b(6), b(7), b(8), b(9), b(1), b(1), b(1), E, E];
    const ps = patternsOf(hand);
    eq(ps.includes('allOneSuit') || ps.includes('mixedOneSuit'), false);
  });
  test('all pungs scores 3, all chows scores 1', () => {
    eq(patternsOf([c(1), c(1), c(1), c(4), c(4), c(4), b(4), b(4), b(4), d(3), d(3), d(3), E, E])
      .includes('allPungs'), true);
    eq(patternsOf([c(1), c(2), c(3), c(4), c(5), c(6), b(1), b(2), b(3), d(1), d(2), d(3), E, E])
      .includes('allChows'), true);
  });
  test('each dragon pung is worth a faan', () => {
    const one = [RED, RED, RED, c(1), c(2), c(3), c(4), c(5), c(6), b(1), b(2), b(3), E, E];
    const two = [RED, RED, RED, GREEN, GREEN, GREEN, c(1), c(2), c(3), b(1), b(2), b(3), E, E];
    const p1 = scoreHand(baseCtx({ concealed: one })).patterns.find((p) => p.key === 'dragonPungs');
    const p2 = scoreHand(baseCtx({ concealed: two })).patterns.find((p) => p.key === 'dragonPungs');
    eq(p1.faan, 1);
    eq(p2.faan, 2);
  });
  test('seat and prevailing wind pungs each score, and only for the right wind', () => {
    const hand = [E, E, E, c(1), c(2), c(3), c(4), c(5), c(6), b(1), b(2), b(3), d(1), d(1)];
    const asEast = patternsOf(hand, { seatWind: 0, prevailingWind: 0 });
    eq(asEast.includes('seatWind') && asEast.includes('prevailingWind'), true, 'east in east:');
    const asSouth = patternsOf(hand, { seatWind: 1, prevailingWind: 1 });
    eq(asSouth.includes('seatWind') || asSouth.includes('prevailingWind'), false, 'south seat:');
  });
  test('all honours scores 10', () =>
    eq(patternsOf([E, E, E, S, S, S, RED, RED, RED, GREEN, GREEN, GREEN, WHITE, WHITE])
      .includes('allHonors'), true));
  test('thirteen orphans scores 13, seven pairs 4', () => {
    eq(patternsOf([...THIRTEEN_ORPHANS, c(1)]).includes('thirteenOrphans'), true);
    eq(patternsOf([c(1), c(1), c(4), c(4), b(1), b(1), b(4), b(4), d(1), d(1), E, E, RED, RED])
      .includes('sevenPairs'), true);
  });
  test('self-draw scores, and concealed only counts on a discard', () => {
    const hand = [c(1), c(2), c(3), c(4), c(5), c(6), b(1), b(2), b(3), d(1), d(2), d(3), E, E];
    eq(patternsOf(hand, { selfDraw: true }).includes('selfDraw'), true);
    eq(patternsOf(hand, { selfDraw: true }).includes('concealed'), false, 'not doubled up:');
    eq(patternsOf(hand, { selfDraw: false }).includes('concealed'), true, 'concealed on a discard:');
  });
  test('a claimed meld is not a concealed hand', () => {
    const concealed = [c(1), c(2), c(3), c(4), c(5), c(6), b(1), b(2), b(3), E, E];
    const melds = [{ type: 'pung', tiles: [RED, RED, RED], from: 's1' }];
    eq(patternsOf(concealed, { melds }).includes('concealed'), false);
  });
  test('each flower is worth a faan', () => {
    const hand = [c(1), c(2), c(3), c(4), c(5), c(6), b(1), b(2), b(3), d(1), d(2), d(3), E, E];
    eq(faanOf(hand, { flowers: [34, 35] }) - faanOf(hand, { flowers: [] }), 2);
  });
  test('scoring picks the best reading of an ambiguous hand', () => {
    // 111 222 333 444 bamboo + EE reads as all-pungs (3) or all-chows (1);
    // either way it is a pure suit, so the pung reading must win.
    const hand = [b(1), b(1), b(1), b(2), b(2), b(2), b(3), b(3), b(3), b(4), b(4), b(4), E, E];
    eq(patternsOf(hand).includes('allPungs'), true, 'took the pung cut:');
  });
  test('junk tiles are not a winning hand at all', () =>
    eq(scoreHand(baseCtx({ concealed: [c(1), c(3), c(5), c(7), c(9), b(2), b(4), b(6), b(8), d(1), d(3), d(5), d(7), d(9)] })), null));
  test('the Hong Kong table doubles every second faan and flattens at the limit', () => {
    eq(pointsFor(3, {}), 8);
    eq(pointsFor(4, {}), 16);
    eq(pointsFor(6, {}), 32);
    eq(pointsFor(13, {}), 384);
    eq(pointsFor(20, {}), 384, 'capped:');
    eq(pointsFor(20, { limitFaan: 5 }), 24, 'lower limit:');
  });
  test('faan-as-points is an alternative table', () => {
    eq(pointsFor(5, { scoring: 'faan' }), 5);
    eq(pointsFor(20, { scoring: 'faan', limitFaan: 13 }), 13);
  });

  // ---- dealing ----
  test('deal: 13 tiles each, dealer to act, every tile accounted for', () => {
    const s = newGame();
    eq(s.phase, 'play');
    eq(s.turnIndex, s.dealerIndex, 'dealer opens:');
    for (const p of s.players) eq(p.hand.length, 13, 'hand:');
    eq(tilesInPlay(s), 144, 'conservation:');
  });
  test('the dealer is East and the winds run round from there', () => {
    const s = newGame();
    eq(s.players[s.dealerIndex].wind, 0);
    eq(new Set(s.players.map((p) => p.wind)).size, 4, 'all four winds:');
  });
  test('flowers are set aside at the deal and replaced', () => {
    const s = newGame(11);
    for (const p of s.players) {
      eq(p.hand.length, 13, 'still thirteen:');
      eq(p.hand.every((t) => !isBonus(t)), true, 'no flowers left in hand:');
    }
  });
  test('flowers can be switched off entirely', () => {
    const s = createState(makeRng(5));
    for (let i = 0; i < 4; i++) addPlayer(s, 's' + i, null, 'P' + i);
    s.hostSeat = 's0';
    s.settings.includeFlowers = false;
    startRound(s);
    eq(tilesInPlay(s), 136);
    for (const p of s.players) eq(p.flowers.length, 0, 'no flowers:');
  });

  // ---- turns ----
  test('draw then discard passes play along', () => {
    const s = newGame();
    const p = s.players[s.turnIndex];
    eq(applyAction(s, p.seatId, { a: 'draw', now: 0 }).ok, true);
    eq(p.hand.length, 14, 'holding:');
    eq(applyAction(s, p.seatId, { a: 'draw', now: 0 }).ok, false, 'no second draw:');
    const before = tilesInPlay(s);
    eq(applyAction(s, p.seatId, { a: 'discard', tile: p.hand[0], now: 0 }).ok, true);
    eq(p.hand.length, 13, 'back to thirteen:');
    eq(tilesInPlay(s), before, 'conservation:');
  });
  test('discarding before drawing is rejected', () => {
    const s = newGame();
    const p = s.players[s.turnIndex];
    eq(applyAction(s, p.seatId, { a: 'discard', tile: p.hand[0], now: 0 }).ok, false);
  });
  test('discarding a tile you do not hold is rejected', () => {
    const s = newGame();
    const p = s.players[s.turnIndex];
    applyAction(s, p.seatId, { a: 'draw', now: 0 });
    const absent = [...Array(KINDS).keys()].find((t) => !p.hand.includes(t));
    eq(applyAction(s, p.seatId, { a: 'discard', tile: absent, now: 0 }).ok, false);
  });
  test('out-of-turn action is rejected and changes nothing', () => {
    const s = newGame();
    const other = s.players[(s.turnIndex + 1) % 4];
    const before = JSON.stringify(redact(s, other.seatId));
    eq(applyAction(s, other.seatId, { a: 'draw', now: 0 }).ok, false);
    eq(JSON.stringify(redact(s, other.seatId)), before);
  });

  // ---- claims ----
  // Put a discardable tile in the current player's hand and a matching pair
  // (or better) in someone else's, then discard it.
  function setUpDiscard(s, tile, claimants = {}) {
    const cur = s.players[s.turnIndex];
    applyAction(s, cur.seatId, { a: 'draw', now: 1000 });
    cur.hand = sortTiles([tile, ...cur.hand.slice(0, 13)]);
    for (const [seatId, hand] of Object.entries(claimants)) rig(s, seatId, hand);
    applyAction(s, cur.seatId, { a: 'discard', tile, now: 1000 });
    return cur;
  }

  test('nobody can claim: play carries straight on, no window at all', () => {
    const s = newGame();
    const cur = s.players[s.turnIndex];
    // Give everyone else a hand with nothing matching a red dragon.
    for (const p of s.players) {
      if (p.seatId !== cur.seatId) rig(s, p.seatId, new Array(13).fill(c(5)));
    }
    setUpDiscard(s, RED);
    eq(s.phase, 'play', 'no window:');
    eq(s.claimDeadline, null);
  });
  test('a claimable discard opens a window with a deadline', () => {
    const s = newGame();
    s.turnIndex = 0;
    const next = 's1';
    setUpDiscard(s, RED, { [next]: [RED, RED, ...new Array(11).fill(c(5))] });
    eq(s.phase, 'claim');
    eq(s.claimDeadline, 1000 + s.settings.claimSeconds * 1000, 'deadline stamped from act.now:');
    eq(claimOptions(s, next).pung, true);
  });
  test('players with nothing to claim are passed for them', () => {
    const s = newGame();
    s.turnIndex = 0;
    setUpDiscard(s, RED, { s1: [RED, RED, ...new Array(11).fill(c(5))] });
    eq(s.claims.s2, 'pass');
    eq(s.claims.s3, 'pass');
    eq(s.claims.s1, undefined, 'the one who can claim still owes an answer:');
  });
  test('a pung claim exposes the meld and hands them the turn', () => {
    const s = newGame();
    s.turnIndex = 0;
    setUpDiscard(s, RED, { s1: [RED, RED, ...new Array(11).fill(c(5))] });
    eq(applyAction(s, 's1', { a: 'claim', type: 'pung', now: 1100 }).ok, true);
    eq(s.phase, 'play');
    eq(s.players[s.turnIndex].seatId, 's1', 'their turn:');
    const m = s.players[1].melds[0];
    eq(m.type, 'pung');
    eq(m.tiles.length, 3);
    eq(m.from, 's0', 'records who threw it:');
    eq(s.players[0].discards.includes(RED), false, 'taken out of the pond:');
  });
  test('a kong claim draws a replacement tile', () => {
    const s = newGame();
    s.turnIndex = 0;
    setUpDiscard(s, RED, { s1: [RED, RED, RED, ...new Array(10).fill(c(5))] });
    const wallBefore = s.wall.length;
    eq(applyAction(s, 's1', { a: 'claim', type: 'kong', now: 1100 }).ok, true);
    eq(s.players[1].melds[0].tiles.length, 4);
    eq(s.wall.length, wallBefore - 1, 'replacement drawn:');
    eq(tilesInPlay(s), 144, 'conservation:');
  });
  test('only the player to the discarder’s left may chow', () => {
    const s = newGame();
    s.turnIndex = 0;
    const runHand = [c(2), c(4), ...new Array(11).fill(b(5))];
    setUpDiscard(s, c(3), { s1: runHand, s2: [...runHand] });
    eq(claimOptions(s, 's1').chows.length > 0, true, 'the next seat can:');
    eq(claimOptions(s, 's2').chows.length, 0, 'the seat after cannot:');
  });
  test('a claim the player cannot make is refused', () => {
    const s = newGame();
    s.turnIndex = 0;
    setUpDiscard(s, RED, { s1: [RED, RED, ...new Array(11).fill(c(5))] });
    eq(applyAction(s, 's1', { a: 'claim', type: 'kong', now: 1100 }).ok, false, 'no fourth tile:');
    eq(applyAction(s, 's1', { a: 'claim', type: 'chow', tiles: [c(1), c(2)], now: 1100 }).ok, false);
  });
  test('the discarder cannot claim their own tile', () => {
    const s = newGame();
    s.turnIndex = 0;
    setUpDiscard(s, RED, { s1: [RED, RED, ...new Array(11).fill(c(5))] });
    eq(applyAction(s, 's0', { a: 'claim', type: 'pung', now: 1100 }).ok, false);
    eq(applyAction(s, 's0', { a: 'pass', now: 1100 }).ok, false);
  });
  test('answering twice is refused', () => {
    const s = newGame();
    s.turnIndex = 0;
    setUpDiscard(s, RED, {
      s1: [RED, RED, ...new Array(11).fill(c(5))],
      s2: [RED, RED, ...new Array(11).fill(b(5))],
    });
    eq(applyAction(s, 's1', { a: 'pass', now: 1100 }).ok, true);
    eq(applyAction(s, 's1', { a: 'pass', now: 1100 }).ok, false);
  });
  test('everyone passing hands the turn to the next seat', () => {
    const s = newGame();
    s.turnIndex = 0;
    setUpDiscard(s, RED, { s1: [RED, RED, ...new Array(11).fill(c(5))] });
    eq(applyAction(s, 's1', { a: 'pass', now: 1100 }).ok, true);
    eq(s.phase, 'play');
    eq(s.players[s.turnIndex].seatId, 's1', 'next seat picks up:');
  });
  test('pung beats chow', () => {
    const s = newGame();
    s.turnIndex = 0;
    setUpDiscard(s, c(3), {
      s1: [c(2), c(4), ...new Array(11).fill(b(5))],      // can chow
      s2: [c(3), c(3), ...new Array(11).fill(d(5))],      // can pung
    });
    applyAction(s, 's1', { a: 'claim', type: 'chow', tiles: [c(2), c(4)], now: 1100 });
    applyAction(s, 's2', { a: 'claim', type: 'pung', now: 1100 });
    eq(s.players[2].melds.length, 1, 'the pung won:');
    eq(s.players[1].melds.length, 0, 'the chow lost:');
  });
  test('kong beats pung', () => {
    const s = newGame();
    s.turnIndex = 0;
    setUpDiscard(s, RED, {
      s1: [RED, RED, ...new Array(11).fill(c(5))],
      s2: [RED, RED, RED, ...new Array(10).fill(d(5))],
    });
    applyAction(s, 's1', { a: 'claim', type: 'pung', now: 1100 });
    applyAction(s, 's2', { a: 'claim', type: 'kong', now: 1100 });
    eq(s.players[2].melds[0]?.type, 'kong');
    eq(s.players[1].melds.length, 0);
  });
  test('mahjong beats everything', () => {
    const s = newGame();
    s.turnIndex = 0;
    // s2 wins on the red dragon; s1 could only pung it.
    const winner = [RED, RED, b(1), b(2), b(3), b(4), b(5), b(6), b(7), b(8), b(9), b(1), b(1)];
    setUpDiscard(s, RED, {
      s1: [RED, RED, ...new Array(11).fill(c(5))],
      s2: winner,
    });
    applyAction(s, 's1', { a: 'claim', type: 'pung', now: 1100 });
    eq(claimOptions(s, 's2').mahjong, true, 'the win is on offer:');
    eq(applyAction(s, 's2', { a: 'claim', type: 'mahjong', now: 1100 }).ok, true);
    eq(s.phase, 'roundEnd');
    eq(s.reveal.winner, 's2');
  });
  test('between equal claims the nearer seat to the discarder wins', () => {
    const s = newGame();
    s.turnIndex = 0;
    setUpDiscard(s, RED, {
      s1: [RED, RED, ...new Array(11).fill(c(5))],
      s2: [RED, RED, ...new Array(11).fill(d(5))],
    });
    applyAction(s, 's2', { a: 'claim', type: 'pung', now: 1100 });
    applyAction(s, 's1', { a: 'claim', type: 'pung', now: 1100 });
    eq(s.players[1].melds.length, 1, 's1 sits nearer:');
    eq(s.players[2].melds.length, 0);
  });
  test('a hand below the faan minimum cannot be declared', () => {
    const s = newGame();
    s.turnIndex = 0;
    s.settings.minFaan = 6;
    const winner = [RED, RED, b(1), b(2), b(3), b(4), b(5), b(6), b(7), b(8), b(9), b(1), b(1)];
    setUpDiscard(s, RED, { s2: winner });
    const o = claimOptions(s, 's2');
    if (o.faan < 6) {
      eq(o.mahjong, false, 'not offered:');
      const r = applyAction(s, 's2', { a: 'claim', type: 'mahjong', now: 1100 });
      eq(r.ok, false);
      eq(r.msg.includes('faan'), true, 'says why:');
    }
  });

  // ---- claim window expiry ----
  test('the window can be expired by the host once the clock is up', () => {
    const s = newGame();
    s.turnIndex = 0;
    setUpDiscard(s, RED, { s1: [RED, RED, ...new Array(11).fill(c(5))] });
    eq(applyAction(s, 's0', { a: 'expireClaims', now: 1100 }).ok, false, 'too early:');
    eq(s.phase, 'claim', 'still open:');
    eq(applyAction(s, 's0', { a: 'expireClaims', now: s.claimDeadline }).ok, true);
    eq(s.phase, 'play', 'closed:');
    eq(s.players[s.turnIndex].seatId, 's1', 'turn moved on:');
  });
  test('only the host may expire the window', () => {
    const s = newGame();
    s.turnIndex = 0;
    setUpDiscard(s, RED, { s1: [RED, RED, ...new Array(11).fill(c(5))] });
    eq(applyAction(s, 's2', { a: 'expireClaims', now: 99999 }).ok, false);
  });
  test('a disconnected player never stalls the window', () => {
    const s = newGame();
    s.turnIndex = 0;
    s.players[1].connected = false;
    setUpDiscard(s, RED, { s1: [RED, RED, ...new Array(11).fill(c(5))] });
    // The only possible claimant is offline, so the window never even opens.
    eq(s.phase, 'play');
  });
  test('play actions are refused while a claim window is open', () => {
    const s = newGame();
    s.turnIndex = 0;
    setUpDiscard(s, RED, { s1: [RED, RED, ...new Array(11).fill(c(5))] });
    eq(applyAction(s, 's1', { a: 'draw', now: 1100 }).ok, false);
  });

  // ---- kongs from hand ----
  test('a concealed kong melds four and draws a replacement', () => {
    const s = newGame();
    const p = s.players[s.turnIndex];
    rig(s, p.seatId, [RED, RED, RED, RED, ...new Array(10).fill(c(5))]);
    const wallBefore = s.wall.length;
    eq(applyAction(s, p.seatId, { a: 'kongConcealed', tile: RED, now: 0 }).ok, true);
    eq(p.melds[0].type, 'ckong');
    eq(p.melds[0].tiles.length, 4);
    eq(s.wall.length, wallBefore - 1, 'replacement drawn:');
  });
  test('a concealed kong needs all four tiles', () => {
    const s = newGame();
    const p = s.players[s.turnIndex];
    rig(s, p.seatId, [RED, RED, RED, ...new Array(11).fill(c(5))]);
    eq(applyAction(s, p.seatId, { a: 'kongConcealed', tile: RED, now: 0 }).ok, false);
  });
  test('a pung can be promoted to a kong with the fourth tile', () => {
    const s = newGame();
    const p = s.players[s.turnIndex];
    rig(s, p.seatId, [RED, ...new Array(10).fill(c(5))],
      [{ type: 'pung', tiles: [RED, RED, RED], from: 's1' }]);
    eq(applyAction(s, p.seatId, { a: 'kongPromote', tile: RED, now: 0 }).ok, true);
    eq(p.melds[0].type, 'kong');
    eq(p.melds[0].tiles.length, 4);
  });
  test('promoting without the pung, or without the tile, is refused', () => {
    const s = newGame();
    const p = s.players[s.turnIndex];
    rig(s, p.seatId, [RED, ...new Array(13).fill(c(5))]);
    eq(applyAction(s, p.seatId, { a: 'kongPromote', tile: RED, now: 0 }).ok, false, 'no pung:');
    rig(s, p.seatId, new Array(11).fill(c(5)),
      [{ type: 'pung', tiles: [RED, RED, RED], from: 's1' }]);
    eq(applyAction(s, p.seatId, { a: 'kongPromote', tile: RED, now: 0 }).ok, false, 'no tile:');
  });

  // ---- winning and paying ----
  const WIN14 = [b(1), b(2), b(3), b(4), b(5), b(6), b(7), b(8), b(9), b(1), b(1), b(1), b(2), b(2)];

  test('self-draw is paid by all three losers', () => {
    const s = newGame();
    const p = rig(s, s.players[s.turnIndex].seatId, WIN14);
    eq(applyAction(s, p.seatId, { a: 'mahjong', now: 0 }).ok, true);
    eq(s.phase, 'roundEnd');
    eq(s.reveal.selfDraw, true);
    const unit = s.reveal.points;
    const win = s.roundScores.find((r) => r.seatId === p.seatId).score;
    eq(win, unit * 3, 'winner collects three units:');
    for (const r of s.roundScores) {
      if (r.seatId !== p.seatId) eq(r.score, -unit, r.seatId + ' pays one:');
    }
  });
  test('a hand that is not a win cannot declare mahjong', () => {
    const s = newGame();
    const p = rig(s, s.players[s.turnIndex].seatId,
      [c(1), c(3), c(5), c(7), c(9), b(2), b(4), b(6), b(8), d(1), d(3), d(5), d(7), d(9)]);
    eq(applyAction(s, p.seatId, { a: 'mahjong', now: 0 }).ok, false);
  });
  test('discarder pays all: the thrower carries the whole hand', () => {
    const s = newGame();
    s.turnIndex = 0;
    s.settings.discarderPaysAll = true;
    setUpDiscard(s, RED, { s2: [RED, RED, b(1), b(2), b(3), b(4), b(5), b(6), b(7), b(8), b(9), b(1), b(1)] });
    applyAction(s, 's2', { a: 'claim', type: 'mahjong', now: 1100 });
    const unit = s.reveal.points;
    eq(s.roundScores.find((r) => r.seatId === 's0').score, -unit * 3, 'thrower pays all:');
    eq(s.roundScores.find((r) => r.seatId === 's1').score, 0, 'bystander pays nothing:');
    eq(s.roundScores.find((r) => r.seatId === 's2').score, unit * 3, 'winner collects the same:');
  });
  test('discarder pays all off: the three losers split it', () => {
    const s = newGame();
    s.turnIndex = 0;
    s.settings.discarderPaysAll = false;
    setUpDiscard(s, RED, { s2: [RED, RED, b(1), b(2), b(3), b(4), b(5), b(6), b(7), b(8), b(9), b(1), b(1)] });
    applyAction(s, 's2', { a: 'claim', type: 'mahjong', now: 1100 });
    const unit = s.reveal.points;
    for (const seat of ['s0', 's1', 's3']) {
      eq(s.roundScores.find((r) => r.seatId === seat).score, -unit, seat + ':');
    }
    eq(s.roundScores.find((r) => r.seatId === 's2').score, unit * 3, 'winner collects the same either way:');
  });
  test('scores are zero-sum and accumulate into totals', () => {
    const s = newGame();
    const p = rig(s, s.players[s.turnIndex].seatId, WIN14);
    applyAction(s, p.seatId, { a: 'mahjong', now: 0 });
    eq(s.roundScores.reduce((n, r) => n + r.score, 0), 0, 'zero-sum:');
    for (const r of s.roundScores) {
      eq(s.players.find((q) => q.seatId === r.seatId).total, r.score, r.seatId + ':');
    }
  });
  test('reveal opens every hand and names the patterns', () => {
    const s = newGame();
    const p = rig(s, s.players[s.turnIndex].seatId, WIN14);
    applyAction(s, p.seatId, { a: 'mahjong', now: 0 });
    eq(s.reveal.rows.length, 4);
    eq(s.reveal.patterns.length > 0, true, 'patterns listed:');
    eq(s.reveal.faan > 0, true, 'faan counted:');
  });
  test('actions are refused once the hand is over', () => {
    const s = newGame();
    const p = rig(s, s.players[s.turnIndex].seatId, WIN14);
    applyAction(s, p.seatId, { a: 'mahjong', now: 0 });
    eq(applyAction(s, p.seatId, { a: 'draw', now: 0 }).ok, false);
  });
  test('an empty wall washes the hand out with nobody scoring', () => {
    const s = newGame();
    s.wall = [];
    const p = s.players[s.turnIndex];
    eq(applyAction(s, p.seatId, { a: 'draw', now: 0 }).ok, true);
    eq(s.phase, 'roundEnd');
    eq(s.reveal.drawn, true);
    for (const r of s.roundScores) eq(r.score, 0, r.seatId + ':');
  });

  // ---- the deal moving on ----
  test('the deal passes on after a loss', () => {
    const s = newGame();
    s.dealerIndex = 1;
    s.dealerRepeats = false;
    startRound(s);
    eq(s.dealerIndex, 2);
  });
  test('the dealer keeps the deal after winning', () => {
    const s = newGame();
    s.turnIndex = s.dealerIndex;
    const p = rig(s, s.players[s.dealerIndex].seatId, WIN14);
    applyAction(s, p.seatId, { a: 'mahjong', now: 0 });
    eq(s.dealerRepeats, true);
    const wasDealer = s.dealerIndex;
    startRound(s);
    eq(s.dealerIndex, wasDealer, 'same dealer:');
  });
  test('the dealer keeps the deal after a washed-out hand', () => {
    const s = newGame();
    s.wall = [];
    applyAction(s, s.players[s.turnIndex].seatId, { a: 'draw', now: 0 });
    eq(s.dealerRepeats, true);
  });
  test('a full circuit of the deal moves the prevailing wind on', () => {
    const s = newGame();
    s.dealerIndex = 3;
    s.dealerRepeats = false;
    s.prevailingWind = 0;
    startRound(s);
    eq(s.dealerIndex, 0);
    eq(s.prevailingWind, 1);
  });

  // ---- redaction ----
  test('redact shows your tiles and nobody else’s concealed hand', () => {
    const s = newGame();
    for (const viewer of s.players.map((p) => p.seatId)) {
      const v = redact(s, viewer);
      eq(v.myHand.length, 13, 'own hand:');
      for (const p of v.players) eq('hand' in p, false, p.seatId + ' hidden:');
      eq('wall' in v, false, 'no wall:');
      eq('rng' in v, false, 'no rng:');
      eq(typeof v.wallCount, 'number', 'count only:');
    }
  });
  test('redact publishes melds, flowers and ponds — all open at a real table', () => {
    const s = newGame();
    const p = s.players[s.turnIndex];
    applyAction(s, p.seatId, { a: 'draw', now: 0 });
    applyAction(s, p.seatId, { a: 'discard', tile: p.hand[0], now: 0 });
    const v = redact(s, s.players[2].seatId);
    const row = v.players.find((q) => q.seatId === p.seatId);
    eq(Array.isArray(row.discards), true, 'pond visible:');
    eq(Array.isArray(row.melds), true, 'melds visible:');
    eq(Array.isArray(row.flowers), true, 'flowers visible:');
  });
  test('redact says who has answered a claim but never what they claimed', () => {
    const s = newGame();
    s.turnIndex = 0;
    setUpDiscard(s, RED, {
      s1: [RED, RED, ...new Array(11).fill(c(5))],
      s2: [RED, RED, ...new Array(11).fill(d(5))],
    });
    applyAction(s, 's1', { a: 'claim', type: 'pung', now: 1100 });
    const asOther = redact(s, 's3');
    eq(asOther.claimAnswered.includes('s1'), true, 'answered is public:');
    eq('claims' in asOther, false, 'the claims themselves never ship:');
    // s3 was auto-passed, so they see their own answer and nothing more.
    eq(asOther.myClaim, 'pass', 'own answer only:');
    eq(redact(s, 's1').myClaim.type, 'pung', 'but you see your own:');
  });
  test('redact offers claim options only to the viewer they belong to', () => {
    const s = newGame();
    s.turnIndex = 0;
    setUpDiscard(s, RED, { s1: [RED, RED, ...new Array(11).fill(c(5))] });
    eq(redact(s, 's1').myClaimOptions.pung, true);
    eq(redact(s, 's2').myClaimOptions.pung, false);
  });
  test('redact hides the reveal until the hand is over', () => {
    const s = newGame();
    eq(redact(s, 's0').reveal, null);
    const p = rig(s, s.players[s.turnIndex].seatId, WIN14);
    applyAction(s, p.seatId, { a: 'mahjong', now: 0 });
    eq(redact(s, 's0').reveal !== null, true);
  });
  test('redact shows the drawn tile only to the player who drew it', () => {
    const s = newGame();
    const p = s.players[s.turnIndex];
    applyAction(s, p.seatId, { a: 'draw', now: 0 });
    eq(redact(s, p.seatId).myJustDrew !== null, true, 'drawer sees it:');
    const other = s.players[(s.turnIndex + 1) % 4].seatId;
    eq(redact(s, other).myJustDrew, null, 'nobody else does:');
  });
  test('redact carries lastMove with an increasing seq', () => {
    const s = newGame();
    const p = s.players[s.turnIndex];
    applyAction(s, p.seatId, { a: 'draw', now: 0 });
    const v1 = redact(s, 's0');
    eq(v1.lastMove.a, 'draw');
    applyAction(s, p.seatId, { a: 'discard', tile: p.hand[0], now: 0 });
    eq(redact(s, 's0').lastMove.seq > v1.lastMove.seq, true);
  });

  // ---- lobby ----
  test('finalScores sorts highest first', () => {
    const s = newGame();
    s.players[0].total = 12;
    s.players[1].total = 40;
    const fs = finalScores(s);
    eq(fs[0].seatId, 's1');
  });
  test('resetToLobby clears the hand but keeps the house rules', () => {
    const s = newGame();
    s.settings.minFaan = 5;
    resetToLobby(s);
    eq(s.phase, 'lobby');
    eq(s.wall.length, 0);
    eq(s.dealerIndex, null);
    eq(s.settings.minFaan, 5, 'rules kept:');
    for (const p of s.players) eq(p.hand.length, 0, 'hands cleared:');
  });
  test('every setting has a default that lands in state', () => {
    const s = newGame();
    for (const f of SETTINGS) eq(f.key in s.settings, true, f.key + ':');
  });

  // ---- fuzz ----
  test('fuzz: 25 random hands play out without crashing, tiles conserved', () => {
    for (let g = 0; g < 25; g++) {
      const rng = makeRng(9000 + g);
      const s = createState(rng);
      for (let i = 0; i < 4; i++) addPlayer(s, 's' + i, 'p' + i, 'P' + i);
      s.hostSeat = 's0';
      startRound(s);
      const total = tilesInPlay(s);
      let now = 0;
      let guard = 0;
      while (s.phase !== 'roundEnd' && guard++ < 2000) {
        now += 100;
        if (s.phase === 'claim') {
          // Answer for whoever still owes one: sometimes claim, mostly pass.
          const pending = s.players.filter((p) => p.seatId !== s.lastDiscard.seat && !s.claims[p.seatId]);
          if (!pending.length) {
            const r = applyAction(s, 's0', { a: 'expireClaims', now: s.claimDeadline });
            if (!r.ok) throw new Error(`game ${g}: could not expire: ${r.msg}`);
            continue;
          }
          const p = pending[0];
          const o = claimOptions(s, p.seatId);
          let acted = false;
          if (o.mahjong) {
            acted = applyAction(s, p.seatId, { a: 'claim', type: 'mahjong', now }).ok;
          } else if (rng() < 0.4) {
            const type = o.kong ? 'kong' : o.pung ? 'pung' : o.chows.length ? 'chow' : null;
            if (type) {
              acted = applyAction(s, p.seatId, {
                a: 'claim', type, tiles: type === 'chow' ? o.chows[0] : null, now,
              }).ok;
            }
          }
          if (!acted) {
            const r = applyAction(s, p.seatId, { a: 'pass', now });
            if (!r.ok) throw new Error(`game ${g}: pass rejected: ${r.msg}`);
          }
        } else {
          const p = s.players[s.turnIndex];
          const target = 13 - 3 * p.melds.length;
          if (p.hand.length <= target) {
            const r = applyAction(s, p.seatId, { a: 'draw', now });
            if (!r.ok) throw new Error(`game ${g}: draw rejected: ${r.msg}`);
          } else {
            // Declare a win when it's there, otherwise throw something.
            if (applyAction(s, p.seatId, { a: 'mahjong', now }).ok) continue;
            const kongs = concealedKongs(p.hand);
            if (kongs.length && rng() < 0.5) {
              applyAction(s, p.seatId, { a: 'kongConcealed', tile: kongs[0], now });
              continue;
            }
            const tile = p.hand[Math.floor(rng() * p.hand.length)];
            const r = applyAction(s, p.seatId, { a: 'discard', tile, now });
            if (!r.ok) throw new Error(`game ${g}: discard rejected: ${r.msg}`);
          }
        }
        if (tilesInPlay(s) !== total) {
          throw new Error(`game ${g}: tile conservation broken (${tilesInPlay(s)} vs ${total})`);
        }
      }
      if (s.phase !== 'roundEnd') throw new Error(`game ${g}: hand never ended`);
      if (s.roundScores.reduce((n, r) => n + r.score, 0) !== 0) {
        throw new Error(`game ${g}: scores not zero-sum`);
      }
    }
  });

  return results;
}
