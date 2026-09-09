// modes/mahjong/engine.js — pure rules engine for Hong Kong mahjong.
// Four players, common faan patterns, hand by hand with a running total.
// No DOM, no network.
import { defaults } from '../../settings.js';
import {
  KINDS, buildWall, sortTiles, countsOf, isBonus, tileName, glyph,
  tileOfWind, WIND_NAMES,
} from './tiles.js';
import { isWin, chowOptions } from './hand.js';
import { scoreHand, pointsFor } from './score.js';
import { shuffle } from '../../cards.js';

export const MODE_ID = 'mahjong';

export const SETTINGS = [
  {
    key: 'minFaan',
    type: 'int',
    default: 3,
    min: 0,
    max: 10,
    label: 'Minimum faan to win on',
    help: 'A hand worth less than this can’t be declared.',
  },
  { key: 'includeFlowers', type: 'bool', default: true, label: 'Play with flowers and seasons' },
  { key: 'allowSevenPairs', type: 'bool', default: true, label: 'Allow the seven-pairs hand' },
  {
    key: 'discarderPaysAll',
    type: 'bool',
    default: true,
    label: 'Discarder pays the whole hand',
    help: 'Off: the three losers split it. Either way the winner collects the same.',
  },
  {
    key: 'claimSeconds',
    type: 'int',
    default: 8,
    min: 3,
    max: 30,
    label: 'Seconds to claim a discard',
  },
  {
    key: 'scoring',
    type: 'enum',
    default: 'hk',
    label: 'Points per faan',
    options: [
      { value: 'hk', label: 'Hong Kong table (8, 16, 24…)' },
      { value: 'faan', label: 'Faan as points (3, 4, 5…)' },
    ],
  },
  { key: 'limitFaan', type: 'int', default: 13, min: 5, max: 13, label: 'Faan limit' },
];

export const SEATS = 4;

// A hand is 13 tiles, counting each exposed meld as three however big it is —
// a kong draws a replacement, so it never changes the count.
const conceal = (p) => 13 - 3 * p.melds.length;
const holding = (p) => p.hand.length > conceal(p);

export function createState(rng = Math.random) {
  return {
    phase: 'lobby', // 'lobby' | 'play' | 'claim' | 'roundEnd'
    roundNumber: 0,
    roomCode: '',
    hostSeat: null,
    turnIndex: 0,
    dealerIndex: null,
    dealerRepeats: false,
    prevailingWind: 0,
    wall: [],
    justDrew: null,        // the tile the player to act picked up, for the view
    lastDiscard: null,     // { tile, seat }
    claims: {},            // seatId -> {type, tiles} | 'pass'
    claimDeadline: null,
    roundScores: null,
    reveal: null,
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
    melds: [],     // { type: 'chow'|'pung'|'kong'|'ckong', tiles: [...], from: seatId|null }
    flowers: [],
    discards: [],
    wind: state.players.length % SEATS,
  });
}

function addLog(state, msg) {
  state.log.push(msg);
  if (state.log.length > 20) state.log.shift();
}

const OK = { ok: true };
const fail = (msg) => ({ ok: false, msg });

function noteMove(state, seatId, a, tile = null) {
  state.lastMove = { a, seat: seatId, tile, seq: ++state.moveSeq };
}

// Live wall for ordinary draws; the far end supplies replacements for kongs
// and flowers, the way the dead wall does at a real table.
const drawLive = (state) => state.wall.pop();
const drawReplacement = (state) => (state.wall.length ? state.wall.shift() : null);

// Take a tile, setting aside any bonus tiles and drawing again for each.
function drawInto(state, p, replacement = false) {
  let guard = 0;
  while (state.wall.length && guard++ < 30) {
    const t = replacement ? drawReplacement(state) : drawLive(state);
    if (t === null) return null;
    if (isBonus(t)) {
      p.flowers.push(t);
      addLog(state, `${p.name} drew ${tileName(t)} and takes a replacement`);
      replacement = true; // every further tile comes from the replacement end
      continue;
    }
    p.hand.push(t);
    p.hand = sortTiles(p.hand);
    return t;
  }
  return null;
}

