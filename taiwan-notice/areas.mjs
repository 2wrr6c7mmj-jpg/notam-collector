// Turns the points on one page of a notice into areas: polygons, circles and
// centre points.
//
// A page usually states the same area several times: the notification form
// lists corners A to D (often twice, once for the sea and once for the air),
// its sketch map prints the same corners scattered around a drawing, and the
// notice to mariners gives them again in Chinese and in English. The page is
// first cut into runs of points, then the runs that restate an area are
// dropped so that each area comes out once.
import {normalizeNoticeText, coordinatePairs} from './coordinates.mjs';

const key = point => `${point.lat.toFixed(5)},${point.lon.toFixed(5)}`;

// "A:", "A：", "A、", "A." or "A-" in front of a point, possibly followed by the
// hemisphere or the word for latitude; also "A 北緯" and "A(".
const LABEL_BEFORE =
  /(?<![A-Za-z])([A-Z])(?: ?[:：、.-] ?(?:[NE] ?|Lat\.? ?|北緯 ?|東經 ?)?| (?:北緯|東經) ?| ?\( ?)$/;
// Printed between two lists of corners: the datum note that ends a list
// ("*WGS84"; without the asterisk it is a column heading of the form), or the
// heading of the next area ("區域 2 座標位置", "乙區:").
const LIST_BREAK = /\* ?WGS ?-?84|區域 ?\d+ ?座標|[甲乙丙丁戊]區 ?[:：]|以上各點連線/;
// "航務中心" (a harbour office) appears on every distribution list, so the
// bare word 中心 does not make a centre.
const CENTRE_WORD = String.raw`⊕|中心 ?(?:點|位置|座標)|Cent(?:er|re) ?Point`;
const CENTRE_BEFORE = new RegExp(String.raw`(?:${CENTRE_WORD})[^\n]{0,16}$`, 'i');
const CENTRE_NEXT_LINE = new RegExp(String.raw`^[^\n]{0,4}\n[^\n]{0,24}中心 ?點 ?位置`);
// "…為中心,5浬為半徑". On a form, words of the neighbouring column may sit
// inside the phrase.
const CIRCLE_AFTER =
  /^[^。\d]{0,24}?為 ?中[^。\d]{0,24}?心[^。\d]{0,40}?(\d+(?:\.\d+)?) ?(?:浬|NM) ?為 ?半 ?徑/;
// "以…為中心,連接下列四點為範圍": the centre of the corners that follow. The
// layout text may break the word ("為中\n … 心").
const CENTRE_AFTER = /^[^。\d]{0,24}?為 ?中[^。\d]{0,24}?心/;
// "以 C 為中心,10NM為半徑,自 P 反時針方向至 Q 所形成之扇形": a sector.
const SECTOR = /^[\s\S]{0,160}?自[\s\S]{0,60}$/;
const SECTOR_TURN = /(反|順) ?時 ?針/;
const CIRCLE_BEFORE = /radius ?(\d+(?:\.\d+)?) ?NM[^\n]{0,12}cent(?:er|re)[^\n]{0,8}$/i;
const ENGLISH_BEFORE = /Lat\.? ?[:：]? ?$/i;

// Where the English half of each notice to mariners sits on the page.
function englishSpans(text) {
  const spans = [];
  for (const match of text.matchAll(/NOTICE ?TO ?MARINERS/gi)) {
    const next = text.indexOf('航船布告', match.index);
    spans.push([match.index, next === -1 ? text.length : next]);
  }
  return spans;
}

function describe(text, point, english) {
  const before = text.slice(Math.max(0, point.index - 40), point.index),
    after = text.slice(point.end, point.end + 90);
  const circle = after.match(CIRCLE_AFTER) ?? before.match(CIRCLE_BEFORE);
  const label = before.match(LABEL_BEFORE)?.[1] ?? null;
  return {
    label,
    radiusNm: circle ? +circle[1] : null,
    isCentre:
      !circle &&
      !label &&
      (CENTRE_BEFORE.test(before) || CENTRE_NEXT_LINE.test(after) || CENTRE_AFTER.test(after)),
    language:
      english.some(([from, to]) => point.index >= from && point.index < to) ||
      ENGLISH_BEFORE.test(before) ||
      /Long/i.test(point.raw)
        ? 'en'
        : 'zh',
  };
}

const position = ({lat, lon, precision, secondsCarried}) => ({
  lat,
  lon,
  precision,
  ...(secondsCarried ? {secondsCarried} : {}),
});

const turn = (a, b, c) =>
  Math.sign((b.lon - a.lon) * (c.lat - a.lat) - (b.lat - a.lat) * (c.lon - a.lon));
const segmentsCross = (p, q, r, s) =>
  turn(p, q, r) !== turn(p, q, s) &&
  turn(r, s, p) !== turn(r, s, q) &&
  turn(p, q, r) !== 0 &&
  turn(r, s, p) !== 0;

export function selfCrossing(points) {
  const n = points.length;
  for (let i = 0; i < n; i++)
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segmentsCross(points[i], points[(i + 1) % n], points[j], points[(j + 1) % n]))
        return true;
    }
  return false;
}

