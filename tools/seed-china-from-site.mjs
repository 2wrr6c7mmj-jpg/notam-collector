// One-time backfill of Chinese warnings from the legacy Sites payload.
//
// The collector started with an empty store and reads only the first two
// listing pages of each China MSA region, so warnings published before it began
// and already pushed past page two were never captured, even while still in
// force. The Sites deployment ran the same collection code for months; this
// copies its still-relevant Chinese warnings into the matching source records.
//
//   node tools/seed-china-from-site.mjs --db state/notam.sqlite [--site-file nav.json] [--dry-run]
//
// Rules: GET only; existing records and items always win (nothing is replaced);
// only warnings that can still matter are copied (not cancelled, and either not
// yet ended or undated but issued within 90 days); each source record stays
// under SEED_BYTES so normal collection keeps room to store new warnings.
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {parseArgs} from 'node:util';

const SITE_URL = 'https://notam.cjmrnn9bx9.chatgpt.site/api/nav-warnings';
const FIRST_PAGE_PREFIX = 'cn-first-page:v1:source:';
const SEED_BYTES = 1_200_000; // China first-page records are capped at 1.8 MB
const DAY = 86400000;

export function stillRelevant(n, now) {
  return !n.cancelled && (Number.isFinite(n.end) ? n.end >= now : Number.isFinite(n.issued) && n.issued >= now - 90 * DAY);
}

/** Pure merge: returns the record with copied items, and what was added or skipped. */
export function mergeSiteItems(record, id, siteItems, now, limit = SEED_BYTES) {
  const known = new Set(record.items.flatMap(n => [n.id, n.sourceUrl && `${n.sourceUrl}|${n.id}`].filter(Boolean)));
  const items = [...record.items], added = [], skipped = {present: 0, notRelevant: 0, otherSource: 0, budget: 0};
  // Newest first, so a tight budget keeps the most recent warnings.
  for (const raw of [...siteItems].sort((a, b) => (b.issued || 0) - (a.issued || 0))) {
    if (!stillRelevant(raw, now)) { skipped.notRelevant++; continue; }
    if (known.has(raw.id) || raw.sourceUrl && known.has(`${raw.sourceUrl}|${raw.id}`)) { skipped.present++; continue; }
    if (raw.chinaFirstPage && raw.chinaFirstPage.sourceId !== id) { skipped.otherSource++; continue; }
    const {sourceId, ...item} = raw;
    const next = {...record, items: [...items, item]};
    if (JSON.stringify(next).length > limit) { skipped.budget++; continue; }
    items.push(item); added.push(item.id); known.add(item.id);
  }
  return {record: {...record, items, status: {...record.status, count: items.length}}, added, skipped};
}

async function main() {
  const {values: args} = parseArgs({options: {db: {type: 'string', default: 'state/notam.sqlite'}, 'site-file': {type: 'string'}, 'dry-run': {type: 'boolean', default: false}}});
  const site = args['site-file'] ? JSON.parse(readFileSync(args['site-file'], 'utf8'))
    : await (await fetch(SITE_URL, {method: 'GET', headers: {Accept: 'application/json'}})).json();
  if (!Array.isArray(site.items)) throw Error('Sites payload has no items');
  const now = Date.now(), db = new DatabaseSync(args.db), bySource = new Map();
  for (const n of site.items) if ((n.sourceCountry || 'CN') === 'CN' && n.sourceId) bySource.set(n.sourceId, [...(bySource.get(n.sourceId) || []), n]);
  const targets = [
    ...db.prepare(`SELECT id, data FROM reference_cache WHERE id LIKE '${FIRST_PAGE_PREFIX}%'`).all().map(r => ({table: 'reference_cache', key: r.id, id: r.id.slice(FIRST_PAGE_PREFIX.length), data: r.data})),
    ...db.prepare('SELECT id, data FROM nav_sources').all().map(r => ({table: 'nav_sources', key: r.id, id: r.id, data: r.data})),
  ];
  let total = 0;
  for (const t of targets) {
    const siteItems = bySource.get(t.id);
    if (!siteItems) continue;
    const record = JSON.parse(t.data);
    if (record.status?.id !== t.id || !Array.isArray(record.items)) { console.log(JSON.stringify({source: t.id, skipped: 'unexpected record shape'})); continue; }
    const {record: merged, added, skipped} = mergeSiteItems(record, t.id, siteItems, now);
    total += added.length;
    console.log(JSON.stringify({source: t.id, before: record.items.length, added: added.length, after: merged.items.length, bytes: JSON.stringify(merged).length, skipped}));
    if (added.length && !args['dry-run']) db.prepare(`UPDATE ${t.table} SET data = ? WHERE id = ?`).run(JSON.stringify(merged), t.key);
  }
  console.log(JSON.stringify({added: total, dryRun: args['dry-run']}));
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
