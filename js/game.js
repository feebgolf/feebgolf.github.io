// game.js — pure rules engine for 6-card Golf.
// No DOM, no network. Every function operates on a plain state object.

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

// A=1, 2=-2, J/Q=10, K=0, everything else face value.
export function cardScore(card) {
  switch (card.rank) {
    case 'A': return 1;
    case '2': return -2;
    case 'J':
    case 'Q': return 10;
    case 'K': return 0;
    default: return parseInt(card.rank, 10);
  }
}

// Hand layout: hand[0..5], columns are the pairs (0,3), (1,4), (2,5).
// A column whose two cards share a rank scores 0 — including a pair of 2s.
export function handScore(hand) {
  let total = 0;
  for (let c = 0; c < 3; c++) {
    const a = hand[c], b = hand[c + 3];
    if (a.rank === b.rank) continue;
    total += cardScore(a) + cardScore(b);
  }
  return total;
}

// Live score from what's showing: face-down cards count 0, and a column
// only cancels when BOTH cards are face up with matching ranks.
export function visibleScore(hand) {
  let total = 0;
  for (let c = 0; c < 3; c++) {
    const a = hand[c], b = hand[c + 3];
    if (a.faceUp && b.faceUp && a.rank === b.rank) continue;
    if (a.faceUp) total += cardScore(a);
    if (b.faceUp) total += cardScore(b);
  }
  return total;
}

// Which columns cancel (for UI highlighting at round end).
export function cancelledColumns(hand) {
  const cols = [];
  for (let c = 0; c < 3; c++) {
    if (hand[c].rank === hand[c + 3].rank) cols.push(c);
  }
  return cols;
}

export function cardName(card) {
  return card.rank + SUIT_GLYPHS[card.suit];
}

export function createState(rng = Math.random) {
  return {
    phase: 'lobby', // 'lobby' | 'setup' | 'play' | 'roundEnd'
    roundNumber: 0,
    roomCode: '',
    hostSeat: null,
    turnIndex: 0,
    finisherIndex: null, // index of the first player to reveal all 6 cards
    drawn: null,         // card currently held by the player at turnIndex
    deck: [],            // last element = top
    discard: [],         // last element = top
    roundScores: null,
    log: [],
    lastMove: null,      // { a, seat, i, seq } — lets the UI animate the move
    moveSeq: 0,
    players: [],         // { seatId, peerId, name, connected, total, setupFlips, hand }
    rng,                 // host-only; never serialized (redact() omits it)
  };
}

export function addPlayer(state, seatId, peerId, name) {
  state.players.push({
    seatId, peerId, name,
    connected: true,
    total: 0,
    setupFlips: 0,
    hand: [],
  });
}

function addLog(state, msg) {
  state.log.push(msg);
  if (state.log.length > 20) state.log.shift();
}

// Deal a fresh round: new shuffled deck, 6 face-down cards each, one discard.
export function startRound(state) {
  // The loser of the previous round goes first (random among tied losers);
  // the first round of a match starts with a random player.
  let firstIndex = null;
  if (state.roundScores) {
    let worst = -Infinity;
    const losers = [];
    for (const rs of state.roundScores) {
      const idx = state.players.findIndex((p) => p.seatId === rs.seatId);
      if (idx === -1) continue; // player left between rounds
      if (rs.score > worst) { worst = rs.score; losers.length = 0; }
      if (rs.score === worst) losers.push(idx);
    }
    if (losers.length) firstIndex = losers[Math.floor(state.rng() * losers.length)];
  }
  const deck = shuffle(makeDeck(), state.rng);
  for (const p of state.players) {
    p.hand = deck.splice(0, 6).map((c) => ({ rank: c.rank, suit: c.suit, faceUp: false }));
    p.setupFlips = 0;
  }
  state.discard = [deck.pop()];
  state.deck = deck;
  state.drawn = null;
  state.finisherIndex = null;
  state.roundScores = null;
  state.roundNumber++;
  state.lastMove = null;
  state.turnIndex = firstIndex !== null ? firstIndex : Math.floor(state.rng() * state.players.length);
  state.phase = 'setup';
  state.log = [];
  addLog(state, firstIndex !== null
    ? `Round ${state.roundNumber} — ${state.players[state.turnIndex].name} lost last round and goes first`
    : `Round ${state.roundNumber} — everyone flips 2 cards`);
}

// Deck empty? Shuffle the discard (minus its top card) back in.
function reshuffle(state) {
  if (state.discard.length <= 1) return false;
  const top = state.discard.pop();
  state.deck = shuffle(state.discard, state.rng);
  state.discard = [top];
  addLog(state, 'Deck reshuffled');
  return true;
}

const OK = { ok: true };
const fail = (msg) => ({ ok: false, msg });

function noteMove(state, seatId, act) {
  state.lastMove = { a: act.a, seat: seatId, i: act.i ?? null, seq: ++state.moveSeq };
}

