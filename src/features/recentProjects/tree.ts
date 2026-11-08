import * as os from 'os';
import * as vscode from 'vscode';
import { RecentEntry, displayName, kindOf, tildify, uriKey } from '../openFolder/mru';
import { entryExists, isCurrentProject, listRecent } from '../openFolder/open';
import { ProjectMetaStore, aliasOf } from './store';

export type Node = { type: 'group'; name: string } | { type: 'project'; entry: RecentEntry; group?: string };

export class RecentProjectsProvider implements vscode.TreeDataProvider<Node> {
  private readonly emitter = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  private recent: RecentEntry[] = [];

  constructor(private readonly meta: ProjectMetaStore) {}

  refresh(): void {
    this.emitter.fire(undefined);
  }

  dispose(): void {
    this.emitter.dispose();
  }

  async getChildren(node?: Node): Promise<Node[]> {
    const meta = this.meta.get();
    if (!node) {
      this.recent = await listRecent();
      const groups = [...meta.groups].sort((a, b) => a.localeCompare(b)).map((name): Node => ({ type: 'group', name }));
      const ungrouped = this.recent.filter((e) => !meta.membership[uriKey(e.uri)]).map((entry): Node => ({ type: 'project', entry }));
      return [...groups, ...ungrouped];
    }
    if (node.type !== 'group') return [];
    // Grouped projects stay visible even after they drop out of the recent list.
    const order = new Map(this.recent.map((e, i) => [uriKey(e.uri), i]));
    return Object.entries(meta.membership)
      .filter(([key, g]) => g === node.name && entryExists(key))
      .map(([key]) => this.recent.find((e) => uriKey(e.uri) === key) ?? { uri: key, kind: kindOf(key) })
      .sort((a, b) => (order.get(uriKey(a.uri)) ?? Infinity) - (order.get(uriKey(b.uri)) ?? Infinity) || displayName(a.uri).localeCompare(displayName(b.uri)))
      .map((entry): Node => ({ type: 'project', entry, group: node.name }));
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.type === 'group') {
      const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.Expanded);
      item.id = `group:${node.name}`;
      item.contextValue = 'group';
      item.iconPath = new vscode.ThemeIcon('folder-library');
      return item;
    }
    const { entry } = node;
    const uri = vscode.Uri.parse(entry.uri);
    const current = isCurrentProject(entry.uri);
    const where = uri.scheme === 'file' ? tildify(uri.fsPath, os.homedir()) : entry.uri;
    const item = new vscode.TreeItem(aliasOf(this.meta.get(), entry.uri) ?? entry.label ?? displayName(entry.uri));
    item.id = `project:${node.group ?? ''}:${uriKey(entry.uri)}`;
    item.description = current ? 'current' : where;
    item.tooltip = uri.scheme === 'file' ? uri.fsPath : entry.uri;
    item.contextValue = current ? 'projectCurrent' : 'project';
    item.iconPath = current
      ? new vscode.ThemeIcon('folder-active', new vscode.ThemeColor('charts.green'))
      : new vscode.ThemeIcon(entry.kind === 'workspace' ? 'folder-library' : 'folder');
    if (!current) item.command = { command: 'stormParity.recentProjects.open', title: 'Open', arguments: [node] };
    return item;
  }
}
