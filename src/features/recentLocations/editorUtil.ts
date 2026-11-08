// Small editor helpers (duplicated from bookmarks on purpose: features share nothing).
import * as vscode from 'vscode';
import { LineChange } from './lineShift';

export const toLineChange = (c: vscode.TextDocumentContentChangeEvent): LineChange => ({
  startLine: c.range.start.line,
  startCharacter: c.range.start.character,
  endLine: c.range.end.line,
  text: c.text,
});

/** Lines of a file, from the open document if any, else from disk (without opening a TextDocument). */
export async function readLines(uri: vscode.Uri): Promise<string[]> {
  const key = uri.toString();
  const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === key);
  if (open) return open.getText().split(/\r?\n/);
  try {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)).split(/\r?\n/);
  } catch {
    return [];
  }
}

export interface EditorSnapshot {
  uri: vscode.Uri;
  viewColumn: vscode.ViewColumn | undefined;
  selections: readonly vscode.Selection[];
  visible: vscode.Range | undefined;
}

export function snapshotEditor(): EditorSnapshot | undefined {
  const e = vscode.window.activeTextEditor;
  return e && { uri: e.document.uri, viewColumn: e.viewColumn, selections: e.selections, visible: e.visibleRanges[0] };
}

export async function restoreEditor(s: EditorSnapshot): Promise<void> {
  const editor = await vscode.window.showTextDocument(s.uri, { viewColumn: s.viewColumn, preserveFocus: false });
  editor.selections = [...s.selections];
  if (s.visible) editor.revealRange(s.visible, vscode.TextEditorRevealType.AtTop);
}

export async function showLine(
  uri: vscode.Uri,
  line: number,
  character: number,
  options: { preview: boolean; preserveFocus: boolean; viewColumn?: vscode.ViewColumn },
): Promise<vscode.TextEditor> {
  const doc = await vscode.workspace.openTextDocument(uri);
  const l = Math.min(line, doc.lineCount - 1);
  const pos = new vscode.Position(l, Math.min(character, doc.lineAt(l).text.length));
  const editor = await vscode.window.showTextDocument(doc, { ...options, selection: new vscode.Range(pos, pos) });
  editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  return editor;
}

export function relativePath(uri: vscode.Uri): string {
  return uri.scheme === 'file' || uri.scheme === 'vscode-remote' ? vscode.workspace.asRelativePath(uri, true) : uri.toString();
}

export const baseName = (uri: vscode.Uri): string => uri.path.slice(uri.path.lastIndexOf('/') + 1);
