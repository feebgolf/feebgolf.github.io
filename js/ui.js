// ui.js — renders a redacted view into the DOM and captures input.
// No network, no rules. Everything the player does funnels into the
// handler callbacks installed by main.js via init().

const $ = (id) => document.getElementById(id);
const SUIT_GLYPHS = { s: '♠', h: '♥', d: '♦', c: '♣' };
const RED_SUITS = new Set(['h', 'd']);

let H = {};            // handlers from main.js
let view = null;       // last rendered view
let prev = null;       // previous view (for flip animation)
let mySeat = null;
// The only UI-owned state: what a tap on a card means right now.
// 'none' | 'swapForDiscard' | 'drawnFlip'   (reset whenever a new view arrives)
let mode = 'none';
let toastTimer = null;
// Round-end overlay pacing: let the final flips play out on the table first.
let overlayTimer = null;
let overlayShownFor = -1; // roundNumber the overlay has been revealed for
const OVERLAY_DELAY_MS = 1600;

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

  $('deck-pile').addEventListener('click', () => {
    if (!isClickable($('deck-pile').firstElementChild)) return;
    setMode('none');
    H.dispatch({ a: 'drawDeck' });
  });
  $('discard-pile').addEventListener('click', () => {
    if (!isClickable($('discard-card').firstElementChild)) return;
    setMode(mode === 'swapForDiscard' ? 'none' : 'swapForDiscard');
  });
  $('btn-discard-flip').addEventListener('click', () => setMode('drawnFlip'));
  $('btn-swap-drawn').addEventListener('click', () => setMode('none'));
  $('btn-cancel-mode').addEventListener('click', () => setMode('none'));
  $('my-grid').addEventListener('click', (e) => {
    const cell = e.target.closest('[data-i]');
    if (!cell || !cell.classList.contains('clickable')) return;
    onMyCard(Number(cell.dataset.i));
  });
}

const isClickable = (el) => el && el.classList.contains('clickable');

function onMyCard(i) {
  const me = myPlayer();
  if (!me) return;
  if (view.phase === 'setup') {
    H.dispatch({ a: 'flipSetup', i });
  } else if (mode === 'swapForDiscard') {
    setMode('none');
    H.dispatch({ a: 'takeDiscard', i });
  } else if (view.drawnBy === mySeat) {
    const act = mode === 'drawnFlip' ? 'discardDrawn' : 'swapDrawn';
    setMode('none');
    H.dispatch({ a: act, i });
  }
}

function setMode(m) {
  mode = m;
  if (view) paint();
}

const myPlayer = () => view?.players.find((p) => p.seatId === mySeat) || null;

// ===== top-level render =====

export function render(v, seat) {
  if (v !== view) { prev = view; view = v; mode = 'none'; }
  mySeat = seat;
  if (!view) { showScreen('menu'); return; }
  paint();
}

