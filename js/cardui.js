// cardui.js — DOM for a playing card. No rules, no network, no game knowledge:
// hand it a {rank, suit, faceUp} and it hands back an element.

export const SUIT_GLYPHS = { s: '♠', h: '♥', d: '♦', c: '♣' };
const RED_SUITS = new Set(['h', 'd']);

// A mass reveal (everyone's hand at round end) reads better as a cascade than
// as one simultaneous flip. Each paint makes a fresh stagger; newStagger(false)
// yields no delay at all, so the common case costs nothing.
export function newStagger(on) {
  let n = 0;
  return () => (on ? n++ * 90 : 0);
}

export function cardEl(card, { animate = false, i = null, stagger = null } = {}) {
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
    if (animate) {
      const go = () => {
        inner.classList.add('up');
        el.classList.add('flipping');
        setTimeout(() => el.classList.remove('flipping'), 600);
      };
      const delay = stagger ? stagger() : 0;
      if (delay) setTimeout(go, delay);
      else requestAnimationFrame(() => requestAnimationFrame(go));
    } else {
      inner.classList.add('up');
    }
  }
  return el;
}

// A block of cards. animateAt(i) decides whether card i is newly revealed and
// should flip rather than simply appear face up.
export function gridEl(cards, {
  clickableIdx = null, small = false, animateAt = () => false, stagger = null,
} = {}) {
  const grid = document.createElement('div');
  grid.className = 'grid' + (small ? '' : ' mine');
  cards.forEach((c, i) => {
    const el = cardEl(c, { i, animate: !!(c.faceUp && animateAt(i)), stagger });
    if (clickableIdx && clickableIdx.has(i)) el.classList.add('clickable');
    grid.appendChild(el);
  });
  return grid;
}
