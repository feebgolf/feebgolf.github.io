// modes/gin/melds.js — melds and deadwood. Pure, DOM-free, and imported by
// BOTH the engine and the view: a player running the solver on the hand they
// can already see leaks nothing, and it lets the table show a live deadwood
// count without a round trip to the host.
import { RANKS } from '../../cards.js';

// Aces are low and runs don't wrap, so plain rank position is all we need.
export const rankIndex = (rank) => RANKS.indexOf(rank);

// A = 1, face cards = 10, everything else at face value.
export function cardValue(card) {
  switch (card.rank) {
    case 'A': return 1;
    case 'J':
    case 'Q':
    case 'K': return 10;
    default: return parseInt(card.rank, 10);
  }
}

export const handValue = (cards) => cards.reduce((n, c) => n + cardValue(c), 0);

const bit = (i) => 1 << i;
const maskOf = (idxs) => idxs.reduce((m, i) => m | bit(i), 0);

// ---- candidate melds ----

// Every subset of `idxs` with at least `min` members. Hands are 10-11 cards, so
// even a pathological group is a few hundred subsets.
function subsets(idxs, min) {
  const out = [];
  const n = idxs.length;
  for (let m = 1; m < (1 << n); m++) {
    const pick = [];
    for (let i = 0; i < n; i++) if (m & bit(i)) pick.push(idxs[i]);
    if (pick.length >= min) out.push(pick);
  }
  return out;
}

// Sets: three or more of a rank. With several decks in play two identical
// cards may or may not both count, hence the toggle.
//
// Two picks from the same rank that use the same suits are the same meld in
// every way that matters — same value melded, same cards left for runs — so
// only one of each suit signature is kept. Without that, a hand holding many
// cards of one rank generates thousands of equivalent candidates and the
// search below grinds (eleven of a rank went from 650ms to under a
// millisecond when this was added).
function setMelds(hand, allowDuplicates) {
  const byRank = new Map();
  hand.forEach((c, i) => {
    if (!byRank.has(c.rank)) byRank.set(c.rank, []);
    byRank.get(c.rank).push(i);
  });
  const out = [];
  for (const idxs of byRank.values()) {
    if (idxs.length < 3) continue;
    const seen = new Set();
    for (const pick of subsets(idxs, 3)) {
      if (!allowDuplicates) {
        const suits = new Set(pick.map((i) => hand[i].suit));
        if (suits.size !== pick.length) continue;
      }
      const sig = pick.map((i) => hand[i].suit).sort().join('');
      if (seen.has(sig)) continue;
      seen.add(sig);
      out.push(pick);
    }
  }
  return out;
}

// Runs: three or more consecutive ranks in one suit, one card per rank.
// Duplicates of the same rank+suit are interchangeable, so take the first.
function runMelds(hand) {
  const bySuit = new Map();
  hand.forEach((c, i) => {
    if (!bySuit.has(c.suit)) bySuit.set(c.suit, new Map());
    const byRank = bySuit.get(c.suit);
    if (!byRank.has(rankIndex(c.rank))) byRank.set(rankIndex(c.rank), i);
  });
  const out = [];
  for (const byRank of bySuit.values()) {
    const ranks = [...byRank.keys()].sort((a, b) => a - b);
    for (let a = 0; a < ranks.length; a++) {
      for (let b = a + 2; b < ranks.length; b++) {
        if (ranks[b] - ranks[a] !== b - a) break; // stretch broken; stop extending
        out.push(ranks.slice(a, b + 1).map((r) => byRank.get(r)));
      }
    }
  }
  return out;
}

// Index form, for the solver's bitmask bookkeeping.
function candidateIndexMelds(hand, { allowDuplicateSets = true } = {}) {
  return [...setMelds(hand, allowDuplicateSets), ...runMelds(hand)];
}

// Card form, for callers who just want to see the melds.
export function candidateMelds(hand, settings = {}) {
  return candidateIndexMelds(hand, settings).map((idxs) => idxs.map((i) => hand[i]));
}

// ---- best decomposition ----

// Pick disjoint melds so the leftover (deadwood) is worth as little as
// possible. Depth-first over the candidates, memoised on the set of cards
// already used, which for a 10-card hand is trivially small.
export function bestDecomposition(hand, settings = {}) {
  const cands = candidateIndexMelds(hand, settings).map((idxs) => ({
    idxs,
    mask: maskOf(idxs),
    value: idxs.reduce((n, i) => n + cardValue(hand[i]), 0),
  }));
  const totalValue = handValue(hand);
  const memo = new Map();

  // Most value we can take off the table using candidates from `from` on,
  // given the cards already spoken for. Returns a number and nothing else:
  // building the meld list here allocates at every one of the (candidates x
  // subsets) states, which is what made this slow.
  function search(from, used) {
    if (from >= cands.length) return 0;
    const key = from * 2048 + used;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    let best = search(from + 1, used); // skip this candidate
    const c = cands[from];
    if (!(c.mask & used)) {
      const take = c.value + search(from + 1, used | c.mask);
      if (take > best) best = take;
    }
    memo.set(key, best);
    return best;
  }

  const removed = search(0, 0);

  // Walk the same decisions back down to recover which melds made that total.
  const picks = [];
  let used = 0;
  let target = removed;
  for (let from = 0; from < cands.length && target > 0; from++) {
    const c = cands[from];
    if (c.mask & used) continue;
    if (c.value + search(from + 1, used | c.mask) === target) {
      picks.push(c);
      used |= c.mask;
      target -= c.value;
    }
  }

  return {
    melds: picks.map((c) => c.idxs.map((i) => hand[i])),
    deadwood: totalValue - removed,
    deadwoodCards: hand.filter((_, i) => !(used & bit(i))),
  };
}

export const deadwoodOf = (hand, settings) => bestDecomposition(hand, settings).deadwood;

// ---- layoffs ----

const isRunMeld = (meld) => meld.length >= 3
  && new Set(meld.map((c) => c.rank)).size === meld.length;

// Can `card` be added to `meld` as it currently stands?
function extends_(meld, card, allowDuplicateSets) {
  if (isRunMeld(meld)) {
    if (meld[0].suit !== card.suit) return false;
    const rs = meld.map((c) => rankIndex(c.rank)).sort((a, b) => a - b);
    const r = rankIndex(card.rank);
    return r === rs[0] - 1 || r === rs[rs.length - 1] + 1;
  }
  if (meld[0].rank !== card.rank) return false;
  if (!allowDuplicateSets && meld.some((c) => c.suit === card.suit)) return false;
  return true;
}

// Lay off as much of `deadwoodCards` as possible onto the knocker's melds.
// Repeated passes rather than one: laying a card onto a run opens the next
// rank along, and a layoff never blocks another one, so a fixpoint is optimal.
export function maxLayoff(deadwoodCards, knockerMelds, { allowDuplicateSets = true } = {}) {
  const melds = knockerMelds.map((m) => [...m]);
  const remaining = [...deadwoodCards];
  const laidOff = [];
  let progress = true;
  while (progress) {
    progress = false;
    for (let i = 0; i < remaining.length; i++) {
      const card = remaining[i];
      const target = melds.find((m) => extends_(m, card, allowDuplicateSets));
      if (!target) continue;
      target.push(card);
      laidOff.push(card);
      remaining.splice(i, 1);
      progress = true;
      break;
    }
  }
  return { laidOff, remaining, deadwood: handValue(remaining) };
}
