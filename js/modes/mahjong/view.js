// modes/mahjong/view.js — the mahjong table: DOM rendering and input capture.
// No rules, no network.
//
// Tiles are drawn as a number over a suit mark (5 萬) rather than from the
// Unicode Mahjong block. Those code points are lovely but half of them default
// to emoji presentation, so a hand ends up a mix of flat glyphs and big
// coloured images depending on the platform's font. The composed face renders
// the same everywhere; the Unicode glyph rides along in the tooltip.
import {
  tileFace, glyph, tileName, suitOf, isHonor, isBonus, isDragon,
  WIND_NAMES, countsOf,
} from './tiles.js';

export const MODE_ID = 'mahjong';

const $ = (id) => document.getElementById(id);

let H = {};
let view = null;
let mySeat = null;
let listeners = [];
let ticker = null;

function on(id, ev, fn) {
  const el = $(id);
  if (!el) return;
  el.addEventListener(ev, fn);
  listeners.push([el, ev, fn]);
}

export function mount(root, handlers) {
  H = handlers;
  root.replaceChildren($('tpl-table-mahjong').content.cloneNode(true));
  root.className = MODE_ID;

  on('mj-wall', 'click', () => {
    if (!canDraw()) return;
    H.dispatch({ a: 'draw' });
  });
  on('mj-hand', 'click', (e) => {
    const cell = e.target.closest('[data-t]');
    if (!cell || !cell.classList.contains('clickable')) return;
    H.dispatch({ a: 'discard', tile: Number(cell.dataset.t) });
  });

  // A claim window counts down, so repaint while one is open. Cheap, and it
  // stops the moment the window closes.
  ticker = setInterval(() => {
    if (view && view.phase === 'claim') H.repaint();
  }, 250);
}

export function unmount() {
  for (const [el, ev, fn] of listeners) el.removeEventListener(ev, fn);
  listeners = [];
  clearInterval(ticker);
  ticker = null;
  view = null;
}

export function resetInput() {}

const me = () => view.players.find((p) => p.seatId === mySeat) || null;
const myTurn = () => view.phase === 'play' && view.players[view.turnIndex]?.seatId === mySeat;
const iHold = () => !!me()?.holding;
const canDraw = () => myTurn() && !iHold() && view.wallCount > 0;

// ===== tiles =====

function tileEl(t, { faceDown = false, small = false } = {}) {
  const el = document.createElement('div');
  el.className = 'mj-tile' + (small ? ' small' : '') + (faceDown ? ' back' : '');
  if (faceDown) return el;
  el.dataset.t = t;
  el.title = `${glyph(t)} ${tileName(t)}`;
  const face = tileFace(t);
  const top = document.createElement('span');
  top.className = 'mj-top';
  top.textContent = face.top;
  el.appendChild(top);
  if (face.bottom) {
    const bot = document.createElement('span');
    bot.className = 'mj-bot';
    bot.textContent = face.bottom;
    el.appendChild(bot);
  }
  if (isBonus(t)) el.classList.add('mj-bonus');
  else if (isDragon(t)) el.classList.add('mj-dragon');
  else if (isHonor(t)) el.classList.add('mj-wind');
  else el.classList.add('mj-suit-' + suitOf(t));
  return el;
}

function tileRow(tiles, opts = {}) {
  const row = document.createElement('div');
  row.className = 'mj-row' + (opts.cls ? ' ' + opts.cls : '');
  for (const t of tiles) row.appendChild(tileEl(t, opts));
  return row;
}

function meldsEl(melds, opts = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'mj-melds';
  for (const m of melds) {
    const g = document.createElement('div');
    g.className = 'mj-meld' + (m.type === 'ckong' ? ' concealed' : '');
    for (const t of m.tiles) g.appendChild(tileEl(t, opts));
    wrap.appendChild(g);
  }
  return wrap;
}

// ===== card flights =====
// Tiles aren't playing cards, so the flight layer is handed a factory.

const makeTile = (t) => {
  const el = tileEl(t === null || t === undefined ? 0 : t);
  if (t === null || t === undefined) el.className = 'mj-tile back';
  return el;
};

export function planMoves(oldV, newV, seat) {
  mySeat = seat;
  const lm = newV.lastMove;
  const mine = lm.seat === mySeat;
  switch (lm.a) {
    case 'discard':
      return [{
        from: mine ? `#mj-hand [data-t="${lm.tile}"]` : `.mj-opp[data-seat="${lm.seat}"]`,
        to: '#mj-discard-tile .mj-tile',
        card: lm.tile,
        make: makeTile,
        flip: false,
      }];
    case 'claim':
      return [{
        from: '#mj-discard-tile .mj-tile',
        to: mine ? '#mj-my-melds .mj-tile' : `.mj-opp[data-seat="${lm.seat}"]`,
        card: lm.tile,
        make: makeTile,
        flip: false,
      }];
    default:
      return []; // draws are private; kongs happen in place
  }
}

// ===== the table =====

