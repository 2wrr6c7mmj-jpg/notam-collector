// Existing oldSite tables only. No schema changes; this module is NOT wired into
// any route, scheduler, or collector. All current tests use an in-memory SQL DB.
import {COOLDOWN_MS} from './transport.mjs';
import {validateSavedSource} from './normalize.mjs';

export const STORAGE_ID = 'msil-ui:trial:v2';
const LEASE_MS = 65000;
const RECORD_MAX_BYTES = 800 * 1024;
export const SQL = Object.freeze({
  read:'SELECT c.data, c.checked_at, r.started_at FROM reference_cache c LEFT JOIN nav_refresh r ON r.id = c.id WHERE c.id = ?',
  claim:'INSERT INTO nav_refresh (id, started_at, lease_until) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET started_at = excluded.started_at, lease_until = excluded.lease_until WHERE nav_refresh.lease_until <= ? AND nav_refresh.started_at <= ?',
  commit:'INSERT INTO reference_cache (id, data, checked_at) SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM nav_refresh WHERE id = ? AND started_at = ? AND lease_until > ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, checked_at = excluded.checked_at',
  finish:'UPDATE nav_refresh SET lease_until = ? WHERE id = ? AND started_at = ? AND lease_until > ?'
});
const validAt = at => Number.isSafeInteger(at) && at >= 0 && at < 8.64e15 - COOLDOWN_MS;
function parseRecord(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > RECORD_MAX_BYTES) throw Error('MSIL saved record invalid');
  const value = JSON.parse(text);
  if (value?.schemaVersion !== 1 || value.kind !== 'msil-ui-saved-source' || !validAt(value.lastAttemptAt) || !validAt(value.retryNotBefore) || !['ok','error'].includes(value.refreshState)) throw Error('MSIL saved record invalid');
  if (value.source) {
    validateSavedSource(value.source);
    if (value.source.refreshState !== value.refreshState) throw Error('MSIL saved state differs');
  }
  return value;
}
export function createD1SourceStore(db) {
  if (!db?.prepare || !db?.batch) throw Error('Shared storage required');
  return {
    async read() {
      const row = await db.prepare(SQL.read).bind(STORAGE_ID).first();
      if (!row) return null;
      const saved = parseRecord(row.data);
      // An acquisition-start gate survives a crash, expired lease or failed
      // source commit. A later UI GET must not mistake the older success for a
      // successfully completed latest attempt. Derive status without DB writes
      // or modifying the original acquisition timestamps/content.
      if (Number.isSafeInteger(row.started_at) && row.started_at > saved.lastAttemptAt) {
        return {...saved, refreshState:'error', uncommittedAttemptAt:row.started_at,
          ...(saved.source ? {source:{...saved.source,refreshState:'error',refreshMessage:'最後の取得が完了したことを確認できません。前回の保存原文と取得日時を保持しています。'}} : {})};
      }
      return saved;
    },
    async claim(at) {
      if (!validAt(at)) throw Error('MSIL attempt time invalid');
      const result = await db.prepare(SQL.claim).bind(STORAGE_ID, at, at+LEASE_MS, at, at-COOLDOWN_MS).run();
      return result.meta.changes === 1 ? {startedAt:at, expiresAt:at+LEASE_MS} : null;
    },
    async commit(lease, record, at) {
      if (!validAt(at) || !validAt(lease?.startedAt) || at < lease.startedAt || at >= lease.expiresAt || record.lastAttemptAt !== lease.startedAt || record.retryNotBefore < lease.startedAt+COOLDOWN_MS) throw Error('MSIL lease expired');
      const text = JSON.stringify(record); parseRecord(text);
      // D1 batch is transactional: save and extend the shared gate together.
      // Both statements are conditional on the same lease ownership and expiry.
      const result = await db.batch([
        db.prepare(SQL.commit).bind(STORAGE_ID,text,at,STORAGE_ID,lease.startedAt,at),
        db.prepare(SQL.finish).bind(record.retryNotBefore,STORAGE_ID,lease.startedAt,at)
      ]);
      return result[0].meta.changes === 1 && result[1].meta.changes === 1;
    }
  };
}
