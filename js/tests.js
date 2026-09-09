// tests.js — aggregate runner. Walks the registry, runs the shared contract
// tests plus each mode's own suite, and prefixes names with the mode id.
// Run via test.html in a browser or `node js/run-tests.mjs [mode]`.
import { MODES } from './modes/registry.js';
import { runContractTests } from './modes/contract-tests.js';

export async function runTests(only = null) {
  const out = [];
  for (const m of Object.values(MODES)) {
    if (only && m.id !== only) continue;
    const engine = await m.engine();
    for (const r of runContractTests(m, engine)) {
      out.push({ ...r, name: `[${m.id}] contract: ${r.name}` });
    }
    const { runTests: run } = await m.tests();
    for (const r of run()) out.push({ ...r, name: `[${m.id}] ${r.name}` });
  }
  return out;
}
