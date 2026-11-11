// Puts one notice together: every danger area it states, each with the times
// it is active.
//
// A notice is a title plus attachments, an attachment is a list of pages.
// The same area is stated on several pages (notification form, notice to
// mariners, the harbour bureau's summary); it comes out once. Times are taken
// from the most exact statement available for the area:
//
//   1. the schedule table that follows the area's form, or the column of a
//      navy table that carries the area's range name (R-18, ...),
//   2. the dates written on the pages that state the area,
//   3. the dates on pages that state no area (a covering letter),
//   4. the dates in the title.
//
// `attachments` is a list of {pages: [text of each page], ocr?: true,
// otherReadings?: [[text of each page], ...], coordinateLists?: [...]}.
//
// `published` is the day the notice was put up (anything Date.parse reads).
// With it, times that cannot belong to the notice are left out and counted in
// `slotsLeftOut`: a notice does not announce a firing that ended well before
// it was published (a sentence copied from last month's notice, or a year
// misread in a scan), and a date read from a scan that lies months ahead is a
// misread month.
import {normalizeNoticeText} from './coordinates.mjs';
import {pageAreas} from './areas.mjs';
import {scheduleTable} from './schedule.mjs';
import {dateSlots, monthsNamed, noticeYear} from './dates.mjs';
import {repairOcrText, votedPoints} from './ocr.mjs';

const pointKey = point => `${point.lat.toFixed(5)},${point.lon.toFixed(5)}`;
const isSubset = (small, big) => [...small].every(item => big.has(item));
const RANGE_NAME = /R ?- ?\d+[A-Z]?/g;

// What a notice does, from its title: cancels an earlier notice, changes one
// (修正, 修訂, 更新, 異動, 新增, 刪除), or stands on its own.
export function noticeKind(title) {
  if (/取消|撤銷|停止實施/.test(title)) return 'cancellation';
  if (/修正|修訂|更正|更新|異動|變更|新增|刪除|調整/.test(title)) return 'amendment';
  return 'notice';
}

const TAIPEI_OFFSET_MS = 8 * 3600e3;
const taipeiDay = instant =>
  new Date(Date.parse(instant) + TAIPEI_OFFSET_MS).toISOString().slice(0, 10);

// Sorted, without repeats. A whole-day slot gives way to a timed slot on the
// same day: the notice to mariners names the day, the form names the hours.
export function tidySlots(slots) {
  const timedDays = new Set(slots.filter(s => !s.wholeDay).map(s => taipeiDay(s.start)));
  const unique = new Map();
  for (const slot of slots) {
    if (slot.wholeDay && timedDays.has(taipeiDay(slot.start))) continue;
    const key = `${slot.start} ${slot.end}`;
    // Stated once as a reserve day and once without the mark: the mark stays.
    if (!unique.has(key) || slot.reserve) unique.set(key, slot);
  }
  return [...unique.values()].sort(
    (a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end),
  );
}

const DAY_MS = 86400e3;
// The page of a notice shows when it was last changed, which may be some
// days after it was first put up.
const PAST_ALLOWED_MS = 10 * DAY_MS,
  SCAN_AHEAD_ALLOWED_MS = 100 * DAY_MS;

function belongsToNotice(slot, published, fromScan) {
  if (published === null) return true;
  if (Date.parse(slot.end) < published - PAST_ALLOWED_MS) return false;
  return !fromScan || Date.parse(slot.start) <= published + SCAN_AHEAD_ALLOWED_MS;
}

function readPages(attachments, {year, noticeMonths, published, leftOut}) {
  const keep = (slots, fromScan) =>
    slots.filter(slot => {
      const belongs = belongsToNotice(slot, published, fromScan);
      if (!belongs) leftOut.count++;
      return belongs;
    });
  return attachments.flatMap((attachment, attachmentIndex) => {
    // A scan may come with more than one reading of each page (the same page
    // recognised with other settings); each reading is read as a page of its
    // own, so an area both readings agree on is stated twice.
    const readings = [attachment.pages, ...(attachment.otherReadings ?? [])];
    return attachment.pages.flatMap((_, pageIndex) =>
      readings.map(reading => {
        const recognised = reading[pageIndex] ?? '';
        const raw = attachment.ocr ? repairOcrText(recognised) : recognised;
        const where = {attachment: attachmentIndex, page: pageIndex + 1};
        const table = scheduleTable(raw, {noticeMonths});
        if (table) return {...where, table: {...table, slots: keep(table.slots, !!attachment.ocr)}};
        const text = normalizeNoticeText(raw);
        return {
          ...where,
          ...pageAreas(raw, {scan: !!attachment.ocr}),
          slots: keep(dateSlots(text, {year}), !!attachment.ocr),
          rangeNames: [
            ...new Set((text.match(RANGE_NAME) ?? []).map(name => name.replace(/ /g, ''))),
          ],
        };
      }),
    );
  });
}

