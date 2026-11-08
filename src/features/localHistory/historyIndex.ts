// Pure local history index logic: no vscode or fs access, so it is unit-testable.

export type EntrySource = 'save' | 'baseline' | 'label' | 'restore';

export interface HistoryEntry {
  /** Unique per entry (timestamp based). */
  id: string;
  timestamp: number;
  /** Content hash; the snapshot body is stored once per hash. */
  hash: string;
  size: number;
  source: EntrySource;
  label?: string;
}

export interface HistoryIndex {
  version: 1;
  uri: string;
  entries: HistoryEntry[];
}

export interface PruneOptions {
  now: number;
  retentionDays: number;
  maxEntries: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function emptyIndex(uri: string): HistoryIndex {
  return { version: 1, uri, entries: [] };
}

/** Sorted oldest first; tolerates hand-edited or partially written indexes. */
export function normalizeIndex(raw: unknown, uri: string): HistoryIndex {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as HistoryIndex).entries)) return emptyIndex(uri);
  const entries = (raw as HistoryIndex).entries.filter(
    (e) => e && typeof e.id === 'string' && typeof e.hash === 'string' && typeof e.timestamp === 'number',
  );
  entries.sort((a, b) => a.timestamp - b.timestamp);
  return { version: 1, uri: typeof (raw as HistoryIndex).uri === 'string' ? (raw as HistoryIndex).uri : uri, entries };
}

/**
 * Drops entries older than the retention window, then keeps only the newest `maxEntries`.
 * Returns the kept entries (oldest first) and the hashes no longer referenced by any kept entry.
 */
export function prune(entries: readonly HistoryEntry[], opts: PruneOptions): { kept: HistoryEntry[]; orphanHashes: string[] } {
  const cutoff = opts.now - Math.max(0, opts.retentionDays) * DAY_MS;
  let kept = entries.filter((e) => e.timestamp >= cutoff).sort((a, b) => a.timestamp - b.timestamp);
  const max = Math.max(1, Math.floor(opts.maxEntries));
  if (kept.length > max) kept = kept.slice(kept.length - max);
  return { kept, orphanHashes: orphans(entries, kept) };
}

/** Hashes referenced by `before` but by nothing in `after`. */
export function orphans(before: readonly HistoryEntry[], after: readonly HistoryEntry[]): string[] {
  const live = new Set(after.map((e) => e.hash));
  return [...new Set(before.map((e) => e.hash))].filter((h) => !live.has(h));
}

/** Unlabelled save snapshots identical to the latest entry are skipped; labels are always recorded. */
export function shouldRecord(entries: readonly HistoryEntry[], hash: string, source: EntrySource): boolean {
  if (source === 'label') return true;
  const latest = entries[entries.length - 1];
  return !latest || latest.hash !== hash;
}

let lastId = 0;

/** Monotonic id even when two entries are created within the same millisecond. */
export function newEntryId(now: number): string {
  lastId = Math.max(lastId + 1, now);
  return lastId.toString(36);
}

/** Lines `[start, end]` of `text`, joined with \n; out-of-range lines are simply missing. */
export function lineRange(text: string, start: number, end: number): string {
  return text.split(/\r?\n/).slice(start, end + 1).join('\n');
}

/** Short human age like `just now`, `5 min ago`, `3 h ago`, `2 days ago`. */
export function formatAge(timestamp: number, now: number): string {
  const s = Math.max(0, Math.round((now - timestamp) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? '1 day ago' : `${d} days ago`;
}
