/** Pure helpers for scratch file naming and language ordering (no VS Code dependency). */

const SCRATCH_RE = /^scratch_(\d+)(?:\.|$)/;

/** Next free `scratch_<n>.<ext>`: n is one more than the highest number in use (any extension), starting at 1. */
export function nextScratchName(existing: readonly string[], ext: string): string {
  let max = 0;
  for (const name of existing) {
    const m = SCRATCH_RE.exec(name);
    if (m) max = Math.max(max, Number(m[1]));
  }
  const cleanExt = ext.replace(/^\.+/, '');
  return cleanExt ? `scratch_${max + 1}.${cleanExt}` : `scratch_${max + 1}`;
}

/** Validates a user-supplied file name; returns an error message or undefined when valid. */
export function validateFileName(name: string): string | undefined {
  const trimmed = name.trim();
  if (!trimmed) return 'Name must not be empty.';
  if (/[\\/:*?"<>|\u0000-\u001f]/.test(trimmed)) return 'Name contains invalid characters.';
  if (trimmed === '.' || trimmed === '..') return 'Invalid name.';
  return undefined;
}

/** Moves recently used ids to the front (in recency order), keeping the rest in their original order. */
export function orderByRecent<T>(items: readonly T[], recent: readonly string[], id: (item: T) => string): T[] {
  const rank = new Map(recent.map((r, i) => [r, i]));
  const top = items.filter((i) => rank.has(id(i))).sort((a, b) => rank.get(id(a))! - rank.get(id(b))!);
  return [...top, ...items.filter((i) => !rank.has(id(i)))];
}

/** Adds `id` to the front of the MRU list, capped at `max`. */
export function touchRecent(recent: readonly string[], id: string, max = 5): string[] {
  return [id, ...recent.filter((r) => r !== id)].slice(0, max);
}
