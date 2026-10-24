// Server-side only. Fixed official origins, one acquisition, no retries or logs.
// This file uses Web APIs; the unchanged page planner uses nodejs_compat crypto.
import {pageState,descriptionText} from '../vendor/notam-update-bridge/msil-stage.mjs';
import {planNextPage} from '../vendor/notam-update-bridge/msil-pagination.mjs';
import {classifyTransportFailure,safeTransportDiagnostic} from './transport-diagnostic.mjs';

export const TRIAL_DOCUMENT = 'https://portal.msil.go.jp/howtouse';
export const API_ORIGIN = 'https://api.msil.go.jp';
export const COOLDOWN_MS = 2 * 60 * 60 * 1000;
// Tighter than the Pages batch runner: keep transient allocation conservative
// for the oldSite Worker while preserving the previous source on overflow.
const WINDOW_MS = 60000, INTERVAL_MS = 3000, LAYER_BYTES = 2 * 1024 * 1024, TOTAL_BYTES = 4 * 1024 * 1024;
const encoder = new TextEncoder();
export class AcquisitionError extends Error {
  constructor(code, retryAt = null, diagnostic = null) { super('MSIL acquisition unavailable'); this.code = code; this.retryAt = retryAt; const safe=safeTransportDiagnostic(diagnostic); if(safe)this.diagnostic=safe; }
}
const fail = code => { throw new AcquisitionError(code); };
const aborted = signal => { if (signal.aborted) fail('ABORTED'); };

function deadline(signal, ms) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, {once:true});
  const timer = setTimeout(abort, ms);
  return {signal:controller.signal, close(){ clearTimeout(timer); signal?.removeEventListener('abort', abort); }};
}
export async function waitBounded(ms, signal) {
  aborted(signal);
  await new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new AcquisitionError('ABORTED')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, {once:true});
    if (signal.aborted) abort();
  });
}
const retryTime = (value, at) => {
  const parsed = /^\d+$/.test(value) ? at + Number(value) * 1000 : Date.parse(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 8.64e15 ? parsed : null;
};

async function readFixed(url, {fetcher, signal, maxBytes, accept, key, now, stage}) {
  aborted(signal);
  let response;
  try {
    // Avoid Request.cache / credentials options: current oldSite runtime rejected
    // its Pages request even after both were removed. No incoming headers copied.
    // workerd rejects redirect:'error' during Request construction. Manual mode
    // follows zero redirects; refuse every 3xx below, including absent Location.
    response = await fetcher(url, {method:'GET', redirect:'manual', signal,
      headers:{Accept:accept, 'Cache-Control':'no-cache', ...(key ? {'Ocp-Apim-Subscription-Key':key} : {})}});
  } catch (error) { throw new AcquisitionError('TRANSPORT',null,classifyTransportFailure(error,stage,signal.aborted)); }
  if (response.status === 429) {
    void response.body?.cancel().catch(() => {});
    throw new AcquisitionError('RATE_LIMIT', retryTime(response.headers.get('retry-after') || '', now()));
  }
  if ((response.status >= 300 && response.status < 400) || response.headers.has('location')) {
    void response.body?.cancel().catch(() => {}); fail('HTTP_OR_REDIRECT');
  }
  if (!response.ok || response.redirected || (response.url && response.url !== url)) {
    void response.body?.cancel().catch(() => {}); fail('HTTP_OR_REDIRECT');
  }
  const type = response.headers.get('content-type') || '';
  if (!(key ? /^application\/(?:geo\+)?json(?:\s*;|$)/i : /^text\/html(?:\s*;|$)/i).test(type)) {
    void response.body?.cancel().catch(() => {}); fail('CONTENT_TYPE');
  }
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) {
    void response.body?.cancel().catch(() => {}); fail('BODY_LIMIT');
  }
  const reader = response.body?.getReader(); if (!reader) fail('MISSING_BODY');
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, {once:true});
  const chunks = []; let length = 0;
  try {
    while (true) {
      aborted(signal); const part = await reader.read(); aborted(signal);
      if (part.done) break;
      length += part.value.byteLength;
      if (length > maxBytes) fail('BODY_LIMIT');
      chunks.push(part.value);
    }
  } catch (error) { if (error instanceof AcquisitionError) throw error; fail('BODY_READ'); }
  finally { signal.removeEventListener('abort', cancel); await reader.cancel().catch(() => {}); }
  if (declared !== null && !response.headers.get('content-encoding') && Number(declared) !== length) fail('TRUNCATED');
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let text; try { text = new TextDecoder('utf-8', {fatal:true}).decode(bytes); } catch { fail('UTF8'); }
  if (key && text.toLowerCase().includes(key.toLowerCase())) fail('ECHO_DISCARDED');
  return {text, bytes:length};
}

