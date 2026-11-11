import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeNoticeText} from '../taiwan-notice/coordinates.mjs';
import {datePhrases, dateSlots, noticeYear} from '../taiwan-notice/dates.mjs';

const read = raw =>
  datePhrases(normalizeNoticeText(raw)).map(
    ({days, times}) =>
      `${days.map(d => `${d.month}/${d.day}${d.reserve ? 'r' : ''}`).join(' ')} | ${times
        .map(t => `${t.from}-${t.to}`)
        .join(' ')}`,
  );

// Each sample keeps the line breaks and the neighbouring column of a
// published form.
test('a list of days with one time', () => {
  assert.deepEqual(read('民國115年12月16、17日,\n 交通部航港局 射擊日期 每日1400-1700時,計2日。'), [
    '12/16 12/17 | 1400-1700',
  ]);
  assert.deepEqual(
    read(
      '115年4月1-2、7-10、\n 民用航空局 射擊時間 13-17 、20\n 飛航服務總臺 日 , 每 日 0700-1630\n 時。',
    ),
    ['4/1 4/2 4/7 4/8 4/9 4/10 4/13 4/14 4/15 4/16 4/17 4/20 | 700-1630'],
  );
});

test('reserve days named after the list', () => {
  assert.deepEqual(
    read(
      '115年8月10、11、12日,0500-\n 中華電信股份有限公射擊日期 0700 時,共計3 日\n (11、12 日為預備日)',
    ),
    ['8/10 8/11r 8/12r | 500-700'],
  );
  assert.deepEqual(read('(二)預備日:115年10月21日(週三)1700-2000時。'), ['10/21r | 1700-2000']);
});

test('several lists in one sentence, each with its own times', () => {
  assert.deepEqual(
    read(
      '民國 115年12月\n 交通部航政司 2、3 日 0900-1700時\n 交通部航港局 15日 0900-1130時\n交通部航港局北部航務中心 16日 0900-1130時、1400-1700\n 射擊日期 時\n ,計 7日。',
    ),
    ['12/2 12/3 | 900-1700', '12/15 | 900-1130', '12/16 | 900-1130 1400-1700'],
  );
});

test('a list that runs into the next month', () => {
  assert.deepEqual(
    read('115年 8 月 25、26\n 日及 9 月 7、8、9 日\n交通部航港局中部航務中心 1840-2040時'),
    ['8/25 8/26 9/7 9/8 9/9 | 1840-2040'],
  );
});

test('the notice to mariners gives days without times', () => {
  assert.deepEqual(read('說 明:115年12月1-4、7-11日在下列位址連線範圍內進行軍事操演'), [
    '12/1 12/2 12/3 12/4 12/7 12/8 12/9 12/10 12/11 | ',
  ]);
});

test('numbers that are not days are left alone', () => {
  // The count of days, and the row number of the distribution list.
  assert.deepEqual(
    read('114 年 9月 2、5及 12 日,\n 處基隆營運中心作業股 計 3日,每日 0800-1200、1400-\n 1800。'),
    ['9/2 9/5 9/12 | 800-1200 1400-1800'],
  );
  assert.deepEqual(read('114年 9 月 1、4、23 及\n3 交通部航港局 25日'), ['9/1 9/4 9/23 | ']);
  // A day struck out by an amendment.
  assert.deepEqual(read('115年 3月 10、11、(刪除)12、\n 13 日每日 1200-1700時'), [
    '3/10 3/11 3/13 | 1200-1700',
  ]);
});

test('the date of a letter is not a firing date', () => {
  assert.deepEqual(read('發文日期:中華民國115年10月14日'), []);
  assert.deepEqual(read('依據 115 年 4月 10日國海戰訓字第 1150027900 號函'), []);
});

test('slots are in UTC; a day without a time is the whole day in Taiwan', () => {
  assert.deepEqual(dateSlots(normalizeNoticeText('115年12月16日1400-1700時')), [
    {start: '2026-12-16T06:00:00.000Z', end: '2026-12-16T09:00:00.000Z'},
  ]);
  assert.deepEqual(dateSlots(normalizeNoticeText('115年12月16日在下列位址')), [
    {start: '2026-12-15T16:00:00.000Z', end: '2026-12-16T16:00:00.000Z', wholeDay: true},
  ]);
});

