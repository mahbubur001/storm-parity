import * as vscode from 'vscode';
import { ClipRing, distribute, presentItem, textForCopy } from './ring';

const STATE_KEY = 'stormParity.clipboardHistory.items';
const CONFIG = 'stormParity.clipboardHistory';

interface HistoryPick extends vscode.QuickPickItem {
  index: number;
}

function config(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration(CONFIG);
}

export function activate(ctx: vscode.ExtensionContext): void {
  const persist = (): boolean => config().get<boolean>('persist', true);
  const ring = new ClipRing(config().get<number>('maxItems', 30), persist() ? ctx.globalState.get<string[]>(STATE_KEY, []) : []);
  // Last clipboard content we know about, so focus checks don't re-record our own copies.
  let lastSeen: string | undefined;

  const save = (): Thenable<void> => ctx.globalState.update(STATE_KEY, persist() ? ring.toArray() : undefined);
  const record = (text: string): void => {
    lastSeen = text;
    if (ring.push(text)) void save();
  };

  const captureExternal = async (): Promise<void> => {
    const text = await vscode.env.clipboard.readText();
    if (text === lastSeen) return;
    record(text);
  };

  const copyOrCut = async (action: 'copy' | 'cut'): Promise<void> => {
    const editor = vscode.window.activeTextEditor;
    const fallback = editor ? selectedText(editor) : '';
    await vscode.commands.executeCommand(action === 'copy' ? 'editor.action.clipboardCopyAction' : 'editor.action.clipboardCutAction');
    // The clipboard is the source of truth (handles emptySelectionClipboard, multi-cursor, etc.).
    const text = (await vscode.env.clipboard.readText()) || fallback;
    record(text);
  };

  const pasteFromHistory = async (): Promise<void> => {
    await captureExternal();
    const editor = vscode.window.activeTextEditor;
    if (ring.size === 0) {
      void vscode.window.showInformationMessage('Storm: clipboard history is empty.');
      return;
    }
    const deleteButton: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('trash'), tooltip: 'Remove from history' };
    const clearButton: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('clear-all'), tooltip: 'Clear history' };
    const qp = vscode.window.createQuickPick<HistoryPick>();
    qp.title = 'Paste from History';
    qp.placeholder = editor ? 'Select an entry to paste' : 'Select an entry to copy to the clipboard';
    qp.matchOnDescription = false;
    qp.matchOnDetail = true;
    qp.buttons = [clearButton];
    const render = (): void => {
      qp.items = ring.toArray().map((text, index) => ({ ...presentItem(text), index, buttons: [deleteButton] }));
    };
    render();

    const picked = await new Promise<HistoryPick | undefined>((resolve) => {
      const disposables: vscode.Disposable[] = [];
      disposables.push(
        qp.onDidTriggerItemButton((e) => {
          ring.remove(e.item.index);
          void save();
          if (ring.size === 0) qp.hide();
          else render();
        }),
        qp.onDidTriggerButton(() => {
          ring.clear();
          void save();
          qp.hide();
        }),
        qp.onDidAccept(() => {
          resolve(qp.selectedItems[0]);
          qp.hide();
        }),
        qp.onDidHide(() => {
          resolve(undefined);
          disposables.forEach((d) => d.dispose());
          qp.dispose();
        }),
      );
      qp.show();
    });
    if (!picked) return;

    const text = ring.toArray()[picked.index];
    ring.promote(picked.index);
    void save();
    lastSeen = text;
    await vscode.env.clipboard.writeText(text);
    if (!editor) return;
    const spread = vscode.workspace.getConfiguration('editor', editor.document).get<string>('multiCursorPaste', 'spread') === 'spread';
    const texts = distribute(text, editor.selections.length, spread);
    const selections = editor.selections;
    await editor.edit((b) => selections.forEach((sel, i) => b.replace(sel, texts[i])));
    editor.revealRange(editor.selection);
  };

  ctx.subscriptions.push(
    vscode.commands.registerCommand('stormParity.clipboardHistory.copy', () => copyOrCut('copy')),
    vscode.commands.registerCommand('stormParity.clipboardHistory.cut', () => copyOrCut('cut')),
    vscode.commands.registerCommand('stormParity.clipboardHistory.pasteFromHistory', pasteFromHistory),
    vscode.commands.registerCommand('stormParity.clipboardHistory.clear', async () => {
      ring.clear();
      await save();
      void vscode.window.showInformationMessage('Storm: clipboard history cleared.');
    }),
    vscode.window.onDidChangeWindowState((s) => {
      if (s.focused) void captureExternal();
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(`${CONFIG}.maxItems`)) {
        ring.setMax(config().get<number>('maxItems', 30));
        void save();
      }
      if (e.affectsConfiguration(`${CONFIG}.persist`)) void save();
    }),
  );

  void captureExternal();
}

function selectedText(editor: vscode.TextEditor): string {
  const doc = editor.document;
  const eol = doc.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
  const emptySelectionClipboard = vscode.workspace.getConfiguration('editor', doc).get<boolean>('emptySelectionClipboard', true);
  return textForCopy(
    editor.selections.map((s) => ({ isEmpty: s.isEmpty, text: doc.getText(s), lineText: doc.lineAt(s.active.line).text })),
    eol,
    emptySelectionClipboard,
  );
}
