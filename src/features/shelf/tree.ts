import * as vscode from 'vscode';
import * as path from 'path';
import { ShelfEntry, ShelfStore, ShelvedFile } from './store';

export type ShelfNode = { kind: 'shelf'; entry: ShelfEntry } | { kind: 'file'; entry: ShelfEntry; file: ShelvedFile };

const STATUS_LABEL: Record<string, string> = {
  M: 'Modified',
  A: 'Added',
  D: 'Deleted',
  R: 'Renamed',
  C: 'Copied',
  U: 'Untracked',
};

export class ShelfTreeProvider implements vscode.TreeDataProvider<ShelfNode>, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<ShelfNode | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(
    private readonly store: ShelfStore,
    private readonly openRoots: () => string[],
  ) {}

  refresh(): void {
    this.emitter.fire(undefined);
  }

  /** Entries belonging to repositories open in this window. */
  async visibleEntries(): Promise<ShelfEntry[]> {
    const roots = new Set(this.openRoots());
    const all = await this.store.list();
    return roots.size ? all.filter((e) => roots.has(e.repoRoot)) : [];
  }

  async getChildren(node?: ShelfNode): Promise<ShelfNode[]> {
    if (!node) return (await this.visibleEntries()).map((entry) => ({ kind: 'shelf', entry }));
    if (node.kind === 'shelf') return node.entry.files.map((file) => ({ kind: 'file', entry: node.entry, file }));
    return [];
  }

  getTreeItem(node: ShelfNode): vscode.TreeItem {
    if (node.kind === 'shelf') {
      const { entry } = node;
      const item = new vscode.TreeItem(entry.name, vscode.TreeItemCollapsibleState.Collapsed);
      item.id = `shelf:${entry.id}`;
      item.contextValue = 'shelf';
      item.iconPath = new vscode.ThemeIcon('archive');
      const multi = this.openRoots().length > 1;
      item.description = [new Date(entry.date).toLocaleString(), multi ? path.basename(entry.repoRoot) : ''].filter(Boolean).join('  ');
      item.tooltip = new vscode.MarkdownString(
        [
          `**${entry.name}**`,
          `${entry.files.length} file(s), shelved ${new Date(entry.date).toLocaleString()}`,
          entry.changelist ? `Changelist: ${entry.changelist}` : '',
          `Repository: ${entry.repoRoot}`,
        ]
          .filter(Boolean)
          .join('\n\n'),
      );
      return item;
    }
    const { entry, file } = node;
    const item = new vscode.TreeItem(path.posix.basename(file.path), vscode.TreeItemCollapsibleState.None);
    item.id = `shelf:${entry.id}:${file.path}`;
    item.contextValue = 'shelfFile';
    item.resourceUri = vscode.Uri.file(path.join(entry.repoRoot, ...file.path.split('/')));
    const dir = path.posix.dirname(file.path);
    item.description = `${file.status}  ${dir === '.' ? '' : dir}`;
    item.tooltip = `${STATUS_LABEL[file.status] ?? file.status}: ${file.path}`;
    item.command = { command: 'stormParity.shelf.showPatch', title: 'Show Patch', arguments: [node] };
    return item;
  }

  dispose(): void {
    this.emitter.dispose();
  }
}
