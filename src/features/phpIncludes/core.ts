// Pure parsing and evaluation of PHP include / require path expressions, e.g. `RTCL_PRO_PATH . 'vendor/autoload.php'`.
import * as path from 'path';

export type Node =
  | { k: 'str'; v: string }
  | { k: 'num'; v: number }
  | { k: 'magic'; v: '__DIR__' | '__FILE__' }
  | { k: 'const'; name: string }
  | { k: 'call'; name: string; args: Node[] }
  | { k: 'concat'; parts: Node[] };

interface Token {
  t: 'str' | 'num' | 'ident' | 'punct' | 'other';
  v: string;
  start: number;
  end: number;
}

/** Tokens of `src` from `from`, stopping after the first `;` (enough for one statement or define call). */
function tokenize(src: string, from: number): Token[] {
  const tokens: Token[] = [];
  let i = from;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const start = i;
    if (c === "'" || c === '"') {
      let v = '';
      let dynamic = false;
      i++;
      while (i < src.length && src[i] !== c) {
        if (src[i] === '\\' && i + 1 < src.length) {
          const next = src[i + 1];
          // Single quotes only unescape \' and \\; double quotes also unescape the usual sequences, kept literal here.
          if (next === c || next === '\\') {
            v += next;
            i += 2;
            continue;
          }
        }
        if (c === '"' && (src[i] === '$' || src[i] === '{')) dynamic = true;
        v += src[i++];
      }
      if (i >= src.length) return tokens; // unterminated
      i++;
      tokens.push({ t: dynamic ? 'other' : 'str', v, start, end: i });
      continue;
    }
    const ident = /^\\?[A-Za-z_][\w\\]*/.exec(src.slice(i, i + 200));
    if (ident) {
      i += ident[0].length;
      tokens.push({ t: 'ident', v: ident[0].replace(/^\\/, ''), start, end: i });
      continue;
    }
    const num = /^\d+/.exec(src.slice(i, i + 20));
    if (num) {
      i += num[0].length;
      tokens.push({ t: 'num', v: num[0], start, end: i });
      continue;
    }
    i++;
    tokens.push({ t: '(),.;'.includes(c) ? 'punct' : 'other', v: c, start, end: i });
    if (c === ';') break;
  }
  return tokens;
}

/** Recursive descent over `expr := term ('.' term)*`. Returns the node and the index of the next token. */
function parseExpr(tokens: Token[], at: number): [Node, number] | undefined {
  const first = parseTerm(tokens, at);
  if (!first) return undefined;
  const parts = [first[0]];
  let i = first[1];
  while (tokens[i]?.v === '.' && tokens[i].t === 'punct') {
    const next = parseTerm(tokens, i + 1);
    if (!next) return undefined;
    parts.push(next[0]);
    i = next[1];
  }
  return [parts.length === 1 ? parts[0] : { k: 'concat', parts }, i];
}

function parseTerm(tokens: Token[], at: number): [Node, number] | undefined {
  const tok = tokens[at];
  if (!tok) return undefined;
  if (tok.t === 'str') return [{ k: 'str', v: tok.v }, at + 1];
  if (tok.t === 'num') return [{ k: 'num', v: Number(tok.v) }, at + 1];
  if (tok.t === 'punct' && tok.v === '(') {
    const inner = parseExpr(tokens, at + 1);
    if (!inner || tokens[inner[1]]?.v !== ')') return undefined;
    return [inner[0], inner[1] + 1];
  }
  if (tok.t !== 'ident') return undefined;
  if (tok.v === '__DIR__' || tok.v === '__FILE__') return [{ k: 'magic', v: tok.v }, at + 1];
  if (tokens[at + 1]?.v !== '(') return [{ k: 'const', name: tok.v }, at + 1];
  const args: Node[] = [];
  let i = at + 2;
  if (tokens[i]?.v === ')') return [{ k: 'call', name: tok.v.toLowerCase(), args }, i + 1];
  for (;;) {
    const arg = parseExpr(tokens, i);
    if (!arg) return undefined;
    args.push(arg[0]);
    i = arg[1];
    if (tokens[i]?.v === ',') i++;
    else if (tokens[i]?.v === ')') return [{ k: 'call', name: tok.v.toLowerCase(), args }, i + 1];
    else return undefined;
  }
}

