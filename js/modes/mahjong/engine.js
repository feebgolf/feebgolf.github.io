// modes/mahjong/engine.js — NOT YET IMPLEMENTED.
//
// A placeholder that satisfies the engine contract (see modes/contract-tests.js)
// so the shared plumbing is exercised before the rules exist. Registered but
// not `playable`, so the menu doesn't offer it yet.
//
// Rules to come: Hong Kong / Cantonese, 4 players, chow/pung/kong claims off
// discards resolved by priority inside a claim window, common faan patterns
// with a minimum-faan requirement.
import { defaults } from '../../settings.js';

export const MODE_ID = 'mahjong';

export const SETTINGS = [
  { key: 'minFaan', type: 'int', default: 3, min: 0, max: 10, label: 'Minimum faan to win on' },
  { key: 'includeFlowers', type: 'bool', default: true, label: 'Play with flowers and seasons' },
  { key: 'allowSevenPairs', type: 'bool', default: true, label: 'Allow the seven-pairs hand' },
  {
    key: 'discarderPaysAll',
    type: 'bool',
    default: true,
    label: 'Discarder pays the whole hand',
    help: 'Off: everyone pays, and the discarder pays double.',
  },
  { key: 'claimSeconds', type: 'int', default: 6, min: 2, max: 20, label: 'Seconds to claim a discard' },
];

export function createState(rng = Math.random) {
  return {
    phase: 'lobby',
    roundNumber: 0,
    roomCode: '',
    hostSeat: null,
    turnIndex: 0,
    dealerIndex: 0,
    prevailingWind: 0,
    roundScores: null,
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
    seatId, peerId, name, connected: true, total: 0,
    hand: [], melds: [], flowers: [], discards: [], wind: state.players.length % 4,
  });
}

export function startRound(state) {
  state.roundNumber++;
  state.phase = 'play';
  state.log = [`Mahjong isn't implemented yet — hand ${state.roundNumber}`];
}

export function applyAction() {
  return { ok: false, msg: 'Mahjong is not playable yet' };
}

export function redact(state) {
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
    settings: state.settings,
    ...(state.phase === 'lobby' ? { settingsSchema: SETTINGS } : {}),
    log: state.log.slice(-6),
    lastMove: state.lastMove,
    players: state.players.map((p) => ({
      seatId: p.seatId,
      name: p.name,
      connected: p.connected,
      total: p.total,
      wind: p.wind,
      handCount: p.hand.length,
      melds: p.melds,
      flowers: p.flowers,
      discards: p.discards,
    })),
  };
}

export function finalScores(state) {
  return state.players
    .map((p) => ({ seatId: p.seatId, name: p.name, total: p.total }))
    .sort((a, b) => b.total - a.total);
}

export function resetToLobby(state) {
  state.phase = 'lobby';
  state.roundNumber = 0;
  state.roundScores = null;
  state.log = [];
  state.lastMove = null;
  state.dealerIndex = 0;
  state.prevailingWind = 0;
  for (const p of state.players) {
    p.total = 0;
    p.hand = []; p.melds = []; p.flowers = []; p.discards = [];
  }
}