function paint() {
  if (view.phase === 'lobby') {
    renderLobby();
    showScreen('lobby');
  } else {
    renderGame();
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
  $('lobby-code').textContent = view.roomCode || '····';
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
  $('btn-start').disabled = n < 2;
  $('btn-start').textContent = view.roundNumber > 0 ? 'Deal next round' : 'Start game';
  $('lobby-status').textContent = isHost
    ? (n < 2 ? 'Waiting for players to join… (2–4 can play)' : `${n} player${n > 1 ? 's' : ''} in — start when ready`)
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

// ===== cards =====

function cardEl(card, { animate = false, i = null } = {}) {
  const el = document.createElement('div');
  el.className = 'card';
  if (i !== null) el.dataset.i = i;
  if (!card) { el.classList.add('empty'); return el; }

  const inner = document.createElement('div');
  inner.className = 'card-inner';
  const back = document.createElement('div');
  back.className = 'card-back';
  const face = document.createElement('div');
  face.className = 'card-face';

  if (card.faceUp && card.rank) {
    if (RED_SUITS.has(card.suit)) face.classList.add('red');
    const corner = document.createElement('div');
    corner.className = 'corner';
    corner.textContent = card.rank;
    const sm = document.createElement('span');
    sm.className = 'suit-sm';
    sm.textContent = SUIT_GLYPHS[card.suit];
    corner.appendChild(sm);
    const big = document.createElement('div');
    big.className = 'big-suit';
    big.textContent = SUIT_GLYPHS[card.suit];
    face.append(corner, big);
  }

  inner.append(back, face);
  el.appendChild(inner);

  if (card.faceUp) {
    if (animate) requestAnimationFrame(() => requestAnimationFrame(() => inner.classList.add('up')));
    else inner.classList.add('up');
  }
  return el;
}

// Was this card face-down in the previous view? Then animate the flip.
function flippedNow(seatId, i) {
  if (!prev || prev.phase === 'lobby') return false;
  const pp = prev.players.find((p) => p.seatId === seatId);
  return !!(pp && pp.hand[i] && !pp.hand[i].faceUp);
}

function gridEl(player, { clickableIdx = null, small = false } = {}) {
  const grid = document.createElement('div');
  grid.className = 'grid' + (small ? '' : ' mine');
  player.hand.forEach((c, i) => {
    const el = cardEl(c, { i, animate: c.faceUp && flippedNow(player.seatId, i) });
    if (clickableIdx && clickableIdx.has(i)) el.classList.add('clickable');
    grid.appendChild(el);
  });
  return grid;
}

// ===== game table =====

function renderGame() {
  const me = myPlayer();
  const current = view.players[view.turnIndex];
  const myTurn = view.phase === 'play' && current?.seatId === mySeat;
  const iHold = view.drawnBy === mySeat;

  // --- opponents ---
  const opps = view.players.filter((p) => p.seatId !== mySeat);
  $('opponents').replaceChildren(...opps.map((p) => {
    const box = document.createElement('div');
    box.className = 'opp';
    if (view.phase === 'play' && current?.seatId === p.seatId) box.classList.add('active-player');
    if (!p.connected) box.classList.add('disconnected');
    const name = document.createElement('div');
    name.className = 'opp-name';
    name.textContent = p.name;
    const pts = document.createElement('span');
    pts.className = 'pts';
    pts.textContent = ` · ${p.total}`;
    name.appendChild(pts);
    if (!p.connected) {
      const d = document.createElement('span');
      d.className = 'disc-tag';
      d.textContent = ' ⚠ left';
      name.appendChild(d);
    }
    box.appendChild(name);
    box.appendChild(gridEl(p, { small: true }));
    if (view.drawnBy === p.seatId) {
      const h = document.createElement('div');
      h.className = 'holding';
      h.textContent = 'holding a drawn card…';
      box.appendChild(h);
    }
    return box;
  }));

  // --- deck / discard / drawn ---
  $('deck-count').textContent = view.deckCount;
  const deckCard = $('deck-pile').firstElementChild;
  deckCard.classList.toggle('clickable', myTurn && !view.drawnBy);

  const disc = $('discard-card');
  const discEl = cardEl(view.discardTop ? { ...view.discardTop, faceUp: true } : null);
  if (myTurn && !view.drawnBy && view.discardTop) discEl.classList.add('clickable');
  disc.replaceChildren(discEl);

  const showDrawn = !!view.drawnBy;
  $('drawn-slot').hidden = !showDrawn;
  if (showDrawn) {
    // drawer sees the card; everyone else sees a back
    $('drawn-card').replaceChildren(
      cardEl(view.drawnCard ? { ...view.drawnCard, faceUp: true } : { faceUp: false }),
    );
  }
  const canFlip = me && me.hand.some((c) => !c.faceUp);
  $('drawn-actions').hidden = !iHold;
  $('btn-discard-flip').disabled = !canFlip;
  $('btn-discard-flip').hidden = mode === 'drawnFlip';
  $('btn-swap-drawn').hidden = mode !== 'drawnFlip';
  $('btn-cancel-mode').hidden = true;

  // --- live round-score panel (face-down cards count as 0) ---
  const ls = $('live-scores');
  ls.replaceChildren(ls.firstElementChild); // keep the title
  for (const p of view.players) {
    const row = document.createElement('div');
    row.className = 'ls-row';
    if (view.phase === 'play' && current?.seatId === p.seatId) row.classList.add('ls-active');
    const nm = document.createElement('span');
    nm.className = 'ls-name';
    nm.textContent = p.seatId === mySeat ? 'You' : p.name;
    const sc = document.createElement('span');
    sc.className = 'ls-score';
    sc.textContent = typeof p.visibleScore === 'number' ? p.visibleScore : '–';
    row.append(nm, sc);
    ls.appendChild(row);
  }

  // --- log ---
  $('log').replaceChildren(...(view.log || []).slice(-1).map((line) => {
    const d = document.createElement('div');
    d.textContent = line;
    return d;
  }));

  // --- my grid + affordances ---
  let clickableIdx = null;
  if (me) {
    if (view.phase === 'setup' && me.setupFlips < 2) {
      clickableIdx = idxWhere(me, (c) => !c.faceUp);
    } else if (mode === 'swapForDiscard') {
      clickableIdx = idxWhere(me, () => true);
    } else if (iHold) {
      clickableIdx = mode === 'drawnFlip' ? idxWhere(me, (c) => !c.faceUp) : idxWhere(me, () => true);
    }
  }
  const myHeader = $('my-header');
  if (me) {
    myHeader.textContent = `${me.name} (you)`;
    const pts = document.createElement('span');
    pts.className = 'pts';
    pts.textContent = ` · ${me.total} pts`;
    myHeader.appendChild(pts);
    $('my-grid').replaceChildren(...gridEl(me, { clickableIdx }).children);
  }
  $('my-area').classList.toggle('active-me', myTurn);

  // --- status line ---
  $('status-bar').textContent = statusText(me, current, myTurn, iHold, canFlip);
  $('status-bar').classList.toggle('my-turn', myTurn || (view.phase === 'setup' && me && me.setupFlips < 2));
}

function idxWhere(p, pred) {
  return new Set(p.hand.map((c, i) => (pred(c) ? i : -1)).filter((i) => i >= 0));
}

function statusText(me, current, myTurn, iHold, canFlip) {
  const final = view.finisherIndex !== null && view.phase === 'play' ? 'Final turns! ' : '';
  if (view.phase === 'setup') {
    if (me && me.setupFlips < 2) {
      const left = 2 - me.setupFlips;
      return `Flip ${left} card${left > 1 ? 's' : ''} to start`;
    }
    const ready = view.players.filter((p) => p.setupFlips >= 2).length;
    return `Waiting for others to flip… (${ready}/${view.players.length} ready)`;
  }
  if (view.phase === 'roundEnd') return 'Round over';
  if (!myTurn) return `${final}${current ? current.name + "'s turn…" : ''}`;
  if (iHold) {
    if (mode === 'drawnFlip') return `${final}Tap a face-down card to flip it`;
    return canFlip
      ? `${final}Tap a card to swap it in — or Discard & flip`
      : `${final}Tap a card to swap it in`;
  }
  if (mode === 'swapForDiscard') return `${final}Tap one of your cards to replace it`;
  return `${final}Your turn — tap the deck to draw, or the discard to take it`;
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

  $('roundend-title').textContent = `Round ${view.roundNumber}`;

  // Big winner banner: the round's lowest score takes it.
  const scores = view.roundScores || [];
  const bestRound = Math.min(...scores.map((r) => r.score));
  const winners = scores.filter((r) => r.score === bestRound);
  const winnerSeats = new Set(winners.map((w) => w.seatId));
  const bannerEl = $('roundend-winner');
  if (winners.length === 1) {
    const w = winners[0];
    bannerEl.textContent = w.seatId === mySeat
      ? `🏆 You win the round with ${w.score}!`
      : `🏆 ${w.name} wins the round with ${w.score}!`;
  } else {
    bannerEl.textContent = `🤝 Round tied at ${bestRound} — ${winners.map((w) => w.name).join(' & ')}`;
  }

  $('roundend-hands').replaceChildren(...view.players.map((p) => {
    const box = document.createElement('div');
    box.className = 're-hand';
    if (winnerSeats.has(p.seatId)) {
      box.classList.add('re-winner');
      const ribbon = document.createElement('div');
      ribbon.className = 're-ribbon';
      ribbon.textContent = winners.length > 1 ? '🏆 Tied' : '🏆 Winner';
      box.appendChild(ribbon);
    }
    const name = document.createElement('div');
    name.className = 're-name';
    name.textContent = p.name;
    box.appendChild(name);
    const grid = document.createElement('div');
    grid.className = 'grid';
    const cancelled = new Set();
    for (let c = 0; c < 3; c++) {
      if (p.hand[c]?.rank && p.hand[c].rank === p.hand[c + 3]?.rank) cancelled.add(c);
    }
    p.hand.forEach((card, i) => {
      const el = cardEl(card);
      if (cancelled.has(i % 3)) {
        el.classList.add('cancelled');
        if (i < 3) {
          const b = document.createElement('span');
          b.className = 'zero-badge';
          b.textContent = '0';
          el.appendChild(b);
        }
      }
      grid.appendChild(el);
    });
    box.appendChild(grid);
    const rs = view.roundScores?.find((r) => r.seatId === p.seatId);
    const sc = document.createElement('div');
    sc.className = 're-score';
    sc.textContent = rs ? `${rs.score >= 0 ? '+' : ''}${rs.score} this round` : '';
    box.appendChild(sc);
    return box;
  }));

  // scoreboard sorted by running total, lowest first
  const rows = view.players
    .map((p) => ({
      name: p.name + (p.seatId === mySeat ? ' (you)' : ''),
      round: view.roundScores?.find((r) => r.seatId === p.seatId)?.score ?? 0,
      total: p.total,
    }))
    .sort((a, b) => a.total - b.total);
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
