// modes/gin/engine.js — pure rules engine for the house version of gin rummy:
// 2–8 players, deck count scaling with the table, and a single knocker scored
// against every opponent at once. No DOM, no network.
import { makeDeck, shuffle, cardName } from '../../cards.js';
import { defaults } from '../../settings.js';
import { bestDecomposition, maxLayoff, handValue, cardValue } from './melds.js';

export const MODE_ID = 'gin';

export const HAND_SIZE = 10;

export const SETTINGS = [
  {
    key: 'allowDuplicateSets',
    type: 'bool',
    default: true,
    label: 'Identical cards can form a set',
    help: 'With more than one deck in play, 7♥ 7♥ 7♠ counts as a set.',
  },
  {
    key: 'knockMax',
    type: 'int',
    default: 10,
    min: 0,
    max: 20,
    label: 'Most deadwood you can knock on',
    help: 'Zero deadwood is gin, whatever this is set to.',
  },
  {
    key: 'layoffs',
    type: 'bool',
    default: true,
    label: 'Opponents may lay off on the knocker',
    help: 'Never allowed against gin.',
  },
  {
    key: 'ginBonus',
    type: 'int',
    default: 25,
    min: 0,
    max: 100,
    label: 'Gin bonus (per opponent)',
  },
  {
    key: 'undercutBonus',
    type: 'int',
    default: 25,
    min: 0,
    max: 100,
    label: 'Undercut bonus',
  },
];

// Enough decks that the stock is still worth drawing from: 2–3 players get the
// classic single 52-card deck, 4–7 get two, 8 get three.
export function deckCount(numPlayers) {
  return Math.max(1, Math.ceil((HAND_SIZE * numPlayers + 32) / 52));
}

// Cards stop being unique once there's more than one deck, so every card
// carries an id — the view and the flight animations need a stable handle.
export function buildDeck(numPlayers) {
  const out = [];
  let id = 0;
  for (let d = 0; d < deckCount(numPlayers); d++) {
    for (const c of makeDeck()) out.push({ rank: c.rank, suit: c.suit, id: 'c' + id++ });
  }
  return out;
}

export function createState(rng = Math.random) {
  return {
    phase: 'lobby', // 'lobby' | 'play' | 'roundEnd'
    roundNumber: 0,
    roomCode: '',
    hostSeat: null,
    turnIndex: 0,
    dealerIndex: null,
    stock: [],       // last element = top
    discard: [],     // last element = top
    roundScores: null,
    reveal: null,    // end-of-hand breakdown, public once the hand is over
    settings: defaults(SETTINGS),
    log: [],
    lastMove: null,
    moveSeq: 0,
    players: [],
    rng,
  };
}

export function addPlayer(state, seatId, peerId, name) {
  state.players.push({
    seatId, peerId, name,
    connected: true,
    total: 0,
    hand: [],
    tookId: null,   // card just taken from the discard: can't be thrown straight back
    knocked: false,
  });
}

function addLog(state, msg) {
  state.log.push(msg);
  if (state.log.length > 20) state.log.shift();
}

// Deal a fresh hand: 10 cards each, one card turned up, the rest is the stock.
// The deal passes to the left each hand, and the player after the dealer leads.
export function startRound(state) {
  const n = state.players.length;
  state.dealerIndex = state.dealerIndex === null
    ? Math.floor(state.rng() * n)
    : (state.dealerIndex + 1) % n;
  const deck = shuffle(buildDeck(n), state.rng);
  for (const p of state.players) {
    p.hand = deck.splice(0, HAND_SIZE);
    p.tookId = null;
    p.knocked = false;
  }
  state.discard = [deck.pop()];
  state.stock = deck;
  state.roundScores = null;
  state.reveal = null;
  state.roundNumber++;
  state.lastMove = null;
  state.turnIndex = (state.dealerIndex + 1) % n;
  state.phase = 'play';
  state.log = [];
  addLog(state, `Hand ${state.roundNumber} — ${state.players[state.turnIndex].name} leads`);
}

