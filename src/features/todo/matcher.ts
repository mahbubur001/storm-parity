/** Pure TODO matching (no VS Code dependency). */

export interface TodoMatch {
  /** Zero-based line. */
  line: number;
  /** Zero-based column of the tag. */
  column: number;
  tag: string;
  /** Text from the tag to the end of the line, without trailing comment closers. */
  text: string;
}

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Comment openers: //, #, /*, leading *, <!--, --, {{--, ;, %, and leading ' (VB). */
const COMMENT_CONTEXT = String.raw`(?:\/\/|#|\/\*|^\s*\*|<!--|--|;|%|^\s*')`;

/**
 * Builds the line regex. With a custom regex, group 1 (if any) is the tag; otherwise the whole match.
 * Default: one of `patterns` as a case-sensitive word, preceded somewhere on the line by a comment opener.
 */
export function buildTodoRegex(patterns: readonly string[], customRegex?: string): RegExp | undefined {
  if (customRegex && customRegex.trim()) return new RegExp(customRegex);
  const words = patterns.map((p) => p.trim()).filter(Boolean).map(escapeRegex);
  if (words.length === 0) return undefined;
  return new RegExp(String.raw`${COMMENT_CONTEXT}.*?(?<![\w$])(${words.join('|')})(?![\w$])`);
}

const CLOSERS = /\s*(?:\*\/|-->|--\}\}|\?>)\s*$/;

export function matchLine(line: string, regex: RegExp): { column: number; tag: string; text: string } | undefined {
  const m = regex.exec(line);
  if (!m) return undefined;
  const tag = m[1] ?? m[0];
  const column = m[1] !== undefined ? m.index + m[0].lastIndexOf(m[1]) : m.index;
  const text = line.slice(column).replace(CLOSERS, '').trim();
  return { column, tag, text };
}

export function findTodos(content: string, regex: RegExp): TodoMatch[] {
  const out: TodoMatch[] = [];
  const lines = content.split(/\r\n|\r|\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length > 2000) continue;
    const m = matchLine(line, regex);
    if (m) out.push({ line: i, ...m });
  }
  return out;
}

/** Heuristic binary check: a NUL byte in the first 8 KB. */
export function looksBinary(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 8192);
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return true;
  return false;
}

/** Joins exclude globs into one brace pattern for workspace.findFiles. */
export function combineGlobs(globs: readonly string[]): string | undefined {
  const unique = [...new Set(globs.map((g) => g.trim()).filter(Boolean))];
  if (unique.length === 0) return undefined;
  return unique.length === 1 ? unique[0] : `{${unique.join(',')}}`;
}
