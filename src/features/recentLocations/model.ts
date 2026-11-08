// Pure recent-locations list logic (no vscode import) so it can be unit tested.
import { LineChange, shiftLineAll } from './lineShift';

export interface RecentLocation {
  uri: string;
  line: number;
  character: number;
  /** True once the location has been edited. */
  changed: boolean;
  timestamp: number;
}

export interface RecordOptions {
  /** Entries in the same file within this many lines are merged. */
  mergeDistance: number;
  maxEntries: number;
}

const isUnder = (uri: string, prefix: string): boolean => uri === prefix || uri.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`);

/**
 * Records a location, most recent first. A location near an existing entry of the same file
 * replaces that entry (moved to the front); an edited entry keeps its changed line when merely viewed again.
 */
export function recordLocation(list: readonly RecentLocation[], entry: RecentLocation, opts: RecordOptions): RecentLocation[] {
  const i = list.findIndex((l) => l.uri === entry.uri && Math.abs(l.line - entry.line) <= opts.mergeDistance);
  const rest = i < 0 ? [...list] : list.filter((_, j) => j !== i);
  const old = i < 0 ? undefined : list[i];
  const keepOld = old?.changed && !entry.changed;
  const merged: RecentLocation = {
    ...entry,
    line: keepOld ? old.line : entry.line,
    character: keepOld ? old.character : entry.character,
    changed: entry.changed || !!old?.changed,
  };
  return [merged, ...rest].slice(0, Math.max(1, opts.maxEntries));
}

/** Shifts the entries of `uri` for an edit, merging entries that collapse onto the same line. */
export function shiftLocations(list: readonly RecentLocation[], uri: string, changes: readonly LineChange[]): RecentLocation[] | undefined {
  if (changes.length === 0 || !list.some((l) => l.uri === uri)) return undefined;
  let moved = false;
  const shifted = list.map((l) => {
    if (l.uri !== uri) return l;
    const line = shiftLineAll(l.line, changes);
    if (line === l.line) return l;
    moved = true;
    return { ...l, line, character: 0 };
  });
  if (!moved) return undefined;
  const seen = new Set<string>();
  return shifted.filter((l) => {
    const key = `${l.line}:${l.uri}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function renameLocations(list: readonly RecentLocation[], oldUri: string, newUri: string): RecentLocation[] | undefined {
  if (!list.some((l) => isUnder(l.uri, oldUri))) return undefined;
  return list.map((l) => (isUnder(l.uri, oldUri) ? { ...l, uri: newUri + l.uri.slice(oldUri.length) } : l));
}

export function removeLocations(list: readonly RecentLocation[], uri: string): RecentLocation[] | undefined {
  const next = list.filter((l) => !isUnder(l.uri, uri));
  return next.length === list.length ? undefined : next;
}

/** Validates persisted data. */
export function parseLocations(raw: unknown): RecentLocation[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (l): l is RecentLocation =>
      !!l && typeof l === 'object' && typeof l.uri === 'string' && typeof l.line === 'number' && typeof l.character === 'number',
  ).map((l) => ({ ...l, changed: !!l.changed, timestamp: typeof l.timestamp === 'number' ? l.timestamp : 0 }));
}
