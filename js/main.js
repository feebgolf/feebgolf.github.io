// main.js — coordinator. Wires ui <-> net <-> the active mode's engine.
// The host plays through the exact same handleAction() path that guest
// messages hit, so there are no host/guest branches anywhere in the UI.
import * as net from './net.js';
import * as ui from './ui.js';
import { DEFAULT_MODE, modeOf } from './modes/registry.js';
import * as settings from './settings.js';

const V = net.PROTOCOL_V;

const app = {
  role: null,          // 'host' | 'guest' | 'dev'
  mySeat: null,
  modeId: null,        // which game we're playing
  engine: null,        // that mode's rules — host/dev only; guests never need one
  state: null,         // full state — host/dev only
  view: null,          // last redacted view — the sole render source
  netH: null,
  netG: null,
  connToSeat: new Map(),
  seatToConn: new Map(),
  timer: null,         // pending engine deadline (mahjong's claim window)
  modeGen: 0,          // bumped per mode load, so a stale import can't land
  ready: new Set(),    // seats that have clicked Ready at this round's end
  linkMsg: null,       // host only: why the room code isn't joinable right now
};

// The registry entry for the game in progress (falls back before one is chosen).
const mode = () => modeOf(app.modeId);

// Load a mode's modules. Guests never need the engine — the host is
// authoritative and there's no client-side prediction — so they only pay for
// the view. Idempotent: the module cache makes re-entry instant.
async function activateMode(id, { needEngine }) {
  const m = modeOf(id);
  const gen = ++app.modeGen;
  const [view, engine] = await Promise.all([
    m.view(),
    needEngine ? m.engine() : null,
  ]);
  // Leaving the room, or joining a different one, while the import was in
  // flight makes this load stale — mounting it now would leave a renderer for
  // a game we're no longer in.
  if (gen !== app.modeGen) return;
  app.modeId = m.id;
  app.engine = engine;
  ui.useMode(m.id, view);
  // A view can arrive while the import is still in flight; state messages are
  // full snapshots, so painting the freshest one here is all the fix needed.
  if (app.view) ui.render(app.view, app.mySeat);
}

const newSeat = () => 's' + Math.random().toString(36).slice(2, 8);

// ===== shared dispatch =====

function dispatch(act) {
  if (app.role === 'guest') app.netG?.send({ t: 'act', v: V, ...act });
  else if (app.role === 'host' || app.role === 'dev') handleAction(app.mySeat, act);
}

// ===== host logic (also drives dev mode) =====

function handleAction(seatId, act) {
  const s = app.state;
  if (!s) return;
  const isHostSeat = seatId === s.hostSeat;
  const m = mode();

  // Meta actions (lobby/round control) are host-only.
  if (act.a === 'startGame') {
    if (!isHostSeat || s.phase !== 'lobby') return;
    if (s.players.length < m.minPlayers || s.players.length > m.maxPlayers) return;
    app.engine.startRound(s);
    broadcast();
    return;
  }
  // Nobody deals the next hand alone: every seat still at the table has to
  // click Ready first. Readiness is shell plumbing, not rules — no engine
  // knows about it, and all three modes get the same gate for free.
  if (act.a === 'ready') {
    if (s.phase !== 'roundEnd') return;
    if (!s.players.some((p) => p.seatId === seatId && p.connected)) return;
    app.ready.add(seatId);
    settleRoundEnd();
    return;
  }
  // House rules: host only, and only before the cards are dealt.
  if (act.a === 'setSetting') {
    if (!isHostSeat || s.phase !== 'lobby') return;
    const res = settings.coerce(app.engine.SETTINGS, act.key, act.value);
    if (!res.ok) { ui.toast(res.msg); return; }
    s.settings[act.key] = res.value;
    broadcast();
    return;
  }
  if (act.a === 'toLobby') {
    if (!isHostSeat) return;
    toLobby();
    return;
  }

  // Engines never read the clock; anything time-dependent (mahjong's claim
  // window) reads act.now, so tests can drive it deterministically.
  const res = app.engine.applyAction(s, seatId, { ...act, now: Date.now() });
  if (res.ok) {
    broadcast();
  } else if (seatId === app.mySeat) {
    ui.toast(res.msg);
  } else {
    const conn = app.seatToConn.get(seatId);
    if (conn) app.netH?.send(conn, { t: 'error', v: V, msg: res.msg });
  }
}

