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
    engine: () => import('./golf/engine.js'),
    tests: () => import('./golf/tests.js'),
  },
};

export const DEFAULT_MODE = 'golf';

export const isMode = (id) => Object.prototype.hasOwnProperty.call(MODES, id);

// Never throws: an unknown id (stale link, tampered message) falls back.
export const modeOf = (id) => MODES[isMode(id) ? id : DEFAULT_MODE];
