// modes/gin/view.js — the gin rummy table: DOM rendering and input capture.
// No rules, no network. The meld solver is shared with the engine, so the
// deadwood readout is computed locally from the hand you can already see.
import { cardEl } from '../../cardui.js';
import { SUITS } from '../../cards.js';
import { bestDecomposition, rankIndex } from './melds.js';

export const MODE_ID = 'gin';

const $ = (id) => document.getElementById(id);

let H = {};
let view = null;
let mySeat = null;
// View-owned state: 'none' | 'knock' decides what tapping a card means, and
// the sort order is a pure display preference.
let inputMode = 'none';
let sortBy = 'rank';
let listeners = [];
// Trying every possible discard means one solve per card, and a repaint can be
// triggered by something as trivial as the sort toggle — so cache the answer
// against the exact hand it was computed for.
let knockCache = { key: null, value: null };

function on(id, ev, fn) {
  const el = $(id);
  if (!el) return;
  el.addEventListener(ev, fn);
  listeners.push([el, ev, fn]);
}

export function mount(root, handlers) {
  H = handlers;
  root.replaceChildren($('tpl-table-gin').content.cloneNode(true));
  root.className = MODE_ID;

  on('gin-stock', 'click', () => {
    if (!canDraw()) return;
    setMode('none');
    H.dispatch({ a: 'draw' });
  });
  on('gin-discard', 'click', () => {
    if (!canDraw() || !view.discardTop) return;
    setMode('none');
    H.dispatch({ a: 'take' });
  });
  on('btn-gin-knock', 'click', () => setMode(inputMode === 'knock' ? 'none' : 'knock'));
  on('btn-gin-sort', 'click', () => {
    sortBy = sortBy === 'rank' ? 'suit' : 'rank';
    H.repaint();
  });
  on('gin-hand', 'click', (e) => {
    const cell = e.target.closest('[data-id]');
    if (!cell || !cell.classList.contains('clickable')) return;
    const id = cell.dataset.id;
    const knocking = inputMode === 'knock';
    setMode('none');
    H.dispatch({ a: knocking ? 'knock' : 'discard', id });
  });
}

export function unmount() {
  for (const [el, ev, fn] of listeners) el.removeEventListener(ev, fn);
  listeners = [];
  view = null;
  inputMode = 'none';
  knockCache = { key: null, value: null };
}

export function resetInput() {
  inputMode = 'none';
}

function setMode(m) {
  inputMode = m;
  if (view) H.repaint();
}

const myTurn = () => view.phase === 'play' && view.players[view.turnIndex]?.seatId === mySeat;
// Holding an eleventh card means the turn is half done: a discard is owed.
const iHold = () => myTurn() && view.myHand.length > 10;
const canDraw = () => myTurn() && !iHold();

// ===== hand presentation =====

function sortedHand() {
  const hand = [...(view.myHand || [])];
  if (sortBy === 'suit') {
    hand.sort((a, b) => SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit)
      || rankIndex(a.rank) - rankIndex(b.rank));
  } else {
    hand.sort((a, b) => rankIndex(a.rank) - rankIndex(b.rank)
      || SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit));
  }
  return hand;
}

// Which of my cards are currently melded, so the table can show them grouped
// without reordering the hand under the player's fingers.
function myMeldInfo() {
  const hand = view.myHand || [];
  if (!hand.length) return { meldOf: new Map(), deadwood: 0, meldCount: 0 };
  const b = bestDecomposition(hand, view.settings || {});
  // Which meld each card belongs to, so neighbouring melds can be tinted apart.
  const meldOf = new Map();
  b.melds.forEach((m, i) => m.forEach((c) => meldOf.set(c.id, i)));
  return { meldOf, deadwood: b.deadwood, meldCount: b.melds.length };
}

