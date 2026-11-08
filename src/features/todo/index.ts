import * as vscode from 'vscode';
import { TodoMatch } from './matcher';
import { FileTodos, TodoIndex } from './scanner';

const VIEW_ID = 'stormParity.todo';
const CTX_CURRENT_FILE = 'stormParity.todo.currentFileOnly';
const CTX_FILTERED = 'stormParity.todo.tagFiltered';

type Node = { kind: 'file'; file: FileTodos; todos: TodoMatch[] } | { kind: 'todo'; uri: vscode.Uri; todo: TodoMatch };

class TodoTreeProvider implements vscode.TreeDataProvider<Node> {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;
  currentFileOnly = false;
  tagFilter: Set<string> | undefined;

  constructor(private readonly index: TodoIndex) {}

  refresh(): void {
    this.emitter.fire();
  }

  /** Files and their todos after applying the current filters. */
  visible(): { file: FileTodos; todos: TodoMatch[] }[] {
    const active = vscode.window.activeTextEditor?.document.uri.toString();
    return this.index.all
      .filter((f) => !this.currentFileOnly || f.uri.toString() === active)
      .map((file) => ({ file, todos: this.tagFilter ? file.todos.filter((t) => this.tagFilter!.has(t.tag)) : file.todos }))
      .filter((f) => f.todos.length > 0)
      .sort((a, b) => a.file.uri.path.localeCompare(b.file.uri.path));
  }

  getChildren(node?: Node): Node[] {
    if (!node) return this.visible().map((f) => ({ kind: 'file', ...f }));
    if (node.kind === 'file') return node.todos.map((todo) => ({ kind: 'todo', uri: node.file.uri, todo }));
    return [];
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind === 'file') {
      const item = new vscode.TreeItem(node.file.uri, vscode.TreeItemCollapsibleState.Expanded);
      const rel = vscode.workspace.asRelativePath(node.file.uri, true);
      const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
      item.description = `${dir}${dir ? '  ' : ''}(${node.todos.length})`;
      item.contextValue = 'todoFile';
      return item;
    }
    const { todo, uri } = node;
    const item = new vscode.TreeItem(todo.text, vscode.TreeItemCollapsibleState.None);
    item.description = `line ${todo.line + 1}`;
    item.tooltip = `${vscode.workspace.asRelativePath(uri, true)}:${todo.line + 1}\n${todo.text}`;
    item.iconPath = new vscode.ThemeIcon(iconFor(todo.tag));
    item.contextValue = 'todoItem';
    const pos = new vscode.Position(todo.line, todo.column);
    item.command = {
      command: 'vscode.open',
      title: 'Open',
      arguments: [uri, { selection: new vscode.Range(pos, pos), preserveFocus: false } satisfies vscode.TextDocumentShowOptions],
    };
    return item;
  }

  dispose(): void {
    this.emitter.dispose();
  }
}

function iconFor(tag: string): string {
  switch (tag) {
    case 'FIXME':
      return 'bug';
    case 'HACK':
    case 'XXX':
      return 'warning';
    default:
      return 'checklist';
  }
}

export function activate(ctx: vscode.ExtensionContext): void {
  const index = new TodoIndex();
  const provider = new TodoTreeProvider(index);
  const view = vscode.window.createTreeView(VIEW_ID, { treeDataProvider: provider, showCollapseAll: true });
  let started = false;

  const update = (): void => {
    provider.refresh();
    const files = provider.visible();
    const total = files.reduce((n, f) => n + f.todos.length, 0);
    view.badge = total > 0 ? { value: total, tooltip: `${total} TODO item${total === 1 ? '' : 's'}` } : undefined;
    const filters = [provider.currentFileOnly ? 'current file' : '', provider.tagFilter ? [...provider.tagFilter].join(', ') : ''].filter(Boolean);
    view.description = `${total} in ${files.length} file${files.length === 1 ? '' : 's'}${filters.length ? ` (${filters.join('; ')})` : ''}`;
    view.message = index.scanning ? 'Scanning workspace...' : total === 0 && started ? 'No TODO items found.' : undefined;
  };

  const ensureStarted = (): void => {
    if (started) return;
    started = true;
    void index.scanAll();
  };

  const setCurrentFileOnly = (on: boolean): void => {
    provider.currentFileOnly = on;
    void vscode.commands.executeCommand('setContext', CTX_CURRENT_FILE, on);
    update();
  };

  // Debounced per-file updates from the file watcher.
  const pending = new Map<string, vscode.Uri>();
  let timer: NodeJS.Timeout | undefined;
  const queue = (uri: vscode.Uri): void => {
    if (!started) return;
    pending.set(uri.toString(), uri);
    clearTimeout(timer);
    timer = setTimeout(() => {
      const uris = [...pending.values()];
      pending.clear();
      // Bulk changes (checkouts, installs) are cheaper as one full rescan.
      if (uris.length > 200) void index.scanAll();
      else void Promise.all(uris.map((u) => index.updateUri(u)));
    }, 300);
  };

  const watcher = vscode.workspace.createFileSystemWatcher('**/*');

  ctx.subscriptions.push(
    index,
    provider,
    view,
    watcher,
    index.onDidChange(update),
    view.onDidChangeVisibility((e) => e.visible && ensureStarted()),
    watcher.onDidCreate(queue),
    watcher.onDidChange(queue),
    watcher.onDidDelete((uri) => started && index.remove(uri)),
    vscode.workspace.onDidSaveTextDocument((doc) => started && void index.updateDocument(doc)),
    vscode.window.onDidChangeActiveTextEditor(() => provider.currentFileOnly && update()),
    vscode.workspace.onDidChangeWorkspaceFolders(() => started && void index.scanAll()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!['stormParity.todo', 'files.exclude', 'search.exclude'].some((s) => e.affectsConfiguration(s))) return;
      index.reloadSettings();
      if (started) void index.scanAll();
    }),
    { dispose: () => clearTimeout(timer) },
    vscode.commands.registerCommand('stormParity.todo.refresh', () => {
      started = true;
      index.reloadSettings();
      return index.scanAll();
    }),
    vscode.commands.registerCommand('stormParity.todo.currentFileOnly', () => setCurrentFileOnly(true)),
    vscode.commands.registerCommand('stormParity.todo.allFiles', () => setCurrentFileOnly(false)),
    vscode.commands.registerCommand('stormParity.todo.filterTags', async () => {
      const tags = [...new Set(index.all.flatMap((f) => f.todos.map((t) => t.tag)))].sort();
      if (tags.length === 0) {
        void vscode.window.showInformationMessage('Storm: no TODO items to filter.');
        return;
      }
      const picks = await vscode.window.showQuickPick(
        tags.map((tag) => ({ label: tag, picked: !provider.tagFilter || provider.tagFilter.has(tag) })),
        { title: 'Filter TODO Patterns', canPickMany: true, placeHolder: 'Select the patterns to show' },
      );
      if (!picks) return;
      provider.tagFilter = picks.length === 0 || picks.length === tags.length ? undefined : new Set(picks.map((p) => p.label));
      void vscode.commands.executeCommand('setContext', CTX_FILTERED, provider.tagFilter !== undefined);
      update();
    }),
    vscode.commands.registerCommand('stormParity.todo.clearFilters', () => {
      provider.tagFilter = undefined;
      void vscode.commands.executeCommand('setContext', CTX_FILTERED, false);
      setCurrentFileOnly(false);
    }),
  );

  if (view.visible) ensureStarted();
}
