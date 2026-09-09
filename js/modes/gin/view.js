// modes/gin/view.js — NOT YET IMPLEMENTED. Enough of the view contract to
// mount without errors if the mode is ever reached (it isn't offered in the
// menu until the engine lands).
export const MODE_ID = 'gin';

export function mount(root) {
  root.className = MODE_ID;
  const note = document.createElement('p');
  note.className = 'muted';
  note.textContent = 'This game isn\u2019t playable yet.';
  root.replaceChildren(note);
}

export function unmount() {}
export function renderTable() {}
export function renderRoundEnd(ctx, body) { body.replaceChildren(); }
export function planMoves() { return []; }
export function resetInput() {}
