// ui.js — the shell: menu, lobby, screen switching, the round-end overlay
// chrome, toasts and banners. No network, no rules, and no knowledge of any
// particular game — the table itself is painted by the active mode's view
// module, which ui.js mounts into #table-root.
import { modeOf } from './modes/registry.js';
import { newStagger } from './cardui.js';
import * as fx from './fx.js';

const $ = (id) => document.getElementById(id);

let H = {};            // handlers from main.js
let view = null;       // last rendered view
let prev = null;       // previous view (for flip animations)
let mySeat = null;
let modeView = null;   // the active mode's view module
let toastTimer = null;
// Round-end overlay pacing: let the final flips play out on the table first.
let overlayTimer = null;
let overlayShownFor = -1; // roundNumber the overlay has been revealed for
const OVERLAY_DELAY_MS = 1600;
let staggerOn = false;   // round-end mass reveal: cascade the flips

export function init(handlers) {
  H = handlers;

  const nameInput = $('name-input');
  nameInput.value = localStorage.getItem('feebgolf-name') || '';
  // A #ABCD link prefills the join code.
  const hash = location.hash.replace('#', '').trim();
  if (/^[A-Za-z0-9]{4}$/.test(hash)) $('code-input').value = hash.toUpperCase();

  const savedName = () => {
    const name = nameInput.value.trim().slice(0, 12);
    if (name) localStorage.setItem('feebgolf-name', name);
    return name;
  };

  $('btn-create').addEventListener('click', () => {
    const name = savedName();
    if (!name) return menuError('Enter a name first');
    H.createGame(name);
  });
  const join = () => {
    const name = savedName();
    if (!name) return menuError('Enter a name first');
    const code = $('code-input').value.trim().toUpperCase();
    if (code.length !== 4) return menuError('Room codes are 4 characters');
    H.joinGame(code, name);
  };
  $('btn-join').addEventListener('click', join);
  $('code-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
  $('code-input').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase(); });

  $('btn-start').addEventListener('click', () => H.startGame());
  $('btn-leave').addEventListener('click', () => H.leave());
  $('btn-copy').addEventListener('click', copyInvite);
  $('btn-next-round').addEventListener('click', () => H.nextRound());
  $('btn-to-lobby').addEventListener('click', () => H.toLobby());
}

// Swap in a mode's table renderer. useMode(null) just tears the old one down,
// which is what leaving a room does — otherwise a later join into a different
// game would paint through a stale renderer with doubly-bound listeners.
export function useMode(id, viewModule = null) {
  if (modeView === viewModule) return;
  modeView?.unmount();
  modeView = viewModule;
  if (modeView) {
    // The mode view never imports ui.js; it gets what it needs handed over.
    modeView.mount($('table-root'), { ...H, repaint: paint, toast, banner });
  } else {
    $('table-root').replaceChildren();
    $('table-root').className = '';
  }
}

// ===== top-level render =====

export function render(v, seat) {
  const isNew = v !== view;
  let flights = [];
  if (isNew) {
    mySeat = seat;
    // Plan card flights against the OLD DOM, before the repaint tears it down.
    if (modeView && fx.shouldAnimate(view, v)) {
      flights = fx.capture(modeView.planMoves(view, v, seat));
    }
    fx.settle();
    staggerOn = !!(view && view.phase === 'play' && v.phase === 'roundEnd');
    prev = view; view = v;
    modeView?.resetInput();
  }
  mySeat = seat;
  if (!view) { showScreen('menu'); return; }
  paint();
  if (isNew && flights.length) fx.launch(flights);
}

function paint() {
  if (view.phase === 'lobby') {
    renderLobby();
    showScreen('lobby');
  } else {
    modeView?.renderTable({ view, prev, mySeat, stagger: newStagger(staggerOn) });
    showScreen('game');
  }
  renderRoundEnd();
}

export function showScreen(name) {
  for (const id of ['screen-menu', 'screen-lobby', 'screen-game']) {
    $(id).hidden = id !== 'screen-' + name;
  }
  if (name === 'menu') {
    view = prev = null;
    fx.settle();
    clearTimeout(overlayTimer);
    overlayTimer = null;
    overlayShownFor = -1;
    $('overlay-roundend').hidden = true;
    banner(null);
  }
}

// ===== menu helpers =====

export function menuError(msg) {
  $('menu-error').textContent = msg || '';
  $('menu-error').hidden = !msg;
  menuStatus(null);
}
export function menuStatus(msg) {
  $('menu-status').textContent = msg || '';
  $('menu-status').hidden = !msg;
  if (msg) $('menu-error').hidden = true;
}

// ===== lobby =====