// Corners sorted clockwise around the outline (Andrew's monotone chain).
// Points that are not corners of the hull are left out.
function hull(points) {
  const sorted = [...points].sort((a, b) => a.lon - b.lon || a.lat - b.lat);
  const half = list => {
    const chain = [];
    for (const point of list) {
      while (chain.length >= 2 && turn(chain.at(-2), chain.at(-1), point) >= 0) chain.pop();
      chain.push(point);
    }
    chain.pop();
    return chain;
  };
  return [...half(sorted), ...half(sorted.reverse())];
}

// Some notices list the corners of a rectangle as north-west, north-east,
// south-west, south-east, which read in order makes a bow tie. When every
// point is a corner of the outline there is only one simple polygon through
// them, so the corners are put in that order.
//
// A crossing ring with points inside its outline cannot be untangled that
// way. On a form with labelled corners (the test range at Zhuangwei lists the
// outline O, A to E and then points F to I inside it) the outline is taken;
// the area drawn is then never smaller than the one meant. A bare list that
// crosses is several areas printed without a break and is left marked.
function untangle(points, labelled) {
  if (!selfCrossing(points)) return {points};
  const outline = hull(points);
  if (outline.length === points.length) return {points: outline, reordered: true};
  if (labelled) return {points: outline, outlineOnly: true};
  return {points, selfCrossing: true};
}

const NM_PER_DEGREE = 60;
const bearing = (centre, point) =>
  (Math.atan2(
    (point.lon - centre.lon) * Math.cos((centre.lat * Math.PI) / 180),
    point.lat - centre.lat,
  ) *
    180) /
  Math.PI;

// The outline of a sector: the centre, the point where the arc starts, the
// arc in steps of ten degrees, the point where it ends.
function sectorOutline(centre, radiusNm, from, to, anticlockwise) {
  const start = bearing(centre, from);
  let sweep = (((bearing(centre, to) - start) % 360) + 360) % 360; // clockwise
  if (anticlockwise) sweep -= 360;
  const arc = [];
  for (let step = 10; step < Math.abs(sweep); step += 10) {
    const angle = ((start + Math.sign(sweep) * step) * Math.PI) / 180;
    arc.push({
      lat: centre.lat + (radiusNm / NM_PER_DEGREE) * Math.cos(angle),
      lon:
        centre.lon +
        ((radiusNm / NM_PER_DEGREE) * Math.sin(angle)) / Math.cos((centre.lat * Math.PI) / 180),
      precision: 'derived',
    });
  }
  return [centre, from, ...arc, to].map(point => ({...position(point), label: null}));
}

// Marks the three points of each sector (centre, start and end of the arc)
// and returns the sectors.
function takeSectors(text, described) {
  const sectors = [];
  described.forEach((centre, i) => {
    const from = described[i + 1],
      to = described[i + 2];
    if (centre.radiusNm === null || !to) return;
    if (!SECTOR.test(text.slice(centre.end, from.index))) return;
    const turn = text.slice(from.index, to.index).match(SECTOR_TURN);
    if (!turn || !/^[^。]{0,80}扇 ?形/.test(text.slice(to.end, to.end + 90))) return;
    centre.used = from.used = to.used = true;
    sectors.push({
      points: sectorOutline(centre, centre.radiusNm, from, to, turn[1] === '反'),
      language: centre.language,
      sector: {
        centre: position(centre),
        radiusNm: centre.radiusNm,
        anticlockwise: turn[1] === '反',
      },
    });
  });
  return sectors;
}

