import test from 'node:test';
import assert from 'node:assert/strict';
import {repairOcrText, votedPoints} from '../taiwan-notice/ocr.mjs';
import {normalizeNoticeText, coordinatePairs} from '../taiwan-notice/coordinates.mjs';
import {readNotice} from '../taiwan-notice/notice.mjs';

const points = raw =>
  coordinatePairs(normalizeNoticeText(repairOcrText(raw))).points.map(p => [
    +p.lat.toFixed(4),
    +p.lon.toFixed(4),
  ]);

// Each sample is a coordinate as the recogniser returned it.
test('repairs the slips the recogniser makes on the marks of an angle', () => {
  assert.deepEqual(points(`[B : 22022'00"N 121004'00"E`), [[22.3667, 121.0667]]);
  assert.deepEqual(points(`22932'N 120°58'E`), [[22.5333, 120.9667]]);
  assert.deepEqual(points(`2201800"N 120°54'30"E`), [[22.3, 120.9083]]);
  assert.deepEqual(points(`22*15'0"N 120°55°0"E`), [[22.25, 120.9167]]);
  assert.deepEqual(points(`24° 24N 121°21E`), [[24.4, 121.35]]);
  assert.deepEqual(points(`22°18'00"N 121°0400"E`), [[22.3, 121.0667]]);
  assert.deepEqual(points(`24°40’00.0"N 121°49’00.0"E`), [[24.6667, 121.8167]]);
  assert.deepEqual(points(`北緯22?19'00.0" , 東經120553'00.0" 。`), [[22.3167, 120.8833]]);
  assert.deepEqual(points(`A:22 32N 121°02'E`), [[22.5333, 121.0333]]);
  assert.deepEqual(points(`22 06'N 122 06'E`), [[22.1, 122.1]]);
});

test('a number that lost a digit is not guessed at', () => {
  // 220600N 1222600E with the first digit of each lost.
  assert.deepEqual(points('C(20600N 222600E)'), []);
});

test('text that was read correctly is left alone', () => {
  const clean = `A : 22°18'00"N 120°54'30"E 自08:00L 至 17:00L 止 114年8月16、17日 1200-1700時`;
  assert.equal(repairOcrText(clean), clean);
});

const FORM = `射擊日期| 114年12 月30、31日
 A : 22°32'N 121°02'E
 B : 22°19'N 120°53'E
 C : 22°06'N 120°53'E
 D : 22°06'N 122°06'E
 E : 22°32'N 122°06'E`;
// The same form as a second reading returned it, and with one digit misread.
const FORM_AGAIN = `射擊日期 114年12月30、31日
A:22 32N 121°02'E
B:22 19N 120°53'E
C:22 06N 120°53'E
D:22 06N 122°06'E
E : 22°32'N 122°06'E`;
const FORM_MISREAD = FORM_AGAIN.replace('22 19N', '22 13N');
const TITLE = '114年12月--國家中山科學研究院於本島東南沿海舉行火砲測試';

test('an area read from a scan counts when two readings agree on it', () => {
  const {areas, unconfirmedOcrAreas} = readNotice({
    title: TITLE,
    attachments: [{ocr: true, pages: [FORM], otherReadings: [[FORM_AGAIN]]}],
  });
  assert.equal(areas.length, 1);
  assert.equal(areas[0].ocr, true);
  assert.equal(areas[0].statements, 2);
  assert.equal(areas[0].slots.length, 2);
  assert.deepEqual(unconfirmedOcrAreas, []);
});

test('readings that differ in a digit confirm nothing', () => {
  const {areas, unconfirmedOcrAreas} = readNotice({
    title: TITLE,
    attachments: [{ocr: true, pages: [FORM], otherReadings: [[FORM_MISREAD]]}],
  });
  assert.deepEqual(areas, []);
  assert.equal(unconfirmedOcrAreas.length, 2);
});

test('a scan is not used when the notice has an area in real text', () => {
  const {areas} = readNotice({
    title: TITLE,
    attachments: [
      {pages: [FORM]},
      {ocr: true, pages: [FORM_MISREAD], otherReadings: [[FORM_MISREAD]]},
    ],
  });
  assert.equal(areas.length, 1);
  assert.equal(areas[0].ocr, undefined);
  assert.equal(+areas[0].points[1].lat.toFixed(4), 22.3167);
});

