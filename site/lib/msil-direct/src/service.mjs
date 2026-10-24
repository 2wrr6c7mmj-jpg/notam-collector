// Local candidate orchestration; publication and live acquisition remain separate.
import {acquireTrialCollection, AcquisitionError, COOLDOWN_MS} from './transport.mjs';
import {normalizeCollection, projectSavedSource} from './normalize.mjs';
import {safeTransportDiagnostic} from './transport-diagnostic.mjs';

const publicResult = (record, now, state = record?.refreshState) => ({
  available:Boolean(record?.source), refreshState:state || 'unavailable',
  sourceRefreshState:record?.refreshState || 'unavailable',
  stale:!record?.source || record.refreshState==='error' || state==='storage-error' || now-Date.parse(record.source.acquisition.completedAt)>8*3600000,
  ...(record?.source ? {projection:projectSavedSource(record.source, now)} : {})
});
const metadataResult = (record, now, state = record?.refreshState) => ({
  available:Boolean(record?.source), refreshState:state || 'unavailable',
  sourceRefreshState:record?.refreshState || 'unavailable',
  stale:!record?.source || record.refreshState==='error' || state==='storage-error' || now-Date.parse(record.source.acquisition.completedAt)>8*3600000
});

// UI GET path: DB read + the common parser only. It has no fetch parameter and
// never invokes refreshSavedTrial. Failed acquisition cannot refresh source age.
export async function readSavedTrial(store, now) {
  const record=await store.read();
  return publicResult(record, now ?? Date.now());
}

// Only a future, explicitly authorized update action may call this entrypoint.
// It requires the global atomic store; never substitute per-isolate memory or
// Cache API for this gate. A denied/corrupt store means zero external requests.
export async function refreshSavedTrial({store, fetcher = fetch, signal, now = Date.now, wait,
  metadataOnly = false, claimFirst = false, deadlineAt = Infinity, acquisitionWindowMs = 60000} = {}) {
  if (!store?.read || !store?.claim || !store?.commit) throw Error('Shared storage required');
  if (claimFirst && !metadataOnly) throw Error('Claim-first is an internal metadata-only mode');
  const result = metadataOnly ? metadataResult : publicResult;
  const active = () => { if (signal?.aborted || now() >= deadlineAt) throw new AcquisitionError('ABORTED'); };
  active();let at,previous,lease;
  if (claimFirst) {
    // An authenticated automatic caller does not need a display. Losing 63/64
    // callers must not load and recompile all saved originals just for status.
    at=now();lease = await store.claim(at);active();
    if (!lease) return result(null,now(),'cooldown');
    previous = await store.read();active();
  } else {
    previous = await store.read();active();at=now();
    if (previous && at < previous.retryNotBefore) return result(previous,at,'cooldown');
    lease = await store.claim(at);active();
    if (!lease) return result(await store.read(),now(),'cooldown');
  }
  let source, code = null, diagnostic = null, retryNotBefore = at+COOLDOWN_MS;
  try {
    active();
    const windowMs = Math.min(acquisitionWindowMs,deadlineAt-now()-5000);
    const collection = await acquireTrialCollection({fetcher, signal, now, wait, windowMs});
    active();
    source = normalizeCollection(collection, previous?.source);
    // Validate the complete UI projection before replacing the saved source.
    // No fresh timestamp is assigned until all three layers + common parser pass.
    projectSavedSource(source, now());
    active();
    if (Number.isFinite(deadlineAt) && deadlineAt-now()<3000) throw new AcquisitionError('WINDOW');
  } catch (error) {
    code = error instanceof AcquisitionError ? error.code : 'NORMALIZATION';
    diagnostic = error instanceof AcquisitionError ? safeTransportDiagnostic(error.diagnostic) : null;
    if (error instanceof AcquisitionError && Number.isSafeInteger(error.retryAt)) retryNotBefore = Math.max(retryNotBefore,error.retryAt);
    source = previous?.source ? {...previous.source, refreshState:'error', refreshMessage:'海しるの更新に失敗しました。前回の保存原文と取得日時を保持しています。'} : undefined;
  }
  const record = {schemaVersion:1, kind:'msil-ui-saved-source', lastAttemptAt:at, retryNotBefore,
    refreshState:code?'error':'ok', ...(code ? {failureCode:code} : {}),
    ...(diagnostic ? {failureStage:diagnostic.stage,failureCategory:diagnostic.category} : {}), ...(source ? {source} : {})};
  try {
    // After budget expiry, do not start another write. The persisted claim lets
    // the next UI read identify this uncompleted attempt without false freshness.
    active();
    const committed = await store.commit(lease,record,now());
    active();
    if (!committed) return metadataOnly ? result(null,now(),'superseded') : result(await store.read(),now(),'superseded');
  } catch {
    // Never serve uncommitted new data. A failed write still leaves the atomic
    // acquisition-start cooldown in nav_refresh. Next UI reads the old record.
    return result(previous, now(), 'storage-error');
  }
  return result(record,now());
}
