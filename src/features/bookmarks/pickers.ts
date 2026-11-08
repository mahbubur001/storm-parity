import * as vscode from 'vscode';
import { Bookmark, BookmarkStore, MNEMONICS, normalizeMnemonic } from './model';
import { baseName, readLines, relativePath, restoreEditor, showLine, snapshotEditor } from './editorUtil';

interface BookmarkItem extends vscode.QuickPickItem {
  bookmark: Bookmark;
}

const DELETE_BUTTON: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('trash'), tooltip: 'Delete Bookmark' };

async function toItems(store: BookmarkStore): Promise<BookmarkItem[]> {
  const cache = new Map<string, string[]>();
  const items: BookmarkItem[] = [];
  for (const bookmark of store.all()) {
    const uri = vscode.Uri.parse(bookmark.uri);
    if (!cache.has(bookmark.uri)) cache.set(bookmark.uri, await readLines(uri));
    items.push({
      bookmark,
      label: `$(bookmark) ${bookmark.mnemonic ? `[${bookmark.mnemonic}] ` : ''}${baseName(uri)}:${bookmark.line + 1}`,
      description: [bookmark.description, relativePath(uri)].filter(Boolean).join('  '),
      detail: cache.get(bookmark.uri)?.[bookmark.line]?.trim() ?? '',
      buttons: [DELETE_BUTTON],
    });
  }
  return items;
}

/** Cmd+F3: all bookmarks with live preview; restores the original editor on cancel. */
export async function showAllBookmarks(store: BookmarkStore, onDelete: (b: Bookmark) => void): Promise<void> {
  const original = snapshotEditor();
  const qp = vscode.window.createQuickPick<BookmarkItem>();
  qp.title = 'Bookmarks';
  qp.placeholder = store.size ? 'Filter bookmarks by file, mnemonic, description or code' : 'No bookmarks yet (F3 to add one)';
  qp.matchOnDescription = true;
  qp.matchOnDetail = true;
  qp.items = await toItems(store);

  let accepted = false;
  let previewed = false;
  const disposables: vscode.Disposable[] = [
    qp.onDidChangeActive(([item]) => {
      if (!item) return;
      previewed = true;
      void showLine(vscode.Uri.parse(item.bookmark.uri), item.bookmark.line, {
        preview: true,
        preserveFocus: true,
        viewColumn: original?.viewColumn,
      }).then(undefined, () => undefined);
    }),
    qp.onDidTriggerItemButton(async ({ item }) => {
      onDelete(item.bookmark);
      qp.keepScrollPosition = true;
      qp.items = await toItems(store);
    }),
    qp.onDidAccept(() => {
      const [item] = qp.selectedItems;
      if (!item) return;
      accepted = true;
      qp.hide();
      void showLine(vscode.Uri.parse(item.bookmark.uri), item.bookmark.line, {
        preview: false,
        preserveFocus: false,
        viewColumn: original?.viewColumn,
      });
    }),
    qp.onDidHide(() => {
      disposables.forEach((d) => d.dispose());
      qp.dispose();
      if (!accepted && previewed && original) void restoreEditor(original);
    }),
  ];
  qp.show();
}

type MnemonicChoice = { kind: 'mnemonic'; char: string } | { kind: 'anonymous' } | { kind: 'remove' };
interface MnemonicItem extends vscode.QuickPickItem {
  choice?: MnemonicChoice;
}

/** Opt+F3 picker: typing a single 0-9 / A-Z char picks it immediately. */
export function pickMnemonic(store: BookmarkStore, current: Bookmark | undefined): Promise<MnemonicChoice | undefined> {
  const taken = store.takenMnemonics();
  const items: MnemonicItem[] = [];
  if (current) {
    items.push({ label: '$(trash) Remove bookmark', choice: { kind: 'remove' } });
    if (current.mnemonic) items.push({ label: '$(bookmark) Make anonymous', choice: { kind: 'anonymous' } });
  } else {
    items.push({ label: '$(bookmark) Anonymous bookmark', choice: { kind: 'anonymous' } });
  }
  items.push({ label: 'Mnemonics', kind: vscode.QuickPickItemKind.Separator });
  for (const char of MNEMONICS) {
    const holder = taken.get(char);
    const isCurrent = holder && current && holder.uri === current.uri && holder.line === current.line;
    const where = holder && `${baseName(vscode.Uri.parse(holder.uri))}:${holder.line + 1}`;
    items.push({
      label: char,
      description: isCurrent ? 'current (pick again to remove)' : where ? `in use at ${where} (will move here)` : undefined,
      choice: { kind: 'mnemonic', char },
    });
  }

  return new Promise((resolve) => {
    const qp = vscode.window.createQuickPick<MnemonicItem>();
    qp.title = current ? 'Edit Bookmark Mnemonic' : 'Add Bookmark with Mnemonic';
    qp.placeholder = 'Type 0-9 or A-Z to assign a mnemonic';
    qp.items = items;
    let result: MnemonicChoice | undefined;
    const finish = (choice: MnemonicChoice | undefined) => {
      result = choice;
      qp.hide();
    };
    qp.onDidChangeValue((value) => {
      const char = normalizeMnemonic(value);
      if (char && value.trim().length === 1) finish({ kind: 'mnemonic', char });
    });
    qp.onDidAccept(() => finish(qp.selectedItems[0]?.choice));
    qp.onDidHide(() => {
      qp.dispose();
      resolve(result);
    });
    qp.show();
  });
}

/** Command-palette fallback for jump-to-mnemonic without args. */
export async function pickTakenMnemonic(store: BookmarkStore): Promise<string | undefined> {
  const taken = [...store.takenMnemonics().entries()].sort(([a], [b]) => MNEMONICS.indexOf(a) - MNEMONICS.indexOf(b));
  if (taken.length === 0) {
    void vscode.window.showInformationMessage('No mnemonic bookmarks.');
    return undefined;
  }
  const pick = await vscode.window.showQuickPick(
    taken.map(([char, b]) => ({
      label: char,
      description: `${baseName(vscode.Uri.parse(b.uri))}:${b.line + 1}${b.description ? `  ${b.description}` : ''}`,
    })),
    { title: 'Go to Mnemonic Bookmark', placeHolder: 'Pick a mnemonic' },
  );
  return pick?.label;
}
