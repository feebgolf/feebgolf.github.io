// fx.js — FLIP-style card flights. Knows nothing about any game: a mode hands
// over {from, to, card, flip} selector pairs and fx measures, clones, animates
// and cleans up after itself.
import { cardEl } from './cardui.js';

export const REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)').matches;
const FLY_MS = 450;
let active = []; // settle callbacks for in-flight clones

// Cheap, mode-independent reasons to skip animating a transition entirely.
// Hoisting these means a mode's planMoves() starts from "there IS a new move,
// what flies?" and structurally cannot forget them.
export function shouldAnimate(oldV, newV) {
  if (REDUCED_MOTION || !oldV || !newV) return false;
  if (!newV.lastMove || newV.lastMove.seq === oldV.lastMove?.seq) return false;
  if (oldV.phase === 'lobby' || newV.phase === 'lobby') return false;
  return newV.roundNumber === oldV.roundNumber; // a fresh deal is not a move
}

export function rectOf(sel) {
  const el = document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width ? r : null;
}

// Measure origins against the CURRENT DOM, before the repaint tears it down.
export function capture(moves) {
  return moves
    .filter(Boolean)
    .map((m) => ({ ...m, fromRect: rectOf(m.from) }))
    .filter((m) => m.fromRect);
}

export function launch(moves) {
  for (const m of moves) {
    const destEl = document.querySelector(m.to);
    if (!destEl) continue;
    const dr = destEl.getBoundingClientRect();
    if (!dr.width) continue;
    const or = m.fromRect;
    // Modes that don't deal in playing cards (mahjong tiles) supply `make`.
    const clone = m.make
      ? m.make(m.card)
      : cardEl(m.card ? { ...m.card, faceUp: true } : { faceUp: false });
    clone.classList.add('fx-card');
    clone.style.width = or.width + 'px';
    clone.style.left = or.left + 'px';
    clone.style.top = or.top + 'px';
    const inner = clone.querySelector('.card-inner');
    if (m.flip && inner) inner.classList.remove('up'); // start face-down, flip mid-air
    document.body.appendChild(clone);
    destEl.style.visibility = 'hidden';

    const dx = dr.left - or.left;
    const dy = dr.top - or.top;
    const s = dr.width / or.width;
    const midS = ((1 + s) / 2) * 1.08;
    const anim = clone.animate([
      { transform: 'translate(0, 0) scale(1)' },
      { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 22}px) scale(${midS})`, offset: 0.5 },
      { transform: `translate(${dx}px, ${dy}px) scale(${s})` },
    ], { duration: FLY_MS, easing: 'cubic-bezier(.3, .6, .3, 1)', fill: 'forwards' });
    if (m.flip && inner) setTimeout(() => inner.classList.add('up'), 90);

    let done = false;
    const settleOne = () => {
      if (done) return;
      done = true;
      clone.remove();
      destEl.style.visibility = '';
      active = active.filter((f) => f !== settleOne);
    };
    active.push(settleOne);
    anim.onfinish = settleOne;
    setTimeout(settleOne, FLY_MS + 80); // onfinish can be unreliable; guarantee cleanup
  }
}

export function settle() {
  for (const f of active) f();
  active = [];
}
