import test from 'node:test';
import assert from 'node:assert/strict';
import {scheduleTable, taipeiInstant} from '../taiwan-notice/schedule.mjs';

const WEEKDAYS = '一二三四五六日';
// A month of blank day lines with the given lines filled in, as the tables
// are printed.
const table = (title, header, filled) =>
  [
    title,
    header,
    ...Array.from({length: 30}, (_, i) => {
      const day = String(i + 1).padStart(2, '0');
      return ` ${day}      ${WEEKDAYS[i % 7]}      ${filled[i + 1] ?? ''}`;
    }),
  ].join('\n');

const times = slots => slots.map(s => `${s.start.slice(5, 16)}/${s.end.slice(5, 16)}`);

test('local time in Taiwan is eight hours ahead of UTC', () => {
  assert.equal(taipeiInstant(2026, 12, 16, 1400), '2026-12-16T06:00:00.000Z');
  assert.equal(taipeiInstant(2026, 12, 1, 500), '2026-11-30T21:00:00.000Z');
});

test('reads an army table and skips its UTC column', () => {
  const result = scheduleTable(
    table(
      '1 2 0 H 2部隊金 門 地 區 民 國1 1 5年12月份 時 段 申 請 表',
      '日期 星期 射擊時間 標準時間(格林威治時間)',
      {
        5: '0800-1200、1400-1800 時      0000-0400、0600-1000 時',
        16: '1400-1700時                 0600-0900時',
        17: '1400-1700時(預備日)         0600-0900時(預備日)',
      },
    ),
  );
  assert.equal(result.year, 2026);
  assert.equal(result.month, 12);
  assert.deepEqual(times(result.slots), [
    '12-05T00:00/12-05T04:00',
    '12-05T06:00/12-05T10:00',
    '12-16T06:00/12-16T09:00',
    '12-17T06:00/12-17T09:00',
  ]);
  assert.deepEqual(
    result.slots.map(s => !!s.reserve),
    [false, false, false, true],
  );
});

test('a UTC column written with dates, and a time split by the text layer', () => {
  const result = scheduleTable(
    table('33E01部隊東引地區115年1月份時段申請表', '日期 星期 射擊時間 標準時間(格林威治時間)', {
      7: '0500-0800 時       6日 2100 時-7 日 0000時',
      8: '0800時-22 00時(預備日 )      0000時-1400 時(預備日 )',
      9: '0800時-1200時        1月9日0000時-0400時',
    }),
  );
  assert.deepEqual(times(result.slots), [
    '01-06T21:00/01-07T00:00',
    '01-08T00:00/01-08T14:00',
    '01-09T00:00/01-09T04:00',
  ]);
});

test('a navy table gives each time to the range of its column', () => {
  const result = scheduleTable(
    table(
      '國 防 部 海 軍 司 令 部                   115      年    11     月份靶區時段申請表',
      '日期 靶區             R-18              R-25             R-27             R-39         備註',
      {
        2: '  0800-1700        0700-1700        0800-1700        0700-1700',
        3: `${' '.repeat(19)}0700-1700${' '.repeat(25)}2200-0200`,
      },
    ),
  );
  assert.deepEqual(result.ranges, ['R-18', 'R-25', 'R-27', 'R-39']);
  assert.deepEqual(
    result.slots.map(s => s.range),
    ['R-18', 'R-25', 'R-27', 'R-39', 'R-25', 'R-39'],
  );
  // Ends after midnight.
  assert.equal(times(result.slots).at(-1), '11-03T14:00/11-03T18:00');
});

test('a form that only refers to the table is not a table', () => {
  assert.equal(scheduleTable('射擊時間 如115年7月份靶區時段申請表\n射擊地點 R-18'), null);
});

// The sheets above start on a Monday, as June 2026 does.
test("a sheet left with last month's heading is read as the month its weekdays fit", () => {
  const page = table('部隊金門地區民國115年3月份時段申請表', '日期 星期 射擊時間', {
    9: '0800-1200',
  });
  const read = scheduleTable(page, {noticeMonths: [[2026, 6]]});
  assert.equal(read.month, 6);
  assert.equal(read.monthFromWeekdays, true);
  assert.deepEqual(times(read.slots), ['06-09T00:00/06-09T04:00']);
});

test('the heading stands when the notice names no month the weekdays fit', () => {
  const page = table('部隊金門地區民國115年3月份時段申請表', '日期 星期 射擊時間', {
    9: '0800-1200',
  });
  for (const noticeMonths of [[], [[2026, 3]], [[2026, 5]]]) {
    const read = scheduleTable(page, {noticeMonths});
    assert.equal(read.month, 3);
    assert.equal(read.monthFromWeekdays, undefined);
  }
});
