// modes/mahjong/score.js — faan patterns and what a hand pays.
// Pure. The common Hong Kong patterns only: no nine gates, no heavenly hand,
// none of the other limit rarities. Adding one later is a row in this table.
import {
  isHonor, isDragon, isSuited, suitOf, tileOfWind,
} from './tiles.js';
import { winningDecompositions } from './hand.js';

const isPungSet = (set) => set.length >= 3 && set[0] === set[1];
const isChowSet = (set) => set.length === 3 && set[0] !== set[1];

// Every set in the hand, exposed and concealed, plus the pair — enough for any
// pattern below to be a one-line test.
function shape(dec, melds) {
  const sets = [...melds.map((m) => m.tiles), ...dec.sets];
  const all = sets.flat();
  if (dec.pair !== null) all.push(dec.pair, dec.pair);
  return { sets, all };
}

// Each entry returns the faan it is worth, or 0 for "doesn't apply". Written
// as a table so the list of what this engine knows is readable in one place.
const PATTERNS = [
  {
    key: 'thirteenOrphans',
    label: 'Thirteen orphans',
    test: (c) => (c.dec.special === 'thirteenOrphans' ? 13 : 0),
  },
  {
    key: 'allHonors',
    label: 'All honours',
    test: (c) => (c.tiles.length && c.tiles.every(isHonor) ? 10 : 0),
  },
  {
    key: 'allOneSuit',
    label: 'All one suit',
    test: (c) => {
      if (!c.tiles.length || !c.tiles.every(isSuited)) return 0;
      return new Set(c.tiles.map(suitOf)).size === 1 ? 7 : 0;
    },
  },
  {
    key: 'sevenPairs',
    label: 'Seven pairs',
    test: (c) => (c.dec.special === 'sevenPairs' ? 4 : 0),
  },
  {
    key: 'mixedOneSuit',
    label: 'Mixed one suit',
    test: (c) => {
      const suited = c.tiles.filter(isSuited);
      const honors = c.tiles.filter(isHonor);
      if (!suited.length || !honors.length) return 0;
      if (suited.length + honors.length !== c.tiles.length) return 0;
      return new Set(suited.map(suitOf)).size === 1 ? 3 : 0;
    },
  },
  {
    key: 'allPungs',
    label: 'All pungs',
    test: (c) => (c.sets.length === 4 && c.sets.every(isPungSet) ? 3 : 0),
  },
  {
    key: 'allChows',
    label: 'All chows',
    test: (c) => (c.sets.length === 4 && c.sets.every(isChowSet) ? 1 : 0),
  },
  {
    key: 'dragonPungs',
    label: 'Dragon pung',
    each: true,
    test: (c) => c.sets.filter((s) => isPungSet(s) && isDragon(s[0])).length,
  },
  {
    key: 'seatWind',
    label: 'Seat wind pung',
    test: (c) => (c.sets.some((s) => isPungSet(s) && s[0] === tileOfWind(c.seatWind)) ? 1 : 0),
  },
  {
    key: 'prevailingWind',
    label: 'Prevailing wind pung',
    test: (c) => (c.sets.some((s) => isPungSet(s) && s[0] === tileOfWind(c.prevailingWind)) ? 1 : 0),
  },
  {
    key: 'concealed',
    label: 'Fully concealed',
    // Nothing claimed off the table all hand — worth a faan only on a
    // discard, since self-draw already has its own.
    test: (c) => (c.melds.length === 0 && !c.selfDraw ? 1 : 0),
  },
  {
    key: 'selfDraw',
    label: 'Self-draw',
    test: (c) => (c.selfDraw ? 1 : 0),
  },
  {
    key: 'flowers',
    label: 'Flower',
    each: true,
    test: (c) => c.flowers.length,
  },
];

// The classic Hong Kong table: doubles every second faan, and flattens into
// the limit at the top. Data rather than arithmetic because the real table
// isn't a clean power of two.
const HK_POINTS = [1, 2, 4, 8, 16, 24, 32, 48, 64, 96, 128, 192, 256, 384];

export function pointsFor(faan, settings = {}) {
  const limit = settings.limitFaan ?? 13;
  const f = Math.max(0, Math.min(faan, limit));
  if (settings.scoring === 'faan') return f; // plain faan-as-points
  return HK_POINTS[Math.min(f, HK_POINTS.length - 1)];
}

// Score one reading of the hand. `test` returns faan directly, so an
// "each" pattern like dragon pungs just returns how many it found.
function scoreOne(dec, ctx) {
  const { sets, all } = shape(dec, ctx.melds);
  // Seven pairs and thirteen orphans have no set structure, so patterns that
  // look at suits read the raw tiles instead.
  const tiles = dec.special ? [...ctx.concealed, ...ctx.melds.flatMap((m) => m.tiles)] : all;
  const c = { ...ctx, dec, sets, tiles };
  const patterns = [];
  let faan = 0;
  for (const p of PATTERNS) {
    const n = p.test(c);
    if (!n) continue;
    faan += n;
    patterns.push({ key: p.key, label: p.label, faan: n, times: p.each ? n : 1 });
  }
  return { faan, patterns, dec };
}

// The hand's value: the best-scoring reading of it. Returns null when the
// tiles aren't a winning hand at all.
export function scoreHand(ctx) {
  const decs = winningDecompositions(ctx.concealed, ctx.melds.length, ctx.settings || {});
  if (!decs.length) return null;
  let best = null;
  for (const dec of decs) {
    const s = scoreOne(dec, ctx);
    if (!best || s.faan > best.faan) best = s;
  }
  best.points = pointsFor(best.faan, ctx.settings || {});
  return best;
}
