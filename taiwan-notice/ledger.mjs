// The ledger keeps what was read from each Taiwanese firing notice: its
// areas and the times each is active, and nothing else. The text taken out of
// the attachments stays where it was extracted (it names contact persons);
// the ledger is what the published data is built from.
//
// One entry per notice, keyed by the notice number of the Fisheries Agency
// page (view.php?theme=Shooting_bulletin&id=<number>):
//
//   {title, published, kind, attachments: [{fileId, sha256}], areas, unread?}
//
// `attachments` are the files the entry was read from. A file never changes
// under its fileId; a notice that is revised gets other files, and its entry
// is then out of date.
//
// An area is {type: 'polygon', points: [[lat, lon], ...]} or
// {type: 'circle', centre: [lat, lon], radiusNm}, with `slots`
// ([start, end] in epoch milliseconds, plus 'day' for a slot that names only
// the day and 'reserve' for a reserve day), `slotSource`, and `marks` that
// say how far the area can be trusted (see MARKS).
const METRES_PER_NM = 1852;
const round = degrees => Math.round(degrees * 1e6) / 1e6;
const position = ({lat, lon}) => [round(lat), round(lon)];

// Properties of an area as readNotice and confirmScannedAreas return it.
const MARKS = [
  'ocr', // read by character recognition
  'confirmedByKnownArea', // drawn with the corners of the same area in another notice
  'outlineOnly', // the outline of a list that also names points inside it
  'reordered', // corners put in order around the outline
  'fromMinimumRadius', // a centre and the smallest radius that covers the area
];

function ledgerArea(area) {
  const shape =
    area.type === 'circle'
      ? {type: 'circle', centre: position(area.centre), radiusNm: area.radiusNm}
      : {type: 'polygon', points: area.points.map(position)};
  const marks = MARKS.filter(mark => area[mark]);
  return {
    ...shape,
    ...(area.range ? {range: area.range} : {}),
    slots: area.slots.map(slot => [
      Date.parse(slot.start),
      Date.parse(slot.end),
      ...(slot.wholeDay ? ['day'] : []),
      ...(slot.reserve ? ['reserve'] : []),
    ]),
    slotSource: area.slotSource,
    ...(marks.length ? {marks} : {}),
  };
}

// `notice` is a result of readNotice that has been through
// confirmScannedAreas; `source` is {title, published, attachments}.
export function ledgerEntry(notice, {title, published, attachments}) {
  const unread = {
    ...(notice.unconfirmedOcrAreas?.length
      ? {unconfirmedAreas: notice.unconfirmedOcrAreas.length}
      : {}),
    ...(notice.unresolvedLists ? {unresolvedLists: notice.unresolvedLists} : {}),
    ...(notice.slotsLeftOut ? {slotsLeftOut: notice.slotsLeftOut} : {}),
  };
  return {
    title,
    published,
    kind: notice.kind,
    attachments: attachments.map(({fileId, sha256}) => ({fileId, sha256})),
    areas: notice.areas.map(ledgerArea),
    ...(Object.keys(unread).length ? {unread} : {}),
  };
}

const period = ([start, end, ...flags]) => ({
  start,
  end,
  ...(flags.includes('day') ? {precision: 'date'} : {}),
  ...(flags.includes('reserve') ? {scopeLabel: '予備日'} : {}),
});

// What an entry puts on the map, in the form of the maritime contract: one
// shape per area with the periods it is active, and the periods of the notice
// as a whole. Only areas with times are drawn; a notice that cancels another
// draws nothing. `sourceUrl` is the page of the notice.
export function mapFacts(entry, sourceUrl) {
  const drawn = entry.kind === 'cancellation' ? [] : entry.areas.filter(area => area.slots.length);
  const shapes = drawn.map(area => ({
    ...(area.type === 'circle'
      ? {kind: 'circle', points: [area.centre], radius: area.radiusNm * METRES_PER_NM}
      : {kind: 'polygon', points: area.points}),
    provenance: 'text',
    sourceReference: sourceUrl,
    validityPeriods: area.slots.map(period),
  }));
  const unique = new Map();
  for (const shape of shapes)
    for (const slot of shape.validityPeriods) {
      const key = `${slot.start} ${slot.end}`;
      // Stated for one area as a reserve day and for another without the mark.
      if (!unique.has(key) || !slot.scopeLabel) unique.set(key, slot);
    }
  const validityPeriods = [...unique.values()].sort((a, b) => a.start - b.start || a.end - b.end);
  return {
    shapes,
    validityPeriods,
    start: validityPeriods.length ? validityPeriods[0].start : null,
    end: validityPeriods.length ? Math.max(...validityPeriods.map(slot => slot.end)) : null,
  };
}