// A player who has dropped can't click anything, so they don't hold the round
// hostage — nextRound() prunes them. An empty table isn't "all ready".
function allReady(s) {
  const here = s.players.filter((p) => p.connected);
  return here.length > 0 && here.every((p) => app.ready.has(p.seatId));
}

// Deal again if the table is unanimous, otherwise just show everyone where the
// count stands. Call this wherever readiness or the seat list can change while
// the round-end overlay is up.
function settleRoundEnd() {
  if (allReady(app.state)) nextRound();
  else broadcast();
}

function nextRound() {
  const s = app.state;
  prunePlayers(s);
  app.ready.clear();
  if (s.players.length < mode().minPlayers) { toLobby(); return; }
  app.engine.startRound(s);
  broadcast();
}

function prunePlayers(s) {
  for (const p of [...s.players]) {
    if (!p.connected && p.seatId !== app.mySeat) {
      s.players.splice(s.players.indexOf(p), 1);
    }
  }
}

// End the match: back to the lobby with fresh totals. Pruning the player list
// is the plumbing's job; clearing the game itself belongs to the engine.
function toLobby() {
  const s = app.state;
  prunePlayers(s);
  app.ready.clear();
  app.engine.resetToLobby(s);
  ui.banner(null);
  broadcast();
}

// The engine redacts the rules; the shell stamps on what only it knows.
function viewFor(seatId) {
  const v = app.engine.redact(app.state, seatId);
  if (v.phase === 'roundEnd') v.ready = [...app.ready];
  // Only the host can do anything about the broker link, and only the host is
  // holding the screen with the room code on it.
  if (seatId === app.state.hostSeat && app.linkMsg) v.linkMsg = app.linkMsg;
  return v;
}

function broadcast() {
  const s = app.state;
  if (app.netH) {
    for (const p of s.players) {
      if (p.seatId === app.mySeat || !p.connected) continue;
      const conn = app.seatToConn.get(p.seatId);
      if (conn) app.netH.send(conn, { t: 'state', v: V, view: viewFor(p.seatId) });
    }
  }
  app.view = viewFor(app.mySeat);
  ui.render(app.view, app.mySeat);
  scheduleEngineTimer();
}

// Some games run on a clock — mahjong's claim window closes whether or not
// everyone answers. Engines can't read the clock, so they name a moment they
// want waking and the host fires the action then.
function scheduleEngineTimer() {
  clearTimeout(app.timer);
  app.timer = null;
  if (!app.state || !app.engine?.pendingTimer) return;
  const t = app.engine.pendingTimer(app.state);
  if (!t) return;
  app.timer = setTimeout(() => {
    app.timer = null;
    // Ask again rather than firing t.act blindly: a claim answered in the
    // meantime already closed the window, and the stale action would be
    // rejected — toasting "Unknown action" at the host mid-hand.
    const still = app.engine?.pendingTimer?.(app.state);
    if (still) handleAction(app.state.hostSeat, still.act);
  }, Math.max(0, t.at - Date.now()) + 40); // a beat past the deadline
}

function bind(conn, seatId) {
  app.connToSeat.set(conn, seatId);
  app.seatToConn.set(seatId, conn);
}

function unbind(conn) {
  const seat = app.connToSeat.get(conn);
  if (seat !== undefined) {
    app.connToSeat.delete(conn);
    if (app.seatToConn.get(seat) === conn) app.seatToConn.delete(seat);
  }
  return seat;
}

