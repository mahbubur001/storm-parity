import * as path from 'path';
import * as vscode from 'vscode';

export const SCHEME = 'storm-parity-clipboard';
const MAX_ENTRIES = 20;

/** Read-only in-memory documents holding clipboard text and selection snapshots. */
class SnapshotProvider implements vscode.TextDocumentContentProvider {
  private readonly contents = new Map<string, string>();
  private counter = 0;

  /** Keeps the original file name at the end of the path so language detection still works. */
  add(kind: 'clipboard' | 'selection', fileName: string, text: string): vscode.Uri {
    const uri = vscode.Uri.from({ scheme: SCHEME, path: `/${kind}/${++this.counter}/${fileName}` });
    this.contents.set(uri.toString(), text);
    while (this.contents.size > MAX_ENTRIES) {
      const oldest = this.contents.keys().next().value;
      if (oldest === undefined) break;
      this.contents.delete(oldest);
    }
    return uri;
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contents.get(uri.toString()) ?? '';
  }
}

async function compareWithClipboard(provider: SnapshotProvider): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showInformationMessage('Compare with Clipboard: open an editor first.');
    return;
  }
  const { document, selection } = editor;
  const fileName = path.basename(document.uri.path) || 'untitled';
  const clipboard = await vscode.env.clipboard.readText();
  const left = provider.add('clipboard', fileName, clipboard);

  let right: vscode.Uri;
  let title: string;
  if (selection.isEmpty) {
    // Whole file: diff against the live document so it stays editable, like PhpStorm.
    right = document.uri;
    title = `Clipboard vs ${fileName}`;
  } else {
    right = provider.add('selection', fileName, document.getText(selection));
    title = `Clipboard vs ${fileName} (selection, lines ${selection.start.line + 1}-${selection.end.line + 1})`;
  }

  await vscode.commands.executeCommand('vscode.diff', left, right, title);
  // Virtual docs only get the language from the extension; align them with the source document.
  for (const doc of vscode.workspace.textDocuments) {
    if (doc.uri.scheme === SCHEME && (doc.uri.toString() === left.toString() || doc.uri.toString() === right.toString()) && doc.languageId !== document.languageId) {
      await vscode.languages.setTextDocumentLanguage(doc, document.languageId);
    }
  }
}

export function activate(ctx: vscode.ExtensionContext): void {
  const provider = new SnapshotProvider();
  ctx.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, provider),
    vscode.commands.registerCommand('stormParity.compareClipboard.compare', () => compareWithClipboard(provider)),
  );
}
