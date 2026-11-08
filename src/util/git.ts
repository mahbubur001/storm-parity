// Shared git helpers: a minimal typing of the built-in git extension API, a git CLI runner
// (execFile-style, never through a shell) and a pure parser for `git status --porcelain=v1 -z`.
import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { createHash } from 'crypto';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Built-in git extension API (subset)
// ---------------------------------------------------------------------------

export interface GitRepositoryState {
  readonly onDidChange: vscode.Event<void>;
}

export interface GitRepository {
  readonly rootUri: vscode.Uri;
  readonly state: GitRepositoryState;
  push?(remoteName?: string, branchName?: string, setUpstream?: boolean): Promise<void>;
}

export type GitApiState = 'uninitialized' | 'initialized';

export interface GitAPI {
  readonly state: GitApiState;
  readonly onDidChangeState: vscode.Event<GitApiState>;
  readonly git: { readonly path: string };
  readonly repositories: GitRepository[];
  readonly onDidOpenRepository: vscode.Event<GitRepository>;
  readonly onDidCloseRepository: vscode.Event<GitRepository>;
  toGitUri(uri: vscode.Uri, ref: string): vscode.Uri;
}

interface GitExtension {
  readonly enabled: boolean;
  getAPI(version: 1): GitAPI;
}

let apiPromise: Promise<GitAPI | undefined> | undefined;

/** Resolves the git extension API once it is initialized, or undefined when git is unavailable. */
export function getGitApi(): Promise<GitAPI | undefined> {
  apiPromise ??= loadGitApi();
  return apiPromise;
}

async function loadGitApi(): Promise<GitAPI | undefined> {
  try {
    const ext = vscode.extensions.getExtension<GitExtension>('vscode.git');
    if (!ext) return undefined;
    const exports = ext.isActive ? ext.exports : await ext.activate();
    if (!exports?.enabled) return undefined;
    const api = exports.getAPI(1);
    if (api.state !== 'initialized') {
      await new Promise<void>((resolve) => {
        const sub = api.onDidChangeState((s) => {
          if (s === 'initialized') {
            sub.dispose();
            resolve();
          }
        });
      });
    }
    if (api.git?.path) gitPath = api.git.path;
    return api;
  } catch (err) {
    console.error('[storm-parity] git extension unavailable', err);
    return undefined;
  }
}

/** The repository whose root is the longest prefix of `uri`, if any. */
export function findRepository(api: GitAPI, uri: vscode.Uri): GitRepository | undefined {
  let best: GitRepository | undefined;
  for (const repo of api.repositories) {
    if (isInside(repo.rootUri.fsPath, uri.fsPath) && (!best || repo.rootUri.fsPath.length > best.rootUri.fsPath.length)) {
      best = repo;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// git CLI
// ---------------------------------------------------------------------------

let gitPath = 'git';

/** Overrides the git binary (normally taken from the git extension). */
export function setGitPath(p: string): void {
  gitPath = p;
}

export class GitError extends Error {
  constructor(
    message: string,
    readonly stderr: string,
    readonly exitCode: number | null,
  ) {
    super(message);
    this.name = 'GitError';
  }
}

export interface GitRunOptions {
  /** Data written to stdin. */
  input?: string | Buffer;
  /** Extra environment variables. */
  env?: Record<string, string>;
}

/**
 * Runs git with `args` in `cwd` (no shell) and returns raw stdout.
 * Pathspecs are always literal (GIT_LITERAL_PATHSPECS) so file names like `[id].ts` never glob.
 */
export function runGitRaw(cwd: string, args: string[], opts: GitRunOptions = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(gitPath, args, {
      cwd,
      env: { ...process.env, GIT_LITERAL_PATHSPECS: '1', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C', ...opts.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (b: Buffer) => out.push(b));
    child.stderr.on('data', (b: Buffer) => err.push(b));
    child.on('error', (e) => reject(new GitError(`Failed to run git: ${e.message}`, '', null)));
    child.on('close', (code) => {
      const stderr = Buffer.concat(err).toString('utf8');
      if (code === 0) resolve(Buffer.concat(out));
      else reject(new GitError(stderr.trim() || `git ${args[0]} exited with code ${code}`, stderr, code));
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(opts.input ?? '');
  });
}

export async function runGit(cwd: string, args: string[], opts: GitRunOptions = {}): Promise<string> {
  return (await runGitRaw(cwd, args, opts)).toString('utf8');
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export interface StatusEntry {
  /** Repo-relative path, forward slashes. */
  path: string;
  /** Source path for renames/copies. */
  origPath?: string;
  /** Index status letter. */
  x: string;
  /** Worktree status letter. */
  y: string;
}

export type ChangeKind = 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'untracked' | 'ignored' | 'conflict';

/** Parses `git status --porcelain=v1 -z` output. */
export function parsePorcelainZ(output: string): StatusEntry[] {
  const parts = output.split('\0');
  const entries: StatusEntry[] = [];
  for (let i = 0; i < parts.length; i++) {
    const rec = parts[i];
    if (rec.length < 4 || rec[2] !== ' ') continue;
    const x = rec[0];
    const y = rec[1];
    const entry: StatusEntry = { path: rec.slice(3), x, y };
    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') {
      const orig = parts[++i];
      if (orig) entry.origPath = orig;
    }
    entries.push(entry);
  }
  return entries;
}

export function changeKind(e: Pick<StatusEntry, 'x' | 'y'>): ChangeKind {
  const { x, y } = e;
  if (x === '?' && y === '?') return 'untracked';
  if (x === '!' && y === '!') return 'ignored';
  if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) return 'conflict';
  if (x === 'R' || y === 'R') return 'renamed';
  if (x === 'C' || y === 'C') return 'copied';
  if (x === 'D' || y === 'D') return 'deleted';
  if (x === 'A' || y === 'A') return 'added';
  return 'modified';
}

export function statusLetter(kind: ChangeKind): string {
  switch (kind) {
    case 'modified':
      return 'M';
    case 'added':
      return 'A';
    case 'deleted':
      return 'D';
    case 'renamed':
      return 'R';
    case 'copied':
      return 'C';
    case 'untracked':
      return 'U';
    case 'ignored':
      return 'I';
    case 'conflict':
      return '!';
  }
}

/** Changed (non-ignored) files of the repository at `root`. */
export async function getStatus(root: string): Promise<StatusEntry[]> {
  const out = await runGit(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], {
    env: { GIT_OPTIONAL_LOCKS: '0' },
  });
  return parsePorcelainZ(out).filter((e) => changeKind(e) !== 'ignored');
}

/** All paths (new and original) touched by the given entries. */
export function entryPaths(entries: readonly StatusEntry[]): string[] {
  const set = new Set<string>();
  for (const e of entries) {
    set.add(e.path);
    if (e.origPath) set.add(e.origPath);
  }
  return [...set];
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export function isInside(root: string, file: string): boolean {
  const rel = path.relative(root, file);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Repo-relative, forward-slash path for an absolute file path (undefined when outside the repo). */
export function toRepoPath(root: string, file: string): string | undefined {
  const rel = path.relative(root, file);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return undefined;
  return rel.split(path.sep).join('/');
}

export function fromRepoPath(root: string, repoPath: string): string {
  return path.join(root, ...repoPath.split('/'));
}

/** Stable short hash for a repository root, used for storage folder names. */
export function repoHash(root: string): string {
  return createHash('sha1').update(path.resolve(root)).digest('hex').slice(0, 12);
}