function handleHello(conn, msg) {
  const s = app.state;
  const reject = (reason, msg = null) => {
    app.netH.send(conn, { t: 'reject', v: V, reason, msg });
    setTimeout(() => { try { conn.close(); } catch { /* fine */ } }, 500);
  };
  if (msg.v !== V) return reject('version');
  const name = String(msg.name || '').trim().slice(0, 12);
  if (!name) return reject('bad_name');

  if (s.phase !== 'lobby') {
    // Refresh recovery: rebind a disconnected player rejoining by name.
    const ghost = s.players.find((p) => !p.connected && p.name === name);
    if (!ghost) return reject('in_progress');
    ghost.connected = true;
    ghost.peerId = conn.peer;
    // They lost the overlay along with the page, so their old Ready doesn't
    // count any more — the table waits for them to click it again.
    app.ready.delete(ghost.seatId);
    bind(conn, ghost.seatId);
    app.netH.send(conn, {
      t: 'welcome', v: V, mode: app.modeId,
      seatId: ghost.seatId, name: ghost.name, roomCode: s.roomCode,
    });
    ui.banner(null);
    broadcast();
    return;
  }

  const m = mode();
  if (s.players.length >= m.maxPlayers) {
    return reject('full', `That ${m.label} room is full (${m.maxPlayers} players max).`);
  }
  let finalName = name;
  let n = 2;
  while (s.players.some((p) => p.name === finalName)) finalName = `${name} (${n++})`;
  const seatId = newSeat();
  app.engine.addPlayer(s, seatId, conn.peer, finalName);
  bind(conn, seatId);
  app.netH.send(conn, {
    t: 'welcome', v: V, mode: app.modeId,
    seatId, name: finalName, roomCode: s.roomCode,
  });
  broadcast();
}

function handleGuestGone(conn) {
  const seat = unbind(conn);
  if (seat === undefined || !app.state) return;
  const s = app.state;
  const p = s.players.find((q) => q.seatId === seat);
  if (!p) return;
  if (s.phase === 'lobby') {
    s.players.splice(s.players.indexOf(p), 1);
  } else {
    p.connected = false;
    s.log.push(`${p.name} disconnected`);
    ui.banner(`${p.name} disconnected — they can rejoin with the same name.`, {
      label: 'Back to lobby',
      onClick: () => dispatch({ a: 'toLobby' }),
    });
  }
  // The seat we were waiting on may be the one that just vanished.
  if (s.phase === 'roundEnd') { settleRoundEnd(); return; }
  broadcast();
}

async function createGame(name, modeId = DEFAULT_MODE) {
  ui.menuError(null);
  ui.menuStatus('Creating room…');
  app.role = 'host';
  await activateMode(modeId, { needEngine: true });
  app.state = app.engine.createState();
  app.mySeat = newSeat();
  app.state.hostSeat = app.mySeat;
  app.engine.addPlayer(app.state, app.mySeat, null, name);
  app.netH = net.createHost({
    onOpen(code) {
      app.state.roomCode = code;
      ui.menuStatus(null);
      broadcast();
    },
    onFatal(msg) { resetToMenu(msg); },
    // The room code lives on the broker, not in the game: losing it doesn't
    // touch anyone already at the table, it just stops new joins — so say so
    // on the lobby screen and carry on.
    onLink(msg) {
      if (app.linkMsg === msg) return;
      app.linkMsg = msg;
      if (app.state) broadcast();
    },
    onHello(conn, msg) { handleHello(conn, msg); },
    onAction(conn, msg) {
      const seat = app.connToSeat.get(conn);
      if (seat !== undefined) handleAction(seat, msg);
    },
    onClose(conn) { handleGuestGone(conn); },
  });
}

// ===== guest logic =====

const REJECT_TEXT = {
  full: 'That room is full (4 players max).',
  in_progress: 'That game is already in progress.',
  version: 'Your page is out of date — refresh and try again.',
  bad_name: 'The host rejected your name — try another.',
};

