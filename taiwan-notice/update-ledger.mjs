// Reads the Taiwanese firing notices the ledger does not have yet.
//
//   node update-ledger.mjs --items public/api/nav-warnings.json \
//                          --ledger state/tw-firing-ledger.json [--plan]
//                          [--reread 1384,1282]
//
// The collector saves each notice of the Fisheries Agency as a title and a
// link (item id `TW-FA-<notice number>`). For a notice that is new, or whose
// list of attachments has changed, this fetches the page of the notice and
// its attachments, takes their text out (extract.py), reads areas and times
// from it (notice.mjs, known-areas.mjs) and puts them in the ledger
// (ledger.mjs). `--plan` only prints how many notices are waiting. `--reread`
// reads the given notices again as if they were new.
//
// The attachments and their text name contact persons. They stay in a
// temporary directory that is removed before this ends; the ledger keeps
// areas, times, the title and which files were read.
//
// Requests go to www.fa.gov.tw one at a time, GAP_MS apart, a few notices per
// run. Nothing is fetched when robots.txt cannot be checked or forbids it,
// and the run stops at the first 403 or 429.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {readNotice} from './notice.mjs';
import {confirmScannedAreas} from './known-areas.mjs';
import {ledgerEntry} from './ledger.mjs';

const ORIGIN = 'https://www.fa.gov.tw';
const SOURCE_ID = 'tw-fisheries';
const ITEM_ID = /^TW-FA-(\d+)$/;
const FILE_ID = /redirect_file\.php\?theme=Shooting_bulletin&id=(\d+)/;
const NOTICES_PER_RUN = 4;
const MAX_ATTACHMENTS = 12;
const MAX_PAGE_BYTES = 600_000;
const MAX_FILE_BYTES = 4_000_000;
const GAP_MS = 3500;
const EXTRACT_TIMEOUT_MS = 6 * 60000;

const pageUrl = number => `${ORIGIN}/view.php?theme=Shooting_bulletin&subtheme=&id=${number}`;
const fileUrl = fileId => `${ORIGIN}/redirect_file.php?theme=Shooting_bulletin&id=${fileId}`;
const sameSet = (a, b) => a.length === b.length && a.every(item => b.includes(item));

// Notices to read, newest first: those the ledger lacks, then those the
// collector lists other attachments for than the ledger was read from.
export function waitingNotices(items, ledger) {
  const added = [],
    revised = [];
  for (const item of items) {
    const number = item.sourceId === SOURCE_ID && item.id.match(ITEM_ID)?.[1];
    if (!number) continue;
    const notice = {
      number,
      title: item.location,
      published: item.taiwan?.publication?.value ?? null,
    };
    const entry = ledger.notices[number];
    const listed = (item.taiwan?.attachments ?? [])
      .map(attachment => attachment.url.match(FILE_ID)?.[1])
      .filter(Boolean);
    if (!entry) added.push(notice);
    else if (listed.length && !sameSet(listed, fileIds(entry))) revised.push(notice);
  }
  const newestFirst = (a, b) => b.number - a.number;
  return [...added.sort(newestFirst), ...revised.sort(newestFirst)];
}

const fileIds = entry => entry.attachments.map(attachment => attachment.fileId);

// The files a notice links to, in the order of its page.
export function attachmentIds(html) {
  const ids = new Set();
  for (const [, href] of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']*)["']/gi)) {
    const fileId = href.replaceAll('&amp;', '&').match(FILE_ID)?.[1];
    if (fileId) ids.add(fileId);
  }
  return [...ids].slice(0, MAX_ATTACHMENTS);
}

// An entry of the ledger in the form known-areas.mjs compares against.
const asRead = entry => ({
  areas: entry.areas.map(area =>
    area.type === 'circle'
      ? {type: 'circle', centre: point(area.centre), radiusNm: area.radiusNm}
      : {
          type: 'polygon',
          points: area.points.map(point),
          ...(area.marks?.includes('ocr') ? {ocr: true} : {}),
        },
  ),
});
const point = ([lat, lon]) => ({lat, lon});

// A scan that left an area unread, undated or unconfirmed is worth reading
// again list by list.
const complete = notice =>
  notice.areas.length > 0 &&
  notice.areas.every(area => area.slots.length) &&
  !notice.unconfirmedOcrAreas?.length;

/**
 * Reads one notice from its extracted attachments. `extracted` are the
 * attachments as extract.py wrote them; `ledger` gives the areas known from
 * other notices, against which areas read from a scan are confirmed.
 */