export function startRound(state) {
  const n = state.players.length;
  if (state.dealerIndex === null) {
    state.dealerIndex = Math.floor(state.rng() * n);
  } else if (!state.dealerRepeats) {
    state.dealerIndex = (state.dealerIndex + 1) % n;
    // A full circuit of the deal moves the prevailing wind along.
    if (state.dealerIndex === 0) state.prevailingWind = (state.prevailingWind + 1) % SEATS;
  }
  state.dealerRepeats = false;

  const wall = shuffle(buildWall(state.settings.includeFlowers !== false), state.rng);
  state.wall = wall;
  state.players.forEach((p, i) => {
    p.hand = [];
    p.melds = [];
    p.flowers = [];
    p.discards = [];
    // East is the dealer; the winds run round from there.
    p.wind = (i - state.dealerIndex + SEATS) % SEATS;
  });
  for (const p of state.players) {
    for (let k = 0; k < 13; k++) drawInto(state, p);
  }
  state.justDrew = null;
  state.lastDiscard = null;
  state.claims = {};
  state.claimDeadline = null;
  state.roundScores = null;
  state.reveal = null;
  state.roundNumber++;
  state.lastMove = null;
  state.turnIndex = state.dealerIndex;
  state.phase = 'play';
  state.log = [];
  addLog(state, `Hand ${state.roundNumber} — ${state.players[state.dealerIndex].name} deals, ${WIND_NAMES[state.prevailingWind]} wind`);
}

// ===== what a player may claim from the current discard =====

export function claimOptions(state, seatId) {
  const none = { pung: false, kong: false, chows: [], mahjong: false };
  if (state.phase !== 'claim' || !state.lastDiscard) return none;
  const pi = state.players.findIndex((p) => p.seatId === seatId);
  if (pi === -1) return none;
  const p = state.players[pi];
  if (p.seatId === state.lastDiscard.seat) return none;
  if (state.claims[seatId]) return none; // already answered

  const tile = state.lastDiscard.tile;
  const counts = countsOf(p.hand);
  const discarderIndex = state.players.findIndex((q) => q.seatId === state.lastDiscard.seat);
  // Only the player about to take their turn may claim a chow.
  const isNext = (discarderIndex + 1) % state.players.length === pi;

  const full = [...p.hand, tile];
  const scored = isWin(full, p.melds.length, state.settings)
    ? scoreHand({
      concealed: full,
      melds: p.melds,
      seatWind: p.wind,
      prevailingWind: state.prevailingWind,
      selfDraw: false,
      flowers: p.flowers,
      settings: state.settings,
    })
    : null;

  return {
    pung: counts[tile] >= 2,
    kong: counts[tile] >= 3,
    chows: isNext ? chowOptions(p.hand, tile) : [],
    mahjong: !!scored && scored.faan >= (state.settings.minFaan ?? 0),
    faan: scored ? scored.faan : 0,
  };
}

const hasAnyClaim = (state, seatId) => {
  const o = claimOptions(state, seatId);
  return o.pung || o.kong || o.chows.length > 0 || o.mahjong;
};

// Everyone who could still answer the open claim window.
function pendingClaimants(state) {
  return state.players.filter((p) => p.seatId !== state.lastDiscard.seat && !state.claims[p.seatId]);
}

// Open the window after a discard. Anyone who can't claim anything — or who
// isn't connected — is passed for them, so a table never waits on a player
// with no decision to make. If that's everybody, play simply carries on.
function openClaims(state, now) {
  state.claims = {};
  // The phase has to flip first: claimOptions only answers during an open
  // window, so asking who's eligible before this line always says nobody.
  state.phase = 'claim';
  state.claimDeadline = (now ?? 0) + (state.settings.claimSeconds ?? 8) * 1000;
  const discarder = state.lastDiscard.seat;
  for (const p of state.players) {
    if (p.seatId === discarder) continue;
    if (!p.connected || !hasAnyClaim(state, p.seatId)) state.claims[p.seatId] = 'pass';
  }
  if (pendingClaimants(state).length === 0) passTurn(state);
}

// Nobody wanted it: the next player picks up.
function passTurn(state) {
  const discarderIndex = state.players.findIndex((p) => p.seatId === state.lastDiscard.seat);
  state.turnIndex = (discarderIndex + 1) % state.players.length;
  state.claims = {};
  state.claimDeadline = null;
  state.justDrew = null;
  state.phase = 'play';
}

const PRIORITY = { mahjong: 4, kong: 3, pung: 2, chow: 1 };

// Highest priority wins; between equals, whoever sits nearest the discarder
// going round the table.
function pickClaim(state) {
  const discarderIndex = state.players.findIndex((p) => p.seatId === state.lastDiscard.seat);
  let best = null;
  state.players.forEach((p, i) => {
    const c = state.claims[p.seatId];
    if (!c || c === 'pass') return;
    const dist = (i - discarderIndex + state.players.length) % state.players.length;
    const rank = PRIORITY[c.type] ?? 0;
    if (!best || rank > best.rank || (rank === best.rank && dist < best.dist)) {
      best = { seatId: p.seatId, index: i, claim: c, rank, dist };
    }
  });
  return best;
}

