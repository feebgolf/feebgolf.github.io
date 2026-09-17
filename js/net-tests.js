// net-tests.js — the transport's reconnect and failure-reporting logic, with
// PeerJS and the DOM stubbed out. These are the paths that only show up on a
// real phone that went to sleep or a network with no route between players,
// which is exactly why they're worth pinning down here instead.
import { suite } from './testkit.js';
import { createHost, createGuest } from './net.js';

// A stand-in for a PeerJS Peer: records what was asked of it and lets a test
// fire the events the real broker would.
class FakePeer {
  constructor(id, opts) {
    this.id = id;
    this.opts = opts;
    this.handlers = {};
    this.destroyed = false;
    this.disconnected = false;
    this.reconnects = 0;
    this.connects = [];
    FakePeer.made.push(this);
  }
  on(event, fn) { (this.handlers[event] ||= []).push(fn); }
  emit(event, arg) { for (const fn of this.handlers[event] || []) fn(arg); }
  reconnect() { this.reconnects++; this.disconnected = false; }
  destroy() { this.destroyed = true; }
  connect(peerId) {
    this.connects.push(peerId);
    const conn = fakeConn();
    this.lastConn = conn;
    return conn;
  }
}
FakePeer.made = [];

// Enough of a DataConnection for watchTransport and the send guards.
function fakeConn() {
  const pc = {
    connectionState: 'new',
    iceConnectionState: 'new',
    listeners: {},
    addEventListener(event, fn) { (this.listeners[event] ||= []).push(fn); },
    fire(event) { for (const fn of this.listeners[event] || []) fn(); },
  };
  return {
    open: false,
    peerConnection: pc,
    sent: [],
    closed: false,
    handlers: {},
    on(event, fn) { (this.handlers[event] ||= []).push(fn); },
    emit(event, arg) { for (const fn of this.handlers[event] || []) fn(arg); },
    send(msg) { this.sent.push(msg); },
    close() { this.closed = true; },
    // Terminal ICE failure, the way a network with no route reports it.
    killTransport() { pc.connectionState = 'failed'; pc.fire('connectionstatechange'); },
  };
}

// Install the globals net.js reaches for, run the body, then put back exactly
// what was there — the mode suites share this process.
function withStubs(body) {
  const saved = {
    Peer: globalThis.Peer,
    document: globalThis.document,
    setInterval: globalThis.setInterval,
    setTimeout: globalThis.setTimeout,
    clearInterval: globalThis.clearInterval,
    clearTimeout: globalThis.clearTimeout,
  };
  FakePeer.made = [];
  const ticks = [];   // captured setInterval callbacks
  const timeouts = []; // captured setTimeout callbacks
  const docHandlers = {};
  globalThis.Peer = FakePeer;
  globalThis.document = {
    visibilityState: 'visible',
    addEventListener(event, fn) { (docHandlers[event] ||= []).push(fn); },
    removeEventListener(event, fn) {
      docHandlers[event] = (docHandlers[event] || []).filter((f) => f !== fn);
    },
  };
  // Cancellation has to be real: a test that fires a timer the code already
  // cleared is testing a clock nobody ships.
  globalThis.setInterval = (fn) => ticks.push(fn);
  globalThis.setTimeout = (fn) => timeouts.push(fn);
  globalThis.clearInterval = (id) => { if (id) ticks[id - 1] = null; };
  globalThis.clearTimeout = (id) => { if (id) timeouts[id - 1] = null; };
  try {
    return body({
      peers: FakePeer.made,
      tick: () => ticks.filter(Boolean).forEach((fn) => fn()),
      fireTimeouts: () => {
        // Blank the slots in place rather than truncating: ids handed out
        // earlier have to keep pointing at the same timer.
        const due = timeouts.filter(Boolean);
        timeouts.forEach((fn, i) => { if (fn) timeouts[i] = null; });
        due.forEach((fn) => fn());
      },
      becomeVisible: () => (docHandlers.visibilitychange || []).forEach((fn) => fn()),
    });
  } finally {
    Object.assign(globalThis, saved);
  }
}

// A host with every callback recorded.
function hostWithSpies(env) {
  const seen = { open: [], fatal: [], link: [], closed: [] };
  const api = createHost({
    onOpen: (code) => seen.open.push(code),
    onFatal: (msg) => seen.fatal.push(msg),
    onLink: (msg) => seen.link.push(msg),
    onHello: () => {},
    onAction: () => {},
    onClose: (conn) => seen.closed.push(conn),
  });
  return { api, seen, peer: () => env.peers[env.peers.length - 1] };
}

