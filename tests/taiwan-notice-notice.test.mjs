import test from 'node:test';
import assert from 'node:assert/strict';
import {readNotice, noticeKind} from '../taiwan-notice/notice.mjs';

const WEEKDAYS = '一二三四五六日';
const month = (title, header, filled) =>
  [
    title,
    header,
    ...Array.from({length: 30}, (_, i) => {
      const day = String(i + 1).padStart(2, '0');
      return `  ${day}    ${WEEKDAYS[i % 7]}        ${filled[i + 1] ?? ''}`;
    }),
  ].join('\n');

const form = (place, corners, dates) => `國防部陸軍司令部演訓場域通報單
 射擊日期 ${dates}
 射擊地點 ${place}
${corners.map((corner, i) => ` 危險區域 ${'ABCD'[i]}: ${corner}`).join('\n')}
 危險區域中心
 點 ⊕:24°23'36"N 118°12'41"E
 最小半徑 2浬(NM)`;
const mariners = (corners, dates) => `航船布告
 說 明:${dates}在下列位址連線範圍內進行軍事操演,禁止進入該操演水域。
 位 置:${corners.map(c => c.replace(/(\S+)N (\S+)E/, '北緯 $1 ,東經 $2。')).join('\n ')}*WGS84
 NOTICE TO MARINERS
Positions:${corners.map(c => c.replace(/(\S+)N (\S+)E/, 'Lat. $1N.,Long.$2E.')).join('\n ')} *WGS84`;

const TIGER = [
  `24°23'50"N 118°11'37"E`,
  `24°23'37"N 118°13'59"E`,
  `24°23'13"N 118°13'54"E`,
  `24°23'46"N 118°11'35"E`,
];
const PEAK = [
  `24°25'40"N 118°27'29"E`,
  `24°24'50"N 118°28'30"E`,
  `24°24'06"N 118°27'35"E`,
  `24°24'56"N 118°27'02"E`,
];
const times = area =>
  area.slots.map(
    s => `${s.start.slice(5, 16)}/${s.end.slice(11, 16)}${s.reserve ? ' reserve' : ''}`,
  );

test('each form is followed by its schedule table and its notice to mariners', () => {
  const header = '日期 星期 射擊時間 標準時間(格林威治時間)';
  const {areas, kind, year} = readNotice({
    title: '115年12月--國防部陸軍金門防衛指揮部對海實彈射擊',
    attachments: [
      {pages: ['主旨:檢送本部115年12月份演訓場域通報單,請查照。']},
      {
        pages: [
          form('金門地區猛虎嶼海域', TIGER, '民國115年12月16、17日,每日1400-1700時,計2日。'),
          month('120H2部隊金門地區民國115年12月份時段申請表', header, {
            16: '1400-1700時          0600-0900時',
            17: '1400-1700時(預備日)  0600-0900時(預備日)',
          }),
          mariners(TIGER, '115 年 12 月 16、17 日'),
          form('金門地區峰上海域', PEAK, '民國115年12月2日 0900-1700時'),
          month('120D1部隊金門地區民國115年12月份時段申請表', header, {
            2: '0900-1700時          0100-0900時',
          }),
          mariners(PEAK, '115 年 12 月 2 日'),
        ],
      },
    ],
  });
  assert.equal(kind, 'notice');
  assert.equal(year, 2026);
  assert.equal(areas.length, 2);
  assert.deepEqual(
    areas.map(a => a.slotSource),
    ['schedule', 'schedule'],
  );
  assert.deepEqual(times(areas[0]), ['12-16T06:00/09:00', '12-17T06:00/09:00 reserve']);
  assert.deepEqual(times(areas[1]), ['12-02T01:00/09:00']);
  assert.equal(areas[0].points.length, 4);
});