const OK = { ok: true };
const fail = (msg) => ({ ok: false, msg });

function noteMove(state, seatId, a, id = null) {
  state.lastMove = { a, seat: seatId, id, seq: ++state.moveSeq };
}

export function applyAction(state, seatId, act) {
  const pi = state.players.findIndex((p) => p.seatId === seatId);
  if (pi === -1) return fail('Unknown player');
  const p = state.players[pi];

  if (state.phase !== 'play') return fail('Not in play');
  if (pi !== state.turnIndex) return fail('Not your turn');

  const holding = p.hand.length > HAND_SIZE; // drew already, owes a discard

  switch (act.a) {
    case 'draw': {
      if (holding) return fail('You already drew — discard one');
      // Running the stock out with nobody knocking makes it a dead hand.
      if (state.stock.length === 0) { endDraw(state); return OK; }
      const c = state.stock.pop();
      p.hand.push(c);
      p.tookId = null;
      addLog(state, `${p.name} drew from the stock`);
      noteMove(state, seatId, 'draw', c.id);
      return OK;
    }
    case 'take': {
      if (holding) return fail('You already drew — discard one');
      if (state.discard.length === 0) return fail('The discard pile is empty');
      const c = state.discard.pop();
      p.hand.push(c);
      p.tookId = c.id;
      addLog(state, `${p.name} took ${cardName(c)} from the discard`);
      noteMove(state, seatId, 'take', c.id);
      return OK;
    }
    case 'discard':
    case 'knock': {
      if (!holding) return fail('Draw a card first');
      const idx = p.hand.findIndex((c) => c.id === act.id);
      if (idx === -1) return fail('You do not have that card');
      if (p.hand[idx].id === p.tookId) {
        return fail('You cannot discard the card you just took');
      }
      const card = p.hand[idx];
      const rest = p.hand.filter((_, i) => i !== idx);

      if (act.a === 'knock') {
        const dw = bestDecomposition(rest, state.settings).deadwood;
        if (dw > state.settings.knockMax) {
          return fail(`You need ${state.settings.knockMax} deadwood or less to knock — you have ${dw}`);
        }
      }

      p.hand = rest;
      p.tookId = null;
      state.discard.push(card);

      if (act.a === 'knock') {
        p.knocked = true;
        addLog(state, `${p.name} discarded ${cardName(card)} and knocked`);
        noteMove(state, seatId, 'knock', card.id);
        endKnock(state, pi);
        return OK;
      }
      addLog(state, `${p.name} discarded ${cardName(card)}`);
      noteMove(state, seatId, 'discard', card.id);
      state.turnIndex = (state.turnIndex + 1) % state.players.length;
      return OK;
    }
    default:
      return fail('Unknown action');
  }
}

// The stock ran dry with nobody knocking: nobody scores.
function endDraw(state) {
  state.roundScores = state.players.map((p) => ({
    seatId: p.seatId, name: p.name, score: 0,
  }));
  state.reveal = {
    knocker: null,
    gin: false,
    rows: state.players.map((p) => {
      const b = bestDecomposition(p.hand, state.settings);
      return {
        seatId: p.seatId, name: p.name,
        melds: b.melds, deadwoodCards: b.deadwoodCards, deadwood: b.deadwood,
        laidOff: [], score: 0,
      };
    }),
  };
  state.phase = 'roundEnd';
  addLog(state, 'The stock ran out — dead hand, nobody scores');
}