const METRES_PER_NM = 1852;
const TO_METRES = {m: 1, 公尺: 1, meters: 1, metres: 1, km: 1000, 公里: 1000, kilometers: 1000};
const metres = (number, unit) => +number.replace(/,/g, '') * TO_METRES[unit.toLowerCase()];
const LIMITS = [
  /往 ?([東西南北]) ?(\d[\d,]*) ?(m|公尺|km|公里)/gi,
  /(\d[\d,]*) ?(meters|metres|m|km|kilometers) to the (north|south|east|west)/gi,
];
const SIDE = {北: 'north', 南: 'south', 東: 'east', 西: 'west'};

// The launch site for sounding rockets gives its danger area as distances
// from the pad: "往北 6000m、往南 6000m、往西 4000m、往東 8000m", in English
// "6000 meters to the north". The pad is the point printed before the
// distances. Returns the rectangle, or null when a side is missing.
function rangeLimitsBox(text, described) {
  for (const pattern of LIMITS) {
    const sides = {};
    let first = Infinity;
    for (const match of text.matchAll(pattern)) {
      const zh = match[1] in SIDE;
      const side = zh ? SIDE[match[1]] : match[3].toLowerCase();
      sides[side] ??= zh ? metres(match[2], match[3]) : metres(match[1], match[2]);
      first = Math.min(first, match.index);
    }
    if (!['north', 'south', 'east', 'west'].every(side => sides[side] > 0)) continue;
    const pad = described.findLast(point => point.end <= first);
    if (!pad) continue;
    const latStep = metre => metre / METRES_PER_NM / NM_PER_DEGREE,
      lonStep = metre => latStep(metre) / Math.cos((pad.lat * Math.PI) / 180);
    const corner = (north, east) => ({
      lat: pad.lat + latStep(north),
      lon: pad.lon + lonStep(east),
      precision: 'derived',
      label: null,
    });
    return {
      points: [
        corner(sides.north, -sides.west),
        corner(sides.north, sides.east),
        corner(-sides.south, sides.east),
        corner(-sides.south, -sides.west),
      ],
      language: pad.language,
      statements: 1,
      rangeLimits: {pad: position(pad), ...sides},
    };
  }
  return null;
}

function cutIntoRuns(described) {
  const runs = [];
  let run = null;
  const close = () => {
    if (run?.points.length) runs.push(run);
    run = null;
  };
  for (const point of described) {
    if (point.used || point.radiusNm !== null || point.isCentre) {
      close();
      continue;
    }
    const labelled = point.label !== null;
    const startsOver =
      run &&
      (LIST_BREAK.test(point.gapBefore) ||
        run.language !== point.language ||
        run.labelled !== labelled ||
        key(run.points[0]) === key(point) ||
        (point.label === 'A' && run.points.at(-1).label !== 'O') ||
        (labelled && run.points.some(earlier => earlier.label === point.label)));
    if (startsOver) close();
    run ??= {language: point.language, labelled, points: [], from: point.index};
    run.to = point.end;
    // The same corner printed twice in a row is one corner.
    if (run.points.length && key(run.points.at(-1)) === key(point)) continue;
    run.points.push({...position(point), label: point.label});
  }
  close();
  return runs;
}

const isSubset = (small, big) => [...small].every(item => big.has(item));

// Keeps one ring per area. Runs are ranked so that the best statement of an
// area is met first: Chinese before English (the Chinese text is the
// original; the English one carries more typing slips), labelled corners
// before bare ones, rings that are simple as written before reordered ones,
// more corners before fewer.
function distinctRings(runs) {
  const rings = runs
    .filter(run => run.points.length >= 3)
    .map(run => ({
      ...run,
      ...untangle(run.points, run.labelled),
      keys: new Set(run.points.map(key)),
    }));
  const rank = ring =>
    (ring.language === 'zh' ? 0 : 8) +
    (ring.labelled ? 0 : 4) +
    (ring.selfCrossing ? 3 : ring.outlineOnly ? 2 : ring.reordered ? 1 : 0);
  rings.sort((a, b) => rank(a) - rank(b) || b.points.length - a.points.length);

  const kept = [];
  for (const ring of rings) {
    const restated = kept.findIndex(
      other => isSubset(ring.keys, other.keys) || isSubset(other.keys, ring.keys),
    );
    if (restated !== -1) {
      // The fuller statement wins, e.g. when the Chinese text lost a corner.
      const statements = kept[restated].statements + (ring.incomplete ? 0 : 1);
      if (ring.keys.size > kept[restated].keys.size && !ring.selfCrossing) kept[restated] = ring;
      kept[restated].statements = statements;
      continue;
    }
    // The English notice repeats the Chinese one. A notification form labels
    // its corners; bare points on the same page are its sketch map, whose
    // text layer pairs latitudes and longitudes at random.
    if (ring.language === 'en' && kept.some(other => other.language === 'zh')) continue;
    if (!ring.labelled && kept.some(other => other.labelled && other.language === ring.language))
      continue;
    ring.statements = ring.incomplete ? 0 : 1;
    kept.push(ring);
  }
  return kept;
}

