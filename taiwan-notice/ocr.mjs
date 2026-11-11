// Repairs for text that came from character recognition of a scanned notice.
//
// The recogniser reads Chinese and digits well but trips over the small marks
// of an angle: the degree sign comes out as 0, 9, o or *, the minute mark is
// dropped or read as a second degree sign. Only slips that leave no doubt
// about the number meant are repaired; anything else stays as recognised and
// is then not read as a coordinate at all.
import {angleTokens, normalizeNoticeText} from './coordinates.mjs';

const LAT = String.raw`2\d`, // Taiwanese notices lie between 20°N and 27°N
  LON = String.raw`1[12]\d`; // and between 110°E and 129°E

const REPAIRS = [
  // Curly quotes the recogniser prefers.
  [/[‘’]/g, "'"],
  [/[“”]/g, '"'],
  // 22*15'0"N, 22o15'N: a mark where the degree sign belongs.
  [new RegExp(String.raw`(?<!\d)(${LAT}|${LON}) ?[*oO] ?(\d{1,2})(?=['°])`, 'g'), '$1°$2'],
  // 22022'00"N, 22506'00.0", 22?19'00", 121004'00"E: the degree sign read as
  // a digit or a question mark. Five digits and a minute mark cannot be a
  // latitude otherwise, six not a longitude.
  [new RegExp(String.raw`(?<![\d.°])(${LAT})[\d?]([0-5]\d)(?=')`, 'g'), '$1°$2'],
  [new RegExp(String.raw`(?<![\d.°])(${LON})[\d?]([0-5]\d)(?=')`, 'g'), '$1°$2'],
  // 2201800"N: the degree sign read as 0 and the minute mark dropped.
  [new RegExp(String.raw`(?<![\d.°])(${LAT})0([0-5]\d)([0-5]\d)(?=" ?N)`, 'g'), "$1°$2'$3"],
  [new RegExp(String.raw`(?<![\d.°])(${LON})0([0-5]\d)([0-5]\d)(?=" ?E)`, 'g'), "$1°$2'$3"],
  // 120°55°0"E: the minute mark read as a degree sign.
  [/(\d{2,3}° ?[0-5]?\d) ?°(?= ?\d{1,2}(?:\.\d)? ?")/g, "$1'"],
  // 121°0400"E: the minute mark dropped before the seconds.
  [/(\d{2,3}°)([0-5]\d)([0-5]\d)(?=" ?[NE])/g, "$1$2'$3"],
  // 121°21E, 24° 24N, 121°55° E, 24°48 N: the minute mark dropped, or read
  // as a second degree sign, before the hemisphere.
  [/(\d{2,3}°) ?([0-5]\d) ?°? ?(?=[NE](?![A-Za-z]))/g, "$1$2'"],
  // The test range at Zhuangwei writes longitude first and no hemisphere,
  // "O:121°49'、24°48'", in small print: the minute marks come out as ~ - 7
  // or a quote, the comma as » > or +, a degree sign as 7 or not at all
  // ("121°49~ » 24°48 ~", "12154 > ,24744", "121750 ~,24750-"). A longitude,
  // a comma and a latitude in that order leave no doubt about what is meant.
  // A hemisphere letter in between marks one of the usual forms, which are
  // left alone.
  [
    new RegExp(
      String.raw`(?<![\d.°])(${LON})[°.7]? ?([0-5]\d)(?: ?7)?[^\d\nNE»>,+、]{0,4}[»>,+、]{1,2} ?` +
        String.raw`(${LAT})[°7.\- ]?([0-5]\d)(?: ?7(?!\d)|(?!\d))`,
      'g',
    ),
    "$1°$2', $3°$4'",
  ],
  // The labels O and I of such a list read as digits: "0:121°49'", "1: 121°52'".
  [new RegExp(String.raw`(?<![\dA-Za-z])0(?= ?[:;] ?${LON}°)`, 'g'), 'O'],
  [new RegExp(String.raw`(?<![\dA-Za-z])1(?= ?[:;] ?${LON}°)`, 'g'), 'I'],
  // 22 32N 121 02'E: degree sign and minute mark both lost before the
  // hemisphere.
  [new RegExp(String.raw`(?<![\d.°])(${LAT}) ([0-5]\d) ?'? ?(?=N(?![A-Za-z]))`, 'g'), "$1°$2'"],
  [new RegExp(String.raw`(?<![\d.°])(${LON}) ([0-5]\d) ?'? ?(?=E(?![A-Za-z]))`, 'g'), "$1°$2'"],
];

export function repairOcrText(text) {
  return REPAIRS.reduce(
    (repaired, [pattern, replacement]) => repaired.replace(pattern, replacement),
    text,
  );
}

// Points of a list of corners that was cut out of the page and read several
// times, line by line (see the survey's coordinate-blocks.py).
//
// `readings` holds one list of lines per reading, aligned: line 3 of one
// reading is line 3 of the others. A watermark or a sketch map printed across
// the list garbles different digits in each reading, so the latitude and the
// longitude of a line are each taken from the readings that agree on it. A
// number that only one reading saw, or on which the readings are split
// evenly, is not used, and a line gives a point only when both numbers were
// agreed on.
const LATITUDES = [20, 27],
  LONGITUDES = [110, 129];
const seconds = value => Math.round(value * 3600);

function agreed(values) {
  const votes = new Map();
  for (const value of values) votes.set(value, (votes.get(value) ?? 0) + 1);
  const [first, second] = [...votes].sort((a, b) => b[1] - a[1]);
  return first && first[1] >= 2 && first[1] > (second?.[1] ?? 0) ? first[0] : null;
}

export function votedPoints(readings) {
  const lineCount = Math.max(0, ...readings.map(lines => lines.length));
  const points = [];
  for (let line = 0; line < lineCount; line++) {
    const latitudes = [],
      longitudes = [];
    for (const lines of readings) {
      const tokens = angleTokens(normalizeNoticeText(repairOcrText(lines[line] ?? '')));
      const first = ([low, high]) =>
        tokens.find(token => token.value >= low && token.value <= high)?.value;
      const [lat, lon] = [first(LATITUDES), first(LONGITUDES)];
      if (lat !== undefined) latitudes.push(seconds(lat));
      if (lon !== undefined) longitudes.push(seconds(lon));
    }
    const [lat, lon] = [agreed(latitudes), agreed(longitudes)];
    if (lat !== null && lon !== null) points.push({lat: lat / 3600, lon: lon / 3600});
  }
  return points;
}
