// cards.js — the standard 52-card deck, shared by every card game mode.
// No DOM, no network, no rules: anything here is true of playing cards in
// general, never of one particular game.

export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const SUITS = ['s', 'h', 'd', 'c'];
export const SUIT_GLYPHS = { s: '♠', h: '♥', d: '♦', c: '♣' };

export function makeDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) deck.push({ rank, suit });
  }
  return deck;
}

// Fisher-Yates, in place. rng injectable for deterministic tests.
export function shuffle(arr, rng = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function cardName(card) {
  return card.rank + SUIT_GLYPHS[card.suit];
}
