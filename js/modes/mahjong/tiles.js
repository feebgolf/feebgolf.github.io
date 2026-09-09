// modes/mahjong/tiles.js — tile identity and index maths. No DOM, no rules.
//
// A tile is a plain integer. Unlike playing cards from a multi-deck shoe,
// mahjong tiles of the same kind are completely interchangeable, so no
// per-tile identity is needed — and integer indices make the counts[34] array
// that win detection runs on trivial.
//
//    0– 8  characters 1–9      27–30  winds E S W N
//    9–17  bamboo 1–9          31–33  dragons red green white
//   18–26  dots 1–9            34–41  flowers and seasons (bonus tiles)

export const KINDS = 34;          // distinct tiles that make up a hand
export const BONUS_FIRST = 34;
export const BONUS_LAST = 41;
export const SUIT_NAMES = ['characters', 'bamboo', 'dots'];
export const WIND_NAMES = ['East', 'South', 'West', 'North'];
export const DRAGON_NAMES = ['Red dragon', 'Green dragon', 'White dragon'];

export const isSuited = (t) => t >= 0 && t < 27;
export const isHonor = (t) => t >= 27 && t < 34;
export const isWind = (t) => t >= 27 && t < 31;
export const isDragon = (t) => t >= 31 && t < 34;
export const isBonus = (t) => t >= BONUS_FIRST && t <= BONUS_LAST;

// Suit 0/1/2 for suited tiles, -1 for honours.
export const suitOf = (t) => (isSuited(t) ? Math.floor(t / 9) : -1);
// 1–9 for suited tiles, 0 for honours.
export const numOf = (t) => (isSuited(t) ? (t % 9) + 1 : 0);
export const tileOfWind = (w) => 27 + w;

export const isTerminal = (t) => isSuited(t) && (numOf(t) === 1 || numOf(t) === 9);
// A chow can start here only if the next two tiles are in the same suit.
export const canStartChow = (t) => isSuited(t) && numOf(t) <= 7;

export const THIRTEEN_ORPHANS = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];

// The Unicode Mahjong Tiles block, U+1F000 onwards. Several of these default
// to emoji presentation, which renders them as large coloured images next to
// the flat ones; U+FE0E asks for the text form so a hand looks uniform. The
// view pairs the glyph with a label, so a platform that ignores the request
// still reads correctly.
const GLYPH_BASE = { wind: 0x1F000, dragon: 0x1F004, chars: 0x1F007, bamboo: 0x1F010, dots: 0x1F019, bonus: 0x1F022 };
const TEXT_STYLE = '︎';

export function glyph(t) {
  let cp;
  if (isBonus(t)) cp = GLYPH_BASE.bonus + (t - BONUS_FIRST);
  else if (isDragon(t)) cp = GLYPH_BASE.dragon + (t - 31);
  else if (isWind(t)) cp = GLYPH_BASE.wind + (t - 27);
  else cp = [GLYPH_BASE.chars, GLYPH_BASE.bamboo, GLYPH_BASE.dots][suitOf(t)] + (numOf(t) - 1);
  return String.fromCodePoint(cp) + TEXT_STYLE;
}

const BONUS_NAMES = ['Plum', 'Orchid', 'Bamboo', 'Chrysanthemum', 'Spring', 'Summer', 'Autumn', 'Winter'];

export function tileName(t) {
  if (isBonus(t)) return BONUS_NAMES[t - BONUS_FIRST];
  if (isDragon(t)) return DRAGON_NAMES[t - 31];
  if (isWind(t)) return WIND_NAMES[t - 27];
  return `${numOf(t)} ${SUIT_NAMES[suitOf(t)]}`;
}

// Short label for a tile face: "5" over a suit mark, or a single honour mark.
export const HONOR_MARKS = ['東', '南', '西', '北', '中', '發', '白'];
export const SUIT_MARKS = ['萬', '條', '筒'];
// The marks a real set carries. Initials won't do: Spring and Summer would
// both come out "S", so two different tiles would wear the same face.
export const BONUS_MARKS = ['梅', '蘭', '竹', '菊', '春', '夏', '秋', '冬'];
export function tileFace(t) {
  if (isBonus(t)) return { top: BONUS_MARKS[t - BONUS_FIRST], bottom: '' };
  if (isHonor(t)) return { top: HONOR_MARKS[t - 27], bottom: '' };
  return { top: String(numOf(t)), bottom: SUIT_MARKS[suitOf(t)] };
}

// Four of every ordinary tile; one of each bonus tile if they're in play.
export function buildWall(includeFlowers = true) {
  const wall = [];
  for (let t = 0; t < KINDS; t++) for (let n = 0; n < 4; n++) wall.push(t);
  if (includeFlowers) for (let t = BONUS_FIRST; t <= BONUS_LAST; t++) wall.push(t);
  return wall;
}

export const wallSize = (includeFlowers = true) => KINDS * 4 + (includeFlowers ? 8 : 0);

export const sortTiles = (tiles) => [...tiles].sort((a, b) => a - b);

export function countsOf(tiles) {
  const c = new Array(KINDS).fill(0);
  for (const t of tiles) if (t < KINDS) c[t]++;
  return c;
}