function resolveClaims(state) {
  const winner = pickClaim(state);
  if (!winner) { passTurn(state); return; }
  const p = state.players[winner.index];
  const tile = state.lastDiscard.tile;
  const fromSeat = state.lastDiscard.seat;

  // However it's claimed, the tile leaves the discarder's pond — a won tile
  // that stayed there would exist twice over.
  const discarder = state.players.find((q) => q.seatId === fromSeat);
  const di = discarder.discards.lastIndexOf(tile);
  if (di >= 0) discarder.discards.splice(di, 1);

  if (winner.claim.type === 'mahjong') {
    p.hand = sortTiles([...p.hand, tile]);
    state.claims = {};
    state.claimDeadline = null;
    endHand(state, { winnerIndex: winner.index, selfDraw: false, fromSeat });
    return;
  }

  const used = winner.claim.type === 'chow' ? winner.claim.tiles : null;
  const take = winner.claim.type === 'kong' ? 3 : 2;
  if (used) {
    for (const t of used) p.hand.splice(p.hand.indexOf(t), 1);
    p.melds.push({ type: 'chow', tiles: sortTiles([...used, tile]), from: fromSeat });
  } else {
    for (let k = 0; k < take; k++) p.hand.splice(p.hand.indexOf(tile), 1);
    const tiles = new Array(take + 1).fill(tile);
    p.melds.push({ type: winner.claim.type, tiles, from: fromSeat });
  }
  addLog(state, `${p.name} claimed ${tileName(tile)} for a ${winner.claim.type}`);
  noteMove(state, p.seatId, 'claim', tile);

  state.claims = {};
  state.claimDeadline = null;
  state.turnIndex = winner.index;
  state.phase = 'play';
  // A kong is one set short of a hand, so it draws a replacement; then the
  // claimer discards either way.
  if (winner.claim.type === 'kong') drawInto(state, p, true);
  state.justDrew = null;
  if (!state.wall.length && !holding(p)) endWallExhausted(state);
}

// ===== actions =====

