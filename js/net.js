// net.js — PeerJS transport. No DOM, no rules.
// Host: reserves the peer ID 'feebgolf-<CODE>' so joiners can connect
// knowing only the 4-character room code. Guest: connects to that ID.
/* global Peer */

export const PROTOCOL_V = 3;
const PREFIX = 'feebgolf-';
// Unambiguous charset — no 0/O, 1/I/L.
const CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const PING_MS = 20000;      // keepalive interval (both directions)
const WATCHDOG_MS = 180000; // app-level "peer went silent" cutoff — generous
                            // because backgrounded mobile tabs throttle timers
const JOIN_MS = 25000;      // give up on a join. Mobile ICE plus a relay hop
                            // can genuinely take 10s+, which is what the old
                            // limit was, so slow joins looked like bad codes.

// Two phones on mobile data sit behind carrier NATs with no direct path
// between them, so they need a TURN server to relay for them — and the relay
// has to answer on a port their network allows.
//
// We spell the ICE list out instead of taking PeerJS's defaults because those
// defaults are broken: the library's own relay hostnames
// (eu-0/us-0.turn.peerjs.com) no longer resolve at all, so every game has
// silently been running on STUN alone. STUN gets two players talking when at
// least one of their routers cooperates, which is why WiFi-to-WiFi usually
// works and phone-to-phone over cellular usually doesn't.
//
// There is no longer a free no-signup relay worth hardcoding here (Metered's
// openrelayproject credentials now answer TURN allocations with a 400), so
// TURN is a slot you fill in. Any provider that issues STATIC credentials
// works from a static site — Metered and ExpressTurn both do on their free
// tiers. Paste one entry and phone-to-phone starts working:
//
//   const TURN = [{
//     urls: ['turn:your.relay.example:443?transport=tcp', 'turn:your.relay.example:80'],
//     username: '…', credential: '…',
//   }];
//
// Prefer a relay that listens on 443/TCP: that is the port that gets out of
// locked-down mobile, hotel and office networks. Relayed traffic is
// DTLS-encrypted, so a relay carries our packets without seeing any cards.
const TURN = [];

// Public STUN only tells each side what its own public address looks like;
// several are listed so one being down doesn't cost us the srflx candidate.
const ICE = {
  iceServers: [
    {
      urls: [
        'stun:stun.l.google.com:19302',
        'stun:stun1.l.google.com:19302',
        'stun:stun.cloudflare.com:3478',
      ],
    },
    ...TURN,
  ],
};

// True when this build has no relay, which is the difference between "your
// networks could not find a path" and "…and there is nothing to fall back to".
export const hasRelay = TURN.length > 0;

const PEER_OPTS = { config: ICE };

export function randomCode() {
  let code = '';
  const buf = new Uint32Array(4);
  crypto.getRandomValues(buf);
  for (const n of buf) code += CHARS[n % CHARS.length];
  return code;
}

function friendlyError(err) {
  switch (err?.type) {
    case 'browser-incompatible':
      return 'This browser does not support WebRTC — try Chrome, Safari or Firefox.';
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed':
      return 'Could not reach the connection server — check your internet and try again.';
    default:
      return 'Connection error — please try again.';
  }
}

// Silent peer death (crash, network drop) never fires PeerJS's 'close', so
// watch the underlying RTCPeerConnection for terminal ICE failure. onIce fires
// once we can see ICE actually running, which is how the guest tells "no such
// room" apart from "this network won't carry WebRTC".
function watchTransport(conn, onDead, onIce = null) {
  const attach = () => {
    const pc = conn.peerConnection;
    if (!pc) return false;
    onIce?.();
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') onDead();
    });
    pc.addEventListener('iceconnectionstatechange', () => {
      if (pc.iceConnectionState === 'failed') onDead();
    });
    return true;
  };
  if (!attach()) setTimeout(attach, 1000);
}

