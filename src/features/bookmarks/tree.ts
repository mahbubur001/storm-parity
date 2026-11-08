import * as vscode from 'vscode';
import { Bookmark, BookmarkStore } from './model';
import { baseName, readLines, relativePath } from './editorUtil';

export type BookmarkNode = { kind: 'file'; uri: string } | { kind: 'bookmark'; bookmark: Bookmark };

export const isBookmarkNode = (v: unknown): v is BookmarkNode =>
  !!v && typeof v === 'object' && ((v as BookmarkNode).kind === 'file' || (v as BookmarkNode).kind === 'bookmark');

export class BookmarksTree implements vscode.TreeDataProvider<BookmarkNode> {
  private readonly emitter = new vscode.EventEmitter<BookmarkNode | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly store: BookmarkStore) {}

  refresh(): void {
    this.emitter.fire(undefined);
  }

  getChildren(node?: BookmarkNode): BookmarkNode[] {
    if (!node) return this.store.uris().map((uri) => ({ kind: 'file', uri }));
    if (node.kind === 'file') return this.store.forUri(node.uri).map((bookmark) => ({ kind: 'bookmark', bookmark }));
    return [];
  }

  async getTreeItem(node: BookmarkNode): Promise<vscode.TreeItem> {
    if (node.kind === 'file') {
      const uri = vscode.Uri.parse(node.uri);
      const item = new vscode.TreeItem(uri, vscode.TreeItemCollapsibleState.Expanded);
      item.description = relativePath(uri).slice(0, -baseName(uri).length).replace(/\/$/, '');
      item.contextValue = 'stormParity.bookmarkFile';
      return item;
    }
    const b = node.bookmark;
    const uri = vscode.Uri.parse(b.uri);
    const text = (await readLines(uri))[b.line]?.trim() ?? '';
    const item = new vscode.TreeItem(`${b.line + 1}: ${text}`, vscode.TreeItemCollapsibleState.None);
    item.description = [b.mnemonic && `[${b.mnemonic}]`, b.description].filter(Boolean).join(' ');
    item.tooltip = `${relativePath(uri)}:${b.line + 1}${b.description ? `\n${b.description}` : ''}`;
    item.iconPath = new vscode.ThemeIcon('bookmark');
    item.contextValue = 'stormParity.bookmark';
    item.command = { command: 'stormParity.bookmarks.reveal', title: 'Reveal Bookmark', arguments: [node] };
    return item;
  }

  dispose(): void {
    this.emitter.dispose();
  }
}