// `scan` is set for text from character recognition: a point is then only
// read from one line, and a list of corners with a stray half of a point in
// or right after it (a corner the recogniser garbled) does not count as a
// statement of its area.
export function pageAreas(rawText, {scan = false} = {}) {
  const text = normalizeNoticeText(rawText),
    english = englishSpans(text),
    {points, leftovers} = coordinatePairs(text, {sameLine: scan}),
    described = points.map((point, i, all) => ({
      ...point,
      ...describe(text, point, english),
      gapBefore: i ? text.slice(all[i - 1].end, point.index) : '',
    }));

  const sectors = takeSectors(text, described);
  const box = rangeLimitsBox(text, described);
  const circles = new Map(),
    centres = new Map();
  for (const point of described) {
    if (point.used) continue;
    if (point.radiusNm !== null) {
      const id = `${key(point)} ${point.radiusNm}`;
      circles.set(id, {
        centre: position(point),
        radiusNm: point.radiusNm,
        statements: (circles.get(id)?.statements ?? 0) + 1,
      });
    } else if (point.isCentre) centres.set(key(point), position(point));
  }

  const runs = cutIntoRuns(described);
  if (scan)
    for (const run of runs) {
      const lineAfter = text.indexOf('\n', run.to);
      const until = lineAfter === -1 ? text.length : lineAfter;
      run.incomplete = leftovers.some(
        stray =>
          stray.index > run.from - 60 &&
          stray.index < until &&
          !/中心|⊕|半徑/.test(text.slice(Math.max(0, stray.index - 30), stray.end + 12)),
      );
    }
  return {
    polygons: [
      ...distinctRings(runs).map(
        ({points, language, statements, reordered, outlineOnly, selfCrossing: crossing}) => ({
          points,
          language,
          statements,
          ...(reordered ? {reordered} : {}),
          ...(outlineOnly ? {outlineOnly} : {}),
          ...(crossing ? {selfCrossing: crossing} : {}),
        }),
      ),
      ...sectors,
      ...(box ? [box] : []),
    ],
    circles: [...circles.values()],
    centres: [...centres.values()],
    minimumRadiusNm: minimumRadiusNm(text),
    loosePoints: runs.filter(run => run.points.length < 3).flatMap(run => run.points),
  };
}

// Radius printed next to a centre point on the notification form
// ("最小半徑 7浬(NM)", "涵蓋危險區域最小半徑 6000m"; the layout text may put
// the number between the two halves of the heading: "最小 865m … 半徑").
// It describes the danger area around the centre and is kept apart from
// circles that a notice defines outright; a notice that states no other area
// is drawn from it.
const RADIUS_UNIT = String.raw`(浬|NM|m|公尺|km|公里)(?![A-Za-z])`;
const MINIMUM_RADIUS = [
  new RegExp(String.raw`最小 ?半徑[^\d\n]{0,12}(\d[\d,]*(?:\.\d+)?) ?\(?${RADIUS_UNIT}`, 'i'),
  new RegExp(
    String.raw`最小 ?(\d[\d,]*(?:\.\d+)?) ?${RADIUS_UNIT}[^\n]{0,40}\n[^\n]{0,60}半徑`,
    'i',
  ),
];
export function minimumRadiusNm(rawText) {
  const text = normalizeNoticeText(rawText);
  const match = MINIMUM_RADIUS.map(pattern => text.match(pattern)).find(Boolean);
  if (!match) return null;
  const unit = match[2].toLowerCase();
  if (unit === '浬' || unit === 'nm') return +match[1].replace(/,/g, '');
  return metres(match[1], unit) / METRES_PER_NM;
}
