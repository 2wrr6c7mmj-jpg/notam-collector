import test from 'node:test';
import assert from 'node:assert/strict';
import {readNotice} from '../taiwan-notice/notice.mjs';
import {confirmScannedAreas} from '../taiwan-notice/known-areas.mjs';

const CORNERS = [`22°32'N 121°02'E`, `22°19'N 120°53'E`, `22°06'N 120°53'E`, `22°06'N 122°06'E`];
const form = (corners, dates) =>
  `射擊日期 ${dates}\n${corners.map((corner, i) => `${'ABCDE'[i]} : ${corner}`).join('\n')}`;
const typed = readNotice({
  title: '115年5月--東南沿海實彈射擊',
  attachments: [{pages: [form(CORNERS, '115年5月5日')]}],
});
const scanned = (corners, dates = '115年6月9日') =>
  readNotice({
    title: '115年6月--東南沿海實彈射擊',
    attachments: [{ocr: true, pages: [form(corners, dates)]}],
  });
const days = area => area.slots.map(slot => slot.start.slice(5, 10));

test('a scan read once is confirmed by the same area in another notice', () => {
  const alone = scanned(CORNERS);
  assert.equal(alone.areas.length, 0);
  assert.equal(alone.unconfirmedOcrAreas.length, 1);
  const [, confirmed] = confirmScannedAreas([typed, alone]);
  assert.equal(confirmed.unconfirmedOcrAreas, undefined);
  assert.equal(confirmed.areas.length, 1);
  assert.equal(confirmed.areas[0].ocr, true);
  assert.equal(confirmed.areas[0].confirmedByKnownArea, true);
  assert.deepEqual(days(confirmed.areas[0]), ['06-08']);
});

test('a scan that lost a corner is drawn with the corners of the known area', () => {
  const [, confirmed] = confirmScannedAreas([typed, scanned(CORNERS.slice(1))]);
  assert.equal(confirmed.areas[0].points.length, 4);
  assert.deepEqual(confirmed.areas[0].points, typed.areas[0].points);
});

test('a misread digit that puts a corner outside every known area stays unconfirmed', () => {
  const misread = scanned([CORNERS[0], `22°19'N 120°33'E`, ...CORNERS.slice(2)]);
  const [, same] = confirmScannedAreas([typed, misread]);
  assert.equal(same, misread);
});

test('corners that two known areas share do not say which one is meant', () => {
  const other = readNotice({
    title: '115年5月--東南沿海實彈射擊',
    attachments: [{pages: [form([...CORNERS.slice(1), `22°40'N 122°06'E`], '115年5月6日')]}],
  });
  const [, , unsure] = confirmScannedAreas([typed, other, scanned(CORNERS.slice(1))]);
  assert.equal(unsure.areas.length, 0);
  assert.equal(unsure.unconfirmedOcrAreas.length, 1);
});

test('two misreadings of one area in a notice come out as one area', () => {
  const notice = readNotice({
    title: '115年6月--東南沿海實彈射擊',
    attachments: [
      {
        ocr: true,
        pages: [form(CORNERS.slice(1), '115年6月9日'), form(CORNERS.slice(0, 3), '115年6月10日')],
      },
    ],
  });
  assert.equal(notice.unconfirmedOcrAreas.length, 2);
  const [, confirmed] = confirmScannedAreas([typed, notice]);
  assert.equal(confirmed.areas.length, 1);
  assert.deepEqual(days(confirmed.areas[0]), ['06-08', '06-09']);
});

test('a misread corner that stays inside the known area does not hide which area is meant', () => {
  // 22°13'N 120°53'E lies on the western edge; the other three corners match.
  const misread = scanned([CORNERS[0], `22°13'N 120°53'E`, ...CORNERS.slice(2)]);
  const [, confirmed] = confirmScannedAreas([typed, misread]);
  assert.deepEqual(confirmed.areas[0].points, typed.areas[0].points);
});

test('both readings losing the same corner of a known area does not make a smaller area', () => {
  const pages = [form(CORNERS.slice(1), '115年6月9日')];
  const twice = readNotice({
    title: '115年6月--東南沿海實彈射擊',
    attachments: [{ocr: true, pages, otherReadings: [pages]}],
  });
  assert.equal(twice.areas[0].points.length, 3);
  const [, confirmed] = confirmScannedAreas([typed, twice]);
  assert.equal(confirmed.areas.length, 1);
  assert.deepEqual(confirmed.areas[0].points, typed.areas[0].points);
  assert.deepEqual(days(confirmed.areas[0]), ['06-08']);
});

// A scan whose list of corners gives no area, read again line by line.
const lines = corners => [corners, corners];
const fromLists = corners =>
  readNotice({
    title: '115年6月--東南沿海實彈射擊',
    attachments: [{ocr: true, pages: ['射擊日期 115年6月9日'], coordinateLists: [lines(corners)]}],
  });

test('points read line by line are drawn as the known area they are corners of', () => {
  const inside = `22°15'N 121°30'E`;
  const notice = fromLists([...CORNERS.slice(1), inside]);
  assert.equal(notice.areas.length, 0);
  assert.equal(notice.scanPoints.length, 4);
  const [, confirmed] = confirmScannedAreas([typed, notice]);
  assert.equal(confirmed.scanPoints, undefined);
  assert.deepEqual(confirmed.areas[0].points, typed.areas[0].points);
  assert.equal(confirmed.areas[0].cornersRead, 3);
  assert.equal(confirmed.areas[0].confirmedByKnownArea, true);
  assert.deepEqual(days(confirmed.areas[0]), ['06-08']);
});

test('two corners are too few, and a point outside the area rules it out', () => {
  const few = fromLists(CORNERS.slice(2));
  const outside = fromLists([...CORNERS.slice(1), `23°15'N 121°30'E`]);
  const [, sameFew, sameOutside] = confirmScannedAreas([typed, few, outside]);
  assert.equal(sameFew, few);
  assert.equal(sameOutside, outside);
});