export function renderTable(ctx) {
  ({ view, mySeat } = ctx);
  const current = view.players[view.turnIndex];

  // --- opponents, each with their melds, flowers and pond ---
  const order = [];
  const n = view.players.length;
  const myIndex = view.players.findIndex((p) => p.seatId === mySeat);
  for (let k = 1; k < n; k++) order.push(view.players[(myIndex + k) % n]);

  $('mj-opponents').replaceChildren(...order.map((p) => {
    const box = document.createElement('div');
    box.className = 'mj-opp';
    box.dataset.seat = p.seatId;
    if (view.phase !== 'roundEnd' && current?.seatId === p.seatId) box.classList.add('active-player');
    if (!p.connected) box.classList.add('disconnected');

    const head = document.createElement('div');
    head.className = 'mj-opp-head';
    const wind = document.createElement('span');
    wind.className = 'mj-wind-tag';
    wind.textContent = WIND_NAMES[p.wind][0];
    wind.title = `${WIND_NAMES[p.wind]} seat`;
    const name = document.createElement('span');
    name.className = 'mj-opp-name';
    name.textContent = p.name;
    const cnt = document.createElement('span');
    cnt.className = 'mj-opp-cards';
    cnt.textContent = `🀫${p.handCount}`;
    const pts = document.createElement('span');
    pts.className = 'pts';
    pts.textContent = p.total;
    head.append(wind, name, cnt, pts);
    if (view.phase === 'claim' && view.claimAnswered.includes(p.seatId)) {
      const a = document.createElement('span');
      a.className = 'mj-answered';
      a.textContent = '✓';
      a.title = 'has answered';
      head.appendChild(a);
    }
    if (!p.connected) {
      const d = document.createElement('span');
      d.className = 'disc-tag';
      d.textContent = '⚠';
      head.appendChild(d);
    }
    box.appendChild(head);
    if (p.melds.length) box.appendChild(meldsEl(p.melds, { small: true }));
    if (p.flowers.length) box.appendChild(tileRow(p.flowers, { small: true, cls: 'mj-flowers' }));
    if (p.discards.length) box.appendChild(tileRow(p.discards, { small: true, cls: 'mj-pond' }));
    return box;
  }));

  // --- wall and the tile on the table ---
  const wall = $('mj-wall');
  wall.querySelector('.deck-count').textContent = view.wallCount;
  wall.querySelector('.card').classList.toggle('clickable', canDraw());
  const disc = $('mj-discard-tile');
  disc.replaceChildren(view.lastDiscard ? tileEl(view.lastDiscard.tile) : emptySlot());

  // --- the claim window ---
  renderClaims();

  // --- my area ---
  const mine = me();
  const myHeader = $('my-header');
  if (mine) {
    myHeader.replaceChildren();
    const wind = document.createElement('span');
    wind.className = 'mj-wind-tag';
    wind.textContent = WIND_NAMES[mine.wind][0];
    wind.title = `${WIND_NAMES[mine.wind]} seat`;
    myHeader.append(wind, document.createTextNode(` ${mine.name} (you) · ${mine.total} pts`));
    if (view.dealerIndex === view.players.indexOf(mine)) {
      const d = document.createElement('span');
      d.className = 'mj-dealer-tag';
      d.textContent = 'dealer';
      myHeader.appendChild(d);
    }
  }

  const meldBox = $('mj-my-melds');
  meldBox.replaceChildren();
  if (mine?.melds.length) meldBox.appendChild(meldsEl(mine.melds));
  if (mine?.flowers.length) meldBox.appendChild(tileRow(mine.flowers, { small: true, cls: 'mj-flowers' }));

  const hand = $('mj-hand');
  hand.replaceChildren(...(view.myHand || []).map((t) => {
    const el = tileEl(t);
    // Tapping means "throw this", which only makes sense while holding.
    if (iHold() && myTurn()) el.classList.add('clickable');
    if (t === view.myJustDrew) el.classList.add('just-drew');
    return el;
  }));

  renderActions();
  $('log').replaceChildren(...(view.log || []).slice(-1).map((line) => {
    const d = document.createElement('div');
    d.textContent = line;
    return d;
  }));
  $('my-area').classList.toggle('active-me', myTurn());
  $('status-bar').textContent = statusText(current);
  $('status-bar').classList.toggle('my-turn', myTurn() || claimIsMine());
}

function emptySlot() {
  const el = document.createElement('div');
  el.className = 'mj-tile empty';
  return el;
}

const claimIsMine = () => view.phase === 'claim' && !view.myClaim
  && !!view.myClaimOptions
  && (view.myClaimOptions.pung || view.myClaimOptions.kong
    || view.myClaimOptions.chows.length > 0 || view.myClaimOptions.mahjong);

function secondsLeft() {
  if (view.claimDeadline === null) return 0;
  const span = (view.settings?.claimSeconds ?? 8) * 1000;
  // The deadline is on the host's clock, so clamp it into range rather than
  // trusting the difference between two machines' idea of now.
  return Math.ceil(Math.max(0, Math.min(view.claimDeadline - Date.now(), span)) / 1000);
}