// Can I knock at all, and what's the best I could get down to?
function knockOptions() {
  if (!iHold()) return { can: false, best: null };
  const key = view.myHand.map((c) => c.id).join(',') + '|' + view.myTookId
    + '|' + (view.settings?.knockMax ?? 10) + '|' + !!view.settings?.allowDuplicateSets;
  if (knockCache.key === key) return knockCache.value;
  const max = view.settings?.knockMax ?? 10;
  const hand = view.myHand;
  let best = Infinity;
  const legal = new Set();
  for (const c of hand) {
    if (c.id === view.myTookId) continue; // can't throw back what you just took
    const rest = hand.filter((x) => x.id !== c.id);
    const dw = bestDecomposition(rest, view.settings || {}).deadwood;
    if (dw < best) best = dw;
    if (dw <= max) legal.add(c.id);
  }
  const value = { can: legal.size > 0, legal, best: best === Infinity ? null : best };
  knockCache = { key, value };
  return value;
}

// ===== card flights =====

const handSel = (id) => `#gin-hand [data-id="${id}"]`;
const oppSel = (seat) => `.gin-opp[data-seat="${seat}"]`;

export function planMoves(oldV, newV, seat) {
  mySeat = seat;
  const lm = newV.lastMove;
  const mine = lm.seat === mySeat;
  switch (lm.a) {
    case 'draw':
      // Only my own draw has a visible destination; an opponent's is private.
      return mine
        ? [{ from: '#gin-stock .card', to: handSel(lm.id), card: cardById(newV, lm.id), flip: true }]
        : [];
    case 'take':
      return mine
        ? [{ from: '#gin-discard .card', to: handSel(lm.id), card: cardById(newV, lm.id), flip: false }]
        : [];
    case 'discard':
    case 'knock':
      return [{
        from: mine ? handSel(lm.id) : oppSel(lm.seat),
        to: '#gin-discard .card',
        card: newV.discardTop,
        flip: !mine,
      }];
    default:
      return [];
  }
}

const cardById = (v, id) => (v.myHand || []).find((c) => c.id === id) || null;

// ===== the table =====

export function renderTable(ctx) {
  ({ view, mySeat } = ctx);
  const current = view.players[view.turnIndex];
  const info = myMeldInfo();
  const knock = knockOptions();

  // --- opponents: hands are hidden, so it's a compact roster ---
  const opps = view.players.filter((p) => p.seatId !== mySeat);
  $('gin-opponents').replaceChildren(...opps.map((p) => {
    const box = document.createElement('div');
    box.className = 'gin-opp';
    box.dataset.seat = p.seatId;
    if (view.phase === 'play' && current?.seatId === p.seatId) box.classList.add('active-player');
    if (!p.connected) box.classList.add('disconnected');

    const name = document.createElement('span');
    name.className = 'gin-opp-name';
    name.textContent = p.name;
    const cards = document.createElement('span');
    cards.className = 'gin-opp-cards';
    cards.textContent = `🂠 ${p.handCount}`;
    const pts = document.createElement('span');
    pts.className = 'pts';
    pts.textContent = p.total;
    box.append(name, cards, pts);
    if (p.knocked) {
      const t = document.createElement('span');
      t.className = 'gin-tag';
      t.textContent = 'knocked';
      box.appendChild(t);
    }
    if (!p.connected) {
      const d = document.createElement('span');
      d.className = 'disc-tag';
      d.textContent = '⚠ left';
      box.appendChild(d);
    }
    return box;
  }));

  // --- stock and discard ---
  const stock = $('gin-stock');
  const stockCard = stock.querySelector('.card');
  stock.querySelector('.deck-count').textContent = view.stockCount;
  stockCard.classList.toggle('clickable', canDraw() && view.stockCount > 0);

  const discEl = cardEl(view.discardTop ? { ...view.discardTop, faceUp: true } : null);
  if (canDraw() && view.discardTop) discEl.classList.add('clickable');
  $('gin-discard-card').replaceChildren(discEl);

  // --- my hand ---
  const hand = sortedHand();
  const holding = iHold();
  const handBox = $('gin-hand');
  handBox.replaceChildren(...hand.map((c) => {
    const el = cardEl({ ...c, faceUp: true });
    el.dataset.id = c.id;
    if (info.meldOf.has(c.id)) {
      // Three tints, cycled: a hand can hold three melds, and two of them
      // sitting side by side in the same colour would read as one.
      el.classList.add('melded', 'meld-' + 'abc'[info.meldOf.get(c.id) % 3]);
    }
    if (c.id === view.myTookId) el.classList.add('just-taken');
    // Only meaningful once a discard is owed; in knock mode, only discards
    // that actually bring you under the limit are offered.
    if (holding && c.id !== view.myTookId
      && (inputMode !== 'knock' || knock.legal?.has(c.id))) {
      el.classList.add('clickable');
    }
    return el;
  }));

  // --- meld / deadwood readout ---
  const meld = $('gin-meldinfo');
  const parts = [`${info.meldCount} meld${info.meldCount === 1 ? '' : 's'}`,
    `deadwood ${info.deadwood}`];
  if (holding && knock.best !== null) parts.push(`best discard leaves ${knock.best}`);
  meld.textContent = parts.join(' · ');

  const knockBtn = $('btn-gin-knock');
  knockBtn.disabled = !knock.can;
  knockBtn.classList.toggle('armed', inputMode === 'knock');
  knockBtn.textContent = inputMode === 'knock' ? 'Pick a card to throw' : 'Knock';
  $('btn-gin-sort').textContent = sortBy === 'rank' ? 'Sort by suit' : 'Sort by rank';

  // --- header, log, status ---
  const me = view.players.find((p) => p.seatId === mySeat);
  const myHeader = $('my-header');
  if (me) {
    myHeader.textContent = `${me.name} (you)`;
    const pts = document.createElement('span');
    pts.className = 'pts';
    pts.textContent = ` · ${me.total} pts`;
    myHeader.appendChild(pts);
  }
  $('log').replaceChildren(...(view.log || []).slice(-1).map((line) => {
    const d = document.createElement('div');
    d.textContent = line;
    return d;
  }));
  $('my-area').classList.toggle('active-me', myTurn());
  $('status-bar').textContent = statusText(current, knock);
  $('status-bar').classList.toggle('my-turn', myTurn());
}

