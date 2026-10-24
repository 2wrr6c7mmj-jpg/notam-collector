import { batchCodes } from "./locations";
import { navSources } from "./nav-sources";
import { navPayload, refreshNavSource } from "./nav-store";
import {readChinaFirstPageSources} from "./nav-china-first-page";
import {auditChinaLatestPages,inspectChinaPagination} from "./nav-china-audit";
import { nmsPayload, nmsSummary, refreshCode, validCodes } from "./nms-store";
import type { NmsEnv } from "./nms-provider";

import {createD1SourceStore} from "./msil-direct/src/store.mjs";
import {refreshSavedTrial} from "./msil-direct/src/service.mjs";

const headers = { "Cache-Control": "no-store" };
async function authorized(request: Request, env: NmsEnv) {
  const actual = request.headers.get("Authorization") || "";
  if (!actual.startsWith("Bearer ") || actual.length > 4096) return false;
  const hash = async (value: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  const [a, b] = await Promise.all([hash(actual.slice(7)), hash(env.NOTAM_UPDATE_TOKEN || "")]);
  // The unattended key is generated/stored inside Cloudflare. Only its SHA-256
  // verifier is provisioned here; the original task credential stays valid.
  const verifier = env.NOTAM_CRON_TOKEN_SHA256 || "";
  const validVerifier = /^[a-f0-9]{64}$/.test(verifier);
  let legacy = env.NOTAM_UPDATE_TOKEN ? 0 : 1, cron = validVerifier ? 0 : 1;
  for (let i = 0; i < a.length; i++) {
    legacy |= a[i] ^ b[i];
    cron |= a[i] ^ (validVerifier ? parseInt(verifier.slice(i * 2, i * 2 + 2), 16) : 0);
  }
  return legacy === 0 || cron === 0;
}

export async function updateRequest(request: Request, env: NmsEnv, _ctx?: unknown) {
  try {
    if (request.method === "GET") {
      const [notam, nav] = await Promise.all([nmsSummary(env.DB), navPayload(env.DB,undefined,{summaryOnly:true})]);
      return Response.json({ codes: batchCodes, sourceIds: navSources.map((source) => source.id),
        notam: { statuses: notam.statuses, count: notam.count, fetchedAt: notam.fetchedAt },
        nav: { sources: nav.sources, count: nav.items.length, checkedAt: nav.checkedAt, fetchedAt: nav.fetchedAt },
        refreshMinutes: 60 }, { headers });
    }
    if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405, headers });
    if (!await authorized(request, env)) return Response.json({ error: "更新権限がありません。" }, { status: 401, headers });
    const input = await request.json() as { kind?: string; codes?: unknown; sourceId?: string };
    if (input.kind === "nav-audit") {
      const [stored,payload]=await Promise.all([readChinaFirstPageSources(env.DB),navPayload(env.DB)]);
      const selected=stored.records.filter(record=>!input.sourceId||record.status.id===input.sourceId);
      return Response.json({auditedAt:Date.now(),errors:stored.errors,sources:await Promise.all(selected.map(async record=>({id:record.status.id,...await auditChinaLatestPages(record,payload.items),pagination:inspectChinaPagination(record)})))},{headers});
    }
    if (input.kind === "msil") {
      const result = await refreshSavedTrial({store:createD1SourceStore(env.DB), signal:request.signal});
      return Response.json({available:result.available, refreshState:result.refreshState,
        sourceRefreshState:result.sourceRefreshState, stale:result.stale,
        count:result.projection?.items.length || 0,
        sourceCompletedAt:result.projection?.sourceCompletedAt || null},
        {status:result.refreshState === "error" || result.refreshState === "storage-error" ? 503 : 200, headers});
    }
    if (input.kind === "notam") {
      const codes = validCodes(input.codes, 2);
      if (!codes.length || codes.some((code) => !batchCodes.includes(code))) return Response.json({ error: "定期更新の地点を指定してください。" }, { status: 400, headers });
      const updating: string[] = [];
      for (const [index, code] of codes.entries()) {
        if (index) await new Promise((resolve) => setTimeout(resolve, 2100));
        const result = await refreshCode(env, code, fetch, true);
        if (result.updating) updating.push(code);
      }
      const payload = await nmsPayload(env.DB, codes);
      return Response.json({ statuses: payload.statuses, updating, count: payload.items.length }, { headers });
    }
    if (input.kind === "nav" && navSources.some((source) => source.id === input.sourceId)) {
      const result = await refreshNavSource(env.DB, input.sourceId!, fetch, true);
      return Response.json({ source: result.status }, { headers });
    }
    return Response.json({ error: "更新対象を確認してください。" }, { status: 400, headers });
  } catch (error) {
    console.error("Site update unavailable", error instanceof Error ? error.name : "unknown");
    return Response.json({ error: "更新データを保存できません。前回分を保持しています。" }, { status: 503, headers });
  }
}
