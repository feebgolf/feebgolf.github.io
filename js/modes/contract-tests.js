// modes/contract-tests.js — every registered engine must pass these. They
// assert the INTERFACE, not the rules: the shared plumbing in main.js and
// ui.js only works if all three modes agree on this much.
//
// Deliberately imports only a mode's engine, never its view — engines have to
// stay DOM-free so `node js/run-tests.mjs` can run them.
import { makeRng, suite } from '../testkit.js';

const REQUIRED_FN = [
  'createState', 'addPlayer', 'startRound', 'applyAction',
  'redact', 'finalScores', 'resetToLobby',
];
// main.js intercepts these before applyAction, so no engine may claim them.
const RESERVED = ['startGame', 'nextRound', 'toLobby', 'setSetting'];
// Keys that would mean hidden information had leaked into a guest's view.
const SECRET_KEYS = ['deck', 'rng', 'wall', 'stock', 'hands'];

// A seated, dealt game at the mode's minimum player count.
function dealt(m, engine, seed = 9) {
  const s = engine.createState(makeRng(seed));
  for (let i = 0; i < m.minPlayers; i++) engine.addPlayer(s, 's' + i, 'p' + i, 'P' + i);
  s.hostSeat = 's0';
  s.roomCode = 'TEST';
  engine.startRound(s);
  return s;
}

export function runContractTests(m, engine) {
  const { results, test, eq } = suite();

  test('exports MODE_ID matching its registry id', () => eq(engine.MODE_ID, m.id));
  test('exports every required function', () => {
    for (const name of REQUIRED_FN) eq(typeof engine[name], 'function', name + ':');
  });

  test('createState starts in the lobby with the contract fields', () => {
    const s = engine.createState(makeRng());
    eq(s.phase, 'lobby');
    eq(Array.isArray(s.players), true, 'players array:');
    eq(Array.isArray(s.log), true, 'log array:');
    eq(s.roundNumber, 0);
  });

  test('addPlayer seats a player with the contract fields', () => {
    const s = engine.createState(makeRng());
    engine.addPlayer(s, 's0', 'peer0', 'Ann');
    const p = s.players[0];
    eq(p.seatId, 's0');
    eq(p.name, 'Ann');
    eq(p.connected, true);
    eq(p.total, 0);
  });

  test('startRound at minPlayers leaves the lobby without throwing', () => {
    const s = dealt(m, engine);
    eq(s.phase !== 'lobby', true, 'phase advanced:');
    eq(s.roundNumber, 1);
  });

  test('redact stamps the mode and the shell-required fields', () => {
    const v = engine.redact(dealt(m, engine), 's0');
    eq(v.mode, m.id);
    eq(typeof v.phase, 'string');
    eq(typeof v.roundNumber, 'number');
    eq(v.hostSeat, 's0');
    eq(Array.isArray(v.players), true, 'players array:');
    for (const p of v.players) {
      eq(typeof p.seatId, 'string', 'seatId:');
      eq(typeof p.name, 'string', 'name:');
      eq(typeof p.total, 'number', 'total:');
      eq(typeof p.connected, 'boolean', 'connected:');
    }
  });

  test('redact leaks no hidden state to any viewer', () => {
    const s = dealt(m, engine);
    for (const viewer of s.players.map((p) => p.seatId)) {
      const v = engine.redact(s, viewer);
      for (const key of SECRET_KEYS) eq(key in v, false, `${key} absent for ${viewer}:`);
      // A view has to survive the wire, so it must be JSON-serializable.
      JSON.parse(JSON.stringify(v));
    }
  });

  test('unknown action from an unknown seat is rejected and mutates nothing', () => {
    const s = dealt(m, engine);
    const before = JSON.stringify(engine.redact(s, 's0'));
    eq(engine.applyAction(s, 'nobody', { a: 'definitely-not-a-move' }).ok, false);
    eq(JSON.stringify(engine.redact(s, 's0')), before, 'state untouched:');
  });

  test('reserved meta action names are rejected by the engine', () => {
    const s = dealt(m, engine);
    for (const a of RESERVED) {
      eq(engine.applyAction(s, 's0', { a }).ok, false, `${a} rejected:`);
    }
  });

  test('resetToLobby returns the game to the lobby', () => {
    const s = dealt(m, engine);
    engine.resetToLobby(s);
    eq(s.phase, 'lobby');
    eq(s.roundNumber, 0);
    eq(s.players.length, m.minPlayers, 'players kept:');
    for (const p of s.players) eq(p.total, 0, 'totals cleared:');
  });

  return results;
}
