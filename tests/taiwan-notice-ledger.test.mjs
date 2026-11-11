import test from 'node:test';
import assert from 'node:assert/strict';
import {readNotice} from '../taiwan-notice/notice.mjs';
import {ledgerEntry, mapFacts} from '../taiwan-notice/ledger.mjs';

const PAGE = 'https://www.fa.gov.tw/view.php?theme=Shooting_bulletin&subtheme=&id=1200';
const source = {
  title: '115年5月--東南沿海實彈射擊',
  published: '2026-04-20',
  attachments: [{fileId: '24000', sha256: 'a'.repeat(64), name: '報告單.pdf', bytes: 1}],
};
const form = `射擊日期 115年5月5日0800-1200時。
預備日:115年5月6日。
A : 22°32'N 121°02'E
B : 22°19'N 120°53'E
C : 22°06'N 120°53'E
D : 22°06'N 122°06'E`;
const circle = `射擊日期 115年5月7日\n以 23°10'N 119°40'E 為中心,5浬為半徑`;
const entry = (pages, title = source.title) =>
  ledgerEntry(readNotice({title, attachments: [{pages}]}), {...source, title});

test('an entry keeps the areas, their times and the files they were read from', () => {
  const {areas, attachments, kind, published} = entry([form]);
  assert.equal(kind, 'notice');
  assert.equal(published, '2026-04-20');
  assert.deepEqual(attachments, [{fileId: '24000', sha256: 'a'.repeat(64)}]);
  assert.equal(areas.length, 1);
  assert.deepEqual(areas[0].points[0], [22.533333, 121.033333]);
  assert.deepEqual(areas[0].slots[0], [
    Date.parse('2026-05-05T08:00+08:00'),
    Date.parse('2026-05-05T12:00+08:00'),
  ]);
  assert.deepEqual(areas[0].slots[1].slice(2), ['day', 'reserve']);
});

test('areas become shapes of the maritime contract with their own periods', () => {
  const facts = mapFacts(entry([form, circle]), PAGE);
  assert.deepEqual(
    facts.shapes.map(shape => [shape.kind, shape.points.length, shape.validityPeriods.length]),
    [
      ['polygon', 4, 2],
      ['circle', 1, 1],
    ],
  );
  assert.equal(facts.shapes[1].radius, 5 * 1852);
  assert.equal(facts.shapes[0].sourceReference, PAGE);
  assert.equal(facts.validityPeriods.length, 3);
  assert.equal(facts.start, Date.parse('2026-05-05T08:00+08:00'));
  assert.equal(facts.end, Date.parse('2026-05-08T00:00+08:00'));
  assert.deepEqual(facts.validityPeriods[1], {
    start: Date.parse('2026-05-06T00:00+08:00'),
    end: Date.parse('2026-05-07T00:00+08:00'),
    precision: 'date',
    scopeLabel: '予備日',
  });
});

test('an area without times and a cancelling notice draw nothing', () => {
  const undated = mapFacts(entry([form.replace(/^.*\n.*\n/, '')], '東南沿海實彈射擊'), PAGE);
  assert.deepEqual(undated, {shapes: [], validityPeriods: [], start: null, end: null});
  const cancelled = mapFacts(entry([form], '115年5月--東南沿海實彈射擊(取消)'), PAGE);
  assert.deepEqual(cancelled.shapes, []);
});
