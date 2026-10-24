import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {D1Shim} from '../runtime/d1.mjs';
import {RELAY_URL, faaRelayFetcher, featuresOf} from '../runtime/faa.mjs';
import {refreshCode, readCodeRecords} from '../site/lib/nms-store.ts';

const migrations = new URL('../site/drizzle/', import.meta.url).pathname;
const freshDb = () => { const db = new D1Shim(path.join(mkdtempSync(path.join(tmpdir(), 'nc-')), 's.sqlite')); db.migrate(migrations); return db; };

test('D1 shim applies migrations once and reports changes like D1', async () => {
  const db = freshDb();
  db.migrate(migrations); // idempotent
  const ins = await db.prepare('INSERT INTO notam_data (code, data) VALUES (?, ?)').bind('RJTT', '{}').run();
  assert.equal(ins.meta.changes, 1);
  assert.deepEqual((await db.prepare('SELECT code FROM notam_data WHERE code IN (?)').bind('RJTT').all()).results, [{code: 'RJTT'}]);
  assert.equal(await db.prepare('SELECT data FROM notam_data').first('data'), '{}');
  const lease = sql => db.prepare(sql);
  const take = (now) => lease("INSERT INTO nav_refresh (id, started_at, lease_until) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET started_at = excluded.started_at, lease_until = excluded.lease_until WHERE nav_refresh.lease_until <= ?").bind('x', now, now + 1000, now).run();
  assert.equal((await take(1)).meta.changes, 1);
  assert.equal((await take(2)).meta.changes, 0, 'a held lease is not taken again');
});

test('FAA response shapes are read only when recognised', () => {
  assert.deepEqual(featuresOf({data: {geojson: [{a: 1}]}}), [{a: 1}]);
  assert.deepEqual(featuresOf({data: {geojson: {features: [{b: 2}]}}}), [{b: 2}]);
  assert.deepEqual(featuresOf({type: 'FeatureCollection', features: []}), []);
  assert.equal(featuresOf({status: 'Error'}), null);
});

function fakeFaa({fail} = {}) {
  const calls = [];
  const base = async (url, init) => {
    calls.push(String(url));
    if (String(url).endsWith('/auth/token')) return Response.json({access_token: 'tok-123456', expires_in: 1800});
    if (fail) return new Response('{}', {status: fail});
    return Response.json({status: 'Success', data: {geojson: [{type: 'Feature', geometry: {type: 'Point', coordinates: [139.78, 35.55]},
      properties: {coreNOTAMData: {notam: {id: 'N1', number: 'A1234/26', location: 'RJTT', icaoLocation: 'RJTT', text: 'RWY 16R/34L CLSD', effectiveStart: '2026-10-24T00:00:00.000Z', effectiveEnd: '2026-10-25T00:00:00.000Z', issued: '2026-10-23T00:00:00.000Z'}}}}]}});
  };
  return {calls, base};
}

test('the in-process relay answers the Sites provider and other URLs pass through', async () => {
  process.env.FAA_NMS_CLIENT_ID = 'client-abcdef'; process.env.FAA_NMS_CLIENT_SECRET = 'secret-abcdef';
  const {calls, base} = fakeFaa();
  const fetcher = faaRelayFetcher(base);
  const relayed = await (await fetcher(RELAY_URL, {method: 'POST', body: JSON.stringify({codes: ['RJTT'], relaySecret: 'x'})})).json();
  assert.equal(relayed.features.length, 1);
  assert.ok(calls.some(u => u.includes('/v1/notams?location=RJTT')));
  await fetcher('https://example.test/other');
  assert.equal(calls.at(-1), 'https://example.test/other');
});

test('a failed FAA call keeps the previous saved record, as on Sites', async () => {
  process.env.FAA_NMS_CLIENT_ID = 'client-abcdef'; process.env.FAA_NMS_CLIENT_SECRET = 'secret-abcdef';
  const DB = freshDb(), env = {DB, NMS_RELAY_URL: RELAY_URL, NMS_RELAY_SECRET: 'x'};
  const ok = await refreshCode(env, 'RJTT', faaRelayFetcher(fakeFaa().base), true);
  assert.equal(ok.error, null); assert.ok(ok.items.length >= 1);
  // Make the saved success old enough to be refreshed, then fail.
  const [saved] = await readCodeRecords(DB, ['RJTT']);
  await DB.prepare('UPDATE notam_data SET data = ? WHERE code = ?').bind(JSON.stringify({...saved, fetchedAt: saved.fetchedAt - 3 * 3600000}), 'RJTT').run();
  await DB.prepare('UPDATE nav_refresh SET lease_until = 0, started_at = 0').run();
  const failed = await refreshCode(env, 'RJTT', faaRelayFetcher(fakeFaa({fail: 503}).base), true);
  assert.match(failed.error, /FAA/);
  assert.equal(failed.items.length, ok.items.length, 'previous items are retained');
  assert.doesNotMatch(JSON.stringify(failed), /secret-abcdef|tok-123456/);
});
