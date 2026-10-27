import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeSiteItems, stillRelevant} from '../tools/seed-china-from-site.mjs';

const now = Date.parse('2026-10-28T00:00:00Z'), DAY = 86400000;
const item = (id, over = {}) => ({id, text: id, shapes: [], warnings: [], sourceUrl: `https://www.msa.gov.cn/${id}.html`, issued: now - 5 * DAY, end: now + DAY, cancelled: false, ...over});
const record = items => ({items, status: {id: 'gd', count: items.length}, firstPage: {entries: []}});

test('copies only still-relevant warnings that the collector does not have', () => {
  const existing = item('粤航警750/2026', {text: 'collector copy'});
  const site = [
    {...item('粤航警750/2026', {text: 'sites copy'}), sourceId: 'gd'},            // present: collector wins
    {...item('粤航警739/2026'), sourceId: 'gd'},                                  // active: copied
    {...item('粤航警600/2026', {end: now - DAY}), sourceId: 'gd'},                // ended
    {...item('粤航警601/2026', {cancelled: true}), sourceId: 'gd'},              // cancelled
    {...item('粤航警602/2026', {end: null, issued: now - 200 * DAY}), sourceId: 'gd'}, // old undated
    {...item('粤航警603/2026', {end: null, issued: now - 10 * DAY}), sourceId: 'gd'},  // recent undated
    {...item('X', {chinaFirstPage: {sourceId: 'sz'}}), sourceId: 'gd'},          // belongs elsewhere
  ];
  const {record: merged, added, skipped} = mergeSiteItems(record([existing]), 'gd', site, now);
  assert.deepEqual(added.sort(), ['粤航警603/2026', '粤航警739/2026']);
  assert.equal(merged.items.find(n => n.id === '粤航警750/2026').text, 'collector copy');
  assert.ok(merged.items.every(n => !('sourceId' in n)), 'payload-only field is not stored');
  assert.equal(merged.status.count, merged.items.length);
  assert.deepEqual(skipped, {present: 1, notRelevant: 3, otherSource: 1, budget: 0});
});

test('stays under the storage budget, keeping the newest warnings', () => {
  const site = [1, 2, 3].map(i => ({...item(`W${i}`, {issued: now - i * DAY, text: 'x'.repeat(400)}), sourceId: 'gd'}));
  const base = record([]), limit = JSON.stringify(base).length + 2 * JSON.stringify(site[0]).length;
  const {added, skipped} = mergeSiteItems(base, 'gd', site, now, limit);
  assert.deepEqual(added, ['W1', 'W2']);
  assert.equal(skipped.budget, 1);
});

test('relevance: not cancelled, not ended, or undated within 90 days', () => {
  assert.equal(stillRelevant(item('a'), now), true);
  assert.equal(stillRelevant(item('b', {end: now - 1}), now), false);
  assert.equal(stillRelevant(item('c', {end: null, issued: now - 89 * DAY}), now), true);
  assert.equal(stillRelevant(item('d', {end: null, issued: null}), now), false);
});
