// main.js — coordinator. Wires ui <-> net <-> game.
// The host plays through the exact same handleAction() path that guest
// messages hit, so there are no host/guest branches anywhere in the UI.
import * as game from './game.js';
import * as net from './net.js';
import * as ui from './ui.js';

const V = net.PROTOCOL_V;

const app = {
  role: null,          // 'host' | 'guest' | 'dev'
  mySeat: null,
  state: null,         // full state — host/dev only
  view: null,          // last redacted view — the sole render source
  netH: null,
  netG: null,
  connToSeat: new Map(),
  seatToConn: new Map(),
};

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

  // Meta actions (lobby/round control) are host-only.
  if (act.a === 'startGame') {
    if (!isHostSeat || s.phase !== 'lobby') return;
    if (s.players.length < 2 || s.players.length > 4) return;
    game.startRound(s);
    broadcast();
    return;
  }
  if (act.a === 'nextRound') {
    if (!isHostSeat || s.phase !== 'roundEnd') return;
    prunePlayers(s);
    if (s.players.length < 2) { toLobby(); return; }
    game.startRound(s);
    broadcast();
    return;
  }
  if (act.a === 'toLobby') {
    if (!isHostSeat) return;
    toLobby();
    return;
  }

  const res = game.applyAction(s, seatId, act);
  if (res.ok) {
    broadcast();
  } else if (seatId === app.mySeat) {
    ui.toast(res.msg);
  } else {
    const conn = app.seatToConn.get(seatId);
    if (conn) app.netH?.send(conn, { t: 'error', v: V, msg: res.msg });
  }
}

function prunePlayers(s) {
  for (const p of [...s.players]) {
    if (!p.connected && p.seatId !== app.mySeat) {
      s.players.splice(s.players.indexOf(p), 1);
    }
  }
}

// End the match: back to the lobby with fresh totals.
function toLobby() {
  const s = app.state;
  prunePlayers(s);
  s.phase = 'lobby';
  s.roundNumber = 0;
  s.finisherIndex = null;
  s.drawn = null;
  s.deck = [];
  s.discard = [];
  s.roundScores = null;
  s.log = [];
  for (const p of s.players) { p.total = 0; p.setupFlips = 0; p.hand = []; }
  ui.banner(null);
  broadcast();
}

function broadcast() {
  const s = app.state;
  if (app.netH) {
    for (const p of s.players) {
      if (p.seatId === app.mySeat || !p.connected) continue;
      const conn = app.seatToConn.get(p.seatId);
      if (conn) app.netH.send(conn, { t: 'state', v: V, view: game.redact(s, p.seatId) });
    }
  }
  app.view = game.redact(s, app.mySeat);
  ui.render(app.view, app.mySeat);
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
  const reject = (reason) => {
    app.netH.send(conn, { t: 'reject', v: V, reason });
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
    bind(conn, ghost.seatId);
    app.netH.send(conn, { t: 'welcome', v: V, seatId: ghost.seatId, name: ghost.name, roomCode: s.roomCode });
    ui.banner(null);
    broadcast();
    return;
  }

  if (s.players.length >= 4) return reject('full');
  let finalName = name;
  let n = 2;
  while (s.players.some((p) => p.name === finalName)) finalName = `${name} (${n++})`;
  const seatId = newSeat();
  game.addPlayer(s, seatId, conn.peer, finalName);
  bind(conn, seatId);
  app.netH.send(conn, { t: 'welcome', v: V, seatId, name: finalName, roomCode: s.roomCode });
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
  broadcast();
}

function createGame(name) {
  ui.menuError(null);
  ui.menuStatus('Creating room…');
  app.role = 'host';
  app.state = game.createState();
  app.mySeat = newSeat();
  app.state.hostSeat = app.mySeat;
  game.addPlayer(app.state, app.mySeat, null, name);
  app.netH = net.createHost({
    onOpen(code) {
      app.state.roomCode = code;
      ui.menuStatus(null);
      broadcast();
    },
    onFatal(msg) { resetToMenu(msg); },
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
          break;
        case 'reject':
          resetToMenu(REJECT_TEXT[msg.reason] || 'Could not join that game.');
          break;
        case 'state':
          app.view = msg.view;
          ui.render(app.view, app.mySeat);
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
  app.state = null;
  app.view = null;
  app.connToSeat.clear();
  app.seatToConn.clear();
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
  nextRound: () => dispatch({ a: 'nextRound' }),
  toLobby: () => dispatch({ a: 'toLobby' }),
});

// ===== dev mode: ?dev=1 — full local game, no networking =====

if (new URLSearchParams(location.search).get('dev')) {
  app.role = 'dev';
  app.state = game.createState();
  app.state.roomCode = 'DEV1';
  const names = ['You', 'Ana', 'Ben'];
  for (let i = 0; i < names.length; i++) game.addPlayer(app.state, 'd' + i, null, names[i]);
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
}
