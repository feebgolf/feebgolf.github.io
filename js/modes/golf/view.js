// modes/golf/view.js — the golf table: DOM rendering and input capture.
// No rules, no network. Every player action funnels into the handler bag that
// main.js and ui.js install via mount().
import { cardEl, gridEl } from '../../cardui.js';

export const MODE_ID = 'golf';

const $ = (id) => document.getElementById(id);

let H = {};             // handlers: dispatch/repaint/toast/banner/…
let view = null;        // the view being painted
let prev = null;        // the one before it (drives flip animations)
let mySeat = null;
let stagger = null;     // round-end cascade, fresh per paint
// The only view-owned state: what a tap on a card means right now.
// 'none' | 'swapForDiscard' | 'drawnFlip'   (reset whenever a new view arrives)
let inputMode = 'none';
let listeners = [];

// ===== mount / unmount =====

function on(id, ev, fn) {
  const el = $(id);
  if (!el) return;
  el.addEventListener(ev, fn);
  listeners.push([el, ev, fn]);
}

export function mount(root, handlers) {
  H = handlers;
  root.replaceChildren($('tpl-table-golf').content.cloneNode(true));
  root.className = MODE_ID;

  on('deck-pile', 'click', () => {
    if (!isClickable($('deck-pile').firstElementChild)) return;
    setMode('none');
    H.dispatch({ a: 'drawDeck' });
  });
  on('discard-pile', 'click', () => {
    if (!isClickable($('discard-card').firstElementChild)) return;
    setMode(inputMode === 'swapForDiscard' ? 'none' : 'swapForDiscard');
  });
  on('btn-discard-flip', 'click', () => setMode('drawnFlip'));
  on('btn-swap-drawn', 'click', () => setMode('none'));
  on('btn-cancel-mode', 'click', () => setMode('none'));
  on('my-grid', 'click', (e) => {
    const cell = e.target.closest('[data-i]');
    if (!cell || !cell.classList.contains('clickable')) return;
    onMyCard(Number(cell.dataset.i));
  });
}

// Symmetric with mount: leaving a room must not leave handlers bound, or a
// later join stacks a second copy of every listener.
export function unmount() {
  for (const [el, ev, fn] of listeners) el.removeEventListener(ev, fn);
  listeners = [];
  view = prev = null;
  inputMode = 'none';
}

export function resetInput() {
  inputMode = 'none';
}

// ===== input =====

const isClickable = (el) => el && el.classList.contains('clickable');

function onMyCard(i) {
  if (!myPlayer()) return;
  if (view.phase === 'setup') {
    H.dispatch({ a: 'flipSetup', i });
  } else if (inputMode === 'swapForDiscard') {
    setMode('none');
    H.dispatch({ a: 'takeDiscard', i });
  } else if (view.drawnBy === mySeat) {
    const act = inputMode === 'drawnFlip' ? 'discardDrawn' : 'swapDrawn';
    setMode('none');
    H.dispatch({ a: act, i });
  }
}

function setMode(m) {
  inputMode = m;
  if (view) H.repaint();
}

const myPlayer = () => view?.players.find((p) => p.seatId === mySeat) || null;

// ===== card flights =====

const cellSel = (seat, i) => (seat === mySeat
  ? `#my-grid [data-i="${i}"]`
  : `.opp[data-seat="${seat}"] [data-i="${i}"]`);

// Turn the view diff (via lastMove) into flights. `card` is what the flying
// card shows on landing; `flip` starts it face-down and flips it mid-air.
// fx.shouldAnimate() has already ruled out the uninteresting transitions.
export function planMoves(oldV, newV, seat) {
  mySeat = seat;
  const lm = newV.lastMove;
  const oldP = oldV.players.find((p) => p.seatId === lm.seat);
  const newP = newV.players.find((p) => p.seatId === lm.seat);
  if (!oldP || !newP) return [];
  const oldCell = lm.i !== null ? oldP.hand[lm.i] : null;
  const newCell = lm.i !== null ? newP.hand[lm.i] : null;
  const mine = lm.seat === mySeat; // the mover already saw their drawn card
  const toDiscard = oldCell && {
    from: cellSel(lm.seat, lm.i),
    to: '#discard-card .card',
    card: newV.discardTop,
    flip: !oldCell.faceUp,
  };
  switch (lm.a) {
    case 'drawDeck':
      return [{ from: '#deck-pile .card', to: '#drawn-card .card',
        card: newV.drawnCard, flip: !!newV.drawnCard }];
    case 'takeDiscard':
      return [
        { from: '#discard-card .card', to: cellSel(lm.seat, lm.i), card: newCell, flip: false },
        toDiscard,
      ];
    case 'swapDrawn':
      return [
        { from: '#drawn-card .card', to: cellSel(lm.seat, lm.i), card: newCell, flip: !mine },
        toDiscard,
      ];
    case 'discardDrawn':
      return [{ from: '#drawn-card .card', to: '#discard-card .card',
        card: newV.discardTop, flip: !mine }];
    default:
      return []; // setup flips animate in place
  }
}

