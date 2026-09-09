// testkit.js — test harness only, zero game knowledge. Shared by every mode's
// test file so results all have the same {name, pass, detail} shape.

// Deterministic LCG so tests are reproducible.
export function makeRng(seed = 42) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

// suite() returns the two functions a test file needs plus the results array
// it fills in. A throw inside test() is the failure message.
export function suite() {
  const results = [];
  const test = (name, fn) => {
    try {
      fn();
      results.push({ name, pass: true, detail: '' });
    } catch (e) {
      results.push({ name, pass: false, detail: e.message });
    }
  };
  const eq = (got, want, label = '') => {
    if (got !== want) throw new Error(`${label} expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  };
  return { results, test, eq };
}
