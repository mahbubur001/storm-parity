import * as vscode from 'vscode';
import { CaseStyle, convertCase, cycleCase, toggleUpperLower } from './caseConvert';

type Transform = (text: string) => string;

const targets: Record<string, CaseStyle> = {
  toCamelCase: 'camel',
  toSnakeCase: 'snake',
  toKebabCase: 'kebab',
  toPascalCase: 'pascal',
  toScreamingSnakeCase: 'screamingSnake',
};

/** Ranges to transform: each non-empty selection, or the word under each empty cursor. */
function targetRanges(editor: vscode.TextEditor): vscode.Range[] {
  const ranges: vscode.Range[] = [];
  for (const sel of editor.selections) {
    if (!sel.isEmpty) {
      ranges.push(sel);
      continue;
    }
    const word = editor.document.getWordRangeAtPosition(sel.active);
    if (word) ranges.push(word);
  }
  return ranges;
}

async function applyTransform(transform: Transform): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  const { document } = editor;
  const ranges = targetRanges(editor);
  if (ranges.length === 0) return;
  // Snapshot the selections so word-under-cursor carets stay put after the edit.
  const selections = editor.selections;
  await editor.edit((b) => {
    for (const r of ranges) {
      const text = document.getText(r);
      const next = transform(text);
      if (next !== text) b.replace(r, next);
    }
  });
  if (selections.every((s) => s.isEmpty)) editor.selections = selections;
}

export function activate(ctx: vscode.ExtensionContext): void {
  const reg = (id: string, transform: Transform): void => {
    ctx.subscriptions.push(vscode.commands.registerCommand(`stormParity.toggleCase.${id}`, () => applyTransform(transform)));
  };
  reg('toggleCase', toggleUpperLower);
  reg('cycleCase', cycleCase);
  for (const [id, style] of Object.entries(targets)) reg(id, (t) => convertCase(t, style));
}
