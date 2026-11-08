import * as vscode from 'vscode';
import { BookmarkStore, MNEMONICS } from './model';

const PLAIN = '';

/** Gutter icon + overview ruler mark per bookmark; one decoration type per mnemonic char. */
export class BookmarkDecorations implements vscode.Disposable {
  private readonly types = new Map<string, vscode.TextEditorDecorationType>();

  constructor(extensionUri: vscode.Uri, private readonly store: BookmarkStore) {
    for (const key of [PLAIN, ...MNEMONICS]) {
      this.types.set(
        key,
        vscode.window.createTextEditorDecorationType({
          gutterIconPath: vscode.Uri.joinPath(extensionUri, 'media', `bookmarks-${key || 'plain'}.svg`),
          gutterIconSize: 'contain',
          overviewRulerColor: new vscode.ThemeColor('stormParity.bookmarks.overviewRuler'),
          overviewRulerLane: vscode.OverviewRulerLane.Left,
          rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
        }),
      );
    }
  }

  refresh(editors: readonly vscode.TextEditor[] = vscode.window.visibleTextEditors): void {
    for (const editor of editors) {
      const groups = new Map<string, vscode.DecorationOptions[]>();
      for (const b of this.store.forUri(editor.document.uri.toString())) {
        if (b.line >= editor.document.lineCount) continue;
        const key = b.mnemonic ?? PLAIN;
        const hover = new vscode.MarkdownString(`**Bookmark${b.mnemonic ? ` ${b.mnemonic}` : ''}**${b.description ? `: ${b.description}` : ''}`);
        const range = new vscode.Range(b.line, 0, b.line, 0);
        groups.set(key, [...(groups.get(key) ?? []), { range, hoverMessage: hover }]);
      }
      for (const [key, type] of this.types) editor.setDecorations(type, groups.get(key) ?? []);
    }
  }

  dispose(): void {
    for (const t of this.types.values()) t.dispose();
    this.types.clear();
  }
}
