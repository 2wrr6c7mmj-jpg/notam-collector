import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attachmentIds,
  readIntoEntry,
  updateLedger,
  waitingNotices,
} from '../taiwan-notice/update-ledger.mjs';

const file = fileId =>
  `https://www.fa.gov.tw/redirect_file.php?theme=Shooting_bulletin&id=${fileId}`;
const item = (number, listed = []) => ({
  id: `TW-FA-${number}`,
  sourceId: 'tw-fisheries',
  location: '115年11月--東南沿海實彈射擊',
  taiwan: {
    publication: {value: '2026-11-02'},
    attachments: listed.map(fileId => ({url: file(fileId), state: 'pending'})),
  },
});
const entry = (fileIds, areas = []) => ({
  title: '115年11月--東南沿海實彈射擊',
  published: '2026-11-02',
  kind: 'notice',
  attachments: fileIds.map(fileId => ({fileId, sha256: 'ab'.repeat(32)})),
  areas,
});
const form = [
  '射擊通報單',
  '射擊日期：115年11月20日0800時至1200時',
  'A：22°30′00″N 121°00′00″E',
  'B：22°30′00″N 121°30′00″E',
  'C：22°00′00″N 121°30′00″E',
  'D：22°00′00″N 121°00′00″E',
].join('\n');

test('new notices wait first, newest first, then notices with other attachments', () => {
  const ledger = {
    notices: {1400: entry(['501', '502']), 1401: entry(['601']), 1402: entry(['701'])},
  };
  const items = [
    item(1400, ['502', '501']),
    item(1401, ['601', '602']),
    item(1402),
    item(1403),
    item(1405),
    {id: 'TW-MOA-9', sourceId: 'tw-moa-ship', location: '其他'},
  ];
  assert.deepEqual(
    waitingNotices(items, ledger).map(notice => notice.number),
    ['1405', '1403', '1401'],
  );
  assert.deepEqual(waitingNotices(items, ledger)[0], {
    number: '1405',
    title: '115年11月--東南沿海實彈射擊',
    published: '2026-11-02',
  });
});

test('the attachments of a notice are the files its page links to, once each', () => {
  const html = `<ul class="download-list">
    <li><a href="redirect_file.php?theme=Shooting_bulletin&amp;id=26179" title="pdf">通報單</a></li>
    <li><a href='redirect_file.php?theme=Shooting_bulletin&id=26180'>航船布告</a></li>
    <li><a href="redirect_file.php?theme=Shooting_bulletin&amp;id=26179">通報單</a></li>
    <li><a href="redirect_file.php?theme=News&amp;id=5">其他</a></li></ul>`;
  assert.deepEqual(attachmentIds(html), ['26179', '26180']);
});

test('a notice is read into an entry of areas, times and the files read', () => {
  const files = [{fileId: '801', sha256: 'cd'.repeat(32)}];
  const source = {title: '115年11月--東南沿海實彈射擊', published: '2026-11-02', files};
  const {entry: read, complete} = readIntoEntry(source, [{format: 'pdf', pages: [form]}], {
    notices: {},
  });
  assert.equal(complete, true);
  assert.deepEqual(read.attachments, files);
  assert.equal(read.areas[0].points.length, 4);
  assert.deepEqual(read.areas[0].slots, [
    [Date.parse('2026-11-20T08:00+08:00'), Date.parse('2026-11-20T12:00+08:00')],
  ]);
  assert.equal(
    readIntoEntry(source, [{format: 'other', pages: []}], {notices: {}}).complete,
    false,
  );
});

const answering = statuses => {
  const requested = [];
  const fetcher = async url => {
    requested.push(new URL(url).pathname);
    return new Response(null, {status: statuses[requested.length - 1] ?? 500});
  };
  return {requested, fetcher};
};

test('nothing is requested when no notice is waiting', async () => {
  const ledger = {notices: {1400: entry(['501'])}};
  const {requested, fetcher} = answering([]);
  const result = await updateLedger([item(1400)], ledger, {fetcher, gapMs: 0});
  assert.equal(result.ledger, ledger);
  assert.deepEqual(requested, []);
});

test('nothing is fetched unless robots.txt is plainly absent', async () => {
  const ledger = {notices: {}};
  for (const status of [200, 500]) {
    const {requested, fetcher} = answering([status]);
    const result = await updateLedger([item(1400)], ledger, {fetcher, gapMs: 0});
    assert.deepEqual(requested, ['/robots.txt']);
    assert.equal(result.done.stopped, 'robots.txt');
    assert.equal(result.ledger, ledger);
  }
});

test('a refusal stops the run and a failed page is tried again next time', async () => {
  const ledger = {notices: {}};
  const refused = answering([404, 500, 429]);
  const result = await updateLedger([item(1400), item(1401), item(1402)], ledger, {
    fetcher: refused.fetcher,
    gapMs: 0,
  });
  assert.deepEqual(refused.requested, ['/robots.txt', '/view.php', '/view.php']);
  assert.deepEqual(result.done.retry, ['1402']);
  assert.equal(result.done.stopped, 'HTTP 429');
  assert.equal(result.ledger, ledger);
});
