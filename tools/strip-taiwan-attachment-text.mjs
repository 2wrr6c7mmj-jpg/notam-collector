// One-time clean-up of attachment text saved for Taiwanese firing notices.
//
// The collection used to fetch the attachments of a notice and keep their
// text in the saved record of the source, after a line "原文添付: <link>".
// That text names contact persons, and the saved state is published on the
// data branch. The attachments are no longer fetched by the collection (see
// taiwan-notice/); this cuts the text that was already saved.
//
//   node tools/strip-taiwan-attachment-text.mjs --db state/notam.sqlite [--dry-run]
import {DatabaseSync} from 'node:sqlite';
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';

const RECORD_ID = 'nav-reviewed-source:v1:tw-fisheries';
const ATTACHMENT_TEXT = /\n+原文添付: https:\/\//;

const withoutAttachmentText = text => text.slice(0, text.search(ATTACHMENT_TEXT));

/** Returns the record without saved attachment text, and how many texts were cut. */
export function stripAttachmentText(record) {
  let cut = 0;
  const strip = notice => {
    if (typeof notice?.text !== 'string' || !ATTACHMENT_TEXT.test(notice.text)) return notice;
    cut++;
    return {...notice, text: withoutAttachmentText(notice.text)};
  };
  const cache = Object.fromEntries(
    Object.entries(record.twOdt?.cache ?? {}).map(([id, entry]) => [
      id,
      {
        ...entry,
        ...(entry.enriched ? {enriched: strip(entry.enriched)} : {}),
        ...(entry.lastSuccess ? {lastSuccess: strip(entry.lastSuccess)} : {}),
      },
    ]),
  );
  return {
    record: {
      ...record,
      items: record.items.map(strip),
      ...(record.twOdt ? {twOdt: {...record.twOdt, cache}} : {}),
    },
    cut,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const {values: args} = parseArgs({options: {db: {type: 'string'}, 'dry-run': {type: 'boolean'}}});
  const db = new DatabaseSync(args.db);
  const row = db.prepare('SELECT data FROM reference_cache WHERE id = ?').get(RECORD_ID);
  if (!row) {
    console.log('No saved record of Taiwanese firing notices.');
  } else {
    const {record, cut} = stripAttachmentText(JSON.parse(row.data));
    if (cut && !args['dry-run']) {
      db.prepare('UPDATE reference_cache SET data = ? WHERE id = ?').run(
        JSON.stringify(record),
        RECORD_ID,
      );
      // Rewrite the file so the removed text does not stay in free pages.
      db.exec('VACUUM');
    }
    console.log(
      `Attachment text cut from ${cut} saved notice texts${args['dry-run'] ? ' (dry run)' : ''}.`,
    );
  }
  db.close();
}