// An attachment marked `ocr: true` is a scan whose pages were read by
// character recognition. Such text can misread or lose a digit, so it is
// used only when the notice has no area in real text. Its areas are marked
// `ocr`, and only those stated at least twice with the same corners count as
// read: on the form and in the notice to mariners, in Chinese and in English,
// or in two readings of the same page. The rest, and any area too wide to be
// a firing area, are returned apart as `unconfirmedOcrAreas`.
//
// When a scan gives no confirmed area, the points it was read as may still
// tell which area is meant. Those read at least twice (on two pages, or in
// two readings of a page) are returned as `scanPoints`, with the times the
// notice states outside any area as `unplacedSlots`, for confirmScannedAreas
// to find the known area they belong to. They do not make an area by
// themselves: corners are lost, and the order with them.
//
// A scan may also come with `coordinateLists`: its lists of corners cut out
// of the page and read several times, each a list of readings with their
// lines aligned. The points those readings agree on (see votedPoints) count
// as read twice.
export function readNotice({title = '', attachments = [], published = null}) {
  const publishedAt = published === null ? null : Date.parse(published);
  const typed = attachments.filter(attachment => !attachment.ocr);
  if (typed.length === attachments.length)
    return withoutUnplaced(assemble(title, attachments, publishedAt));
  const fromText = assemble(title, typed, publishedAt);
  if (fromText.areas.length) return withoutUnplaced(fromText);
  const {unplacedSlots, pointReadings, ...all} = assemble(title, attachments, publishedAt);
  const marked = all.areas.map(area => ({...area, ocr: true}));
  const confirmed = area => area.statements >= 2 && !tooWide(area);
  const areas = marked.filter(confirmed);
  const scanPoints = new Map(
    [...pointReadings].filter(([, {times}]) => times >= 2).map(([key, {point}]) => [key, point]),
  );
  for (const attachment of attachments)
    for (const point of (attachment.coordinateLists ?? []).flatMap(votedPoints))
      scanPoints.set(pointKey(point), point);
  return {
    ...all,
    areas,
    unconfirmedOcrAreas: marked.filter(area => !confirmed(area)),
    ...(!areas.length && scanPoints.size
      ? {scanPoints: [...scanPoints.values()], unplacedSlots}
      : {}),
  };
}

// The widest area in a typed notice measures 111 nautical miles across. Two
// readings of a scan can agree on a wrong digit, which moves a corner by
// degrees; an area wider than this is such a misreading.
const WIDEST_SCANNED_NM = 200;
function tooWide(area) {
  if (area.type !== 'polygon') return false;
  const span = values => Math.max(...values) - Math.min(...values);
  const latitudes = area.points.map(point => point.lat);
  const eastWest =
    span(area.points.map(point => point.lon)) * Math.cos((latitudes[0] * Math.PI) / 180);
  return Math.max(span(latitudes), eastWest) * 60 > WIDEST_SCANNED_NM;
}

const withoutUnplaced = ({unplacedSlots, pointReadings, ...notice}) => notice;

