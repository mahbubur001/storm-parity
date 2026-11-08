// Pure MRU helpers for recent folders / workspaces. No vscode imports so they stay unit-testable.

export type RecentKind = 'folder' | 'workspace';

export interface RecentEntry {
  /** Uri string (vscode.Uri.toString()). */
  uri: string;
  kind: RecentKind;
  /** Optional label reported by VS Code (remote folders etc.). */
  label?: string;
  /** Epoch millis of the last time we opened it. */
  lastOpened?: number;
}

export const WORKSPACE_EXT = '.code-workspace';

/** Normalised key used to compare uris (no trailing slash, case-insensitive drive letters). */
export function uriKey(uri: string): string {
  let key = uri.length > 1 && uri.endsWith('/') ? uri.slice(0, -1) : uri;
  key = key.replace(/^file:\/\/\/([A-Za-z])(:|%3A)/, (_m, d: string, sep: string) => `file:///${d.toLowerCase()}${sep}`);
  return key;
}

export function sameUri(a: string, b: string): boolean {
  return uriKey(a) === uriKey(b);
}

export function kindOf(uriOrPath: string): RecentKind {
  return uriOrPath.toLowerCase().endsWith(WORKSPACE_EXT) ? 'workspace' : 'folder';
}

/** Moves (or inserts) `entry` to the front, dedupes by uri and caps the list at `max`. */
export function touchEntry(list: readonly RecentEntry[], entry: RecentEntry, max = 50): RecentEntry[] {
  const rest = list.filter((e) => !sameUri(e.uri, entry.uri));
  return [entry, ...rest].slice(0, Math.max(0, max));
}

export function removeEntry(list: readonly RecentEntry[], uri: string): RecentEntry[] {
  return list.filter((e) => !sameUri(e.uri, uri));
}

/** Keeps `primary` order, then appends `secondary` entries not already present. */
export function mergeEntries(primary: readonly RecentEntry[], secondary: readonly RecentEntry[]): RecentEntry[] {
  const seen = new Set<string>();
  const out: RecentEntry[] = [];
  for (const e of [...primary, ...secondary]) {
    const key = uriKey(e.uri);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

/** Last path segment of a uri string, decoded, with the workspace extension stripped. */
export function displayName(uri: string): string {
  const withoutQuery = uri.split(/[?#]/)[0];
  const trimmed = withoutQuery.endsWith('/') ? withoutQuery.slice(0, -1) : withoutQuery;
  let name = trimmed.slice(trimmed.lastIndexOf('/') + 1);
  try {
    name = decodeURIComponent(name);
  } catch {
    // keep the raw segment
  }
  if (name.toLowerCase().endsWith(WORKSPACE_EXT)) name = `${name.slice(0, -WORKSPACE_EXT.length)} (Workspace)`;
  return name || uri;
}

/** Replaces the home directory prefix with `~`. */
export function tildify(fsPath: string, home: string): string {
  if (!home) return fsPath;
  if (fsPath === home) return '~';
  const sep = home.includes('\\') ? '\\' : '/';
  const prefix = home.endsWith(sep) ? home : home + sep;
  return fsPath.startsWith(prefix) ? `~${sep}${fsPath.slice(prefix.length)}` : fsPath;
}
