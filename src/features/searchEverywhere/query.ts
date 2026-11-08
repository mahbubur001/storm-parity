// Pure helpers for Search Everywhere: prefix parsing, fuzzy scoring and glob building.

export type Category = 'all' | 'files' | 'symbols' | 'actions' | 'settings';

export interface CategoryInfo {
  id: Category;
  label: string;
  /** Prefix typed in the input to switch to this category ('' for All). */
  prefix: string;
}

export const CATEGORIES: readonly CategoryInfo[] = [
  { id: 'all', label: 'All', prefix: '' },
  { id: 'files', label: 'Files', prefix: 'f ' },
  { id: 'symbols', label: 'Symbols', prefix: '#' },
  { id: 'actions', label: 'Actions', prefix: '>' },
  { id: 'settings', label: 'Settings', prefix: '@set ' },
];

export interface ParsedQuery {
  category: Category;
  text: string;
}

/** Splits the raw input into its category prefix and the search text. */
export function parseQuery(value: string): ParsedQuery {
  for (const c of CATEGORIES) {
    if (c.prefix && value.startsWith(c.prefix)) return { category: c.id, text: value.slice(c.prefix.length).trim() };
  }
  return { category: 'all', text: value.trim() };
}

export function prefixFor(category: Category): string {
  return CATEGORIES.find((c) => c.id === category)?.prefix ?? '';
}

/**
 * Subsequence fuzzy score (higher is better), undefined when `query` is not a subsequence of
 * `target`. Rewards exact/prefix/substring matches, word-start hits and consecutive runs.
 * Whitespace in the query separates independent terms that all have to match.
 */
export function fuzzyScore(query: string, target: string): number | undefined {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return 0;
  const t = target.toLowerCase();
  let total = 0;
  for (const q of terms) {
    const s = termScore(q, t, target);
    if (s === undefined) return undefined;
    total += s;
  }
  return total;
}

function termScore(q: string, t: string, original: string): number | undefined {
  if (t === q) return 1000;
  const idx = t.indexOf(q);
  if (idx === 0) return 800 - t.length;
  if (idx > 0) return (isWordStart(original, idx) ? 600 : 400) - t.length;
  let score = 0;
  let ti = 0;
  let prev = -2;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found < 0) return undefined;
    score += found === prev + 1 ? 5 : 1;
    if (isWordStart(original, found)) score += 8;
    prev = found;
    ti = found + 1;
  }
  return score - t.length / 10;
}

function isWordStart(s: string, i: number): boolean {
  if (i === 0) return true;
  const prev = s[i - 1];
  const cur = s[i];
  return /[^A-Za-z0-9]/.test(prev) || (/[a-z0-9]/.test(prev) && /[A-Z]/.test(cur));
}

const escapeGlobChar = (ch: string): string => {
  if (/[a-zA-Z]/.test(ch)) return `[${ch.toLowerCase()}${ch.toUpperCase()}]`;
  // Glob metacharacters are dropped; the surrounding `*` already covers them and results are re-scored.
  return /[[\]{}*?!,]/.test(ch) ? '' : ch;
};

/**
 * Case-insensitive fuzzy glob for workspace.findFiles. `foo` -> `**\/*[fF]*[oO]*[oO]*` (matches
 * the file name only); `src/foo` constrains the parent folder too.
 */
export function fileGlob(query: string): string {
  const segments = query.replace(/\\/g, '/').split('/').map((s) => s.replace(/\s+/g, '')).filter(Boolean);
  if (segments.length === 0) return '**/*';
  const fuzzy = (seg: string): string => `*${[...seg].map(escapeGlobChar).filter(Boolean).join('*')}*`.replace(/\*+/g, '*');
  return `**/${segments.map(fuzzy).join('/**/')}`;
}

/** Combines enabled glob keys of files.exclude / search.exclude style objects into one brace glob. */
export function excludeGlob(...maps: Array<Record<string, unknown> | undefined>): string | undefined {
  const patterns = new Set<string>();
  for (const m of maps) {
    for (const [glob, enabled] of Object.entries(m ?? {})) {
      // `when` clauses (objects) need sibling checks findFiles cannot express; nested braces break the outer brace.
      if (enabled === true && !glob.includes('{')) patterns.add(glob);
    }
  }
  if (patterns.size === 0) return undefined;
  return patterns.size === 1 ? [...patterns][0] : `{${[...patterns].join(',')}}`;
}
