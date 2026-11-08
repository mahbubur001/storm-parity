// Pure logic for External Libraries. No `vscode` import, so it is unit-testable without an editor.
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

/** Absolute path for a stored include path: expands `~` and resolves relative paths against `base`. */
export function expandPath(stored: string, base: string, home = os.homedir()): string {
  const p = stored.trim();
  const expanded = p === '~' || /^~[\\/]/.test(p) ? path.join(home, p.slice(1)) : p;
  return path.resolve(base, expanded);
}

/**
 * Portable form for settings: paths inside the home folder become `~/...` (like PhpStorm's $USER_HOME$), so a
 * committed .vscode/settings.json works for everyone.
 */
export function contractPath(absolute: string, home = os.homedir()): string {
  const rel = path.relative(home, absolute);
  if (rel === '') return '~';
  if (rel.startsWith('..') || path.isAbsolute(rel)) return absolute;
  return `~/${rel.split(path.sep).join('/')}`;
}

/** User input to absolute path: trims spaces and surrounding quotes (pasted from a terminal), then expands. */
export function resolveInput(input: string, base: string): string {
  return expandPath(input.trim().replace(/^(["'])(.*)\1$/, '$2'), base);
}

/**
 * Include paths from PhpStorm's .idea/php.xml (`<include_path><path value="..."/></include_path>`), with the
 * $USER_HOME$ and $PROJECT_DIR$ macros expanded.
 */
export function parsePhpStormIncludePaths(xml: string, projectDir: string, home = os.homedir()): string[] {
  const block = /<include_path>([\s\S]*?)<\/include_path>/.exec(xml)?.[1] ?? '';
  return [...block.matchAll(/<path\s+value="([^"]*)"/g)]
    .map((m) => m[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>'))
    .map((v) => v.replace(/\$USER_HOME\$/g, home).replace(/\$PROJECT_DIR\$/g, projectDir))
    .filter(Boolean)
    .map((v) => path.resolve(projectDir, v));
}

/**
 * Next value of another tool's include-path setting: the user's own entries are kept, entries this extension added
 * before (`managed`) are replaced by `ours`.
 */
export function mergeManaged(current: readonly string[], managed: readonly string[], ours: readonly string[]): string[] {
  const mine = new Set(managed);
  return [...new Set([...current.filter((p) => !mine.has(p)), ...ours])];
}

export interface SettingValues {
  globalValue?: unknown;
  workspaceValue?: unknown;
  workspaceFolderValue?: unknown;
}

/** True when the user set the key anywhere (as opposed to only the contributed default). */
export function isSet(values: SettingValues | undefined): boolean {
  return values?.globalValue !== undefined || values?.workspaceValue !== undefined || values?.workspaceFolderValue !== undefined;
}

/** Keeps the string entries of a raw setting value; anything else counts as empty. */
export function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((p): p is string => typeof p === 'string') : [];
}

/**
 * The effective include-path list: the Storm Parity setting once it is set anywhere, otherwise the legacy
 * `iextlibraries.includePaths` from the standalone iExternal Libraries extension.
 */
export function effectivePaths(current: SettingValues | undefined, currentValue: unknown, legacyValue: unknown): string[] {
  return isSet(current) ? stringList(currentValue) : stringList(legacyValue);
}

export interface Entry {
  name: string;
  path: string;
  isDirectory: boolean;
}

/** Directory entries, folders first, then case-insensitive natural order. Symlinks are followed; broken ones are files. */
export async function listDirectory(dir: string): Promise<Entry[]> {
  const dirents = await fs.readdir(dir, { withFileTypes: true });
  const entries = await Promise.all(
    dirents.map(async (d) => {
      const full = path.join(dir, d.name);
      const isDir = d.isDirectory() || (d.isSymbolicLink() && (await isDirectory(full)));
      return { name: d.name, path: full, isDirectory: isDir };
    }),
  );
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  return entries.sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || collator.compare(a.name, b.name));
}

export function isDirectory(p: string): Promise<boolean> {
  return fs.stat(p).then(
    (s) => s.isDirectory(),
    () => false,
  );
}
