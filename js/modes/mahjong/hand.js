// modes/mahjong/hand.js — is this a winning hand, and how does it break down?
// Pure: counts in, decompositions out. No DOM, no network, no scoring.
import {
  KINDS, countsOf, canStartChow, isHonor, THIRTEEN_ORPHANS,
} from './tiles.js';

// A standard hand is four sets and a pair. Exposed melds already are sets, so
// only the concealed tiles need decomposing.
//
// The walk always starts at the lowest tile still in hand, which makes the
// branching factor two (pung or chow) over at most 14 tiles — small enough
// that returning EVERY decomposition is cheap, and scoring needs them all: the
// same hand can read as all-chows or as a half flush depending on the cut.
function findSets(counts, need, acc, out) {
  if (need === 0) {
    out.push([...acc]);
    return;
  }
  let i = 0;
  while (i < KINDS && counts[i] === 0) i++;
  if (i >= KINDS) return;

  if (counts[i] >= 3) {
    counts[i] -= 3;
    acc.push([i, i, i]);
    findSets(counts, need - 1, acc, out);
    acc.pop();
    counts[i] += 3;
  }
  if (canStartChow(i) && counts[i + 1] > 0 && counts[i + 2] > 0) {
    counts[i]--; counts[i + 1]--; counts[i + 2]--;
    acc.push([i, i + 1, i + 2]);
    findSets(counts, need - 1, acc, out);
    acc.pop();
    counts[i]++; counts[i + 1]++; counts[i + 2]++;
  }
}

// Every way the concealed tiles split into `setsNeeded` sets plus one pair.
export function standardDecompositions(concealed, setsNeeded) {
  const counts = countsOf(concealed);
  const out = [];
  for (let p = 0; p < KINDS; p++) {
    if (counts[p] < 2) continue;
    counts[p] -= 2;
    const sets = [];
    findSets(counts, setsNeeded, [], sets);
    for (const s of sets) out.push({ sets: s, pair: p, special: null });
    counts[p] += 2;
  }
  return out;
}

// Seven distinct pairs. Four of a kind counted as two pairs is deliberately
// refused — the usual house reading, and it keeps the hand rare.
export function isSevenPairs(concealed) {
  if (concealed.length !== 14) return false;
  const counts = countsOf(concealed);
  return counts.filter((c) => c === 2).length === 7
    && counts.every((c) => c === 0 || c === 2);
}

// All thirteen terminals and honours, one of them twice.
export function isThirteenOrphans(concealed) {
  if (concealed.length !== 14) return false;
  const counts = countsOf(concealed);
  for (let t = 0; t < KINDS; t++) {
    const wanted = THIRTEEN_ORPHANS.includes(t);
    if (!wanted && counts[t] !== 0) return false;
    if (wanted && counts[t] === 0) return false;
  }
  return THIRTEEN_ORPHANS.some((t) => counts[t] === 2);
}

// Every winning reading of a hand. `exposedCount` melds are already sets, so
// the concealed tiles must supply the rest. The two special shapes are only
// available on a fully concealed hand.
export function winningDecompositions(concealed, exposedCount = 0, settings = {}) {
  const out = [];
  const setsNeeded = 4 - exposedCount;
  if (setsNeeded >= 0 && concealed.length === setsNeeded * 3 + 2) {
    out.push(...standardDecompositions(concealed, setsNeeded));
  }
  if (exposedCount === 0) {
    if (settings.allowSevenPairs !== false && isSevenPairs(concealed)) {
      out.push({ sets: [], pair: null, special: 'sevenPairs' });
    }
    if (isThirteenOrphans(concealed)) {
      out.push({ sets: [], pair: null, special: 'thirteenOrphans' });
    }
  }
  return out;
}

export const isWin = (concealed, exposedCount = 0, settings = {}) =>
  winningDecompositions(concealed, exposedCount, settings).length > 0;

// Which tiles would complete this hand? Used to offer a "declare mahjong"
// button only when the claim is actually legal.
export function waits(concealed, exposedCount = 0, settings = {}) {
  const out = [];
  const counts = countsOf(concealed);
  for (let t = 0; t < KINDS; t++) {
    if (counts[t] >= 4) continue; // all four already accounted for
    if (isWin([...concealed, t], exposedCount, settings)) out.push(t);
  }
  return out;
}

// Does this hand hold a concealed set of four?
export const concealedKongs = (concealed) =>
  countsOf(concealed).map((c, t) => (c === 4 ? t : -1)).filter((t) => t >= 0);

// The chows a player could form from `tile` using two of their own tiles.
export function chowOptions(concealed, tile) {
  const counts = countsOf(concealed);
  const out = [];
  const has = (t) => t >= 0 && t < KINDS && counts[t] > 0;
  // tile completes a run as its bottom, middle or top card.
  for (const start of [tile - 2, tile - 1, tile]) {
    if (!canStartChow(start)) continue;
    const need = [start, start + 1, start + 2].filter((t) => t !== tile);
    if (need.length !== 2) continue;
    if (need.every(has) && !isHonor(tile)) out.push(need);
  }
  return out;
}