test('the fleet command form: month, day and time without a year', () => {
  const text = '執行時間\n交通部民用航空局 1116/1200-1600\n(演訓期間)';
  assert.deepEqual(dateSlots(text), []);
  assert.deepEqual(dateSlots(text, {year: 2026}), [
    {start: '2026-11-16T04:00:00.000Z', end: '2026-11-16T08:00:00.000Z'},
  ]);
  assert.equal(noticeYear('115年11月--國防部海軍艦隊指揮部重要操演'), 2026);
});

test('the fleet command form: an end on another day, and dotted dates', () => {
  assert.deepEqual(dateSlots('執行時間 1006/0800-1007/0759', {year: 2026}), [
    {start: '2026-10-06T00:00:00.000Z', end: '2026-10-06T23:59:00.000Z'},
  ]);
  assert.deepEqual(dateSlots(' 115.3.17 P-3C(1批/1 架次) 4,000 呎\n 0800-1200 (含)以下'), [
    {start: '2026-03-17T00:00:00.000Z', end: '2026-03-17T04:00:00.000Z'},
  ]);
});

test('times marked as local with an L', () => {
  assert.deepEqual(
    read('執行時間 115年 11月 25、26日\n 飛航服務總臺 (演訓期間) 自 06:00L至07:50L止'),
    ['11/25 11/26 | 600-750'],
  );
});

test('hours printed in a box of their own apply to the days on the page', () => {
  const page = normalizeNoticeText(
    '本院系統測試訂於114年8月16、17日在本島東南沿海舉行\n 交通部航港局 自08:00L 至 17:00L 止\n 九鵬地區',
  );
  assert.deepEqual(dateSlots(page), [
    {start: '2025-08-16T00:00:00.000Z', end: '2025-08-16T09:00:00.000Z'},
    {start: '2025-08-17T00:00:00.000Z', end: '2025-08-17T09:00:00.000Z'},
  ]);
});

test('two sessions a day, each on a line of its own', () => {
  const page = normalizeNoticeText(
    ' 114 年10月1日\n 射擊時間 A 08:00L 至 12:00L\n B 13:00L 至 17:00L',
  );
  assert.deepEqual(
    dateSlots(page).map(s => `${s.start.slice(11, 16)}-${s.end.slice(11, 16)}`),
    ['00:00-04:00', '05:00-09:00'],
  );
});

test('the date under the reference number of a form is not a firing date', () => {
  assert.deepEqual(read('發文字號:\n115年10月29日\n艦直屬字第1153104050號'), []);
});

test('the term of a launch permit is not a firing date', () => {
  assert.deepEqual(read('發射許可:效期為 115年4月 28日起至 116年4月 27日止。'), []);
});

test('Gregorian dates as the space agency writes them', () => {
  const slots = dateSlots(
    normalizeNoticeText('備用日: 2026/07/26 13:30-18:00\n2026/08/02 09:00-13:30'),
  );
  assert.deepEqual(
    slots.map(s => `${s.start.slice(0, 16)}/${s.end.slice(11, 16)}`),
    ['2026-07-26T05:30/10:00', '2026-08-02T01:00/05:30'],
  );
});

test('a night slot whose end day was typed as its start day ends the next morning', () => {
  const slots = dateSlots('0821/1400-0822/0759\n0822/1400-0822/0759', {year: 2026});
  assert.deepEqual(
    slots.map(slot => [slot.start, slot.end]),
    [
      ['2026-08-21T06:00:00.000Z', '2026-08-21T23:59:00.000Z'],
      ['2026-08-22T06:00:00.000Z', '2026-08-22T23:59:00.000Z'],
    ],
  );
});

test('the month of a later date is not a day of the month named before it', () => {
  const days = raw => dateSlots(normalizeNoticeText(raw)).map(slot => slot.start.slice(5, 10));
  assert.deepEqual(days('115年3月下旬及4月上旬-東南沿海實彈射擊'), []);
  assert.deepEqual(days('114年10月(取消)--中山科學院(取消)10月14日至10月16日九鵬地區'), []);
  assert.deepEqual(days('115年3月2、4日--R27靶區'), ['03-01', '03-03']);
});
