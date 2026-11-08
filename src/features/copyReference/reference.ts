// Pure helpers that turn a symbol tree + cursor position into a reference string.
import { SymbolKind } from 'vscode';

export interface Pos {
  line: number;
  character: number;
}

export interface SymbolNode {
  name: string;
  kind: SymbolKind;
  range: { start: Pos; end: Pos };
  children?: SymbolNode[];
}

const TYPE_KINDS = new Set([SymbolKind.Class, SymbolKind.Interface, SymbolKind.Enum, SymbolKind.Struct, SymbolKind.Module, SymbolKind.Namespace, SymbolKind.Object]);
const CALLABLE_KINDS = new Set([SymbolKind.Method, SymbolKind.Function, SymbolKind.Constructor]);
const MEMBER_KINDS = new Set([SymbolKind.Property, SymbolKind.Field, SymbolKind.Constant, SymbolKind.EnumMember, SymbolKind.Variable]);
const RELEVANT_KINDS = new Set([...TYPE_KINDS, ...CALLABLE_KINDS, ...MEMBER_KINDS]);

const before = (a: Pos, b: Pos): boolean => a.line < b.line || (a.line === b.line && a.character <= b.character);
const contains = (n: SymbolNode, p: Pos): boolean => before(n.range.start, p) && before(p, n.range.end);

/**
 * Chain of symbols enclosing `pos`, outermost first. Works for hierarchical trees and for flat
 * lists (SymbolInformation converted to nodes) because containment is decided by range.
 * Local variables inside callables are dropped: they are not addressable references.
 */
export function symbolChainAt(symbols: readonly SymbolNode[], pos: Pos): SymbolNode[] {
  const flat: SymbolNode[] = [];
  const walk = (nodes: readonly SymbolNode[]): void => {
    for (const n of nodes) {
      if (contains(n, pos)) flat.push(n);
      if (n.children?.length) walk(n.children);
    }
  };
  walk(symbols);
  const size = (n: SymbolNode): number => (n.range.end.line - n.range.start.line) * 1e6 + (n.range.end.character - n.range.start.character);
  flat.sort((a, b) => size(b) - size(a));

  const chain: SymbolNode[] = [];
  for (const n of flat) {
    if (!RELEVANT_KINDS.has(n.kind)) continue;
    const last = chain[chain.length - 1];
    if (last && (CALLABLE_KINDS.has(last.kind) || MEMBER_KINDS.has(last.kind))) break;
    chain.push(n);
  }
  return chain;
}

/** `bar(int $x): void` -> `bar`; Intelephense and others sometimes include signatures in names. */
export function bareName(name: string): string {
  return name.replace(/\s*[(:<].*$/s, '').trim();
}

/** Last `namespace X\Y;` (or `namespace X\Y {`) declared at or before `line`. */
export function phpNamespaceAt(text: string, line: number): string | undefined {
  const lines = text.split(/\r?\n/);
  let ns: string | undefined;
  const re = /^\s*namespace\s+([A-Za-z_\\][\w\\]*)\s*[;{]/;
  for (let i = 0; i <= Math.min(line, lines.length - 1); i++) {
    const m = re.exec(lines[i]);
    if (m) ns = m[1].replace(/^\\/, '');
  }
  return ns;
}

/**
 * PHP FQN such as `App\Http\Foo`, `App\Http\Foo::bar`, `App\Http\Foo::$prop`, `App\Http\Foo::CONST`
 * or `App\helper` for a namespaced function. Undefined when the cursor is not inside a symbol.
 */
export function phpReference(chain: readonly SymbolNode[], namespace: string | undefined): string | undefined {
  let ns = namespace;
  const parts = chain.filter((n) => {
    if (n.kind === SymbolKind.Namespace) {
      ns ??= bareName(n.name).replace(/^\\/, '');
      return false;
    }
    return true;
  });
  if (parts.length === 0) return undefined;
  const qualify = (name: string): string => {
    const clean = name.replace(/^\\/, '');
    return ns && !clean.includes('\\') ? `${ns}\\${clean}` : clean;
  };
  const [type, member] = parts;
  if (!TYPE_KINDS.has(type.kind)) {
    // Namespaced function or constant outside any class.
    return qualify(bareName(type.name));
  }
  const cls = qualify(bareName(type.name));
  if (!member) return cls;
  let m = bareName(member.name);
  if (member.kind === SymbolKind.Property || member.kind === SymbolKind.Field) m = `$${m.replace(/^\$/, '')}`;
  return `${cls}::${m}`;
}

/** Generic dotted symbol path, e.g. `Foo.bar` or `outer.inner`. */
export function dottedReference(chain: readonly SymbolNode[]): string | undefined {
  if (chain.length === 0) return undefined;
  return chain.map((n) => bareName(n.name)).join('.');
}

export interface ReferenceInput {
  languageId: string;
  text: string;
  symbols: readonly SymbolNode[];
  pos: Pos;
}

/** Best symbol reference for the cursor, or undefined if none applies. */
export function symbolReference(input: ReferenceInput): string | undefined {
  const chain = symbolChainAt(input.symbols, input.pos);
  if (input.languageId === 'php') return phpReference(chain, phpNamespaceAt(input.text, input.pos.line));
  return dottedReference(chain);
}

/** `relative/path.ext:42` (1-based line). */
export function pathLineReference(relativePath: string, line: number): string {
  return `${relativePath}:${line + 1}`;
}