// Only the public documentation's labelled trial paragraph is accepted. Its
// value remains in a local variable and is never stored or returned to callers.
function labelledTrialValue(html) {
  const headings = [...html.matchAll(/<(h[1-6])\b[^>]*>[\s\S]*?<\/\1\s*>/gi)];
  const labelled = headings.filter(match => match[0].replace(/<[^>]*>/g,'').replace(/\s+/g,'').includes('試用サブスクリプションキーでの利用'));
  if (labelled.length !== 1) fail('TRIAL_LABEL');
  const heading = labelled[0], level = Number(heading[1][1]);
  const next = headings.find(match => match.index > heading.index && Number(match[1][1]) <= level);
  const section = html.slice(heading.index + heading[0].length, next?.index ?? html.length);
  const matches = [...section.matchAll(/<p\b[^>]*>\s*・\s*([a-f0-9]{32})\s*<\/p>/gi)];
  // The official section currently lists three public trial choices. Select the
  // first once per permitted acquisition; never rotate/retry other values.
  if (matches.length < 1 || matches.length > 3) fail('TRIAL_LABEL');
  return matches[0][1];
}

export async function acquireTrialCollection({fetcher = fetch, signal, now = Date.now, wait = waitBounded, windowMs = WINDOW_MS} = {}) {
  if (!Number.isSafeInteger(windowMs) || windowMs < INTERVAL_MS || windowMs > WINDOW_MS) fail('WINDOW');
  const bounded = deadline(signal, windowMs), startedAt = now();
  const pages = [], receipts = []; let key = '', totalBytes = 0, lastRequestAt = null;
  try {
    const documentation = await readFixed(TRIAL_DOCUMENT, {fetcher, signal:bounded.signal, maxBytes:1024*1024, accept:'text/html', now, stage:'DOCUMENT_FETCH'});
    key = labelledTrialValue(documentation.text);
    for (const layer of [1, 2, 3]) {
      const layerPages = []; let layerWireBytes = 0;
      while (true) {
        aborted(bounded.signal);
        if (now() - startedAt >= windowMs || now() < startedAt) fail('WINDOW');
        const plan = planNextPage(layerPages, {layer, now:now(), maxPages:3, maxFeatures:3000, maxBytes:LAYER_BYTES, maxWindowMs:windowMs});
        if (plan.action === 'stop') { if (!plan.transportComplete) fail('INCOMPLETE'); break; }
        const pause = Math.max(0, plan.notBefore - now(), (lastRequestAt ?? now()-INTERVAL_MS) + INTERVAL_MS - now());
        if (pause) await wait(pause, bounded.signal);
        aborted(bounded.signal);
        if (now() - startedAt >= windowMs || now() < startedAt) fail('WINDOW');
        const maxBytes = Math.min(plan.maxResponseBytes, LAYER_BYTES-layerWireBytes, TOTAL_BYTES-totalBytes);
        if (maxBytes < 1) fail('BODY_LIMIT');
        const url = new URL(`${API_ORIGIN}/navigational-warnings/v2/MapServer/${layer}/query`);
        url.search = new URLSearchParams({where:'1=1', outFields:'*', f:'geojson', outSR:'4326', resultRecordCount:'1000', resultOffset:String(plan.offset)});
        lastRequestAt = now();
        const body = await readFixed(url.toString(), {fetcher, signal:bounded.signal, maxBytes, accept:'application/json', key, now, stage:`LAYER_${layer}_FETCH`});
        totalBytes += body.bytes; layerWireBytes += body.bytes;
        let page; try { page = JSON.parse(body.text); } catch { fail('JSON'); }
        // JSON Unicode escapes and description HTML entities must not turn an
        // upstream echo into a value persisted by the common normalizer.
        if (JSON.stringify(page).toLowerCase().includes(key.toLowerCase())) fail('ECHO_DISCARDED');
        for (const feature of page?.features || []) {
          const description = feature?.properties?.description;
          if (typeof description === 'string' && description.length <= 200000 && descriptionText(description).toLowerCase().includes(key.toLowerCase())) fail('ECHO_DISCARDED');
        }
        const state = pageState(page, {layer, offset:plan.offset, limit:1000});
        const receivedAt = now(), bytes = encoder.encode(JSON.stringify(page)).length;
        if (receivedAt < lastRequestAt || receivedAt-startedAt >= windowMs) fail('WINDOW');
        const entry = {layer, offset:plan.offset, limit:1000, page, receivedAt};
        layerPages.push(entry); pages.push(entry);
        receipts.push({layer, offset:plan.offset, limit:1000, count:state.count, startedAt:new Date(lastRequestAt).toISOString(), receivedAt:new Date(receivedAt).toISOString(), sha256:state.sha256, bytes, layerEnd:state.complete});
      }
    }
    aborted(bounded.signal);
    return {pages, acquisition:{startedAt:new Date(startedAt).toISOString(), completedAt:new Date(now()).toISOString(), windowMs:now()-startedAt, receipts, transportComplete:true, consistentSnapshot:false, fullWarningCoverage:false}};
  } catch (error) { if (error instanceof AcquisitionError) throw error; fail('INVALID_COLLECTION'); }
  finally { key = ''; bounded.close(); }
}