export interface IncludeAt {
  node: Node;
  /** Character range of the path expression on the line. */
  start: number;
  end: number;
}

const INCLUDE = /\b(?:require_once|include_once|require|include)\b/g;

/** The include / require path expression on `line` whose statement contains `character`, if any. */
export function findIncludeAt(line: string, character: number): IncludeAt | undefined {
  const trimmed = line.trimStart();
  if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return undefined;
  for (const m of line.matchAll(INCLUDE)) {
    const keywordStart = m.index ?? 0;
    const tokens = tokenize(line, keywordStart + m[0].length);
    const parsed = parseExpr(tokens, 0);
    if (!parsed) continue;
    const start = tokens[0].start;
    const end = tokens[parsed[1] - 1].end;
    if (character >= keywordStart && character <= end) return { node: parsed[0], start, end };
  }
  return undefined;
}

export interface Define {
  name: string;
  node: Node;
}

/** `define('NAME', <expr>)` and `const NAME = <expr>;` declarations in a PHP source. */
export function findDefines(src: string): Define[] {
  const defines: Define[] = [];
  for (const m of src.matchAll(/\bdefine\s*\(\s*(['"])(\w+)\1\s*,/g)) {
    const parsed = parseExpr(tokenize(src, (m.index ?? 0) + m[0].length), 0);
    if (parsed) defines.push({ name: m[2], node: parsed[0] });
  }
  for (const m of src.matchAll(/^\s*const\s+(\w+)\s*=/gm)) {
    const parsed = parseExpr(tokenize(src, (m.index ?? 0) + m[0].length), 0);
    if (parsed) defines.push({ name: m[1], node: parsed[0] });
  }
  return defines;
}

/** Constant names a node refers to. */
export function constantsOf(node: Node): string[] {
  if (node.k === 'const') return [node.name];
  if (node.k === 'concat') return node.parts.flatMap(constantsOf);
  if (node.k === 'call') return node.args.flatMap(constantsOf);
  return [];
}

const posix = (p: string) => p.replace(/\\/g, '/');
const dirOf = (p: string) => posix(path.dirname(p));

/**
 * The string a path expression evaluates to in `file`, or undefined when it depends on something unknown.
 * `constants` holds the already-resolved constants. Only path-building functions WordPress plugins use are known.
 */
export function evaluate(node: Node, file: string, constants: ReadonlyMap<string, string>): string | undefined {
  switch (node.k) {
    case 'str':
      return node.v;
    case 'num':
      return String(node.v);
    case 'magic':
      return node.v === '__FILE__' ? posix(file) : dirOf(file);
    case 'const':
      return constants.get(node.name);
    case 'concat': {
      let out = '';
      for (const part of node.parts) {
        const v = evaluate(part, file, constants);
        if (v === undefined) return undefined;
        out += v;
      }
      return out;
    }
    case 'call': {
      const args = node.args.map((a) => evaluate(a, file, constants));
      if (args.some((a) => a === undefined)) return undefined;
      const [p, levels] = args as string[];
      switch (node.name) {
        case 'dirname': {
          let dir = p;
          for (let n = Number(levels ?? 1); n > 0; n--) dir = dirOf(dir);
          return dir;
        }
        case 'plugin_dir_path':
          return dirOf(p) + '/';
        case 'trailingslashit':
          return p.replace(/[/\\]+$/, '') + '/';
        case 'untrailingslashit':
          return p.replace(/[/\\]+$/, '');
        case 'realpath':
          return p;
        default:
          return undefined;
      }
    }
  }
}

/**
 * Where an evaluated include path may point. Absolute paths are taken as is; `./` and `../` are relative to the file;
 * bare relative paths are tried against the file's folder, then the workspace roots and include paths (PHP's
 * include_path), like PhpStorm.
 */
export function candidatePaths(value: string, fileDir: string, searchDirs: readonly string[]): string[] {
  if (!value) return [];
  if (path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value)) return [path.normalize(value)];
  if (/^\.\.?[\\/]/.test(value)) return [path.resolve(fileDir, value)];
  return [...new Set([fileDir, ...searchDirs].map((d) => path.resolve(d, value)))];
}
