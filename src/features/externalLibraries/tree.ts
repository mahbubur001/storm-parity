import * as path from 'path';
import * as vscode from 'vscode';
import { contractPath, isDirectory, listDirectory } from './core';
import { LibraryStore } from './store';
import { onDidChangeSections, treeSections, type TreeSection } from './sections';

export type Node =
  | { kind: 'library'; path: string; missing: boolean }
  | { kind: 'entry'; path: string; isDirectory: boolean }
  | { kind: 'section'; section: TreeSection; element: unknown };

/**
 * The "External Libraries" view in the Explorer, PhpStorm's External Libraries node: one root per include path,
 * browsable like any folder, files open in the editor.
 */
export class LibraryTree implements vscode.TreeDataProvider<Node>, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  private watchers: vscode.Disposable[] = [];
  private readonly disposables: vscode.Disposable[];

  constructor(private readonly store: LibraryStore) {
    this.disposables = [this.emitter, store.onDidChange(() => this.refresh()), onDidChangeSections(() => this.emitter.fire(undefined))];
    this.watch();
  }

  refresh(): void {
    this.watch();
    this.emitter.fire(undefined);
  }

  /** Refreshes the view when files change inside a library (debounced; libraries are outside the workspace). */
  private watch(): void {
    this.watchers.forEach((w) => w.dispose());
    let timer: NodeJS.Timeout | undefined;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => this.emitter.fire(undefined), 500);
    };
    this.watchers = this.store.libraries.map((l) => {
      const w = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(l.path), '**/*'));
      w.onDidCreate(schedule);
      w.onDidDelete(schedule);
      return w;
    });
  }

  private async sectionChildren(section: TreeSection, element?: unknown): Promise<Node[]> {
    const children = (await section.getChildren(element)) ?? [];
    return children.map((e): Node => ({ kind: 'section', section, element: e }));
  }

  async getChildren(node?: Node): Promise<Node[]> {
    if (!node) {
      const libraries = await Promise.all(
        this.store.libraries.map(async (l): Promise<Node> => ({ kind: 'library', path: l.path, missing: !(await isDirectory(l.path)) })),
      );
      const sections = await Promise.all(treeSections().map((s) => this.sectionChildren(s)));
      return [...libraries, ...sections.flat()];
    }
    if (node.kind === 'section') return this.sectionChildren(node.section, node.element);
    if (node.kind === 'library' && node.missing) return [];
    const entries = await listDirectory(node.path).catch(() => []);
    return entries.map((e): Node => ({ kind: 'entry', path: e.path, isDirectory: e.isDirectory }));
  }

  getTreeItem(node: Node): vscode.TreeItem | Thenable<vscode.TreeItem> {
    if (node.kind === 'section') return node.section.getTreeItem(node.element);
    const uri = vscode.Uri.file(node.path);
    if (node.kind === 'library') {
      const item = new vscode.TreeItem(
        path.basename(node.path) || node.path,
        node.missing ? vscode.TreeItemCollapsibleState.None : vscode.TreeItemCollapsibleState.Collapsed,
      );
      item.description = node.missing ? 'not found' : contractPath(path.dirname(node.path));
      item.tooltip = new vscode.MarkdownString(node.missing ? `**${node.path}**\n\nThis folder does not exist.` : `**${node.path}**`);
      item.iconPath = new vscode.ThemeIcon(node.missing ? 'warning' : 'library', node.missing ? new vscode.ThemeColor('list.warningForeground') : undefined);
      item.contextValue = 'library';
      item.resourceUri = uri;
      item.id = `library:${node.path}`;
      return item;
    }
    const item = new vscode.TreeItem(uri, node.isDirectory ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
    item.contextValue = node.isDirectory ? 'libraryFolder' : 'libraryFile';
    item.id = `entry:${node.path}`;
    if (!node.isDirectory) item.command = { command: 'vscode.open', title: 'Open', arguments: [uri] };
    return item;
  }

  dispose(): void {
    this.watchers.forEach((w) => w.dispose());
    this.disposables.forEach((d) => d.dispose());
  }
}