export function runTests() {
  const { results, test, eq } = suite();

  test('the room code is offered to the broker with a relay-capable ICE list', () => withStubs((env) => {
    hostWithSpies(env);
    const cfg = env.peers[0].opts.config;
    eq(Array.isArray(cfg.iceServers), true, 'iceServers passed:');
    eq(cfg.iceServers.some((s) => JSON.stringify(s.urls).includes('stun:')), true, 'has STUN:');
    // The dead PeerJS defaults are the bug this list exists to avoid.
    eq(JSON.stringify(cfg).includes('turn.peerjs.com'), false, 'no dead peerjs relay:');
    eq(env.peers[0].id.startsWith('feebgolf-'), true, 'prefixed id:');
  }));

  test('a code collision takes a fresh code rather than retrying the same one', () => withStubs((env) => {
    const h = hostWithSpies(env);
    env.peers[0].emit('error', { type: 'unavailable-id' });
    eq(env.peers.length, 2, 'second attempt made:');
    eq(env.peers[0].destroyed, true, 'first peer destroyed:');
    eq(env.peers[0].id === env.peers[1].id, false, 'different code:');
    env.peers[1].emit('open');
    eq(h.seen.open.length, 1, 'room opened:');
    eq(h.seen.fatal.length, 0, 'not fatal:');
  }));

  test('a late error from a replaced peer cannot kill the live room', () => withStubs((env) => {
    const h = hostWithSpies(env);
    env.peers[0].emit('error', { type: 'unavailable-id' });
    env.peers[1].emit('open');
    // The abandoned peer is still wired up and can still emit.
    env.peers[0].emit('error', { type: 'socket-error' });
    eq(h.seen.fatal.length, 0, 'no fatal from the stale peer:');
    eq(env.peers[1].destroyed, false, 'live peer survives:');
  }));

  test('losing the broker re-registers so the code keeps working', () => withStubs((env) => {
    const h = hostWithSpies(env);
    const p = env.peers[0];
    p.emit('open');
    eq(h.seen.link.at(-1), null, 'link reported healthy:');
    p.emit('disconnected');
    eq(p.reconnects, 1, 'reconnected:');
    eq(typeof h.seen.link.at(-1), 'string', 'host told the code is offline:');
    p.emit('open');
    eq(h.seen.link.at(-1), null, 'notice cleared on reopen:');
  }));

  test('a host back from sleep re-registers without having seen the event', () => withStubs((env) => {
    const h = hostWithSpies(env);
    const p = env.peers[0];
    p.emit('open');
    // A suspended tab misses 'disconnected' entirely; all we can see on the
    // way back is that the peer is no longer registered.
    p.disconnected = true;
    env.becomeVisible();
    eq(p.reconnects, 1, 'relinked when the tab came back:');
    p.disconnected = true;
    env.tick();
    eq(p.reconnects, 2, 'relinked from the keepalive too:');
    eq(h.seen.fatal.length, 0, 'never fatal:');
  }));

  test('losing the room code mid-game is a notice, not a game over', () => withStubs((env) => {
    const h = hostWithSpies(env);
    const p = env.peers[0];
    p.emit('open');
    p.emit('error', { type: 'unavailable-id' }); // our own stale registration
    eq(h.seen.fatal.length, 0, 'players at the table keep playing:');
    eq(typeof h.seen.link.at(-1), 'string', 'host is told joins are down:');
  }));

  test('an unhosted code fails fast and says so', () => withStubs((env) => {
    const fails = [];
    createGuest('ZZZZ', {
      onOpen: () => {}, onMessage: () => {}, onClosed: () => {},
      onFail: (msg) => fails.push(msg),
    });
    env.peers[0].emit('error', { type: 'peer-unavailable' });
    eq(fails.length, 1, 'failed:');
    eq(fails[0].includes('ZZZZ'), true, 'names the code:');
  }));

  test('ICE failure retries once, then blames the network and not the code', () => withStubs((env) => {
    const fails = [];
    createGuest('ABCD', {
      onOpen: () => {}, onMessage: () => {}, onClosed: () => {},
      onFail: (msg) => fails.push(msg),
    });
    const p = env.peers[0];
    p.emit('open');
    eq(p.connects.length, 1, 'connect attempted:');
    p.lastConn.killTransport();
    eq(p.connects.length, 2, 'retried once:');
    eq(fails.length, 0, 'no failure reported yet:');
    p.lastConn.killTransport();
    eq(fails.length, 1, 'gave up after the retry:');
    // "No game found" here is what sent people hunting for a typo.
    eq(fails[0].includes('Found the room'), true, 'reports a path problem:');
  }));

  test('a join that never answers is not reported as a bad code', () => withStubs((env) => {
    const fails = [];
    createGuest('ABCD', {
      onOpen: () => {}, onMessage: () => {}, onClosed: () => {},
      onFail: (msg) => fails.push(msg),
    });
    const p = env.peers[0];
    p.emit('open');            // ICE is running by now
    env.fireTimeouts();        // …and the join deadline passes
    eq(fails.length, 1, 'timed out:');
    eq(fails[0].includes('Found the room'), true, 'blames the path, not the code:');
  }));

  return results;
}
