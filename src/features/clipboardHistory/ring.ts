/**
 * Most-recent-first ring of clipboard entries. Pure, no VS Code dependency.
 */
export class ClipRing {
  private items: string[] = [];

  constructor(
    private max: number,
    initial: readonly string[] = [],
  ) {
    for (let i = initial.length - 1; i >= 0; i--) this.push(initial[i]);
  }

  /** Adds `text` on top. Duplicates move to the top; blank strings are ignored. Returns true if the ring changed. */
  push(text: string): boolean {
    if (text.trim() === '') return false;
    if (this.items[0] === text) return false;
    const existing = this.items.indexOf(text);
    if (existing >= 0) this.items.splice(existing, 1);
    this.items.unshift(text);
    this.trim();
    return true;
  }

  /** Moves the item at `index` to the top. */
  promote(index: number): void {
    if (index <= 0 || index >= this.items.length) return;
    const [item] = this.items.splice(index, 1);
    this.items.unshift(item);
  }

  remove(index: number): void {
    if (index < 0 || index >= this.items.length) return;
    this.items.splice(index, 1);
  }

  clear(): void {
    this.items = [];
  }

  setMax(max: number): void {
    this.max = Math.max(1, Math.floor(max));
    this.trim();
  }

  get size(): number {
    return this.items.length;
  }

  get top(): string | undefined {
    return this.items[0];
  }

  toArray(): string[] {
    return [...this.items];
  }

  private trim(): void {
    if (this.items.length > this.max) this.items.length = Math.max(1, this.max);
  }
}

export interface ItemPresentation {
  label: string;
  description: string;
  detail: string;
}

const PREVIEW_CHARS = 200;

/** Quick pick presentation: first non-blank line as label, line/char counts as description, longer preview as detail. */
export function presentItem(text: string): ItemPresentation {
  const lines = text.split(/\r\n|\r|\n/);
  const first = (lines.find((l) => l.trim() !== '') ?? '').trim();
  const lineCount = text.endsWith('\n') ? lines.length - 1 : lines.length;
  const description = `${lineCount} ${lineCount === 1 ? 'line' : 'lines'}, ${text.length} ${text.length === 1 ? 'char' : 'chars'}`;
  const flat = text.replace(/\s+/g, ' ').trim();
  const detail = lineCount > 1 || flat.length > first.length ? truncate(flat, PREVIEW_CHARS) : '';
  return { label: truncate(first, 120), description, detail };
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export interface SelectionText {
  isEmpty: boolean;
  text: string;
  lineText: string;
}

/**
 * Mirrors what VS Code puts on the clipboard for a copy: non-empty selections joined with the EOL;
 * if every selection is empty and emptySelectionClipboard is on, the whole lines (each with EOL).
 */
export function textForCopy(selections: readonly SelectionText[], eol: string, emptySelectionClipboard: boolean): string {
  const nonEmpty = selections.filter((s) => !s.isEmpty);
  if (nonEmpty.length > 0) return nonEmpty.map((s) => s.text).join(eol);
  if (!emptySelectionClipboard) return '';
  return selections.map((s) => s.lineText + eol).join('');
}

/**
 * Text to insert at each cursor. With several cursors and `spread`, an item whose line count equals
 * the cursor count is distributed one line per cursor, like VS Code's editor.multiCursorPaste.
 */
export function distribute(text: string, cursorCount: number, spread: boolean): string[] {
  if (cursorCount > 1 && spread) {
    const lines = text.replace(/(\r\n|\r|\n)$/, '').split(/\r\n|\r|\n/);
    if (lines.length === cursorCount) return lines;
  }
  return new Array<string>(cursorCount).fill(text);
}
