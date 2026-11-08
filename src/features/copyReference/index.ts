import * as path from 'path';
import * as vscode from 'vscode';
import { pathLineReference, SymbolNode, symbolReference } from './reference';

interface ReferenceForm {
  label: string;
  value: string;
}

function toNodes(symbols: ReadonlyArray<vscode.DocumentSymbol | vscode.SymbolInformation>): SymbolNode[] {
  return symbols.map((s) =>
    'location' in s
      ? { name: s.name, kind: s.kind, range: s.location.range }
      : { name: s.name, kind: s.kind, range: s.range, children: toNodes(s.children) },
  );
}

async function documentSymbols(uri: vscode.Uri): Promise<SymbolNode[]> {
  try {
    const result = await vscode.commands.executeCommand<Array<vscode.DocumentSymbol | vscode.SymbolInformation> | undefined>(
      'vscode.executeDocumentSymbolProvider',
      uri,
    );
    return result ? toNodes(result) : [];
  } catch {
    return [];
  }
}

/** All reference forms for the active cursor, best first. */
async function referenceForms(editor: vscode.TextEditor): Promise<ReferenceForm[]> {
  const { document } = editor;
  const pos = editor.selection.active;
  const relativePath = vscode.workspace.asRelativePath(document.uri, false);
  const forms: ReferenceForm[] = [];

  const symbol = symbolReference({
    languageId: document.languageId,
    text: document.getText(),
    symbols: await documentSymbols(document.uri),
    pos,
  });
  if (symbol) forms.push({ label: document.languageId === 'php' ? 'Fully qualified name' : 'Symbol path', value: symbol });

  forms.push({ label: 'Path and line', value: pathLineReference(relativePath, pos.line) });
  if (!document.isUntitled) {
    forms.push({ label: 'Relative path', value: relativePath });
    forms.push({ label: 'Absolute path', value: document.uri.scheme === 'file' ? document.uri.fsPath : document.uri.toString() });
  }
  forms.push({ label: 'File name', value: path.basename(document.uri.path) });
  return forms;
}

async function copy(value: string): Promise<void> {
  await vscode.env.clipboard.writeText(value);
  vscode.window.setStatusBarMessage(`$(copy) Copied: ${value}`, 3000);
}

async function copyReference(): Promise<string | undefined> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return undefined;
  const [best] = await referenceForms(editor);
  await copy(best.value);
  return best.value;
}

async function copyReferenceAs(): Promise<string | undefined> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return undefined;
  const forms = await referenceForms(editor);
  const pick = await vscode.window.showQuickPick(
    forms.map((f) => ({ label: f.value, description: f.label })),
    { title: 'Copy Reference As', placeHolder: 'Pick the form to copy', matchOnDescription: true },
  );
  if (!pick) return undefined;
  await copy(pick.label);
  return pick.label;
}

export function activate(ctx: vscode.ExtensionContext): void {
  ctx.subscriptions.push(
    vscode.commands.registerCommand('stormParity.copyReference.copyReference', copyReference),
    vscode.commands.registerCommand('stormParity.copyReference.copyReferenceAs', copyReferenceAs),
  );
}
