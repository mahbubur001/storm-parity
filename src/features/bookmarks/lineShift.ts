// Pure line-tracking logic: given a text edit, compute where a line moves to.

export interface LineChange {
  startLine: number;
  startCharacter: number;
  endLine: number;
  text: string;
}

function countNewlines(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

/**
 * Returns the new index of `line` after `change` is applied.
 * Lines inside a removed range collapse onto the change start line.
 */
export function shiftLine(line: number, change: LineChange): number {
  const inserted = countNewlines(change.text);
  const removed = change.endLine - change.startLine;
  if (line < change.startLine) return line;
  if (line > change.endLine) return line + inserted - removed;
  if (line === change.startLine) {
    // Text inserted at column 0 pushes the original line content down.
    if (removed === 0 && change.startCharacter === 0) return line + inserted;
    return line;
  }
  // The tail of the last touched line ends up after the inserted text.
  if (line === change.endLine) return change.startLine + inserted;
  return change.startLine;
}

/** Applies changes in order (VS Code reports multi-cursor changes so sequential application is valid). */
export function shiftLineAll(line: number, changes: readonly LineChange[]): number {
  return changes.reduce((l, c) => shiftLine(l, c), line);
}
