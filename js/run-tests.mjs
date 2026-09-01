// Node runner for the same tests test.html runs in the browser.
import { runTests } from './tests.js';
const results = runTests();
let failed = 0;
for (const r of results) {
  if (r.pass) console.log(`  ok  ${r.name}`);
  else { failed++; console.log(`FAIL  ${r.name} — ${r.detail}`); }
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