test('a garbled first corner does not shift the corners after it', () => {
  // The recogniser lost the first latitude; the corners are those of the list.
  const mariners = `位置:北緯 24°S6'09" ,東經 120°56'48" -
北緯 24°53'34" > 東經 120°54'24" 。
北緯 24°52'38" , 東經 120°56'57"。
北緯 24°52'26" , 東經 120°58'25" -
北緯 24°54'02" , 東經 120°57'49" - *WGS84`;
  const {areas, unconfirmedOcrAreas} = readNotice({
    title: TITLE,
    attachments: [{ocr: true, pages: [mariners], otherReadings: [[mariners]]}],
  });
  // Four corners were read, the same in both readings, but the stray
  // longitude shows that the list is not whole.
  assert.deepEqual(areas, []);
  assert.equal(unconfirmedOcrAreas.length, 1);
  assert.deepEqual(
    unconfirmedOcrAreas[0].points.map(p => [+p.lat.toFixed(3), +p.lon.toFixed(3)])[0],
    [24.893, 120.907],
  );
});

// Lines of the test range's form at Zhuangwei as the recogniser returned them.
test('reads longitude-first corners whose marks came out as other characters', () => {
  assert.deepEqual(points('0:12149-,24-48-'), [[24.8, 121.8167]]);
  assert.deepEqual(points('B: 121°55~ > 24°50 7'), [[24.8333, 121.9167]]);
  assert.deepEqual(points('H:121°54~ ,247447-'), [[24.7333, 121.9]]);
  assert.deepEqual(points('A:121750 ~,24750-'), [[24.8333, 121.8333]]);
  assert.deepEqual(points('D! 1217507» 2442”'), [[24.7, 121.8333]]);
  assert.deepEqual(points('C:121.55 -,24.40 -'), [[24.6667, 121.9167]]);
  assert.equal(repairOcrText('0:12149-,24-48-').slice(0, 2), 'O:');
  assert.equal(repairOcrText('1: 121°52~ » 24°42 ~').slice(0, 2), 'I:');
});

test('leaves the usual forms and other numbers as they are', () => {
  for (const text of [`121°04'E, 22°15'N`, `22°32'N 121°02'E`, '字第11500053371號 03-0000000#000'])
    assert.equal(repairOcrText(text), text);
});

test('takes each number of a line from the readings that agree on it', () => {
  const readings = [
    ['', `B\\24°50'7 N 121°55° EF`, `D 24°42’ N 121°50’ E`, `E: 24°49' N 121°49' E`],
    ['MSL', `B: 24°50' N 121°55' E`, `Dri N 121°50’ E`, `E: 24°44' N 121°49' E`],
    ['', `AG ON 121°55° E`, `D\\24°42’ N 121°50’ E`, `B;24°44 N 121°49 EO`],
    ['', `B: 24°50' N`, `“42, N 121°30° E`, ''],
  ];
  assert.deepEqual(
    votedPoints(readings).map(p => [+p.lat.toFixed(4), +p.lon.toFixed(4)]),
    [
      [24.8333, 121.9167],
      [24.7, 121.8333],
      [24.7333, 121.8167],
    ],
  );
});

test('a number only one reading saw, or a tie, gives no point', () => {
  assert.deepEqual(votedPoints([[`24°50' N 121°55' E`], [`24°50' N`], ['']]), []);
  assert.deepEqual(
    votedPoints([
      [`24°50' N 121°55' E`],
      [`24°50' N 121°55' E`],
      [`24°40' N 121°55' E`],
      [`24°40' N 121°55' E`],
    ]),
    [],
  );
});

test('an area from a scan that is hundreds of miles wide is a misreading', () => {
  const page = corners =>
    `射擊日期 115年6月9日\n${corners.map((c, i) => `${'ABCD'[i]} : ${c}`).join('\n')}`;
  const read = corners => {
    const pages = [page(corners)];
    return readNotice({
      title: '115年6月--實彈射擊',
      attachments: [{ocr: true, pages, otherReadings: [pages]}],
    });
  };
  const corners = [`22°32'N 121°02'E`, `22°19'N 120°53'E`, `22°06'N 120°53'E`, `22°06'N 122°06'E`];
  assert.equal(read(corners).areas.length, 1);
  const wide = read([...corners.slice(0, 3), `22°06'N 128°06'E`]);
  assert.equal(wide.areas.length, 0);
  assert.equal(wide.unconfirmedOcrAreas.length, 1);
});
