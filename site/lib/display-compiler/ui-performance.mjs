/** Reuse a pure projection only when every source field is identical. The cache
 * is bounded to the latest snapshot, so removed/cancelled rows cannot linger.
 * Yield between bounded batches; the caller commits the complete result once.
 */
export function createSnapshotProjector(project) {
  let previous = new Map();
  /** @param {any[]} items @param {{signal?:AbortSignal,budgetMs?:number,yieldTask?:()=>Promise<unknown>,clock?:()=>number}} options */
  return async function projectSnapshot(items, { signal, budgetMs = 8, yieldTask = () => new Promise(resolve => setTimeout(resolve, 0)), clock = () => performance.now() } = {}) {
    const next = new Map(), result = [];
    let sliceStart = clock();
    for (const item of items) {
      signal?.throwIfAborted();
      const signature = JSON.stringify(item);
      const existing = previous.get(signature);
      const value = existing === undefined ? project(item) : existing;
      result.push(value); next.set(signature, value);
      if (clock() - sliceStart >= budgetMs) { await yieldTask(); sliceStart = clock(); }
    }
    signal?.throwIfAborted();
    previous = next;
    return result;
  };
}

/** Full input signatures intentionally cover periods, source evidence, lifecycle
 * and nested fields, including in-place changes. Weak keys release old notices.
 */
export function memoizeNoticeAnalysis(analyze) {
  const cache = new WeakMap();
  return function (notice) {
    const signature = JSON.stringify(notice, (_key, value) => typeof value === 'number' && !Number.isFinite(value) ? { nonFiniteNumber: String(value) } : value);
    const hit = cache.get(notice);
    if (hit?.signature === signature) return hit.value;
    const value = analyze(notice);
    cache.set(notice, { signature, value });
    return value;
  };
}

/** Cache exact query results, not rounded time. Changing any notice field clears
 * the small per-notice LRU. NaN/Infinity stay distinct from null in the key. */
export function memoizeNoticeQuery(analyze) {
  const cache = new WeakMap();
  return function (notice, ...args) {
    const stringify = value => JSON.stringify(value, (_key, field) => typeof field === 'number' && !Number.isFinite(field) ? { nonFiniteNumber: String(field) } : field);
    const signature = stringify(notice), query = stringify(args);
    let entry = cache.get(notice);
    if (entry?.signature !== signature) { entry = {signature,results:new Map()}; cache.set(notice,entry); }
    if (entry.results.has(query)) return entry.results.get(query);
    const value = analyze(notice,...args);
    if(entry.results.size>=4)entry.results.delete(entry.results.keys().next().value);
    entry.results.set(query,value);
    return value;
  };
}