// ---- Host ----
// cb: { onOpen(code), onFatal(msg), onLink(msg), onHello(conn, msg),
//       onAction(conn, msg), onClose(conn) }
// returns { send(conn, msg), close() }
export function createHost(cb) {
  if (typeof Peer === 'undefined') {
    setTimeout(() => cb.onFatal('Could not load the connection library — check your internet and refresh.'), 0);
    return { send() {}, close() {} };
  }
  let peer = null;
  let attempts = 0;
  let destroyed = false;
  const conns = new Map(); // conn -> lastHeard timestamp

  const dropConn = (conn) => {
    if (!conns.delete(conn)) return; // already handled
    try { conn.close(); } catch { /* fine */ }
    cb.onClose(conn);
  };

  function tryOpen() {
    const code = randomCode();
    // The public broker can hold a released ID briefly, so on collision we
    // try a FRESH code rather than retrying the same one.
    const p = new Peer(PREFIX + code, PEER_OPTS);
    peer = p;
    let opened = false;
    // A replaced peer can still emit late — without this guard its handlers
    // would destroy the peer that succeeded it and kill a live room.
    const stale = () => destroyed || peer !== p;

    p.on('open', () => { opened = true; cb.onLink?.(null); cb.onOpen(code); });

    p.on('error', (err) => {
      if (stale()) return;
      if (err.type === 'unavailable-id' && !opened) {
        p.destroy();
        if (++attempts < 5) tryOpen();
        else cb.onFatal('Could not reserve a room code — please try again.');
      } else if (!opened) {
        p.destroy();
        cb.onFatal(friendlyError(err));
      } else if (err.type === 'unavailable-id') {
        // Re-registering after a sleep found our own code still held by the
        // stale session. Players already at the table are unaffected — only
        // new joins need the broker — so this is a notice, never fatal.
        cb.onLink?.('Room code offline — new players can’t join until it reconnects.');
      } else if (err.type !== 'peer-unavailable') {
        console.warn('peer error:', err.type, err);
      }
    });

    // If the websocket to the broker drops, reconnect so new players can
    // still join. Existing WebRTC connections are unaffected.
    p.on('disconnected', () => {
      if (stale()) return;
      cb.onLink?.('Reconnecting the room code…');
      if (!p.destroyed) p.reconnect();
    });

    p.on('connection', (conn) => {
      conn.on('open', () => {
        conns.set(conn, Date.now());
        watchTransport(conn, () => dropConn(conn));
      });
      conn.on('data', (msg) => {
        if (!msg || typeof msg !== 'object') return;
        conns.set(conn, Date.now());
        if (msg.t === 'hello') cb.onHello(conn, msg);
        else if (msg.t === 'act') cb.onAction(conn, msg);
        else if (msg.t === 'bye') dropConn(conn);
        // pings just refresh lastHeard
      });
      conn.on('close', () => dropConn(conn));
      conn.on('error', () => dropConn(conn));
    });
  }
  tryOpen();

  // A phone that sleeps or switches apps loses its websocket to the broker,
  // and the broker then forgets the room code — so the code stops working
  // while the host is off making a sandwich. Re-register as soon as we're
  // running again, from both the timer and the moment the tab comes back.
  const relink = () => {
    if (destroyed || !peer || peer.destroyed || !peer.disconnected) return;
    cb.onLink?.('Reconnecting the room code…');
    try { peer.reconnect(); } catch { /* the error handler will report it */ }
  };

  // Keepalive both refreshes NAT mappings and feeds the peers' watchdogs.
  const keepalive = setInterval(() => {
    relink();
    const now = Date.now();
    for (const [c, lastHeard] of conns) {
      if (now - lastHeard > WATCHDOG_MS) dropConn(c);
      else if (c.open) c.send({ t: 'ping', v: PROTOCOL_V });
    }
  }, PING_MS);

  const onVisible = () => {
    if (document.visibilityState === 'visible') {
      relink();
      for (const c of conns.keys()) { if (c.open) c.send({ t: 'ping', v: PROTOCOL_V }); }
    }
  };
  document.addEventListener('visibilitychange', onVisible);

  return {
    send(conn, msg) { if (conn && conn.open) conn.send(msg); },
    close() {
      destroyed = true;
      clearInterval(keepalive);
      document.removeEventListener('visibilitychange', onVisible);
      try { peer?.destroy(); } catch { /* already gone */ }
    },
  };
}

