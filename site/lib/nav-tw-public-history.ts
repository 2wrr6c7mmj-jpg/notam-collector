import type { Notice } from './notam';
import { twEvidenceOf, twWithinHistory, type TwNotice } from './nav-tw-evidence';

// This is a delivery-window selection, never a deletion or a cancellation.
// The pre-existing FA ledger remains complete for an exact24 -> exact29 update.
export const WINDOWED_TAIWAN_SOURCES = new Set(['tw-moa-ship', 'tw-motc']);
export function selectTwPublicHistory<T extends Notice & { sourceId?: string }>(items: T[], now = Date.now()): T[] {
  const keep = new Set<T>(items.filter(item => {
    if (!WINDOWED_TAIWAN_SOURCES.has(item.sourceId || '')) return true;
    const evidence = twEvidenceOf(item);
    const historical = evidence?.historicalInterpretation;
    // Unknown dates, future activity and cancellation/amendment notices already
    // survive twWithinHistory. Retain an older spatial interpretation too: an
    // unresolved time is not evidence that its area has ceased to matter.
    return twWithinHistory(item, now) ||
      (typeof item.start === 'number' && Number.isFinite(item.start) && (item.start > now || item.end === null)) ||
      item.shapes.length > 0 ||
      (historical !== undefined && (!Array.isArray(historical?.shapes) || historical.shapes.length > 0));
  }));
  const references = new Map<string, T[]>();
  const link = (key: string | undefined, item: T) => {
    if (key) references.set(key, [...(references.get(key) || []), item]);
  };
  for (const item of items) {
    const e = twEvidenceOf(item);
    link(item.sourceUrl, item);
    link(e?.issueReference, item);
  }
  // Keep the known referenced version chain as well as the amendment itself.
  // No title similarity or absent index row is treated as a lifecycle fact.
  const pending = [...keep];
  for (let i = 0; i < pending.length; i++) {
    const evidence = twEvidenceOf(pending[i] as TwNotice);
    for (const reference of [evidence?.amendment?.targetReference, evidence?.supersededBy]) {
      for (const item of references.get(reference || '') || []) {
        if (!keep.has(item)) { keep.add(item); pending.push(item); }
      }
    }
  }
  return items.filter(item => keep.has(item));
}
