import { batchCodes } from "./locations";
import { recoverNoticeGeometry, resolveReferencedGeometry, type Notice } from "./notam";
import { fetchNotams, type NmsEnv } from "./nms-provider";
import { acquireLease, releaseLease } from "./update-lock";

export const HOUR = 3600000;
export type CodeRecord = { code: string; items: Notice[]; fetchedAt: number | null; checkedAt: number | null; error: string | null };
export type CodeStatus = { code: string; fetchedAt: number | null; checkedAt: number | null; count: number | null; state: "pending" | "ok" | "stale" | "error"; error: string | null };
const empty = (code: string): CodeRecord => ({ code, items: [], fetchedAt: null, checkedAt: null, error: null });
const key = (item: Notice) => `${item.location}|${item.id}|${item.text}`;
export function validCodes(values: unknown, limit = 100): string[] {
  return Array.isArray(values) ? [...new Set(values.map((value) => String(value).trim().toUpperCase()).map((code) => code === "RCCS" ? "RCSS" : code))].filter((code) => /^[A-Z]{4}$/.test(code)).slice(0, limit) : [];
}
export async function readCodeRecords(db: D1Database, codes: string[]) {
  if (!codes.length) return [];
  const rows = await db.prepare(`SELECT code, data FROM notam_data WHERE code IN (${codes.map(() => "?").join(",")})`).bind(...codes).all<{ code: string; data: string }>();
  const records = new Map(rows.results.map((row) => [row.code, JSON.parse(row.data) as CodeRecord]));
  return codes.map((code) => records.get(code) || empty(code));
}
export function codePayload(records: CodeRecord[], now = Date.now()) {
  const statuses: CodeStatus[] = records.map((record) => ({ code: record.code, fetchedAt: record.fetchedAt, checkedAt: record.checkedAt,
    count: record.fetchedAt ? record.items.length : null,
    state: record.error ? "error" : !record.fetchedAt ? "pending" : now - record.fetchedAt >= HOUR * 2 ? "stale" : "ok", error: record.error }));
  const dates = records.map((record) => record.fetchedAt).filter((date): date is number => date !== null);
  const items = resolveReferencedGeometry([...new Map(records.flatMap((record) => record.items).map((item) => [key(item), item])).values()].map(recoverNoticeGeometry));
  return { items, searched: records.map((record) => record.code), statuses,
    errors: statuses.filter((status) => status.error).map((status) => `${status.code}: ${status.error}`),
    fetchedAt: dates.length ? Math.min(...dates) : null, newestFetchedAt: dates.length ? Math.max(...dates) : null,
    incomplete: dates.length < records.length, stale: statuses.some((status) => status.state !== "ok"), refreshMinutes: 60,
    environment: "production", source: "FAA NMS API" };
}
export async function nmsPayload(db: D1Database, codes = batchCodes) { return codePayload(await readCodeRecords(db, codes)); }
// Coordinator status needs counts and clocks, not geometry recovery. Keep the
// same identity rule as codePayload without compiling every saved NOTAM.
export async function nmsSummary(db: D1Database, codes = batchCodes, now = Date.now()) {
  const records = await readCodeRecords(db, codes);
  const statuses:CodeStatus[] = records.map(record=>({code:record.code,fetchedAt:record.fetchedAt,checkedAt:record.checkedAt,count:record.fetchedAt?record.items.length:null,state:record.error?'error':!record.fetchedAt?'pending':now-record.fetchedAt>=HOUR*2?'stale':'ok',error:record.error}));
  const dates=records.map(record=>record.fetchedAt).filter((date):date is number=>date!==null);
  return {statuses,count:new Set(records.flatMap(record=>record.items.map(key))).size,fetchedAt:dates.length?Math.min(...dates):null};
}
export async function refreshCode(env: NmsEnv, code: string, fetcher: typeof fetch = fetch, force = false) {
  const now = Date.now(), previous = (await readCodeRecords(env.DB, [code]))[0];
  // Preserve the provider timestamp and last successful data across failures.
  if (previous.fetchedAt && now - previous.fetchedAt < (force ? 120000 : HOUR) && !previous.error) return { ...previous, updating: false };
  if (previous.error && previous.checkedAt && now - previous.checkedAt < 120000) return { ...previous, updating: false };
  if (!await acquireLease(env.DB, `nms:${code}`, now, 35000)) return { ...previous, updating: true };
  const relayLease = await acquireLease(env.DB, "nms:relay", now, 35000, 2000);
  if (!relayLease) { await releaseLease(env.DB, `nms:${code}`, now); return { ...previous, updating: true }; }
  try {
    let record: CodeRecord;
    try { record = { code, ...await fetchNotams(env, code, fetcher), checkedAt: now, error: null }; }
    catch (error) {
      const detail = error instanceof Error && /FAA/.test(error.message) ? error.message : "FAAへの接続がタイムアウトしました。次の更新で再試行します。";
      record = { ...previous, checkedAt: now, error: detail };
    }
    await env.DB.prepare("INSERT INTO notam_data (code, data) VALUES (?, ?) ON CONFLICT(code) DO UPDATE SET data = excluded.data")
      .bind(code, JSON.stringify(record)).run();
    return { ...record, updating: false };
  } finally {
    await releaseLease(env.DB, "nms:relay", now);
    await releaseLease(env.DB, `nms:${code}`, now);
  }
}
export async function refreshDefaultNotams(env: NmsEnv) {
  for (const code of batchCodes) { await refreshCode(env, code); await new Promise((resolve) => setTimeout(resolve, 2100)); }
}
