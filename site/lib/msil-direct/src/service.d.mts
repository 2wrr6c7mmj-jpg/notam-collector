export type MsilSavedResult = {
  available: boolean;
  refreshState: string;
  sourceRefreshState: string;
  stale: boolean;
  projection?: {items: unknown[]; sourceCompletedAt: string; [key: string]: unknown};
};
export function readSavedTrial(store: unknown, now?: number): Promise<MsilSavedResult>;
export function refreshSavedTrial(options: {
  store: unknown;
  fetcher?: typeof fetch;
  signal?: AbortSignal;
  now?: () => number;
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
  metadataOnly?: boolean;
  claimFirst?: boolean;
  deadlineAt?: number;
  acquisitionWindowMs?: number;
}): Promise<MsilSavedResult>;