function renderLobby() {
  const m = modeOf(view.mode);
  $('lobby-code').textContent = view.roomCode || '····';
  $('lobby-mode').textContent = `${m.label} · ${m.blurb}`;
  const list = $('lobby-players');
  list.replaceChildren(...view.players.map((p) => {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = p.name + (p.seatId === mySeat ? ' (you)' : '');
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = p.seatId === view.hostSeat ? 'host' : (p.connected ? '' : 'left');
    li.append(name, tag);
    return li;
  }));
  const isHost = mySeat === view.hostSeat;
  const n = view.players.length;
  $('btn-start').hidden = !isHost;
  $('btn-start').disabled = n < m.minPlayers;
  $('btn-start').textContent = view.roundNumber > 0 ? 'Deal next round' : 'Start game';
  $('lobby-status').textContent = isHost
    ? (n < m.minPlayers
      ? `Waiting for players to join… (${m.minPlayers}–${m.maxPlayers} can play)`
      : `${n} player${n > 1 ? 's' : ''} in — start when ready`)
    : 'Waiting for the host to start…';
}

function copyInvite() {
  if (!view) return;
  const url = `${location.origin}${location.pathname}#${view.roomCode}`;
  navigator.clipboard?.writeText(url).then(
    () => toast(`Invite link copied: ${url}`, false),
    () => toast(url, false),
  );
}

// ===== round end overlay =====

function renderRoundEnd() {
  const isEnd = view && view.phase === 'roundEnd';
  if (!isEnd) {
    clearTimeout(overlayTimer);
    overlayTimer = null;
    overlayShownFor = -1;
    $('overlay-roundend').hidden = true;
    return;
  }
  // Hold the overlay back briefly so everyone sees the last cards flip.
  if (overlayShownFor !== view.roundNumber) {
    if (!overlayTimer) {
      overlayTimer = setTimeout(() => {
        overlayTimer = null;
        if (view && view.phase === 'roundEnd') {
          overlayShownFor = view.roundNumber;
          paint();
        }
      }, OVERLAY_DELAY_MS);
    }
    $('overlay-roundend').hidden = true;
    return;
  }
  $('overlay-roundend').hidden = false;

  const m = modeOf(view.mode);
  $('roundend-title').textContent = `Round ${view.roundNumber}`;

  // Big winner banner. Which way "best" runs is the mode's business.
  const scores = view.roundScores || [];
  const bestRound = m.lowWins
    ? Math.min(...scores.map((r) => r.score))
    : Math.max(...scores.map((r) => r.score));
  const winners = scores.filter((r) => r.score === bestRound);
  const bannerEl = $('roundend-winner');
  if (!scores.length) {
    bannerEl.textContent = '';
  } else if (winners.length === 1) {
    const w = winners[0];
    bannerEl.textContent = w.seatId === mySeat
      ? `🏆 You win the round with ${w.score}!`
      : `🏆 ${w.name} wins the round with ${w.score}!`;
  } else {
    bannerEl.textContent = `🤝 Round tied at ${bestRound} — ${winners.map((w) => w.name).join(' & ')}`;
  }

  modeView?.renderRoundEnd({ view, prev, mySeat }, $('roundend-body'));

  // scoreboard sorted by running total, the mode's winning direction first
  const rows = view.players
    .map((p) => ({
      name: p.name + (p.seatId === mySeat ? ' (you)' : ''),
      round: scores.find((r) => r.seatId === p.seatId)?.score ?? 0,
      total: p.total,
    }))
    .sort((a, b) => (m.lowWins ? a.total - b.total : b.total - a.total));
  const best = rows[0]?.total;
  const table = $('scoreboard');
  table.replaceChildren();
  const head = table.insertRow();
  for (const h of ['player', 'round', 'total']) {
    const th = document.createElement('th');
    th.textContent = h;
    head.appendChild(th);
  }
  for (const r of rows) {
    const tr = table.insertRow();
    if (r.total === best) tr.className = 'winner-row';
    for (const val of [r.name, r.round, r.total]) {
      tr.insertCell().textContent = val;
    }
  }

  const isHost = mySeat === view.hostSeat;
  $('btn-next-round').hidden = !isHost;
  $('btn-to-lobby').hidden = !isHost;
  $('roundend-wait').hidden = isHost;
}

// ===== toast + banner =====

export function toast(msg, isError = true) {
  const t = $('toast');
  t.textContent = msg;
  t.style.color = isError ? '' : '#d2f5d9';
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}

// banner(null) hides. banner(msg, {label, onClick}) shows an action button.
export function banner(msg, action = null) {
  const b = $('banner');
  if (!msg) { b.hidden = true; return; }
  b.replaceChildren(document.createTextNode(msg));
  if (action) {
    const btn = document.createElement('button');
    btn.className = 'btn small';
    btn.textContent = action.label;
    btn.addEventListener('click', action.onClick);
    b.appendChild(btn);
  }
  b.hidden = false;
}