// One knocker against everyone: each opponent lays off what they can (never
// against gin), then pays the difference — or collects it, with a bonus, if
// they matched or beat the knocker.
function endKnock(state, knockerIndex) {
  const k = state.players[knockerIndex];
  const kb = bestDecomposition(k.hand, state.settings);
  const gin = kb.deadwood === 0;
  const canLayOff = state.settings.layoffs && !gin;

  const rows = [];
  let knockerScore = 0;

  for (const p of state.players) {
    if (p.seatId === k.seatId) continue;
    const ob = bestDecomposition(p.hand, state.settings);
    const lay = canLayOff
      ? maxLayoff(ob.deadwoodCards, kb.melds, state.settings)
      : { laidOff: [], remaining: ob.deadwoodCards, deadwood: ob.deadwood };
    const diff = lay.deadwood - kb.deadwood;
    let score = 0;
    if (diff > 0) {
      knockerScore += diff + (gin ? state.settings.ginBonus : 0);
    } else {
      // Undercut: matching the knocker is good enough to turn it around.
      score = -diff + state.settings.undercutBonus;
    }
    rows.push({
      seatId: p.seatId, name: p.name,
      melds: ob.melds, deadwoodCards: lay.remaining, deadwood: lay.deadwood,
      laidOff: lay.laidOff, score,
    });
  }

  rows.unshift({
    seatId: k.seatId, name: k.name,
    melds: kb.melds, deadwoodCards: kb.deadwoodCards, deadwood: kb.deadwood,
    laidOff: [], score: knockerScore,
  });

  state.roundScores = state.players.map((p) => ({
    seatId: p.seatId,
    name: p.name,
    score: rows.find((r) => r.seatId === p.seatId).score,
  }));
  for (const rs of state.roundScores) {
    state.players.find((q) => q.seatId === rs.seatId).total += rs.score;
  }
  state.reveal = { knocker: k.seatId, gin, rows };
  state.phase = 'roundEnd';
  addLog(state, gin
    ? `${k.name} went gin for ${knockerScore}`
    : `${k.name} knocked with ${kb.deadwood} for ${knockerScore}`);
}

// Running totals, highest first: in gin the points are what you win.
export function finalScores(state) {
  return state.players
    .map((p) => ({ seatId: p.seatId, name: p.name, total: p.total }))
    .sort((a, b) => b.total - a.total);
}

export function resetToLobby(state) {
  state.phase = 'lobby';
  state.roundNumber = 0;
  state.turnIndex = 0;
  state.dealerIndex = null;
  state.stock = [];
  state.discard = [];
  state.roundScores = null;
  state.reveal = null;
  state.log = [];
  state.lastMove = null;
  for (const p of state.players) {
    p.total = 0;
    p.hand = [];
    p.tookId = null;
    p.knocked = false;
  }
}

// The view sent over the wire. A gin player sees their OWN hand — that's the
// game — and nothing of anyone else's until the hand is over, when `reveal`
// makes every hand public along with the scoring that came out of it.
export function redact(state, viewerSeatId) {
  const me = state.players.find((p) => p.seatId === viewerSeatId) || null;
  const cur = state.players[state.turnIndex] || null;
  return {
    mode: MODE_ID,
    phase: state.phase,
    roundNumber: state.roundNumber,
    roomCode: state.roomCode,
    hostSeat: state.hostSeat,
    turnIndex: state.turnIndex,
    dealerIndex: state.dealerIndex,
    roundScores: state.roundScores,
    reveal: state.phase === 'roundEnd' ? state.reveal : null,
    settings: state.settings,
    ...(state.phase === 'lobby' ? { settingsSchema: SETTINGS } : {}),
    log: state.log.slice(-6),
    lastMove: state.lastMove,
    stockCount: state.stock.length,
    discardTop: state.discard.length ? state.discard[state.discard.length - 1] : null,
    discardCount: state.discard.length,
    // Whether the player to act still owes a discard, so everyone can see the
    // turn is mid-flight without seeing what was drawn.
    holding: !!(cur && cur.hand.length > HAND_SIZE),
    myHand: me ? me.hand : [],
    myTookId: me ? me.tookId : null,
    players: state.players.map((p) => ({
      seatId: p.seatId,
      name: p.name,
      connected: p.connected,
      total: p.total,
      handCount: p.hand.length,
      knocked: p.knocked,
    })),
  };
}

export { bestDecomposition, maxLayoff, handValue, cardValue };
