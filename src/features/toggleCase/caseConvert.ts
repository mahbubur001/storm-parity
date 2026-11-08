// Pure case conversion helpers. No vscode imports so they are trivially unit-testable.

export type CaseStyle = 'camel' | 'snake' | 'kebab' | 'pascal' | 'screamingSnake';

/** Order used by cycleCase: camelCase -> snake_case -> kebab-case -> PascalCase -> SCREAMING_SNAKE -> camelCase. */
export const CYCLE_ORDER: readonly CaseStyle[] = ['camel', 'snake', 'kebab', 'pascal', 'screamingSnake'];

/** Toggle between lower and UPPER: any lowercase letter makes the whole text upper, otherwise lower. */
export function toggleUpperLower(text: string): string {
  return /\p{Ll}/u.test(text) ? text.toUpperCase() : text.toLowerCase();
}

/**
 * Splits an identifier-ish string into lowercase-agnostic words.
 * Handles camelCase, PascalCase, snake_case, kebab-case, SCREAMING_SNAKE, dotted/spaced text,
 * acronyms (`XMLHttpRequest` -> XML, Http, Request) and digits (`base64Encode` -> base64, Encode).
 */
export function splitWords(text: string): string[] {
  const words: string[] = [];
  for (const chunk of text.split(/[^\p{L}\p{N}]+/u)) {
    if (!chunk) continue;
    // lower->Upper boundary, and acronym->Word boundary (`HTTPServer` -> HTTP | Server).
    const parts = chunk
      .replace(/(\p{Ll}|\p{N})(\p{Lu})/gu, '$1\u0000$2')
      .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1\u0000$2')
      .split('\u0000');
    for (const p of parts) if (p) words.push(p);
  }
  return words;
}

const cap = (w: string): string => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();

/** Converts the core of an identifier (no surrounding punctuation) to the given style. */
export function convertWords(words: readonly string[], style: CaseStyle): string {
  if (words.length === 0) return '';
  switch (style) {
    case 'camel':
      return words[0].toLowerCase() + words.slice(1).map(cap).join('');
    case 'pascal':
      return words.map(cap).join('');
    case 'snake':
      return words.map((w) => w.toLowerCase()).join('_');
    case 'kebab':
      return words.map((w) => w.toLowerCase()).join('-');
    case 'screamingSnake':
      return words.map((w) => w.toUpperCase()).join('_');
  }
}

interface Affixes {
  prefix: string;
  core: string;
  suffix: string;
}

/** Keeps leading/trailing non-word characters (e.g. `$`, `_`, `@`) out of the conversion. */
function splitAffixes(text: string): Affixes {
  const m = /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/su.exec(text);
  return m ? { prefix: m[1], core: m[2], suffix: m[3] } : { prefix: '', core: text, suffix: '' };
}

/** Converts `text` to `style`, preserving leading/trailing punctuation such as `$` or `_`. */
export function convertCase(text: string, style: CaseStyle): string {
  const { prefix, core, suffix } = splitAffixes(text);
  const words = splitWords(core);
  if (words.length === 0) return text;
  return prefix + convertWords(words, style) + suffix;
}

/** Best-effort detection of the style of `text`, or undefined when it does not match any. */
export function detectCase(text: string): CaseStyle | undefined {
  const { core } = splitAffixes(text);
  if (!core) return undefined;
  if (/^\p{Lu}[\p{Lu}\p{N}]*(_[\p{Lu}\p{N}]+)+$/u.test(core)) return 'screamingSnake';
  if (/^[\p{Ll}\p{N}]+(_[\p{Ll}\p{N}]+)+$/u.test(core)) return 'snake';
  if (/^[\p{Ll}\p{N}]+(-[\p{Ll}\p{N}]+)+$/u.test(core)) return 'kebab';
  if (/^\p{Lu}[\p{L}\p{N}]*$/u.test(core) && /\p{Ll}/u.test(core)) return 'pascal';
  if (/^\p{Ll}[\p{L}\p{N}]*$/u.test(core)) return 'camel';
  return undefined;
}

/**
 * Next form in the cycle. Styles that would produce identical text (e.g. `foo` is both camel and
 * snake) are skipped so every invocation visibly changes something when possible.
 */
export function cycleCase(text: string): string {
  const current = detectCase(text);
  const start = current ? CYCLE_ORDER.indexOf(current) : -1;
  for (let i = 1; i <= CYCLE_ORDER.length; i++) {
    const style = CYCLE_ORDER[(start + i) % CYCLE_ORDER.length];
    const next = convertCase(text, style);
    if (next !== text) return next;
  }
  return text;
}