function statusText(current, knock) {
  if (view.phase === 'roundEnd') return 'Hand over';
  if (!myTurn()) {
    const who = current ? `${current.name}'s turn…` : '';
    return view.holding ? `${who} (deciding what to throw)` : who;
  }
  if (iHold()) {
    if (inputMode === 'knock') return 'Tap the card you want to throw as you knock';
    return knock.can
      ? 'Tap a card to throw it — or knock'
      : 'Tap a card to throw it';
  }
  return 'Your turn — draw from the stock, or take the discard';
}

// ===== round-end body =====

export function renderRoundEnd(ctx, body) {
  ({ view, mySeat } = ctx);
  const rev = view.reveal;
  if (!rev) { body.replaceChildren(); return; }

  const rows = rev.rows.map((r) => {
    const box = document.createElement('div');
    box.className = 're-hand gin-re';
    if (r.seatId === rev.knocker) {
      box.classList.add('re-winner');
      const ribbon = document.createElement('div');
      ribbon.className = 're-ribbon';
      ribbon.textContent = rev.gin ? '🏆 Gin' : '🏆 Knocked';
      box.appendChild(ribbon);
    }
    const name = document.createElement('div');
    name.className = 're-name';
    name.textContent = r.name + (r.seatId === mySeat ? ' (you)' : '');
    box.appendChild(name);

    // Melds first, then what was laid off, then what it cost.
    const meldWrap = document.createElement('div');
    meldWrap.className = 'gin-melds';
    for (const m of r.melds) meldWrap.appendChild(cardRow(m, 'gin-meld'));
    if (r.laidOff.length) meldWrap.appendChild(cardRow(r.laidOff, 'gin-laidoff'));
    if (r.deadwoodCards.length) meldWrap.appendChild(cardRow(r.deadwoodCards, 'gin-dead'));
    box.appendChild(meldWrap);

    const sc = document.createElement('div');
    sc.className = 're-score';
    const bits = [`deadwood ${r.deadwood}`];
    if (r.laidOff.length) bits.push(`${r.laidOff.length} laid off`);
    sc.textContent = `${bits.join(' · ')} — ${r.score >= 0 ? '+' : ''}${r.score}`;
    box.appendChild(sc);
    return box;
  });
  body.replaceChildren(...rows);
}

function cardRow(cards, cls) {
  const row = document.createElement('div');
  row.className = 'gin-cardrow ' + cls;
  for (const c of cards) row.appendChild(cardEl({ ...c, faceUp: true }));
  return row;
}