function renderClaims() {
  const box = $('mj-claims');
  if (!claimIsMine()) { box.hidden = true; box.replaceChildren(); return; }
  box.hidden = false;
  const o = view.myClaimOptions;
  const tile = view.lastDiscard.tile;
  const kids = [];

  const label = document.createElement('span');
  label.className = 'mj-claim-label';
  label.textContent = `${tileName(tile)} — ${secondsLeft()}s`;
  kids.push(label);

  const btn = (text, act, primary = false) => {
    const b = document.createElement('button');
    b.className = 'btn small' + (primary ? ' primary' : '');
    b.textContent = text;
    b.addEventListener('click', () => H.dispatch(act));
    return b;
  };
  if (o.mahjong) kids.push(btn(`Mahjong (${o.faan} faan)`, { a: 'claim', type: 'mahjong' }, true));
  if (o.kong) kids.push(btn('Kong', { a: 'claim', type: 'kong' }));
  if (o.pung) kids.push(btn('Pung', { a: 'claim', type: 'pung' }));
  for (const ch of o.chows) {
    kids.push(btn(`Chow ${ch.map((t) => tileFace(t).top).join('')}`, { a: 'claim', type: 'chow', tiles: ch }));
  }
  kids.push(btn('Pass', { a: 'pass' }));
  box.replaceChildren(...kids);
}

// Mahjong, and the two kongs you can declare from your own hand.
function renderActions() {
  const box = $('mj-actions');
  box.replaceChildren();
  if (!myTurn() || !iHold()) return;
  const mine = me();
  const counts = countsOf(view.myHand || []);
  const add = (text, act, primary = false) => {
    const b = document.createElement('button');
    b.className = 'btn small' + (primary ? ' primary' : '');
    b.textContent = text;
    b.addEventListener('click', () => H.dispatch(act));
    box.appendChild(b);
  };
  if (view.myCanWin) add('Mahjong', { a: 'mahjong' }, true);
  counts.forEach((n, t) => {
    if (n === 4) add(`Kong ${tileFace(t).top}${tileFace(t).bottom}`, { a: 'kongConcealed', tile: t });
  });
  for (const m of mine.melds) {
    if (m.type === 'pung' && counts[m.tiles[0]] > 0) {
      const t = m.tiles[0];
      add(`Kong ${tileFace(t).top}${tileFace(t).bottom}`, { a: 'kongPromote', tile: t });
    }
  }
}

function statusText(current) {
  if (view.phase === 'roundEnd') return 'Hand over';
  if (view.phase === 'claim') {
    if (claimIsMine()) return `Claim ${tileName(view.lastDiscard.tile)}, or pass — ${secondsLeft()}s`;
    if (view.myClaim) return 'Waiting for the other players to answer…';
    return 'Someone is deciding whether to claim that tile…';
  }
  if (!myTurn()) return current ? `${current.name}'s turn…` : '';
  if (iHold()) return 'Tap a tile to discard it';
  return 'Your turn — take a tile from the wall';
}

// ===== round-end body =====

export function renderRoundEnd(ctx, body) {
  ({ view, mySeat } = ctx);
  const rev = view.reveal;
  if (!rev) { body.replaceChildren(); return; }

  const kids = [];
  const head = document.createElement('div');
  head.className = 'mj-result';
  if (rev.drawn) {
    head.textContent = 'Washed out — the wall ran dry';
  } else {
    const w = rev.rows.find((r) => r.seatId === rev.winner);
    const how = rev.selfDraw ? 'self-drew' : 'won on a discard';
    head.textContent = `${w.name} ${how} — ${rev.faan} faan, ${rev.points} a head`;
    const pats = document.createElement('div');
    pats.className = 'mj-patterns';
    pats.textContent = rev.patterns
      .map((p) => (p.times > 1 ? `${p.label} ×${p.times}` : p.label))
      .join(' · ');
    head.appendChild(pats);
  }
  kids.push(head);

  for (const r of rev.rows) {
    const box = document.createElement('div');
    box.className = 're-hand mj-re';
    if (r.seatId === rev.winner) {
      box.classList.add('re-winner');
      const ribbon = document.createElement('div');
      ribbon.className = 're-ribbon';
      ribbon.textContent = '🏆 Mahjong';
      box.appendChild(ribbon);
    }
    const name = document.createElement('div');
    name.className = 're-name';
    name.textContent = `${WIND_NAMES[r.wind][0]} ${r.name}${r.seatId === mySeat ? ' (you)' : ''}`;
    box.appendChild(name);
    if (r.melds.length) box.appendChild(meldsEl(r.melds, { small: true }));
    box.appendChild(tileRow(r.hand, { small: true }));
    if (r.flowers.length) box.appendChild(tileRow(r.flowers, { small: true, cls: 'mj-flowers' }));
    const sc = document.createElement('div');
    sc.className = 're-score';
    sc.textContent = `${r.score >= 0 ? '+' : ''}${r.score}`;
    box.appendChild(sc);
    kids.push(box);
  }
  body.replaceChildren(...kids);
}
