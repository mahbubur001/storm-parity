// PHP postfix completion (PhpStorm: Editor | General | Postfix Completion). Pure: no vscode import, unit tested.

export interface PostfixTemplate {
  key: string;
  description: string;
  /** Snippet body; `$EXPR` is replaced by the (snippet-escaped) expression. */
  body: string;
  /** Only for bare class names (`Foo.new`), or only for value expressions. */
  only?: 'className' | 'value';
}

const block = (head: string) => `${head} {\n\t$0\n}`;

export const TEMPLATES: PostfixTemplate[] = [
  { key: 'if', description: 'if (expr) {}', body: block('if ($EXPR)'), only: 'value' },
  { key: 'not', description: '!expr', body: '!$EXPR', only: 'value' },
  { key: 'notnull', description: 'if (expr !== null) {}', body: block('if ($EXPR !== null)'), only: 'value' },
  { key: 'nn', description: 'if (expr !== null) {}', body: block('if ($EXPR !== null)'), only: 'value' },
  { key: 'null', description: 'if (expr === null) {}', body: block('if ($EXPR === null)'), only: 'value' },
  { key: 'isset', description: 'if (isset(expr)) {}', body: block('if (isset($EXPR))'), only: 'value' },
  { key: 'empty', description: 'if (empty(expr)) {}', body: block('if (empty($EXPR))'), only: 'value' },
  { key: 'notempty', description: 'if (!empty(expr)) {}', body: block('if (!empty($EXPR))'), only: 'value' },
  { key: 'inst', description: 'if (expr instanceof Class) {}', body: 'if ($EXPR instanceof ${1:Class}) {\n\t$0\n}', only: 'value' },
  { key: 'foreach', description: 'foreach (expr as $item) {}', body: 'foreach ($EXPR as \\$${1:item}) {\n\t$0\n}', only: 'value' },
  { key: 'fore', description: 'foreach (expr as $item) {}', body: 'foreach ($EXPR as \\$${1:item}) {\n\t$0\n}', only: 'value' },
  { key: 'forek', description: 'foreach (expr as $key => $value) {}', body: 'foreach ($EXPR as \\$${1:key} => \\$${2:value}) {\n\t$0\n}', only: 'value' },
  { key: 'return', description: 'return expr;', body: 'return $EXPR;', only: 'value' },
  { key: 'echo', description: 'echo expr;', body: 'echo $EXPR;', only: 'value' },
  { key: 'var', description: '$name = expr;', body: '\\$${1:name} = $EXPR;', only: 'value' },
  { key: 'par', description: '(expr)', body: '($EXPR)', only: 'value' },
  { key: 'throw', description: 'throw expr;', body: 'throw $EXPR;', only: 'value' },
  { key: 'unset', description: 'unset(expr);', body: 'unset($EXPR);', only: 'value' },
  { key: 'count', description: 'count(expr)', body: 'count($EXPR)', only: 'value' },
  { key: 'vd', description: 'var_dump(expr);', body: 'var_dump($EXPR);', only: 'value' },
  { key: 'dd', description: 'dd(expr);', body: 'dd($EXPR);', only: 'value' },
  { key: 'new', description: 'new Class()', body: 'new $EXPR($0)', only: 'className' },
];

export interface PostfixMatch {
  /** Column where the expression starts; the completion replaces [start, cursor). */
  start: number;
  expr: string;
  /** What was typed after the dot (filters the templates). */
  typed: string;
  className: boolean;
}

const OPEN: Record<string, string> = { ')': '(', ']': '[' };

/** Index of the bracket opening the one closing at `close`, skipping nested pairs; -1 if unbalanced. */
function matchOpen(text: string, close: number): number {
  const stack: string[] = [];
  for (let i = close; i >= 0; i--) {
    const c = text[i];
    if (c === ')' || c === ']') stack.push(OPEN[c]);
    else if (c === '(' || c === '[') {
      if (stack.pop() !== c) return -1;
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

/** Start of the PHP expression ending right before `end`: `$a->b()['c']`, `Foo::bar()`, `\App\Foo`, `strlen($x)`. */
function expressionStart(text: string, end: number): number | undefined {
  let i = end;
  for (;;) {
    const c = text[i - 1];
    if (c === ')' || c === ']') {
      const open = matchOpen(text, i - 1);
      if (open < 0) return undefined;
      i = open;
      continue;
    }
    let j = i;
    while (j > 0 && /[\w\\]/.test(text[j - 1])) j--;
    if (j > 0 && text[j - 1] === '$') j--;
    if (j === i) return i === end ? undefined : i;
    i = j;
    const before = text.slice(0, i);
    if (before.endsWith('?->')) i -= 3;
    else if (before.endsWith('->') || before.endsWith('::')) i -= 2;
    else return i;
  }
}

/** Unclosed quote or a line comment before `index`: postfix is not offered inside strings or comments. */
function inStringOrComment(text: string, index: number): boolean {
  let quote: string | undefined;
  for (let i = 0; i < index; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = undefined;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '#' || (c === '/' && (text[i + 1] === '/' || text[i + 1] === '*'))) return true;
  }
  return !!quote;
}

/** Finds `expr.typed` ending at the cursor (`lineBefore` = line text up to the cursor). */
export function findPostfix(lineBefore: string): PostfixMatch | undefined {
  const m = /\.([A-Za-z_]*)$/.exec(lineBefore);
  if (!m) return undefined;
  const dot = m.index;
  const start = expressionStart(lineBefore, dot);
  if (start === undefined) return undefined;
  const expr = lineBefore.slice(start, dot);
  if (!/[\w$]/.test(expr) || /^\d/.test(expr) || inStringOrComment(lineBefore, start)) return undefined;
  return { start, expr, typed: m[1], className: /^\\?[A-Za-z_][\w\\]*$/.test(expr) && !expr.includes('$') };
}

/** Escapes text for a snippet body ($, } and \ are special). */
export const escapeSnippet = (s: string): string => s.replace(/[\\$}]/g, (c) => `\\${c}`);

/** A bare name (`Foo`, `\App\Foo`) only gets `.new`; any other expression gets the value templates. */
export const templatesFor = (match: PostfixMatch): PostfixTemplate[] =>
  TEMPLATES.filter((t) => (t.only === 'className') === match.className);

export const expand = (t: PostfixTemplate, expr: string): string => t.body.split('$EXPR').join(escapeSnippet(expr));