function joinGame(code, name) {
  ui.menuError(null);
  ui.menuStatus('Connecting…');
  app.role = 'guest';
  app.netG = net.createGuest(code, {
    onOpen() { app.netG.send({ t: 'hello', v: V, name }); },
    onMessage(msg) {
      switch (msg.t) {
        case 'welcome':
          app.mySeat = msg.seatId;
          ui.menuStatus(null);
          // Guests learn the game from the host. The import is fire-and-forget:
          // state messages are full snapshots, so activateMode() paints the
          // freshest one if a view lands while the module is still loading.
          ui.menuStatus(`Loading ${modeOf(msg.mode).label}…`);
          activateMode(msg.mode, { needEngine: false });
          break;
        case 'reject':
          resetToMenu(msg.msg || REJECT_TEXT[msg.reason] || 'Could not join that game.');
          break;
        case 'state':
          app.view = msg.view;                       // always keep the freshest
          // A view from a game whose renderer hasn't loaded yet is dropped;
          // activateMode() paints app.view as soon as the module lands.
          if (app.modeId === msg.view.mode) ui.render(app.view, app.mySeat);
          break;
        case 'error':
          ui.toast(msg.msg);
          break;
        default: // ping etc.
      }
    },
    onClosed() { resetToMenu('The host disconnected — game over.'); },
    onFail(msg) { resetToMenu(msg); },
  });
}

// ===== shared plumbing =====

function resetToMenu(errorMsg = null) {
  app.netH?.close();
  app.netG?.close();
  app.netH = app.netG = null;
  app.role = null;
  app.mySeat = null;
  app.modeId = null;
  app.engine = null;
  app.modeGen++;
  app.state = null;
  app.view = null;
  clearTimeout(app.timer);
  app.timer = null;
  app.connToSeat.clear();
  app.seatToConn.clear();
  app.ready.clear();
  app.linkMsg = null;
  ui.useMode(null);
  ui.showScreen('menu');
  ui.menuStatus(null);
  ui.menuError(errorMsg);
}

function leave() {
  if (app.role === 'guest') app.netG?.send({ t: 'bye', v: V });
  resetToMenu();
}

window.addEventListener('beforeunload', () => {
  if (app.role === 'guest') app.netG?.send({ t: 'bye', v: V });
  app.netH?.close();
  app.netG?.close();
});

ui.init({
  dispatch,
  createGame,
  joinGame,
  leave,
  startGame: () => dispatch({ a: 'startGame' }),
  setSetting: (key, value) => dispatch({ a: 'setSetting', key, value }),
  ready: () => dispatch({ a: 'ready' }),
  toLobby: () => dispatch({ a: 'toLobby' }),
});

// ===== dev mode: ?dev=1 — full local game, no networking =====

const devParams = new URLSearchParams(location.search);
if (devParams.get('dev')) (async () => {
  app.role = 'dev';
  await activateMode(devParams.get('mode') || DEFAULT_MODE, { needEngine: true });
  const m = mode();
  app.state = app.engine.createState();
  app.state.roomCode = 'DEV1';
  // Default to a small table; &seats=N fills it up to the mode's maximum,
  // which is how an 8-handed gin game gets played without 8 browser windows.
  const asked = Number(devParams.get('seats')) || Math.min(3, m.maxPlayers);
  const seats = Math.max(m.minPlayers, Math.min(asked, m.maxPlayers));
  const names = ['You', 'Ana', 'Ben', 'Cy', 'Dee', 'Eli', 'Fay', 'Gus'].slice(0, seats);
  for (let i = 0; i < names.length; i++) app.engine.addPlayer(app.state, 'd' + i, null, names[i]);
  app.state.hostSeat = 'd0';
  app.mySeat = 'd0';

  const bar = document.createElement('div');
  bar.id = 'dev-bar';
  bar.append('play as ');
  const sel = document.createElement('select');
  names.forEach((n, i) => {
    const o = document.createElement('option');
    o.value = 'd' + i;
    o.textContent = n;
    sel.appendChild(o);
  });
  sel.addEventListener('change', () => {
    app.mySeat = sel.value;
    broadcast();
  });
  bar.appendChild(sel);
  document.body.appendChild(bar);

  broadcast();
})();