function assemble(title, attachments, published) {
  const titleText = normalizeNoticeText(title);
  const firstPage = attachments[0]?.pages[0] ?? '';
  const year = noticeYear(titleText) ?? noticeYear(normalizeNoticeText(firstPage));
  const leftOut = {count: 0};
  const pages = readPages(attachments, {
    year,
    noticeMonths: monthsNamed(titleText),
    published,
    leftOut,
  });

  // One entry per distinct area of the notice.
  const areas = [];
  const register = (found, page) => {
    let area = areas.find(
      other =>
        other.type === found.type &&
        (isSubset(found.keys, other.keys) || isSubset(other.keys, found.keys)),
    );
    // How often the notice states the area: on how many pages, and how many
    // times on each. An area read by character recognition that is stated
    // only once has nothing to confirm its digits.
    const statements = (area?.statements ?? 0) + (found.statements ?? 1);
    if (!area) {
      area = {...found, schedule: [], dated: [], rangeNames: new Set()};
      areas.push(area);
    } else if (found.keys.size > area.keys.size) Object.assign(area, found);
    area.statements = statements;
    if (page.rangeNames.length === 1) area.rangeNames.add(page.rangeNames[0]);
    return area;
  };

  // How many pages (and readings of a page) each point was read on.
  const pointReadings = new Map();
  const joinedLists = [],
    aroundCentres = [], // centre and minimum radius on pages that state no area
    looseSlots = [],
    navyTables = [];
  let current = [], // areas of the form that the next schedule table belongs to
    waitingTables = [], // tables printed before the first form of an attachment
    attachment = -1;
  for (const page of pages) {
    if (page.attachment !== attachment) {
      attachment = page.attachment;
      current = [];
      waitingTables = [];
    }
    if (page.table) {
      if (page.table.ranges) navyTables.push(page.table);
      else if (current.length) current.forEach(area => area.schedule.push(...page.table.slots));
      else waitingTables.push(page.table);
      continue;
    }
    for (const key of new Set(
      [...page.polygons.flatMap(p => p.points), ...page.loosePoints].map(pointKey),
    )) {
      const [lat, lon] = key.split(',').map(Number);
      const reading = pointReadings.get(key) ?? {point: {lat, lon}, times: 0};
      pointReadings.set(key, {...reading, times: reading.times + 1});
    }
    const onPage = [];
    for (const polygon of page.polygons) {
      // A bare list that crosses itself is several areas printed without a
      // break (the harbour bureau's summary of a month); see below.
      if (polygon.selfCrossing) joinedLists.push(polygon);
      else
        onPage.push(
          register(
            {type: 'polygon', ...polygon, keys: new Set(polygon.points.map(pointKey))},
            page,
          ),
        );
    }
    for (const circle of page.circles)
      onPage.push(
        register(
          {
            type: 'circle',
            ...circle,
            keys: new Set([`${pointKey(circle.centre)} ${circle.radiusNm}`]),
          },
          page,
        ),
      );
    if (!onPage.length) {
      looseSlots.push(...page.slots);
      if (page.minimumRadiusNm !== null)
        for (const centre of page.centres)
          aroundCentres.push({centre, radiusNm: page.minimumRadiusNm, slots: page.slots, page});
      continue;
    }
    onPage.forEach(area => area.dated.push(...page.slots));
    onPage.forEach(area => waitingTables.forEach(table => area.schedule.push(...table.slots)));
    waitingTables = [];
    current = onPage;
  }

  // A notice that states no polygon and no circle anywhere, only the centre
  // of its danger area and the smallest radius that covers it.
  if (!areas.length)
    for (const {centre, radiusNm, slots, page} of aroundCentres)
      register(
        {
          type: 'circle',
          centre,
          radiusNm,
          fromMinimumRadius: true,
          keys: new Set([`${pointKey(centre)} ${radiusNm.toFixed(3)}`]),
        },
        page,
      ).dated.push(...slots);

  for (const table of navyTables)
    for (const area of areas)
      area.schedule.push(...table.slots.filter(slot => area.rangeNames.has(slot.range)));

  const titleSlots = dateSlots(titleText, {year}).filter(slot =>
    belongsToNotice(slot, published, false),
  );
  const timesOf = candidates => {
    const [slotSource, slots] = candidates.find(([, candidate]) => candidate.length) ?? [
      'none',
      [],
    ];
    return {slots: tidySlots(slots).map(({range, ...slot}) => slot), slotSource};
  };
  const outsideAreas = [
    ['letter', looseSlots],
    ['title', titleSlots],
  ];
  const result = areas.map(({keys, schedule, dated, rangeNames, ...area}) => ({
    ...area,
    ...(rangeNames.size === 1 ? {range: [...rangeNames][0]} : {}),
    ...timesOf([['schedule', schedule], ['page', dated], ...outsideAreas]),
  }));

  // A joined list whose points all belong to areas already known adds nothing.
  const known = new Set(areas.flatMap(area => (area.type === 'polygon' ? [...area.keys] : [])));
  const unresolved = joinedLists.filter(list => !list.points.every(p => known.has(pointKey(p))));

  return {
    kind: noticeKind(title),
    year,
    areas: result,
    unresolvedLists: unresolved.length,
    ...(leftOut.count ? {slotsLeftOut: leftOut.count} : {}),
    unplacedSlots: timesOf(outsideAreas),
    pointReadings,
  };
}
