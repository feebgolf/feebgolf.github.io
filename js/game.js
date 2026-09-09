// game.js — compatibility shim. The golf rules now live in modes/golf/engine.js;
// this re-export keeps main.js and tests.js working until they are retargeted.
export * from './modes/golf/engine.js';
