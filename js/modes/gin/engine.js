// modes/gin/engine.js — NOT YET IMPLEMENTED.
//
// A placeholder that satisfies the engine contract (see modes/contract-tests.js)
// so the shared plumbing — registry, mode-over-the-wire, per-mode player caps,
// the lobby house-rules panel — is exercised before the rules exist. The mode
// is registered but not `playable`, so the menu doesn't offer it yet.
//
// Rules to come: 2–8 players, deck count scaling with the table, one knocker
// scored against every opponent, automatic layoffs, rounds with a running total.
import { defaults } from '../../settings.js';

export const MODE_ID = 'gin';

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
  },
  {
    key: 'layoffs',
    type: 'bool',
    default: true,
    label: 'Opponents may lay off on the knocker',
  },
  { key: 'ginBonus', type: 'int', default: 25, min: 0, max: 100, label: 'Gin bonus (per opponent)' },
  { key: 'undercutBonus', type: 'int', default: 25, min: 0, max: 100, label: 'Undercut bonus' },
];

export function createState(rng = Math.random) {
  return {
    phase: 'lobby',
    roundNumber: 0,
    roomCode: '',
    hostSeat: null,
    turnIndex: 0,
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
  state.players.push({ seatId, peerId, name, connected: true, total: 0, hand: [] });
}

export function startRound(state) {
  state.roundNumber++;
  state.phase = 'play';
  state.log = [`Gin rummy isn't implemented yet — round ${state.roundNumber}`];
}

export function applyAction() {
  return { ok: false, msg: 'Gin rummy is not playable yet' };
}

export function redact(state) {
  return {
    mode: MODE_ID,
    phase: state.phase,
    roundNumber: state.roundNumber,
    roomCode: state.roomCode,
    hostSeat: state.hostSeat,
    turnIndex: state.turnIndex,
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
      handCount: p.hand.length,
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
  for (const p of state.players) { p.total = 0; p.hand = []; }
}
