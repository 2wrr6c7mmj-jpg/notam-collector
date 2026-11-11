import test from 'node:test';
import assert from 'node:assert/strict';
import {stripAttachmentText} from '../tools/strip-taiwan-attachment-text.mjs';

const kept = '115年11月--東南沿海實彈射擊\n發布日期: 115-11-02';
const saved = `${kept}\n\n原文添付: https://www.fa.gov.tw/redirect_file.php?theme=Shooting_bulletin&id=501\n射擊通報單\n承辦人：某某`;

test('saved attachment text is cut from items and from the cache, and nothing else changes', () => {
  const record = {
    items: [
      {id: 'TW-FA-1400', text: saved, shapes: []},
      {id: 'TW-FA-1401', text: kept},
    ],
    revision: 3,
    twOdt: {
      version: 2,
      cursor: 1,
      cache: {
        'TW-FA-1400': {
          checkedAt: 5,
          enriched: {id: 'TW-FA-1400', text: saved},
          lastSuccess: undefined,
        },
        'TW-FA-1401': {checkedAt: 6, outcome: 'error'},
      },
    },
    status: {id: 'tw-fisheries'},
  };
  const {record: cleaned, cut} = stripAttachmentText(record);
  assert.equal(cut, 2);
  assert.equal(cleaned.items[0].text, kept);
  assert.equal(cleaned.twOdt.cache['TW-FA-1400'].enriched.text, kept);
  assert.equal(JSON.stringify(cleaned).includes('承辦人'), false);
  assert.deepEqual(cleaned.items[1], record.items[1]);
  assert.deepEqual(cleaned.twOdt.cache['TW-FA-1401'], record.twOdt.cache['TW-FA-1401']);
  assert.deepEqual(cleaned.status, record.status);
  assert.equal(stripAttachmentText(cleaned).cut, 0);
});
