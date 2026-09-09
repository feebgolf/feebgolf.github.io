// registry.js — the catalogue of game modes: the only place that knows which
// games exist. Imports nothing, so ui.js and main.js can both depend on it.
//
// Metadata is STATIC because the menu, the lobby and handleHello all need a
// mode's player limits before any rules code has been fetched. The modules
// themselves are lazy thunks, so a golf player never downloads mahjong.

export const MODES = {
  golf: {
    id: 'golf',
    label: 'Golf',
    blurb: 'the six-card game',
    minPlayers: 2,
    maxPlayers: 4,
    lowWins: true, // lowest running total wins — drives the shared scoreboard
    playable: true,
    engine: () => import('./golf/engine.js'),
    view: () => import('./golf/view.js'),
    tests: () => import('./golf/tests.js'),
  },
  gin: {
    id: 'gin',
    label: 'Gin Rummy',
    blurb: 'knock and lay off · 2–8 players',
    minPlayers: 2,
    maxPlayers: 8,
    lowWins: false,
    playable: false, // engine still to come; hidden from the menu picker
    engine: () => import('./gin/engine.js'),
    view: () => import('./gin/view.js'),
    tests: () => import('./gin/tests.js'),
  },
  mahjong: {
    id: 'mahjong',
    label: 'Mahjong',
    blurb: 'Hong Kong style · 4 players',
    minPlayers: 4,
    maxPlayers: 4,
    lowWins: false,
    playable: false,
    engine: () => import('./mahjong/engine.js'),
    view: () => import('./mahjong/view.js'),
    tests: () => import('./mahjong/tests.js'),
  },
};

export const DEFAULT_MODE = 'golf';

// What the menu offers. A mode is registered (so its engine is contract-tested
// and its plumbing exercised) before it is playable.
export const playableModes = () => Object.values(MODES).filter((m) => m.playable);

export const isMode = (id) => Object.prototype.hasOwnProperty.call(MODES, id);

// Never throws: an unknown id (stale link, tampered message) falls back.
export const modeOf = (id) => MODES[isMode(id) ? id : DEFAULT_MODE];