export function applyAction(state, seatId, act) {
  const pi = state.players.findIndex((p) => p.seatId === seatId);
  if (pi === -1) return fail('Unknown player');
  const p = state.players[pi];

  // Claim-window actions come from players other than the one to move, so
  // they're handled before the whose-turn check.
  if (state.phase === 'claim') {
    switch (act.a) {
      case 'claim': {
        if (seatId === state.lastDiscard.seat) return fail('You discarded that tile');
        if (state.claims[seatId]) return fail('You already answered');
        const o = claimOptions(state, seatId);
        const t = act.type;
        if (t === 'pung' && !o.pung) return fail('You cannot pung that');
        if (t === 'kong' && !o.kong) return fail('You cannot kong that');
        if (t === 'mahjong' && !o.mahjong) {
          return o.faan
            ? fail(`That hand is only ${o.faan} faan — you need ${state.settings.minFaan}`)
            : fail('That tile does not complete your hand');
        }
        if (t === 'chow') {
          const want = JSON.stringify(sortTiles(act.tiles || []));
          if (!o.chows.some((c) => JSON.stringify(sortTiles(c)) === want)) {
            return fail('You cannot chow that');
          }
        }
        if (!PRIORITY[t]) return fail('Unknown claim');
        state.claims[seatId] = { type: t, tiles: act.tiles || null };
        // Everyone has answered, so there's no reason to wait for the clock.
        if (pendingClaimants(state).length === 0) resolveClaims(state);
        return OK;
      }
      case 'pass': {
        if (seatId === state.lastDiscard.seat) return fail('You discarded that tile');
        if (state.claims[seatId]) return fail('You already answered');
        state.claims[seatId] = 'pass';
        if (pendingClaimants(state).length === 0) resolveClaims(state);
        return OK;
      }
      case 'expireClaims': {
        // The host fires this when the window's clock runs out. Anyone who
        // never answered is treated as passing.
        if (seatId !== state.hostSeat) return fail('Only the host can do that');
        if (state.claimDeadline !== null && (act.now ?? 0) < state.claimDeadline) {
          return fail('The claim window is still open');
        }
        for (const q of pendingClaimants(state)) state.claims[q.seatId] = 'pass';
        resolveClaims(state);
        return OK;
      }
      default:
        return fail('Wait for the claim window to close');
    }
  }

  if (state.phase !== 'play') return fail('Not in play');
  if (pi !== state.turnIndex) return fail('Not your turn');

  switch (act.a) {
    case 'draw': {
      if (holding(p)) return fail('You already drew — discard a tile');
      if (!state.wall.length) { endWallExhausted(state); return OK; }
      const t = drawInto(state, p);
      if (t === null) { endWallExhausted(state); return OK; }
      state.justDrew = t;
      noteMove(state, seatId, 'draw', t);
      return OK;
    }
    case 'discard': {
      if (!holding(p)) return fail('Draw a tile first');
      const i = p.hand.indexOf(act.tile);
      if (i === -1) return fail('You do not hold that tile');
      p.hand.splice(i, 1);
      p.discards.push(act.tile);
      state.lastDiscard = { tile: act.tile, seat: seatId };
      state.justDrew = null;
      addLog(state, `${p.name} discarded ${tileName(act.tile)}`);
      noteMove(state, seatId, 'discard', act.tile);
      openClaims(state, act.now);
      // Passing straight on can empty the wall for the next player.
      if (state.phase === 'play' && !state.wall.length) endWallExhausted(state);
      return OK;
    }
    case 'mahjong': {
      if (!holding(p)) return fail('Draw a tile first');
      const scored = isWin(p.hand, p.melds.length, state.settings)
        ? scoreHand({
          concealed: p.hand,
          melds: p.melds,
          seatWind: p.wind,
          prevailingWind: state.prevailingWind,
          selfDraw: true,
          flowers: p.flowers,
          settings: state.settings,
        })
        : null;
      if (!scored) return fail('That is not a winning hand');
      if (scored.faan < (state.settings.minFaan ?? 0)) {
        return fail(`That hand is only ${scored.faan} faan — you need ${state.settings.minFaan}`);
      }
      endHand(state, { winnerIndex: pi, selfDraw: true, fromSeat: null });
      return OK;
    }
    case 'kongConcealed': {
      if (!holding(p)) return fail('Draw a tile first');
      const counts = countsOf(p.hand);
      if (counts[act.tile] !== 4) return fail('You need all four to kong');
      p.hand = p.hand.filter((t) => t !== act.tile);
      p.melds.push({ type: 'ckong', tiles: [act.tile, act.tile, act.tile, act.tile], from: null });
      addLog(state, `${p.name} declared a concealed kong of ${tileName(act.tile)}`);
      noteMove(state, seatId, 'kongConcealed', act.tile);
      if (drawInto(state, p, true) === null) endWallExhausted(state);
      return OK;
    }
    case 'kongPromote': {
      if (!holding(p)) return fail('Draw a tile first');
      const meld = p.melds.find((m) => m.type === 'pung' && m.tiles[0] === act.tile);
      if (!meld) return fail('You have no pung of that tile');
      const i = p.hand.indexOf(act.tile);
      if (i === -1) return fail('You do not hold the fourth tile');
      p.hand.splice(i, 1);
      meld.type = 'kong';
      meld.tiles = [act.tile, act.tile, act.tile, act.tile];
      addLog(state, `${p.name} added ${tileName(act.tile)} to their pung for a kong`);
      noteMove(state, seatId, 'kongPromote', act.tile);
      if (drawInto(state, p, true) === null) endWallExhausted(state);
      return OK;
    }
    default:
      return fail('Unknown action');
  }
}

// ===== end of hand =====

const copyMelds = (melds) => melds.map((m) => ({ ...m, tiles: [...m.tiles] }));

function revealRows(state, extra = {}) {
  return state.players.map((p) => ({
    seatId: p.seatId,
    name: p.name,
    wind: p.wind,
    hand: sortTiles(p.hand),
    melds: copyMelds(p.melds),
    flowers: [...p.flowers],
    score: 0,
    ...(extra[p.seatId] || {}),
  }));
}

function settle(state, rows) {
  state.roundScores = state.players.map((p) => ({
    seatId: p.seatId,
    name: p.name,
    score: rows.find((r) => r.seatId === p.seatId).score,
  }));
  for (const rs of state.roundScores) {
    state.players.find((q) => q.seatId === rs.seatId).total += rs.score;
  }
  state.phase = 'roundEnd';
  state.claims = {};
  state.claimDeadline = null;
  state.justDrew = null;
}

