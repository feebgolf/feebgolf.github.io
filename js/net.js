// net.js — PeerJS transport. No DOM, no rules.
// Host: reserves the peer ID 'feebgolf-<CODE>' so joiners can connect
// knowing only the 4-character room code. Guest: connects to that ID.
/* global Peer */

export const PROTOCOL_V = 1;
const PREFIX = 'feebgolf-';
// Unambiguous charset — no 0/O, 1/I/L.
const CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const PING_MS = 20000;      // keepalive interval (both directions)
const WATCHDOG_MS = 180000; // app-level "peer went silent" cutoff — generous
                            // because backgrounded mobile tabs throttle timers

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
// watch the underlying RTCPeerConnection for terminal ICE failure.
function watchTransport(conn, onDead) {
  const attach = () => {
    const pc = conn.peerConnection;
    if (!pc) return false;
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') onDead();
    });
    return true;
  };
  if (!attach()) setTimeout(attach, 1000);
}

// ---- Host ----
// cb: { onOpen(code), onFatal(msg), onHello(conn, msg), onAction(conn, msg), onClose(conn) }
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
    peer = new Peer(PREFIX + code);
    let opened = false;

    peer.on('open', () => { opened = true; cb.onOpen(code); });

    peer.on('error', (err) => {
      if (destroyed) return;
      if (err.type === 'unavailable-id' && !opened) {
        peer.destroy();
        if (++attempts < 5) tryOpen();
        else cb.onFatal('Could not reserve a room code — please try again.');
      } else if (!opened) {
        peer.destroy();
        cb.onFatal(friendlyError(err));
      } else if (err.type !== 'peer-unavailable') {
        console.warn('peer error:', err.type, err);
      }
    });

    // If the websocket to the broker drops, reconnect so new players can
    // still join. Existing WebRTC connections are unaffected.
    peer.on('disconnected', () => { if (!destroyed && !peer.destroyed) peer.reconnect(); });

    peer.on('connection', (conn) => {
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

  // Keepalive both refreshes NAT mappings and feeds the peers' watchdogs.
  const keepalive = setInterval(() => {
    const now = Date.now();
    for (const [c, lastHeard] of conns) {
      if (now - lastHeard > WATCHDOG_MS) dropConn(c);
      else if (c.open) c.send({ t: 'ping', v: PROTOCOL_V });
    }
  }, PING_MS);

  const onVisible = () => {
    if (document.visibilityState === 'visible') {
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
  const peer = new Peer();
  let conn = null;
  let opened = false;
  let done = false;
  let lastHeard = Date.now();
  let keepalive = null;

  const timer = setTimeout(() => fail(`No game found with code ${code}`), 10000);

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
    if (!opened) return fail('Connection failed — please try again.');
    done = true;
    cleanup();
    cb.onClosed();
  }
  const onVisible = () => {
    if (document.visibilityState === 'visible' && conn?.open) {
      conn.send({ t: 'ping', v: PROTOCOL_V });
    }
  };

  peer.on('open', () => {
    conn = peer.connect(PREFIX + code, { reliable: true });
    conn.on('open', () => {
      opened = true;
      lastHeard = Date.now();
      clearTimeout(timer);
      watchTransport(conn, hostGone);
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
  });

  peer.on('error', (err) => {
    if (err.type === 'peer-unavailable') fail(`No game found with code ${code}`);
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
