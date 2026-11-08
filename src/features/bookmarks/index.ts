import * as vscode from 'vscode';
import { Bookmark, BookmarkStore, normalizeMnemonic } from './model';
import { BookmarkDecorations } from './decorations';
import { BookmarkNode, BookmarksTree, isBookmarkNode } from './tree';
import { pickMnemonic, pickTakenMnemonic, showAllBookmarks } from './pickers';
import { showLine, toLineChange } from './editorUtil';

const STATE_KEY = 'stormParity.bookmarks.items';

export function activate(ctx: vscode.ExtensionContext): void {
  const store = new BookmarkStore(ctx.workspaceState.get<unknown[]>(STATE_KEY, []));
  const decorations = new BookmarkDecorations(ctx.extensionUri, store);
  const tree = new BookmarksTree(store);
  const view = vscode.window.createTreeView('stormParity.bookmarks', { treeDataProvider: tree, showCollapseAll: true });

  const updateMessage = (): void => {
    view.message = store.size ? undefined : 'No bookmarks. Use F3 or Opt+F3 in an editor to add one.';
  };

  let treeTimer: ReturnType<typeof setTimeout> | undefined;
  const changed = (editors?: readonly vscode.TextEditor[]): void => {
    void ctx.workspaceState.update(STATE_KEY, store.toJSON());
    decorations.refresh(editors);
    updateMessage();
    clearTimeout(treeTimer);
    treeTimer = setTimeout(() => tree.refresh(), 150);
  };

  const cursor = (): { editor: vscode.TextEditor; uri: string; line: number } | undefined => {
    const editor = vscode.window.activeTextEditor;
    return editor && { editor, uri: editor.document.uri.toString(), line: editor.selection.active.line };
  };

  /** Bookmark from a tree node argument, else the bookmark on the cursor line. */
  const target = (arg: unknown): Bookmark | undefined => {
    if (isBookmarkNode(arg) && arg.kind === 'bookmark') return arg.bookmark;
    const c = cursor();
    return c && store.at(c.uri, c.line);
  };

  const reveal = (b: Bookmark) => showLine(vscode.Uri.parse(b.uri), b.line, { preview: false, preserveFocus: false });

  const jumpTo = async (mnemonic: string | undefined): Promise<void> => {
    const m = normalizeMnemonic(mnemonic) ?? (await pickTakenMnemonic(store));
    if (!m) return;
    const b = store.byMnemonic(m);
    if (b) await reveal(b);
    else vscode.window.setStatusBarMessage(`No bookmark with mnemonic ${m}`, 3000);
  };

  const toggleMnemonicFlow = async (): Promise<void> => {
    const c = cursor();
    if (!c) return;
    const choice = await pickMnemonic(store, store.at(c.uri, c.line));
    if (!choice) return;
    if (choice.kind === 'remove') store.toggle(c.uri, c.line);
    else if (choice.kind === 'anonymous') store.assignMnemonic(c.uri, c.line, undefined);
    else store.toggleMnemonic(c.uri, c.line, choice.char);
    changed();
  };

  const navigate = (direction: 1 | -1) => (): void => {
    const c = cursor();
    const next = c && store.neighbour(c.uri, c.line, direction);
    if (!c || !next) return;
    const pos = new vscode.Position(next.line, 0);
    c.editor.selection = new vscode.Selection(pos, pos);
    c.editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  };

  const cmd = (id: string, fn: (...args: never[]) => unknown) => vscode.commands.registerCommand(`stormParity.bookmarks.${id}`, fn);

  ctx.subscriptions.push(
    decorations,
    tree,
    view,
    { dispose: () => clearTimeout(treeTimer) },

    cmd('toggle', () => {
      const c = cursor();
      if (!c) return;
      store.toggle(c.uri, c.line);
      changed();
    }),
    cmd('toggleMnemonic', toggleMnemonicFlow),
    cmd('toggleNumeric', async (digit?: string) => {
      const c = cursor();
      const m = normalizeMnemonic(digit);
      if (!c) return;
      if (!m) return toggleMnemonicFlow();
      store.toggleMnemonic(c.uri, c.line, m);
      changed();
    }),
    cmd('jumpToMnemonic', (mnemonic?: string) => jumpTo(mnemonic)),
    cmd('showAll', () =>
      showAllBookmarks(store, (b) => {
        store.remove(b);
        changed();
      }),
    ),
    cmd('next', navigate(1)),
    cmd('previous', navigate(-1)),
    cmd('reveal', async (node?: BookmarkNode) => {
      const b = target(node);
      if (b) await reveal(b);
    }),
    cmd('editDescription', async (node?: BookmarkNode) => {
      const c = cursor();
      const b = target(node) ?? (c && { uri: c.uri, line: c.line });
      if (!b) return;
      const value = await vscode.window.showInputBox({
        title: 'Bookmark Description',
        prompt: `Line ${b.line + 1}`,
        value: 'description' in b ? (b.description ?? '') : '',
      });
      if (value === undefined) return;
      store.setDescription(b.uri, b.line, value);
      changed();
    }),
    cmd('delete', (node?: BookmarkNode) => {
      if (isBookmarkNode(node) && node.kind === 'file') {
        store.forUri(node.uri).forEach((b) => store.remove(b));
        return changed();
      }
      const b = target(node);
      if (b && store.remove(b)) changed();
    }),
    cmd('clearAll', async () => {
      if (!store.size) return;
      const ok = await vscode.window.showWarningMessage(`Delete all ${store.size} bookmarks in this workspace?`, { modal: true }, 'Delete All');
      if (ok !== 'Delete All') return;
      store.clear();
      changed();
    }),

    vscode.window.onDidChangeVisibleTextEditors((editors) => decorations.refresh(editors)),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.contentChanges.length === 0) return;
      if (store.applyEdits(e.document.uri.toString(), e.contentChanges.map(toLineChange))) {
        changed(vscode.window.visibleTextEditors.filter((ed) => ed.document === e.document));
      }
    }),
    vscode.workspace.onDidRenameFiles((e) => {
      let any = false;
      for (const f of e.files) any = store.rename(f.oldUri.toString(), f.newUri.toString()) || any;
      if (any) changed();
    }),
    vscode.workspace.onDidDeleteFiles((e) => {
      let any = false;
      for (const uri of e.files) any = store.deleteUri(uri.toString()) || any;
      if (any) changed();
    }),
  );

  updateMessage();
  decorations.refresh();
}
