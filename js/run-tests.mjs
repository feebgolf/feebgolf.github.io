// Node runner for the same tests test.html runs in the browser.
// `node js/run-tests.mjs` runs every mode; `node js/run-tests.mjs golf` filters.
import { runTests } from './tests.js';
const results = await runTests(process.argv[2] || null);
let failed = 0;
for (const r of results) {
  if (r.pass) console.log(`  ok  ${r.name}`);
  else { failed++; console.log(`FAIL  ${r.name} — ${r.detail}`); }
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