export function readIntoEntry({title, published, files}, extracted, ledger) {
  const known = Object.values(ledger.notices).map(asRead);
  const attachments = extracted.map(({pages, ocr, otherReadings, coordinateLists}) => ({
    pages,
    ...(ocr ? {ocr, otherReadings} : {}),
    ...(coordinateLists ? {coordinateLists} : {}),
  }));
  const read = confirmScannedAreas([...known, readNotice({title, published, attachments})]).at(-1);
  return {
    complete: complete(read),
    entry: ledgerEntry(read, {title, published, attachments: files}),
  };
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// One GET. Returns {status, bytes?}; `bytes` only for a 200 within `cap`.
async function get(url, cap, fetcher) {
  const response = await fetcher(url, {redirect: 'manual', signal: AbortSignal.timeout(40000)});
  if (response.status !== 200) {
    await response.body?.cancel();
    return {status: response.status};
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body ?? []) {
    size += chunk.length;
    if (size > cap) return {status: 200, tooBig: true};
    chunks.push(chunk);
  }
  return {status: 200, bytes: Buffer.concat(chunks)};
}

class Refused extends Error {}

// Fetches the page and the attachments of one notice into `directory`.
// Returns the files as [{fileId, sha256}], or null when something could not
// be fetched and the notice is to be tried again next time.
async function fetchNotice(number, directory, request) {
  const page = await request(pageUrl(number), MAX_PAGE_BYTES);
  if (!page.bytes) return null;
  const files = [];
  for (const fileId of attachmentIds(page.bytes.toString('utf8'))) {
    const file = await request(fileUrl(fileId), MAX_FILE_BYTES);
    if (file.tooBig) continue;
    if (!file.bytes) return null;
    await fs.writeFile(path.join(directory, `${fileId}.bin`), file.bytes);
    files.push({fileId, sha256: crypto.createHash('sha256').update(file.bytes).digest('hex')});
  }
  return files;
}

async function extract(directory, files, {lists = false} = {}) {
  await promisify(execFile)(
    'python3',
    [
      fileURLToPath(new URL('./extract.py', import.meta.url)),
      directory,
      ...(lists ? ['--lists'] : []),
    ],
    {timeout: EXTRACT_TIMEOUT_MS},
  );
  return Promise.all(
    files.map(async ({fileId}) =>
      JSON.parse(await fs.readFile(path.join(directory, `${fileId}.json`), 'utf8')),
    ),
  );
}

/** Returns the ledger with the waiting notices read into it, and what was done. */
export async function updateLedger(
  items,
  ledger,
  {fetcher = fetch, gapMs = GAP_MS, now = Date.now()} = {},
) {
  const waiting = waitingNotices(items, ledger).slice(0, NOTICES_PER_RUN);
  const done = {waiting: waiting.length, read: [], unchanged: [], retry: [], stopped: null};
  if (!waiting.length) return {ledger, done};

  let requests = 0;
  const request = async (url, cap) => {
    if (requests++) await sleep(gapMs);
    const result = await get(url, cap, fetcher);
    if (result.status === 403 || result.status === 429) throw new Refused(`HTTP ${result.status}`);
    return result;
  };

  const notices = {...ledger.notices};
  try {
    // No robots.txt (a 4xx) leaves the site open; anything else is not a clear yes.
    const robots = await request(`${ORIGIN}/robots.txt`, 200_000);
    if (!(robots.status >= 400 && robots.status < 500)) throw new Refused('robots.txt');
    for (const notice of waiting) {
      const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tw-notice-'));
      try {
        const files = await fetchNotice(notice.number, directory, request).catch(error => {
          if (error instanceof Refused) throw error;
          return null;
        });
        if (!files) {
          done.retry.push(notice.number);
          continue;
        }
        const before = notices[notice.number];
        if (
          before &&
          sameSet(
            files.map(file => file.fileId),
            fileIds(before),
          )
        ) {
          done.unchanged.push(notice.number);
          continue;
        }
        const source = {...notice, files};
        const current = {...ledger, notices};
        let extracted = await extract(directory, files);
        let result = readIntoEntry(source, extracted, current);
        if (!result.complete && extracted.some(attachment => attachment.ocr)) {
          extracted = await extract(directory, files, {lists: true});
          result = readIntoEntry(source, extracted, current);
        }
        notices[notice.number] = result.entry;
        done.read.push(notice.number);
      } finally {
        await fs.rm(directory, {recursive: true, force: true});
      }
    }
  } catch (error) {
    if (!(error instanceof Refused)) throw error;
    done.stopped = error.message;
  }
  return {
    ledger: done.read.length
      ? {...ledger, surveyedAt: new Date(now).toISOString(), notices}
      : ledger,
    done,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const option = name => process.argv[process.argv.indexOf(name) + 1];
  const items = JSON.parse(await fs.readFile(option('--items'), 'utf8')).items;
  const saved = JSON.parse(await fs.readFile(option('--ledger'), 'utf8'));
  const reread = process.argv.includes('--reread') ? option('--reread').split(',') : [];
  const ledger = reread.length
    ? {
        ...saved,
        notices: Object.fromEntries(
          Object.entries(saved.notices).filter(([number]) => !reread.includes(number)),
        ),
      }
    : saved;
  if (process.argv.includes('--plan')) {
    console.log(waitingNotices(items, ledger).length);
  } else {
    const {ledger: next, done} = await updateLedger(items, ledger);
    // A notice that could not be fetched again keeps the entry it had.
    const notices = {...saved.notices, ...next.notices};
    if (next !== ledger) await fs.writeFile(option('--ledger'), JSON.stringify({...next, notices}));
    console.log(JSON.stringify(done));
  }
}
