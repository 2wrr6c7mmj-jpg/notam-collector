// Reads latitude/longitude pairs out of the text layer of Taiwanese firing
// notices. The notices write angles in many ways (° ゜ 度, ′ ＇ ´ 分, ″ 〞 秒,
// hemisphere before or after, latitude first or longitude first, a pair split
// over two lines), so the text is reduced to a stream of angle tokens first and
// the tokens are paired afterwards.

const ENTITIES = {
  '&apos;': "'",
  '&quot;': '"',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&nbsp;': ' ',
};

const DEGREE_SIGN_LEFT_OUT =
  /(?<![\d.°])(2\d|1[0-2]\d) ([0-5]\d) ?'? ?([0-5]\d) ?['"]? ?(?=[NE](?![A-Za-z]| ?[:：]))/g;

// Must run before NFKC: NFKC turns ´ into a space plus a combining accent.
export function normalizeNoticeText(raw) {
  return (
    raw
      .replace(/&(?:apos|quot|amp|lt|gt|nbsp);/g, entity => ENTITIES[entity])
      .replace(/[´`‘’′ʹ＇]/g, "'")
      .replace(/[“”″〞〃＂]|''/g, '"')
      .replace(/[゜º˚∘]/g, '°')
      .normalize('NFKC')
      .replace(/[ \t　]+/g, ' ')
      // The text layer sometimes splits a number: "Long. 12 0°53'00"" is
      // 120°53'00", "N 2 5°09'01"" is 25°09'01", "24°2 1'07"" is 24°21'07".
      .replace(/(?<!\d)(?<!\d\.)(1[0-2]) (\d) ?°/g, '$1$2°')
      .replace(/(?<!\d)(?<!\d\.)(2) (\d)°/g, '$1$2°')
      .replace(/([°度]) ?(\d) (\d) ?(['分])/g, '$1$2$3$4')
      .replace(/(['分]) ?(\d) (\d) ?(["秒])/g, '$1$2$3$4')
      // A form typed without the degree sign: "119 25'29'E", "119 45 29 E".
      // Only next to the hemisphere letter, which is what marks the number as
      // an angle.
      .replace(DEGREE_SIGN_LEFT_OUT, `$1°$2'$3"`)
  );
}

const NUMBER = String.raw`\d{1,3}(?:\.\d+)?`;
// Degrees and minutes, optionally seconds, optionally a hemisphere letter on
// the same line. A letter followed by a colon is the label of the next point.
const ANGLE = new RegExp(
  String.raw`(${NUMBER}) ?(?:°|度) ?(?:(${NUMBER}) ?(?:'|分) ?(?:(${NUMBER}) ?(?:"|秒)?)?)?` +
    String.raw`(?: ?\.? ?[NE](?![A-Za-z]| ?[:：]))?`,
  'g',
);

// The air force, the test ranges and some coast guard units run the digits
// together: "224200N 1214200E" is 22°42'00"N 121°42'00"E. Six digits and N,
// seven digits and E; the letter is what tells such a number from any other.
const COMPACT = /(?<![\d.])(\d{2,3})([0-5]\d)([0-5]\d(?:\.\d+)?) ?([NE])(?![A-Za-z]| ?[:：])/g;

// Every angle in the text, in reading order. `value` is decimal degrees.
//
// A few notices carry seconds of 60 or more ("26°13'60\"N", printed elsewhere in
// the same notice as 26°14'00"). Those are carried over into the minutes.
// Minutes of 60 or more do not occur in the 17,765 angles surveyed and are
// dropped as a misread.
export function angleTokens(text) {
  const tokens = [];
  for (const match of text.matchAll(ANGLE)) {
    const [raw, deg, min, sec] = match;
    if (min === undefined) continue; // bare degrees are too easy to confuse with other numbers
    const minutes = +min,
      seconds = sec === undefined ? 0 : +sec;
    if (minutes >= 60 || seconds >= 100) continue;
    if (deg.includes('.') || (sec !== undefined && min.includes('.'))) continue;
    tokens.push({
      value: +deg + minutes / 60 + seconds / 3600,
      precision: sec === undefined ? 'minute' : 'second',
      ...(seconds >= 60 ? {secondsCarried: true} : {}),
      index: match.index,
      end: match.index + raw.length,
      raw: raw.trim(),
    });
  }
  for (const match of text.matchAll(COMPACT)) {
    const [raw, deg, min, sec, letter] = match;
    if (deg.length !== (letter === 'N' ? 2 : 3)) continue;
    tokens.push({
      value: +deg + +min / 60 + +sec / 3600,
      precision: 'second',
      index: match.index,
      end: match.index + raw.length,
      raw,
    });
  }
  tokens.sort((a, b) => a.index - b.index);
  return tokens;
}

// Plausible bounds for notices published by Taiwanese agencies: from the
// Spratlys (10°N) to north of Dongyin, and from Dongsha (116°E) to east of
// Taiwan. Anything outside is treated as a misread, never clamped.
const LAT = [3, 30],
  LON = [105, 130];
const within = (value, [low, high]) => value >= low && value <= high;

// The two ranges do not overlap, so the value alone tells latitude from
// longitude. The hemisphere letters are not used: "E：24°44'N" is point E, and
// in "N 23°26'10\" E 119°30'00\"" each letter belongs to the angle after it.
function axisOf(token) {
  if (within(token.value, LAT)) return 'lat';
  if (within(token.value, LON)) return 'lon';
  return null;
}

// Text allowed between the two halves of a point. The layout text of a table
// often puts the longitude a line or two below the latitude, after words from
// the neighbouring column, so line breaks are allowed; a label that starts
// another point is not.
function samePoint(gap, maxGap, sameLine) {
  return (
    gap.length <= maxGap &&
    gap.split('\n').length <= (sameLine ? 1 : 4) &&
    !/[A-Z⊕]\s*[:：]/.test(gap)
  );
}

// Pairs neighbouring tokens into points. Two tokens form a point when one is a
// latitude, the other a longitude, and only a little text separates them.
//
// `sameLine` is for text from character recognition. When the recogniser
// garbles one half of a point, the half that is left must not be paired with
// the first half of the next line, which would shift every point after it.
export function coordinatePairs(text, {maxGap = 200, sameLine = false} = {}) {
  const tokens = angleTokens(text),
    points = [],
    leftovers = [];
  for (let i = 0; i < tokens.length; i++) {
    const a = tokens[i],
      b = tokens[i + 1],
      axisA = axisOf(a),
      axisB = b && axisOf(b);
    const gap = b ? text.slice(a.end, b.index) : '';
    const paired = b && axisA && axisB && axisA !== axisB && samePoint(gap, maxGap, sameLine);
    if (!paired) {
      leftovers.push(a);
      continue;
    }
    const lat = axisA === 'lat' ? a : b,
      lon = axisA === 'lat' ? b : a;
    points.push({
      lat: lat.value,
      lon: lon.value,
      precision: lat.precision === 'second' && lon.precision === 'second' ? 'second' : 'minute',
      order: axisA === 'lat' ? 'lat-lon' : 'lon-lat',
      ...(lat.secondsCarried || lon.secondsCarried ? {secondsCarried: true} : {}),
      index: a.index,
      end: b.end,
      raw: text.slice(a.index, b.end).replace(/\s+/g, ' '),
    });
    i++;
  }
  return {points, leftovers};
}
