// Confirms areas read from scans against areas known from other notices.
//
// The same ranges are used month after month. An area that character
// recognition read only once in its notice has nothing inside the notice to
// confirm its digits (see readNotice), but when all its corners are corners
// of an area that other notices state in real text, or state twice in a
// scan, the digits are confirmed from outside. The recogniser often loses a
// corner; the area is then drawn with the corners of the known one.
//
// A notice whose scan gave no area at all may still carry `scanPoints`: the
// points its list of corners was read as, line by line (see readNotice). When
// at least three of them are corners of one known area and none lies outside
// it, the notice is drawn with that area. Points inside the area are allowed:
// the test range at Zhuangwei lists four of them after the outline.
import {tidySlots} from './notice.mjs';

const pointKey = point => `${point.lat.toFixed(5)},${point.lon.toFixed(5)}`;
const cornerKeys = area => area.points.map(pointKey);
const circleKey = area => `${pointKey(area.centre)} ${area.radiusNm}`;

const polygonKey = keys => [...keys].sort().join(' ');
const isProperSubset = (small, big) =>
  small.size < big.size && [...small].every(item => big.has(item));

// Areas stated in real text are known as they stand. An area from a scan is
// known too when both readings agree on it, unless its corners are some of the
// corners of an area known from text: the readings then lost the same corner,
// which happens when a line of the form is hard to read.
function knownAreas(notices) {
  const typed = new Map(),
    scanned = new Map(),
    circles = new Set();
  for (const notice of notices)
    for (const area of notice.areas) {
      if (area.type === 'circle') circles.add(circleKey(area));
      else {
        const keys = cornerKeys(area);
        (area.ocr ? scanned : typed).set(polygonKey(keys), {
          points: area.points,
          keys: new Set(keys),
        });
      }
    }
  const fromText = [...typed.values()];
  const polygons = new Map(typed);
  for (const [key, polygon] of scanned)
    if (!fromText.some(other => isProperSubset(polygon.keys, other.keys)))
      polygons.set(key, polygon);
  return {polygons: [...polygons.values()], fromText, circles};
}

// The known polygon an unconfirmed one restates: the one with exactly its
// corners, or else the only one that has all of them, or else the one its
// points fit (see holdingPoints).
function restated(area, known) {
  const keys = cornerKeys(area);
  if (new Set(keys).size < MIN_CORNERS_READ) return null;
  const holding = known.polygons.filter(other => keys.every(key => other.keys.has(key)));
  return (
    holding.find(other => other.keys.size === keys.length) ??
    (holding.length === 1 ? holding[0] : (holdingPoints(area.points, known)?.polygon ?? null))
  );
}

const MIN_CORNERS_READ = 3;

// Inside the ring or on its edge.
function contains(ring, point) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i],
      b = ring[j];
    const cross = (b.lon - a.lon) * (point.lat - a.lat) - (b.lat - a.lat) * (point.lon - a.lon);
    const between =
      Math.min(a.lat, b.lat) <= point.lat + 1e-9 &&
      point.lat <= Math.max(a.lat, b.lat) + 1e-9 &&
      Math.min(a.lon, b.lon) <= point.lon + 1e-9 &&
      point.lon <= Math.max(a.lon, b.lon) + 1e-9;
    if (Math.abs(cross) < 1e-9 && between) return true;
    if (a.lat > point.lat !== b.lat > point.lat) {
      const lonAtLat = a.lon + ((point.lat - a.lat) / (b.lat - a.lat)) * (b.lon - a.lon);
      if (point.lon < lonAtLat) inside = !inside;
    }
  }
  return inside;
}

// The known polygon the points of a scan belong to: the one with the most of
// them as corners, provided no point lies outside it and no other known
// polygon fits as well.
function holdingPoints(points, known) {
  const fits = known.polygons
    .map(polygon => ({
      polygon,
      corners: points.filter(point => polygon.keys.has(pointKey(point))).length,
    }))
    .filter(
      ({polygon, corners}) =>
        corners >= MIN_CORNERS_READ &&
        points.every(point => polygon.keys.has(pointKey(point)) || contains(polygon.points, point)),
    )
    .sort((a, b) => b.corners - a.corners);
  if (!fits.length || fits[0].corners === fits[1]?.corners) return null;
  return fits[0];
}

function drawnFromScanPoints(notice, known) {
  if (!notice.scanPoints) return notice;
  const {scanPoints, unplacedSlots, ...rest} = notice;
  if (rest.areas.length) return rest;
  const fit = holdingPoints(scanPoints, known);
  if (!fit) return notice;
  return {
    ...rest,
    areas: [
      {
        type: 'polygon',
        points: fit.polygon.points,
        ocr: true,
        confirmedByKnownArea: true,
        cornersRead: fit.corners,
        ...unplacedSlots,
      },
    ],
  };
}

// `notices` are results of readNotice. Returns them with every unconfirmed
// area that restates a known one moved to `areas`, marked `ocr` and
// `confirmedByKnownArea`; then the notices that still have no area are drawn
// from their `scanPoints` where those fit a known area.
export function confirmScannedAreas(notices) {
  const known = knownAreas(notices);
  return restatedAreasConfirmed(notices, known).map(notice => drawnFromScanPoints(notice, known));
}

// An area both readings of a scan agree on, but with a corner missing from
// an area known from text.
const lostCorner = (area, known) =>
  area.ocr &&
  area.type === 'polygon' &&
  known.fromText.some(other => isProperSubset(new Set(cornerKeys(area)), other.keys));

function restatedAreasConfirmed(notices, known) {
  return notices.map(original => {
    const short = original.areas.filter(area => lostCorner(area, known));
    if (!short.length && !original.unconfirmedOcrAreas?.length) return original;
    const notice = {
      ...original,
      areas: original.areas.filter(area => !short.includes(area)),
      unconfirmedOcrAreas: [...short, ...(original.unconfirmedOcrAreas ?? [])],
    };
    // Areas the notice already has, so that a misreading of one of them is
    // joined to it instead of being drawn a second time.
    const areas = notice.areas.map(area => ({...area}));
    const byKey = new Map(
      areas.map(area => [
        area.type === 'circle' ? circleKey(area) : polygonKey(cornerKeys(area)),
        area,
      ]),
    );
    const unconfirmed = [];
    let confirmedAny = false;
    for (const area of notice.unconfirmedOcrAreas) {
      let key, drawn;
      if (area.type === 'circle') {
        if (known.circles.has(circleKey(area))) [key, drawn] = [circleKey(area), area];
      } else {
        const match = restated(area, known);
        if (match) [key, drawn] = [polygonKey(match.keys), {...area, points: match.points}];
      }
      if (!drawn) {
        unconfirmed.push(area);
        continue;
      }
      confirmedAny = true;
      // Several misreadings of one area in a notice come out as one area
      // with the times of all of them.
      const earlier = byKey.get(key);
      if (!earlier) {
        const confirmed = {...drawn, confirmedByKnownArea: true};
        byKey.set(key, confirmed);
        areas.push(confirmed);
      } else if (earlier.slotSource === area.slotSource || earlier.slotSource === 'none') {
        earlier.slots = tidySlots([...earlier.slots, ...area.slots]);
        earlier.slotSource = area.slotSource;
      }
    }
    if (!confirmedAny) return original;
    const {unconfirmedOcrAreas, ...rest} = notice;
    return {
      ...rest,
      areas,
      ...(unconfirmed.length ? {unconfirmedOcrAreas: unconfirmed} : {}),
    };
  });
}