// The five game actions. Every rejection returns {ok:false, msg} and mutates nothing.
export function applyAction(state, seatId, act) {
  const pi = state.players.findIndex((p) => p.seatId === seatId);
  if (pi === -1) return fail('Unknown player');
  const p = state.players[pi];

  if (act.a === 'flipSetup') {
    if (state.phase !== 'setup') return fail('Not in the setup phase');
    if (p.setupFlips >= 2) return fail('You already flipped 2 cards');
    const c = p.hand[act.i];
    if (!c) return fail('Bad card index');
    if (c.faceUp) return fail('That card is already face up');
    c.faceUp = true;
    p.setupFlips++;
    noteMove(state, seatId, act);
    if (state.players.every((q) => q.setupFlips >= 2)) {
      state.phase = 'play';
      addLog(state, `${state.players[state.turnIndex].name} goes first`);
    }
    return OK;
  }

  if (state.phase !== 'play') return fail('Not in play');
  if (pi !== state.turnIndex) return fail('Not your turn');

  switch (act.a) {
    case 'takeDiscard': {
      // Take the discard top and swap it into your grid. No take-then-discard:
      // the swap index is required, so that move is structurally impossible.
      if (state.drawn !== null) return fail('You already drew a card');
      if (state.discard.length === 0) return fail('The discard pile is empty');
      const c = p.hand[act.i];
      if (!c) return fail('Bad card index');
      const taken = state.discard.pop();
      state.discard.push({ rank: c.rank, suit: c.suit });
      p.hand[act.i] = { rank: taken.rank, suit: taken.suit, faceUp: true };
      addLog(state, `${p.name} took ${cardName(taken)}, discarding ${cardName(c)}`);
      noteMove(state, seatId, act);
      finishTurn(state, p);
      return OK;
    }
    case 'drawDeck': {
      if (state.drawn !== null) return fail('You already drew a card');
      if (state.deck.length === 0 && !reshuffle(state)) return fail('No cards left to draw');
      state.drawn = state.deck.pop();
      addLog(state, `${p.name} drew from the deck`);
      noteMove(state, seatId, act);
      return OK;
    }
    case 'swapDrawn': {
      if (state.drawn === null) return fail('You have no drawn card');
      const c = p.hand[act.i];
      if (!c) return fail('Bad card index');
      state.discard.push({ rank: c.rank, suit: c.suit });
      p.hand[act.i] = { rank: state.drawn.rank, suit: state.drawn.suit, faceUp: true };
      addLog(state, `${p.name} kept ${cardName(state.drawn)}, discarding ${cardName(c)}`);
      state.drawn = null;
      noteMove(state, seatId, act);
      finishTurn(state, p);
      return OK;
    }
    case 'discardDrawn': {
      // Discard the drawn card AND flip one of your face-down cards.
      if (state.drawn === null) return fail('You have no drawn card');
      const c = p.hand[act.i];
      if (!c) return fail('Bad card index');
      if (c.faceUp) return fail('Choose a face-down card to flip');
      state.discard.push(state.drawn);
      addLog(state, `${p.name} discarded ${cardName(state.drawn)} and flipped ${cardName(c)}`);
      state.drawn = null;
      c.faceUp = true;
      noteMove(state, seatId, act);
      finishTurn(state, p);
      return OK;
    }
    default:
      return fail('Unknown action');
  }
}

// After each completed turn: record the first finisher, advance, and end the
// round when the turn wraps back to the finisher — that gives every other
// player exactly one extra turn (works for 2, 3 and 4 players).
function finishTurn(state, p) {
  if (state.finisherIndex === null && p.hand.every((c) => c.faceUp)) {
    state.finisherIndex = state.turnIndex;
    addLog(state, `${p.name} flipped their last card — final turns!`);
  }
  state.turnIndex = (state.turnIndex + 1) % state.players.length;
  if (state.finisherIndex !== null && state.turnIndex === state.finisherIndex) {
    endRound(state);
  }
}

function endRound(state) {
  for (const p of state.players) {
    for (const c of p.hand) c.faceUp = true;
  }
  state.roundScores = state.players.map((p) => ({
    seatId: p.seatId,
    name: p.name,
    score: handScore(p.hand),
  }));
  for (const rs of state.roundScores) {
    state.players.find((q) => q.seatId === rs.seatId).total += rs.score;
  }
  state.drawn = null;
  state.phase = 'roundEnd';
  const best = Math.min(...state.roundScores.map((r) => r.score));
  const winners = state.roundScores.filter((r) => r.score === best).map((r) => r.name);
  addLog(state, winners.length > 1
    ? `Round tied: ${winners.join(' & ')} (${best})`
    : `${winners[0]} wins the round (${best})`);
}

// Running totals, lowest first. Ties share a rank.
export function finalScores(state) {
  return state.players
    .map((p) => ({ seatId: p.seatId, name: p.name, total: p.total }))
    .sort((a, b) => a.total - b.total);
}

// The view sent over the wire (and rendered by the host itself).
// Face-down cards are hidden from EVERYONE, including their owner, so the
// view is identical for all players except the drawn card, which only the
// drawer may see. Guests never receive information they shouldn't have.
export function redact(state, viewerSeatId) {
  const cur = state.players[state.turnIndex] || null;
  return {
    phase: state.phase,
    roundNumber: state.roundNumber,
    roomCode: state.roomCode,
    hostSeat: state.hostSeat,
    turnIndex: state.turnIndex,
    finisherIndex: state.finisherIndex,
    roundScores: state.roundScores,
    log: state.log.slice(-6),
    deckCount: state.deck.length,
    discardTop: state.discard.length ? state.discard[state.discard.length - 1] : null,
    lastMove: state.lastMove,
    drawnBy: state.drawn && cur ? cur.seatId : null,
    drawnCard: state.drawn && cur && cur.seatId === viewerSeatId ? state.drawn : null,
    players: state.players.map((p) => ({
      seatId: p.seatId,
      name: p.name,
      connected: p.connected,
      total: p.total,
      visibleScore: p.hand.length ? visibleScore(p.hand) : 0,
      setupFlips: p.setupFlips,
      hand: p.hand.map((c) => (c.faceUp
        ? { rank: c.rank, suit: c.suit, faceUp: true }
        : { faceUp: false })),
    })),
  };
}
