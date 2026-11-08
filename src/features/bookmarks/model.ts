// Pure bookmark state (no vscode import) so it can be unit tested.
import { LineChange, shiftLineAll } from './lineShift';

export const MNEMONICS: readonly string[] = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export interface Bookmark {
  uri: string;
  line: number;
  mnemonic?: string;
  description?: string;
}

/** Normalizes user input to a mnemonic char (0-9, A-Z) or undefined if invalid. */
export function normalizeMnemonic(input: string | undefined): string | undefined {
  const c = (input ?? '').trim().toUpperCase();
  return c.length === 1 && MNEMONICS.includes(c) ? c : undefined;
}

const isUnder = (uri: string, prefix: string): boolean => uri === prefix || uri.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`);

const byLocation = (a: Bookmark, b: Bookmark): number => a.uri.localeCompare(b.uri) || a.line - b.line;

export class BookmarkStore {
  private items: Bookmark[] = [];

  constructor(initial: readonly unknown[] = []) {
    for (const raw of initial) {
      if (!raw || typeof raw !== 'object') continue;
      const { uri, line, mnemonic, description } = raw as Partial<Bookmark>;
      if (typeof uri !== 'string' || typeof line !== 'number' || line < 0) continue;
      if (this.at(uri, line)) continue;
      const m = normalizeMnemonic(mnemonic);
      this.items.push({
        uri,
        line,
        ...(m && !this.byMnemonic(m) ? { mnemonic: m } : {}),
        ...(typeof description === 'string' && description ? { description } : {}),
      });
    }
  }

  all(): Bookmark[] {
    return [...this.items].sort(byLocation);
  }

  get size(): number {
    return this.items.length;
  }

  at(uri: string, line: number): Bookmark | undefined {
    return this.items.find((b) => b.uri === uri && b.line === line);
  }

  forUri(uri: string): Bookmark[] {
    return this.items.filter((b) => b.uri === uri).sort((a, b) => a.line - b.line);
  }

  uris(): string[] {
    return [...new Set(this.items.map((b) => b.uri))].sort();
  }

  byMnemonic(mnemonic: string): Bookmark | undefined {
    const m = normalizeMnemonic(mnemonic);
    return m ? this.items.find((b) => b.mnemonic === m) : undefined;
  }

  /** Map of mnemonic char to the bookmark that holds it. */
  takenMnemonics(): Map<string, Bookmark> {
    return new Map(this.items.filter((b) => b.mnemonic).map((b) => [b.mnemonic as string, b]));
  }

  /** Adds an anonymous bookmark or removes the existing one. Returns true when a bookmark now exists. */
  toggle(uri: string, line: number): boolean {
    const existing = this.at(uri, line);
    if (existing) {
      this.remove(existing);
      return false;
    }
    this.items.push({ uri, line });
    return true;
  }

  /**
   * Ensures a bookmark exists on the line and gives it `mnemonic` (or strips it when undefined).
   * A mnemonic is unique: if another bookmark holds it, that bookmark is removed (the mnemonic moves).
   */
  assignMnemonic(uri: string, line: number, mnemonic: string | undefined): Bookmark {
    const m = normalizeMnemonic(mnemonic);
    let target = this.at(uri, line);
    if (m) {
      const holder = this.byMnemonic(m);
      if (holder && holder !== target) this.remove(holder);
    }
    if (!target) {
      target = { uri, line };
      this.items.push(target);
    }
    if (m) target.mnemonic = m;
    else delete target.mnemonic;
    return target;
  }

  /** Toggles a mnemonic bookmark: removes the line's bookmark if it already has that mnemonic. Returns true when set. */
  toggleMnemonic(uri: string, line: number, mnemonic: string): boolean {
    const m = normalizeMnemonic(mnemonic);
    if (!m) return false;
    const existing = this.at(uri, line);
    if (existing?.mnemonic === m) {
      this.remove(existing);
      return false;
    }
    this.assignMnemonic(uri, line, m);
    return true;
  }

  setDescription(uri: string, line: number, description: string): Bookmark {
    const target = this.at(uri, line) ?? this.assignMnemonic(uri, line, undefined);
    const d = description.trim();
    if (d) target.description = d;
    else delete target.description;
    return target;
  }

  remove(bookmark: Bookmark): boolean {
    const i = this.items.findIndex((b) => b.uri === bookmark.uri && b.line === bookmark.line);
    if (i < 0) return false;
    this.items.splice(i, 1);
    return true;
  }

  clear(): boolean {
    const had = this.items.length > 0;
    this.items = [];
    return had;
  }

  /** Next/previous bookmark line in a file relative to `line`, wrapping around. */
  neighbour(uri: string, line: number, direction: 1 | -1): Bookmark | undefined {
    const list = this.forUri(uri);
    if (list.length === 0) return undefined;
    if (direction === 1) return list.find((b) => b.line > line) ?? list[0];
    return [...list].reverse().find((b) => b.line < line) ?? list[list.length - 1];
  }

  /** Shifts the bookmarks of `uri` for a text edit. Returns true if any line moved. */
  applyEdits(uri: string, changes: readonly LineChange[]): boolean {
    const inFile = this.items.filter((b) => b.uri === uri);
    if (inFile.length === 0 || changes.length === 0) return false;
    let moved = false;
    for (const b of inFile) {
      const next = shiftLineAll(b.line, changes);
      if (next !== b.line) {
        b.line = next;
        moved = true;
      }
    }
    if (moved) this.dedupe(uri);
    return moved;
  }

  /** Re-keys bookmarks for a renamed file or folder. */
  rename(oldUri: string, newUri: string): boolean {
    let changed = false;
    for (const b of this.items) {
      if (!isUnder(b.uri, oldUri)) continue;
      b.uri = newUri + b.uri.slice(oldUri.length);
      changed = true;
    }
    if (changed) for (const u of this.uris()) this.dedupe(u);
    return changed;
  }

  /** Drops bookmarks of a deleted file or folder. */
  deleteUri(uri: string): boolean {
    const before = this.items.length;
    this.items = this.items.filter((b) => !isUnder(b.uri, uri));
    return this.items.length !== before;
  }

  toJSON(): Bookmark[] {
    return this.all().map((b) => ({ ...b }));
  }

  /** When edits collapse several bookmarks onto one line, keep one (preferring a mnemonic) and merge descriptions. */
  private dedupe(uri: string): void {
    const seen = new Map<number, Bookmark>();
    const drop = new Set<Bookmark>();
    for (const b of this.items) {
      if (b.uri !== uri) continue;
      const kept = seen.get(b.line);
      if (!kept) {
        seen.set(b.line, b);
        continue;
      }
      const [winner, loser] = !kept.mnemonic && b.mnemonic ? [b, kept] : [kept, b];
      winner.description = [winner.description, loser.description].filter(Boolean).join('; ') || undefined;
      if (!winner.description) delete winner.description;
      seen.set(b.line, winner);
      drop.add(loser);
    }
    if (drop.size) this.items = this.items.filter((b) => !drop.has(b));
  }
}