// Self-draw: all three losers pay the hand's value each. Won on a discard:
// the same total, but the discarder either carries it alone or the three
// split it, depending on the house rule.
function endHand(state, { winnerIndex, selfDraw, fromSeat }) {
  const w = state.players[winnerIndex];
  const scored = scoreHand({
    concealed: w.hand,
    melds: w.melds,
    seatWind: w.wind,
    prevailingWind: state.prevailingWind,
    selfDraw,
    flowers: w.flowers,
    settings: state.settings,
  });
  const unit = scored.points;
  const losers = state.players.filter((p) => p.seatId !== w.seatId);
  const payments = {};
  if (selfDraw || !state.settings.discarderPaysAll) {
    for (const l of losers) payments[l.seatId] = -unit;
  } else {
    for (const l of losers) payments[l.seatId] = 0;
    payments[fromSeat] = -unit * losers.length;
  }
  const total = -Object.values(payments).reduce((n, v) => n + v, 0);

  const extra = { [w.seatId]: { score: total, winner: true } };
  for (const l of losers) extra[l.seatId] = { score: payments[l.seatId] };
  const rows = revealRows(state, extra);

  state.reveal = {
    winner: w.seatId,
    selfDraw,
    from: fromSeat,
    faan: scored.faan,
    points: unit,
    patterns: scored.patterns,
    drawn: false,
    rows,
  };
  state.dealerRepeats = winnerIndex === state.dealerIndex;
  addLog(state, selfDraw
    ? `${w.name} self-drew for ${scored.faan} faan`
    : `${w.name} won on ${tileName(state.lastDiscard.tile)} for ${scored.faan} faan`);
  settle(state, rows);
}

// The wall ran out with nobody out: a washed-out hand, and the dealer keeps
// the deal.
function endWallExhausted(state) {
  const rows = revealRows(state);
  state.reveal = {
    winner: null, selfDraw: false, from: null,
    faan: 0, points: 0, patterns: [], drawn: true, rows,
  };
  state.dealerRepeats = true;
  addLog(state, 'The wall ran out — washed-out hand, nobody scores');
  settle(state, rows);
}

// An open claim window has a clock on it. The engine can't read the clock, so
// it just says when it wants waking; main.js schedules the callback at the
// host. Any mode with a deadline can do the same.
export function pendingTimer(state) {
  if (state.phase === 'claim' && state.claimDeadline !== null) {
    return { at: state.claimDeadline, act: { a: 'expireClaims' } };
  }
  return null;
}

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
  state.dealerRepeats = false;
  state.prevailingWind = 0;
  state.wall = [];
  state.justDrew = null;
  state.lastDiscard = null;
  state.claims = {};
  state.claimDeadline = null;
  state.roundScores = null;
  state.reveal = null;
  state.log = [];
  state.lastMove = null;
  for (const p of state.players) {
    p.total = 0;
    p.hand = []; p.melds = []; p.flowers = []; p.discards = [];
  }
}

// The view sent over the wire. A player sees their own tiles, everyone's
// exposed melds, flowers and ponds — all public at a real table — and nothing
// of anyone's concealed hand until `reveal` opens them at the end.
export function redact(state, viewerSeatId) {
  const me = state.players.find((p) => p.seatId === viewerSeatId) || null;
  const opts = state.phase === 'claim' && me ? claimOptions(state, viewerSeatId) : null;
  return {
    mode: MODE_ID,
    phase: state.phase,
    roundNumber: state.roundNumber,
    roomCode: state.roomCode,
    hostSeat: state.hostSeat,
    turnIndex: state.turnIndex,
    dealerIndex: state.dealerIndex,
    prevailingWind: state.prevailingWind,
    roundScores: state.roundScores,
    reveal: state.phase === 'roundEnd' ? state.reveal : null,
    settings: state.settings,
    ...(state.phase === 'lobby' ? { settingsSchema: SETTINGS } : {}),
    log: state.log.slice(-6),
    lastMove: state.lastMove,
    wallCount: state.wall.length,
    lastDiscard: state.lastDiscard,
    claimDeadline: state.claimDeadline,
    // Who has answered the window, but never WHAT they claimed — a pending
    // pung would tell the table what someone is holding.
    claimAnswered: Object.keys(state.claims),
    myClaimOptions: opts,
    myClaim: me ? (state.claims[viewerSeatId] || null) : null,
    myHand: me ? sortTiles(me.hand) : [],
    myJustDrew: me && state.players[state.turnIndex]?.seatId === viewerSeatId
      ? state.justDrew : null,
    // Gates the "Mahjong" button, so it only appears when the claim is legal.
    myCanWin: !!(me && holding(me) && isWin(me.hand, me.melds.length, state.settings)),
    players: state.players.map((p) => ({
      seatId: p.seatId,
      name: p.name,
      connected: p.connected,
      total: p.total,
      wind: p.wind,
      handCount: p.hand.length,
      // Copies, not the live arrays: a view is a snapshot, and ui.js keeps the
      // previous one to diff against.
      melds: copyMelds(p.melds),
      flowers: [...p.flowers],
      discards: [...p.discards],
      holding: holding(p),
    })),
  };
}

export { claimOptions as optionsFor, pointsFor, glyph, tileName, KINDS };
