/**
 * Pure Surround With template catalogue and snippet builder (no VS Code dependency).
 *
 * Template lines use VS Code snippet syntax. `head` lines go before the selected code, `tail` lines after it;
 * the body is indented by one `\t`, which insertSnippet converts to the editor's indent unit.
 * `wrap` templates (parens, quotes, tags) are applied inline when the selection is a partial single line.
 */
export interface SurroundTemplate {
  label: string;
  head: string[];
  tail: string[];
  /** Inline form for partial single-line selections. */
  wrap?: { open: string; close: string };
}

const block = (label: string, head: string | string[], tail: string | string[] = '}'): SurroundTemplate => ({
  label,
  head: Array.isArray(head) ? head : [head],
  tail: Array.isArray(tail) ? tail : [tail],
});

const wrap = (label: string, open: string, close: string): SurroundTemplate => ({ label, head: [open], tail: [close], wrap: { open, close } });

const PHP: SurroundTemplate[] = [
  block('if', 'if (${1:true}) {'),
  block('if / else', 'if (${1:true}) {', ['} else {', '\t$0', '}']),
  block('while', 'while (${1:true}) {'),
  block('do / while', 'do {', '} while (${1:true});'),
  block('for', 'for (\\$${1:i} = 0; \\$${1:i} < ${2:count}; \\$${1:i}++) {'),
  block('foreach', 'foreach (\\$${1:items} as \\$${2:item}) {'),
  block('try / catch', 'try {', ['} catch (${1:\\\\Throwable} \\$${2:e}) {', '\t$0', '}']),
  block('try / finally', 'try {', ['} finally {', '\t$0', '}']),
  block('function', 'function ${1:name}(${2}) {'),
  block('region', '// region ${1:Description}', '// endregion'),
];

const JS: SurroundTemplate[] = [
  block('if', 'if (${1:true}) {'),
  block('if / else', 'if (${1:true}) {', ['} else {', '\t$0', '}']),
  block('while', 'while (${1:true}) {'),
  block('for', 'for (let ${1:i} = 0; ${1:i} < ${2:count}; ${1:i}++) {'),
  block('for...of', 'for (const ${1:item} of ${2:items}) {'),
  block('try / catch', 'try {', ['} catch (${1:e}) {', '\t$0', '}']),
  block('try / finally', 'try {', ['} finally {', '\t$0', '}']),
  block('function', 'function ${1:name}(${2}) {'),
  block('arrow IIFE', '(() => {', '})();'),
  block('region', '//#region ${1:Description}', '//#endregion'),
];

const TAG = wrap('<tag></tag>', '<${1:div}>', '</${1}>');
const HTML_COMMENT = wrap('<!-- comment -->', '<!-- ', ' -->');
const MARKUP: SurroundTemplate[] = [TAG, HTML_COMMENT];

const LANGUAGE_TEMPLATES: Record<string, SurroundTemplate[]> = {
  php: [...PHP, TAG],
  javascript: JS,
  typescript: JS,
  javascriptreact: [...JS, TAG],
  typescriptreact: [...JS, TAG],
  html: MARKUP,
  blade: MARKUP,
  vue: MARKUP,
  vue_html: MARKUP,
  xml: MARKUP,
  xsl: MARKUP,
  svg: MARKUP,
};

const LINE_COMMENTS: Record<string, string> = {
  php: '//', javascript: '//', typescript: '//', javascriptreact: '//', typescriptreact: '//', java: '//', c: '//',
  cpp: '//', csharp: '//', go: '//', rust: '//', swift: '//', kotlin: '//', scala: '//', dart: '//', jsonc: '//',
  scss: '//', less: '//', groovy: '//', fsharp: '//',
  python: '#', shellscript: '#', ruby: '#', perl: '#', r: '#', yaml: '#', toml: '#', dockerfile: '#', makefile: '#',
  powershell: '#', ini: ';', properties: '#', coffeescript: '#', julia: '#', elixir: '#', nginx: '#',
  sql: '--', lua: '--', haskell: '--', ada: '--',
  latex: '%', tex: '%', erlang: '%', matlab: '%',
  clojure: ';', lisp: ';', scheme: ';', vb: "'", bat: 'REM',
};

export function lineCommentFor(languageId: string): string | undefined {
  return LINE_COMMENTS[languageId];
}

/** Language-specific templates first, then generic wrappers. */
export function templatesFor(languageId: string): SurroundTemplate[] {
  const specific = LANGUAGE_TEMPLATES[languageId] ?? [];
  const generic: SurroundTemplate[] = [wrap('( )', '(', ')'), wrap('[ ]', '[', ']'), wrap('" "', '"', '"'), wrap("' '", "'", "'")];
  const hasRegion = specific.some((t) => t.label === 'region');
  const comment = lineCommentFor(languageId);
  if (!hasRegion && comment) generic.push(block('region', `${comment} region \${1:Description}`, `${comment} endregion`));
  return [...specific, ...generic];
}

/** PhpStorm-style mnemonics: 1-9, 0, then A-Z. */
export function mnemonic(index: number): string | undefined {
  if (index < 9) return String(index + 1);
  if (index === 9) return '0';
  const letter = index - 10;
  return letter < 26 ? String.fromCharCode(65 + letter) : undefined;
}

/** Escapes text so it is inserted literally by a snippet. */
export function escapeSnippet(text: string): string {
  return text.replace(/[\\$}]/g, (c) => `\\${c}`);
}

const leadingWhitespace = (line: string): string => /^[ \t]*/.exec(line)![0];

/** Removes the longest leading whitespace prefix shared by all non-blank lines. */
export function stripCommonIndent(lines: readonly string[]): string[] {
  const indents = lines.filter((l) => l.trim() !== '').map(leadingWhitespace);
  if (indents.length === 0) return lines.map(() => '');
  let common = indents[0];
  for (const ind of indents.slice(1)) {
    let i = 0;
    while (i < common.length && i < ind.length && common[i] === ind[i]) i++;
    common = common.slice(0, i);
  }
  return lines.map((l) => (l.trim() === '' ? '' : l.slice(common.length)));
}

const hasFinalTabstop = (t: SurroundTemplate): boolean => [...t.head, ...t.tail].some((l) => /\$0|\$\{0[:}]/.test(l));

/**
 * Builds the snippet for block mode: `lines` are the full selected lines; the snippet is meant to be inserted
 * over the range starting at the first non-whitespace column of the first line (insertSnippet re-indents
 * following lines relative to that line).
 */
export function buildBlockSnippet(template: SurroundTemplate, lines: readonly string[]): string {
  const body = stripCommonIndent(lines);
  const blank = body.every((l) => l === '');
  const bodyLines = blank
    ? [hasFinalTabstop(template) ? '\t' : '\t$0']
    : body.map((l) => (l === '' ? '' : `\t${escapeSnippet(l)}`));
  return [...template.head, ...bodyLines, ...template.tail].join('\n');
}

/** Builds the snippet for inline mode (wrap templates around a partial single-line selection). */
export function buildInlineSnippet(template: SurroundTemplate, text: string): string {
  const { open, close } = template.wrap ?? { open: template.head.join(' '), close: template.tail.join(' ') };
  return `${open}${escapeSnippet(text)}${close}`;
}