// ---- Guest ----
// cb: { onOpen(), onMessage(msg), onClosed(), onFail(msg) }
// returns { send(msg), close() }
export function createGuest(code, cb) {
  if (typeof Peer === 'undefined') {
    setTimeout(() => cb.onFail('Could not load the connection library — check your internet and refresh.'), 0);
    return { send() {}, close() {} };
  }
  const peer = new Peer(undefined, PEER_OPTS);
  let conn = null;
  let opened = false;
  let done = false;
  let tries = 0;
  let sawIce = false; // the offer reached a real peer and ICE is running
  let lastHeard = Date.now();
  let keepalive = null;
  let timer = null;

  // The broker answers "no such peer" in a second or two, so by the time this
  // fires the room almost certainly exists and it's the path between us that
  // failed. Saying "no game found" for that sent people hunting for a typo.
  const NO_PATH = 'Found the room, but no direct connection could be opened. '
    + 'Try both devices on the same Wi-Fi, and turn off any VPN.'
    + (hasRelay ? '' : ' (Two phones on mobile data often can’t reach each '
      + 'other without a TURN relay, and this build has none configured.)');
  const NO_ROOM = `No game found with code ${code} — check the code, and that `
    + 'the host still has the game open on screen.';

  function cleanup() {
    clearTimeout(timer);
    clearInterval(keepalive);
    document.removeEventListener('visibilitychange', onVisible);
    try { peer.destroy(); } catch { /* already gone */ }
  }
  function fail(msg) {
    if (done) return;
    done = true;
    cleanup();
    cb.onFail(msg);
  }
  function hostGone() {
    if (done) return;
    if (!opened) return fail(sawIce ? NO_PATH : NO_ROOM);
    done = true;
    cleanup();
    cb.onClosed();
  }
  const onVisible = () => {
    if (document.visibilityState !== 'visible' || done) return;
    if (peer.disconnected && !peer.destroyed) peer.reconnect();
    if (conn?.open) conn.send({ t: 'ping', v: PROTOCOL_V });
  };

  // ICE dying before the channel ever opened earns one more go: a second
  // gathering round often settles on the relay it should have used first.
  function transportDead() {
    if (done || opened) { hostGone(); return; }
    if (++tries < 2) {
      try { conn?.close(); } catch { /* fine */ }
      connect();
      return;
    }
    fail(sawIce ? NO_PATH : NO_ROOM);
  }

  function connect() {
    conn = peer.connect(PREFIX + code, { reliable: true });
    clearTimeout(timer);
    timer = setTimeout(() => fail(sawIce ? NO_PATH : NO_ROOM), JOIN_MS);
    watchTransport(conn, transportDead, () => { sawIce = true; });
    conn.on('open', () => {
      opened = true;
      lastHeard = Date.now();
      clearTimeout(timer);
      keepalive = setInterval(() => {
        if (Date.now() - lastHeard > WATCHDOG_MS) hostGone();
        else if (conn.open) conn.send({ t: 'ping', v: PROTOCOL_V });
      }, PING_MS);
      document.addEventListener('visibilitychange', onVisible);
      cb.onOpen();
    });
    conn.on('data', (msg) => {
      lastHeard = Date.now();
      if (msg && typeof msg === 'object' && !done) cb.onMessage(msg);
    });
    conn.on('close', hostGone);
    conn.on('error', hostGone);
  }

  // Until the broker answers we haven't asked about the code at all, so a
  // stall here is the network, not a typo.
  timer = setTimeout(() => fail(friendlyError({ type: 'network' })), JOIN_MS);
  peer.on('open', connect);

  peer.on('error', (err) => {
    if (err.type === 'peer-unavailable') fail(NO_ROOM);
    else if (!opened) fail(friendlyError(err));
    else console.warn('peer error:', err.type, err);
  });
  peer.on('disconnected', () => { if (!done && !peer.destroyed) peer.reconnect(); });

  return {
    send(msg) { if (conn && conn.open) conn.send(msg); },
    close() {
      done = true;
      try { conn?.close(); } catch { /* fine */ }
      cleanup();
    },
  };
}