// Was this card face-down in the previous view? Then animate the flip.
function flippedNow(seatId, i) {
  if (!prev || prev.phase === 'lobby') return false;
  const pp = prev.players.find((p) => p.seatId === seatId);
  return !!(pp && pp.hand[i] && !pp.hand[i].faceUp);
}

const handOf = (p, opts = {}) => gridEl(p.hand, {
  ...opts,
  animateAt: (i) => flippedNow(p.seatId, i),
  stagger,
});

// ===== the table =====

export function renderTable(ctx) {
  ({ view, prev, mySeat, stagger } = ctx);
  const me = myPlayer();
  const current = view.players[view.turnIndex];
  const myTurn = view.phase === 'play' && current?.seatId === mySeat;
  const iHold = view.drawnBy === mySeat;

  // --- opponents ---
  const opps = view.players.filter((p) => p.seatId !== mySeat);
  $('opponents').replaceChildren(...opps.map((p) => {
    const box = document.createElement('div');
    box.className = 'opp';
    box.dataset.seat = p.seatId;
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
    box.appendChild(handOf(p, { small: true }));
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

  // Keep the drawn slot in the layout for the whole play phase so the pile
  // row never reflows and card flights have a stable target.
  const showDrawnSlot = view.phase === 'play' || !!view.drawnBy;
  $('drawn-slot').hidden = !showDrawnSlot;
  if (showDrawnSlot) {
    // drawer sees the card; everyone else sees a back; empty slot otherwise
    $('drawn-card').replaceChildren(view.drawnBy
      ? cardEl(view.drawnCard ? { ...view.drawnCard, faceUp: true } : { faceUp: false })
      : cardEl(null));
  }
  const canFlip = me && me.hand.some((c) => !c.faceUp);
  $('drawn-actions').hidden = !iHold;
  $('btn-discard-flip').disabled = !canFlip;
  $('btn-discard-flip').hidden = inputMode === 'drawnFlip';
  $('btn-swap-drawn').hidden = inputMode !== 'drawnFlip';
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
    } else if (inputMode === 'swapForDiscard') {
      clickableIdx = idxWhere(me, () => true);
    } else if (iHold) {
      clickableIdx = inputMode === 'drawnFlip' ? idxWhere(me, (c) => !c.faceUp) : idxWhere(me, () => true);
    }
  }
  const myHeader = $('my-header');
  if (me) {
    myHeader.textContent = `${me.name} (you)`;
    const pts = document.createElement('span');
    pts.className = 'pts';
    pts.textContent = ` · ${me.total} pts`;
    myHeader.appendChild(pts);
    $('my-grid').replaceChildren(...handOf(me, { clickableIdx }).children);
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
    if (inputMode === 'drawnFlip') return `${final}Tap a face-down card to flip it`;
    return canFlip
      ? `${final}Tap a card to swap it in — or Discard & flip`
      : `${final}Tap a card to swap it in`;
  }
  if (inputMode === 'swapForDiscard') return `${final}Tap one of your cards to replace it`;
  return `${final}Your turn — tap the deck to draw, or the discard to take it`;
}

// ===== round-end body (the shell owns the title, scoreboard and buttons) =====

export function renderRoundEnd(ctx, body) {
  ({ view, mySeat } = ctx);
  const scores = view.roundScores || [];
  const best = Math.min(...scores.map((r) => r.score));
  const winnerSeats = new Set(scores.filter((r) => r.score === best).map((r) => r.seatId));
  const tied = winnerSeats.size > 1;

  body.replaceChildren(...view.players.map((p) => {
    const box = document.createElement('div');
    box.className = 're-hand';
    if (winnerSeats.has(p.seatId)) {
      box.classList.add('re-winner');
      const ribbon = document.createElement('div');
      ribbon.className = 're-ribbon';
      ribbon.textContent = tied ? '🏆 Tied' : '🏆 Winner';
      box.appendChild(ribbon);
    }
    const name = document.createElement('div');
    name.className = 're-name';
    name.textContent = p.name;
    box.appendChild(name);
    const grid = document.createElement('div');
    grid.className = 'grid';
    // Only mark cancelling columns when the house is actually playing that rule.
    const cancelled = new Set();
    if (view.settings?.pairsCancel !== false) {
      for (let c = 0; c < 3; c++) {
        if (p.hand[c]?.rank && p.hand[c].rank === p.hand[c + 3]?.rank) cancelled.add(c);
      }
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
    const rs = scores.find((r) => r.seatId === p.seatId);
    const sc = document.createElement('div');
    sc.className = 're-score';
    sc.textContent = rs ? `${rs.score >= 0 ? '+' : ''}${rs.score} this round` : '';
    box.appendChild(sc);
    return box;
  }));
}
