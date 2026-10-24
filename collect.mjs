// One collection cycle, equivalent to the Sites /api/update sequence:
//   NOTAM codes two at a time (2.1 s apart), then each maritime source
//   two at a time, then public payloads identical to the Sites GET APIs.
// State lives in a SQLite file (the D1 schema); failures keep the last
// successful record exactly as the Sites stores do.
//
//   node --experimental-transform-types --import ./runtime/register.mjs collect.mjs \
//        --db state/notam.sqlite --out public [--only-notam|--only-nav] [--codes RJTT,RJJJ] [--sources ln,tj]
import {mkdirSync, writeFileSync, renameSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {D1Shim} from './runtime/d1.mjs';
import {RELAY_URL, faaRelayFetcher} from './runtime/faa.mjs';
import {batchCodes} from './site/lib/locations.ts';
import {navSources} from './site/lib/nav-sources.ts';
import {nmsPayload, nmsSummary, refreshCode} from './site/lib/nms-store.ts';
import {navPayload, refreshNavSource} from './site/lib/nav-store.ts';

const {values: args} = parseArgs({options: {
  db: {type: 'string', default: 'state/notam.sqlite'},
  out: {type: 'string', default: 'public'},
  'only-notam': {type: 'boolean', default: false},
  'only-nav': {type: 'boolean', default: false},
  'export-only': {type: 'boolean', default: false},
  codes: {type: 'string'},
  sources: {type: 'string'},
  'deadline-minutes': {type: 'string', default: '50'},
}});

const started = Date.now(), deadline = started + Number(args['deadline-minutes']) * 60000;
const log = (event, detail = {}) => console.log(JSON.stringify({t: new Date().toISOString(), event, ...detail}));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

mkdirSync(path.dirname(args.db), {recursive: true});
const DB = new D1Shim(args.db);
DB.migrate(new URL('./site/drizzle/', import.meta.url).pathname);
const env = {DB, NMS_RELAY_URL: RELAY_URL, NMS_RELAY_SECRET: 'in-process'};
const fetcher = faaRelayFetcher();

const pick = (list, csv) => csv ? list.filter(x => csv.split(',').includes(x)) : list;
const report = {startedAt: started, notam: {}, nav: {}};

if (!args['export-only'] && !args['only-nav']) {
  const codes = pick(batchCodes, args.codes);
  let failedPairs = 0;
  for (let i = 0; i < codes.length && Date.now() < deadline; i += 2) {
    const pair = codes.slice(i, i + 2);
    let pairFailed = true;
    for (const [n, code] of pair.entries()) {
      if (n) await pause(2100);
      const result = await refreshCode(env, code, fetcher, true);
      report.notam[code] = {count: result.items.length, fetchedAt: result.fetchedAt, error: result.error};
      if (!result.error) pairFailed = false;
    }
    log('notam', {codes: pair, results: pair.map(c => report.notam[c])});
    // Same guard as the Sites updater: stop FAA work after 3 wholly failed pairs.
    failedPairs = pairFailed ? failedPairs + 1 : 0;
    if (failedPairs >= 3) { log('notam-stopped', {reason: 'three consecutive failed pairs'}); break; }
    await pause(2100);
  }
}

if (!args['export-only'] && !args['only-notam']) {
  const ids = pick(navSources.map(s => s.id), args.sources);
  let cursor = 0;
  await Promise.all([0, 1].map(async () => {
    while (cursor < ids.length && Date.now() < deadline) {
      const id = ids[cursor++];
      try {
        const result = await refreshNavSource(DB, id, globalThis.fetch, true);
        const s = result.status;
        report.nav[id] = {state: s.state, count: s.count, fetchedAt: s.fetchedAt, detail: s.state === 'ok' ? undefined : s.detail};
      } catch (error) { report.nav[id] = {state: 'exception', detail: String(error?.message || error).slice(0, 200)}; }
      log('nav', {id, ...report.nav[id]});
    }
  }));
}

// Public payloads: byte-for-byte the same shape the Sites GET handlers return.
mkdirSync(path.join(args.out, 'api'), {recursive: true});
const write = (name, value) => {
  const file = path.join(args.out, 'api', name), text = JSON.stringify(value);
  writeFileSync(file + '.tmp', text); renameSync(file + '.tmp', file);
  return {file: name, bytes: text.length, sha256: createHash('sha256').update(text).digest('hex')};
};
const [nms, nav, notamSummary, navSummary] = await Promise.all([nmsPayload(DB), navPayload(DB), nmsSummary(DB), navPayload(DB, undefined, {summaryOnly: true})]);
const files = [
  write('nms.json', nms),
  write('nav-warnings.json', nav),
  write('update.json', {codes: batchCodes, sourceIds: navSources.map(s => s.id),
    notam: {statuses: notamSummary.statuses, count: notamSummary.count, fetchedAt: notamSummary.fetchedAt},
    nav: {sources: navSummary.sources, count: navSummary.items.length, checkedAt: navSummary.checkedAt, fetchedAt: navSummary.fetchedAt},
    refreshMinutes: 120}),
];
report.finishedAt = Date.now(); report.files = files;
report.totals = {notam: nms.items.length, nav: nav.items.length,
  notamErrors: Object.values(report.notam).filter(r => r.error).length,
  navErrors: Object.values(report.nav).filter(r => r.state !== 'ok').length};
writeFileSync(path.join(args.out, 'collection-report.json'), JSON.stringify(report, null, 1));
log('done', {seconds: Math.round((report.finishedAt - started) / 1000), ...report.totals});
DB.close();