test('a navy table gives each range its own times', () => {
  const navyForm = (range, corners) => `國防部海軍司令部對海(空)實彈射擊報告單
 射擊時間 如115年11月份靶區時段申請表
 射擊地點 ${range}
${corners.map((corner, i) => ` ${'ABCD'[i]}:${corner}`).join('\n')}`;
  const {areas} = readNotice({
    title: '115年11月份--國防部海軍司令部R-18、25靶區實彈射擊報告單',
    attachments: [
      {
        pages: [
          navyForm('R-18', [
            `22°54'54"N 119°25'29"E`,
            `22°54'54"N 119°45'29"E`,
            `22°34'54"N 119°45'29"E`,
            `22°34'54"N 119°25'29"E`,
          ]),
          navyForm('R-25', [
            `25°27'54"N 122°00'30"E`,
            `25°27'54"N 122°12'30"E`,
            `25°19'54"N 122°12'30"E`,
            `25°19'54"N 122°00'30"E`,
          ]),
          month(
            '國 防 部 海 軍 司 令 部                   115      年    11     月份靶區時段申請表',
            '日期 靶區             R-18              R-25',
            {2: '0800-1700        0700-1700', 3: `${' '.repeat(17)}0700-1200`},
          ),
        ],
      },
    ],
  });
  assert.deepEqual(
    areas.map(a => a.range),
    ['R-18', 'R-25'],
  );
  assert.deepEqual(times(areas[0]), ['11-02T00:00/09:00']);
  assert.deepEqual(times(areas[1]), ['11-01T23:00/09:00', '11-02T23:00/04:00']);
});

test('without a table the dates on the pages are used; the form gives the hours', () => {
  const {areas} = readNotice({
    title: '115年12月--對海實彈射擊',
    attachments: [
      {
        pages: [
          form('金門地區猛虎嶼海域', TIGER, '民國115年12月16、17日,每日1400-1700時,計2日。'),
          mariners(TIGER, '115 年 12 月 16、17 日'),
        ],
      },
    ],
  });
  assert.equal(areas[0].slotSource, 'page');
  assert.deepEqual(times(areas[0]), ['12-16T06:00/09:00', '12-17T06:00/09:00']);
});

test('the title is the last resort for dates', () => {
  const {areas} = readNotice({
    title: '1141224--114年12月24日1300至1700時止- RCR-27靶區',
    attachments: [{pages: [TIGER.map((c, i) => `${'ABCD'[i]}:${c}`).join('\n')]}],
  });
  assert.equal(areas[0].slotSource, 'title');
  assert.deepEqual(times(areas[0]), ['12-24T05:00/09:00']);
});

test('cancellations and amendments are told by the title', () => {
  assert.equal(noticeKind('114年8月--(取消)海洋委員會海巡署艦隊分署對海實彈射擊'), 'cancellation');
  assert.equal(
    noticeKind('1150909--國防部海軍艦隊指揮部115年10月專案操演演訓場域通報單修正案'),
    'amendment',
  );
  assert.equal(
    noticeKind('115年11月--海軍艦隊指揮部重要操演對海（空）域實彈射擊通報單新增'),
    'amendment',
  );
  assert.equal(noticeKind('115年12月--國防部陸軍金門防衛指揮部對海實彈射擊'), 'notice');
});

test('a notice with only a centre and a minimum radius is drawn as that circle', () => {
  const page = `發射日期及時間 2026/08/01 11:00-18:00
 危險區域中心點 22°10’29’’N, 120°53’45’’E
 涵蓋危險區域最小 865m
 半徑`;
  const {areas} = readNotice({title: '2026火箭競賽陸海空域警戒案', attachments: [{pages: [page]}]});
  assert.equal(areas.length, 1);
  assert.equal(areas[0].type, 'circle');
  assert.equal(areas[0].fromMinimumRadius, true);
  assert.ok(Math.abs(areas[0].radiusNm - 865 / 1852) < 1e-12);
  assert.deepEqual(times(areas[0]), ['08-01T03:00/10:00']);
  // The form of a notice with corners prints a centre and radius too.
  const withCorners = readNotice({
    title: '115年6月份實彈射擊報告單',
    attachments: [{pages: [form('后湖', TIGER, '115年6月9日0800-1200時')]}],
  });
  assert.deepEqual(
    withCorners.areas.map(area => area.type),
    ['polygon'],
  );
});

test('times that cannot belong to the notice are left out', () => {
  // The notice to mariners still carries last month's sentence.
  const notice = {
    title: '115年6月份實彈射擊報告單',
    attachments: [{pages: [mariners(TIGER, '115年5月9、10日'), '主旨:訂於115年6月9日實施射擊']}],
  };
  const unchecked = readNotice(notice);
  assert.deepEqual(times(unchecked.areas[0]), ['05-08T16:00/16:00', '05-09T16:00/16:00']);
  const checked = readNotice({...notice, published: '2026-05-27'});
  assert.equal(checked.slotsLeftOut, 2);
  assert.equal(checked.areas[0].slotSource, 'letter');
  assert.deepEqual(times(checked.areas[0]), ['06-08T16:00/16:00']);
  // A change made a few days after the first firing keeps that firing.
  assert.equal(readNotice({...notice, published: '2026-05-15'}).slotsLeftOut, undefined);
});
