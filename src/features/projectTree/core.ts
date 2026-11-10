export type FolderKind = 'library' | 'excluded';

const matches = (segments: string[], i: number, pattern: string): boolean => {
  const p = pattern.replace(/^\/+|\/+$/g, '');
  if (!p) return false;
  return p.includes('/') ? segments.slice(0, i + 1).join('/') === p : segments[i] === p;
};

/**
 * Kind of the folder at `relPath` (workspace-relative, `/`-separated), or undefined. Folders inside an already marked
 * folder are left alone, so node_modules/foo/vendor isn't flagged again.
 */
export function classify(relPath: string, libraryRoots: string[], excluded: string[]): FolderKind | undefined {
  const segments = relPath.split('/').filter(Boolean);
  const kindAt = (i: number): FolderKind | undefined => {
    if (libraryRoots.some((p) => matches(segments, i, p))) return 'library';
    if (excluded.some((p) => matches(segments, i, p))) return 'excluded';
    return undefined;
  };
  for (let i = 0; i < segments.length - 1; i++) if (kindAt(i)) return undefined;
  return segments.length ? kindAt(segments.length - 1) : undefined;
}
