// Git operations behind shelve/unshelve. Every command is limited to an explicit path list.
import { promises as fs } from 'fs';
import { GitError, StatusEntry, changeKind, entryPaths, fromRepoPath, isInside, runGit, runGitRaw } from '../../util/git';

const DIFF_ARGS = [
  'diff',
  'HEAD',
  '--binary',
  '--no-color',
  '--no-ext-diff',
  '--no-textconv',
  '--no-relative',
  '--src-prefix=a/',
  '--dst-prefix=b/',
];

/**
 * Builds a binary patch (HEAD vs working tree) for `entries`.
 * Untracked files are marked intent-to-add first so they show up in the diff; that is undone on failure.
 */
export async function createPatch(root: string, entries: readonly StatusEntry[]): Promise<Buffer> {
  const paths = entryPaths(entries);
  if (paths.length === 0) throw new Error('No files selected.');
  const conflicted = entries.filter((e) => changeKind(e) === 'conflict');
  if (conflicted.length) throw new Error(`Resolve conflicts before shelving: ${conflicted.map((e) => e.path).join(', ')}`);
  const untracked = entries.filter((e) => changeKind(e) === 'untracked').map((e) => e.path);
  if (untracked.length) await runGit(root, ['add', '-N', '--', ...untracked]);
  try {
    const patch = await runGitRaw(root, [...DIFF_ARGS, '--', ...paths]);
    if (patch.length === 0) throw new Error('The selected files have no changes against HEAD.');
    return patch;
  } catch (err) {
    await undoIntentToAdd(root, untracked);
    throw err;
  }
}

/** Removes intent-to-add index entries again (leaves the files on disk). */
export async function undoIntentToAdd(root: string, paths: readonly string[]): Promise<void> {
  if (paths.length === 0) return;
  await runGit(root, ['rm', '--cached', '-q', '--ignore-unmatch', '--', ...paths]).catch(() => undefined);
}

/**
 * Reverts exactly `entries` to HEAD: files present in HEAD are checked out, new files are
 * dropped from the index and deleted from disk.
 */
export async function revertEntries(root: string, entries: readonly StatusEntry[]): Promise<void> {
  const paths = entryPaths(entries);
  if (paths.length === 0) return;
  const listed = await runGit(root, ['ls-tree', '-r', '-z', '--name-only', '--full-tree', 'HEAD', '--', ...paths]);
  const inHead = new Set(listed.split('\0').filter(Boolean));
  const tracked = paths.filter((p) => inHead.has(p));
  const fresh = paths.filter((p) => !inHead.has(p));
  if (tracked.length) await runGit(root, ['checkout', '-q', 'HEAD', '--', ...tracked]);
  if (fresh.length) {
    await runGit(root, ['rm', '--cached', '-q', '-f', '--ignore-unmatch', '--', ...fresh]);
    for (const p of fresh) {
      const abs = fromRepoPath(root, p);
      if (abs === root || !isInside(root, abs)) continue;
      try {
        const st = await fs.lstat(abs);
        if (st.isFile() || st.isSymbolicLink()) await fs.unlink(abs);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
    }
  }
}

export interface ApplyResult {
  threeWay: boolean;
  conflicts: boolean;
}

/** Applies a patch file to the working tree; falls back to a 3-way merge when it does not apply cleanly. */
export async function applyPatch(root: string, patchFile: string): Promise<ApplyResult> {
  try {
    await runGit(root, ['apply', '--whitespace=nowarn', '--', patchFile]);
    return { threeWay: false, conflicts: false };
  } catch (plainErr) {
    try {
      await runGit(root, ['apply', '--3way', '--whitespace=nowarn', '--', patchFile]);
      return { threeWay: true, conflicts: false };
    } catch (err) {
      if (err instanceof GitError && /with conflicts/i.test(err.stderr)) return { threeWay: true, conflicts: true };
      throw err instanceof GitError ? err : plainErr;
    }
  }
}
