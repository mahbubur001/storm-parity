import { execFile } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import { isPackageName, isPlatform, parseLock, parseManifest, parseOutdated, parseRequireInput, type ComposerPackage, type Outdated } from './core';

const VIEW_ID = 'stormParity.composer';
const CMD = 'stormParity.composer';
const TASK_TYPE = 'storm-composer';

interface Root {
  folder: vscode.WorkspaceFolder;
  dir: string;
}

type Node =
  | { kind: 'root'; root: Root }
  | { kind: 'group'; root: Root; group: 'scripts' | 'require' | 'require-dev' }
  | { kind: 'script'; root: Root; name: string }
  | { kind: 'package'; root: Root; pkg: ComposerPackage; installed?: string; outdated?: Outdated };

interface TaskDef extends vscode.TaskDefinition {
  args: string[];
}

/** The composer command split into program and leading arguments (`php composer.phar` → php, [composer.phar]). */
function composerCommand(): [string, string[]] {
  const parts = (vscode.workspace.getConfiguration('stormParity.composer').get<string>('executable', 'composer') || 'composer').trim().split(/\s+/);
  return [parts[0], parts.slice(1)];
}

const readText = async (file: string): Promise<string | undefined> => {
  try {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.file(file)));
  } catch {
    return undefined;
  }
};

/** Workspace folders with a composer.json at their root. */
async function composerRoots(): Promise<Root[]> {
  const roots: Root[] = [];
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    if (folder.uri.scheme !== 'file') continue;
    if (await readText(path.join(folder.uri.fsPath, 'composer.json'))) roots.push({ folder, dir: folder.uri.fsPath });
  }
  return roots;
}

function composerTask(root: Root, args: string[], name: string): vscode.Task {
  const [cmd, pre] = composerCommand();
  const task = new vscode.Task({ type: TASK_TYPE, args } satisfies TaskDef, root.folder, name, 'composer', new vscode.ShellExecution(cmd, [...pre, ...args], { cwd: root.dir }));
  task.presentationOptions = { reveal: vscode.TaskRevealKind.Always, clear: true };
  return task;
}

class ComposerTree implements vscode.TreeDataProvider<Node> {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;
  /** `composer outdated` results per root dir, until the next install/update. */
  readonly outdated = new Map<string, Map<string, Outdated>>();

  refresh(): void {
    this.emitter.fire();
  }

  async getChildren(node?: Node): Promise<Node[]> {
    if (!node) {
      const roots = await composerRoots();
      return roots.length === 1 ? this.groups(roots[0]) : roots.map((root): Node => ({ kind: 'root', root }));
    }
    if (node.kind === 'root') return this.groups(node.root);
    if (node.kind !== 'group') return [];
    const manifest = await this.manifest(node.root);
    if (!manifest) return [];
    if (node.group === 'scripts') return manifest.scripts.map((name): Node => ({ kind: 'script', root: node.root, name }));
    const lockText = await readText(path.join(node.root.dir, 'composer.lock'));
    const lock = lockText ? safe(() => parseLock(lockText)) : undefined;
    const outdated = this.outdated.get(node.root.dir);
    return manifest.packages
      .filter((p) => p.dev === (node.group === 'require-dev'))
      .map((pkg): Node => ({ kind: 'package', root: node.root, pkg, installed: lock?.get(pkg.name.toLowerCase()), outdated: outdated?.get(pkg.name.toLowerCase()) }));
  }

  private async manifest(root: Root) {
    const text = await readText(path.join(root.dir, 'composer.json'));
    return text ? safe(() => parseManifest(text)) : undefined;
  }

  private async groups(root: Root): Promise<Node[]> {
    const m = await this.manifest(root);
    if (!m) return [];
    const groups: Node[] = [];
    if (m.scripts.length) groups.push({ kind: 'group', root, group: 'scripts' });
    if (m.packages.some((p) => !p.dev)) groups.push({ kind: 'group', root, group: 'require' });
    if (m.packages.some((p) => p.dev)) groups.push({ kind: 'group', root, group: 'require-dev' });
    return groups;
  }

  getTreeItem(node: Node): vscode.TreeItem {
    switch (node.kind) {
      case 'root': {
        const item = new vscode.TreeItem(node.root.folder.name, vscode.TreeItemCollapsibleState.Expanded);
        item.iconPath = new vscode.ThemeIcon('package');
        item.contextValue = 'composerRoot';
        return item;
      }
      case 'group': {
        const item = new vscode.TreeItem(node.group === 'scripts' ? 'Scripts' : node.group, vscode.TreeItemCollapsibleState.Expanded);
        item.iconPath = new vscode.ThemeIcon(node.group === 'scripts' ? 'run-all' : 'library');
        item.id = `${node.root.dir}:${node.group}`;
        return item;
      }
      case 'script': {
        const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon('play');
        item.tooltip = `composer run-script ${node.name}`;
        item.contextValue = 'composerScript';
        item.command = { command: `${CMD}.runScript`, title: 'Run Script', arguments: [node] };
        return item;
      }
      case 'package': {
        const { pkg, installed, outdated } = node;
        const item = new vscode.TreeItem(pkg.name, vscode.TreeItemCollapsibleState.None);
        item.description = [pkg.constraint, installed && `installed ${installed}`, outdated && `→ ${outdated.latest}`].filter(Boolean).join(' · ');
        item.iconPath = outdated
          ? new vscode.ThemeIcon('arrow-circle-up', new vscode.ThemeColor(outdated.status === 'semver-safe-update' ? 'charts.green' : 'charts.yellow'))
          : new vscode.ThemeIcon(isPlatform(pkg.name) ? 'server-environment' : 'package');
        item.tooltip = new vscode.MarkdownString(
          `**${pkg.name}** ${pkg.constraint}${pkg.dev ? ' (dev)' : ''}\n\n${installed ? `Installed: ${installed}` : 'Not installed'}${
            outdated ? `\n\nLatest: ${outdated.latest}${outdated.status === 'update-possible' ? ' (outside the constraint)' : ''}` : ''
          }`,
        );
        item.contextValue = isPlatform(pkg.name) ? 'composerPlatform' : 'composerPackage';
        item.command = { command: `${CMD}.openManifest`, title: 'Open composer.json', arguments: [node] };
        return item;
      }
    }
  }

  dispose(): void {
    this.emitter.dispose();
  }
}

function safe<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

interface PackagistHit {
  name: string;
  description?: string;
  downloads?: number;
}

/** Live Packagist search; typed `vendor/pkg[:constraint]` is offered as-is. */
async function pickPackage(): Promise<string | undefined> {
  const qp = vscode.window.createQuickPick<vscode.QuickPickItem & { arg?: string }>();
  qp.title = 'Composer: Require Package';
  qp.placeholder = 'Search Packagist, or type vendor/package:constraint';
  qp.matchOnDescription = true;
  let timer: NodeJS.Timeout | undefined;
  let seq = 0;
  const typedItem = () => {
    const arg = parseRequireInput(qp.value);
    return arg ? [{ label: `$(add) ${arg}`, description: 'require as typed', arg, alwaysShow: true }] : [];
  };
  qp.onDidChangeValue((q) => {
    clearTimeout(timer);
    qp.items = typedItem();
    if (q.trim().length < 2) return;
    timer = setTimeout(async () => {
      const mine = ++seq;
      qp.busy = true;
      try {
        const res = await fetch(`https://packagist.org/search.json?q=${encodeURIComponent(q.trim())}&per_page=25`);
        const json = (await res.json()) as { results?: PackagistHit[] };
        if (mine !== seq) return;
        qp.items = [
          ...typedItem(),
          ...(json.results ?? [])
            .filter((r) => isPackageName(r.name))
            .map((r) => ({ label: r.name, description: r.downloads ? `${r.downloads.toLocaleString()} downloads` : undefined, detail: r.description, arg: r.name, alwaysShow: true })),
        ];
      } catch {
        // Offline: the typed item still works.
      } finally {
        if (mine === seq) qp.busy = false;
      }
    }, 250);
  });
  qp.show();
  const pick = await new Promise<string | undefined>((resolve) => {
    qp.onDidAccept(() => resolve(qp.selectedItems[0]?.arg ?? parseRequireInput(qp.value)));
    qp.onDidHide(() => resolve(undefined));
  });
  clearTimeout(timer);
  qp.dispose();
  return pick;
}

/**
 * PhpStorm's Composer support: a view of each composer project's scripts and direct dependencies (installed version
 * from composer.lock, available updates on request), with install / update / require / remove run as tasks. The
 * task provider also feeds composer scripts to the Run widget.
 */
export function activate(ctx: vscode.ExtensionContext): void {
  const tree = new ComposerTree();
  const view = vscode.window.createTreeView(VIEW_ID, { treeDataProvider: tree, showCollapseAll: true });

  const pickRoot = async (node?: Node): Promise<Root | undefined> => {
    if (node) return node.root;
    const roots = await composerRoots();
    if (roots.length <= 1) {
      if (!roots.length) void vscode.window.showInformationMessage('Storm: no composer.json in the workspace folders.');
      return roots[0];
    }
    return (await vscode.window.showQuickPick(roots.map((r) => ({ label: r.folder.name, description: r.dir, r })), { title: 'Composer project' }))?.r;
  };

  const run = async (root: Root, args: string[], name: string) => {
    tree.outdated.delete(root.dir);
    await vscode.tasks.executeTask(composerTask(root, args, name));
  };

  const checkOutdated = async (node?: Node) => {
    const root = await pickRoot(node);
    if (!root) return;
    await vscode.window.withProgress({ location: { viewId: VIEW_ID }, title: 'Checking for package updates' }, async () => {
      const [cmd, pre] = composerCommand();
      const out = await new Promise<string>((resolve, reject) =>
        execFile(cmd, [...pre, 'outdated', '--direct', '--format=json', '--no-interaction'], { cwd: root.dir, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) =>
          stdout.trim() ? resolve(stdout) : reject(new Error((stderr || err?.message || 'no output').trim())),
        ),
      );
      const outdated = parseOutdated(out);
      tree.outdated.set(root.dir, outdated);
      tree.refresh();
      void vscode.window.setStatusBarMessage(outdated.size ? `Composer: ${outdated.size} package update(s) available` : 'Composer: all direct packages are up to date', 5000);
    }).then(undefined, (e: Error) => vscode.window.showErrorMessage(`Composer outdated failed: ${e.message}`));
  };

  const watcher = vscode.workspace.createFileSystemWatcher('**/composer.{json,lock}');
  /** The view only shows in workspaces with a composer project, so the context is kept up to date from activation. */
  const updateContext = async () => {
    await vscode.commands.executeCommand('setContext', `${CMD}.hasProject`, (await composerRoots()).length > 0);
  };
  const refresh = () => {
    void updateContext();
    tree.refresh();
  };
  void updateContext();

  ctx.subscriptions.push(
    tree,
    view,
    watcher,
    watcher.onDidChange(refresh),
    watcher.onDidCreate(refresh),
    watcher.onDidDelete(refresh),
    vscode.workspace.onDidChangeWorkspaceFolders(refresh),
    vscode.tasks.onDidEndTask((e) => e.execution.task.definition.type === TASK_TYPE && refresh()),
    vscode.tasks.registerTaskProvider(TASK_TYPE, {
      provideTasks: async () => {
        const tasks: vscode.Task[] = [];
        for (const root of await composerRoots()) {
          const text = await readText(path.join(root.dir, 'composer.json'));
          const m = text ? safe(() => parseManifest(text)) : undefined;
          for (const s of m?.scripts ?? []) tasks.push(composerTask(root, ['run-script', s], s));
          tasks.push(composerTask(root, ['install'], 'install'), composerTask(root, ['update'], 'update'));
        }
        return tasks;
      },
      resolveTask: (task) => {
        const def = task.definition as TaskDef;
        const folder = typeof task.scope === 'object' ? (task.scope as vscode.WorkspaceFolder) : undefined;
        return Array.isArray(def.args) && folder ? composerTask({ folder, dir: folder.uri.fsPath }, def.args, task.name) : undefined;
      },
    }),
    vscode.commands.registerCommand(`${CMD}.refresh`, refresh),
    vscode.commands.registerCommand(`${CMD}.install`, async (node?: Node) => {
      const root = await pickRoot(node);
      if (root) await run(root, ['install'], 'install');
    }),
    vscode.commands.registerCommand(`${CMD}.update`, async (node?: Node) => {
      const root = await pickRoot(node);
      if (root) await run(root, ['update'], 'update');
    }),
    vscode.commands.registerCommand(`${CMD}.require`, async (node?: Node) => {
      const root = await pickRoot(node);
      if (!root) return;
      const arg = await pickPackage();
      if (!arg) return;
      const dev = await vscode.window.showQuickPick(
        [
          { label: 'require', description: 'runtime dependency', dev: false },
          { label: 'require-dev', description: 'development only (--dev)', dev: true },
        ],
        { title: `Composer: require ${arg}` },
      );
      if (dev) await run(root, ['require', arg, ...(dev.dev ? ['--dev'] : [])], `require ${arg}`);
    }),
    vscode.commands.registerCommand(`${CMD}.checkOutdated`, checkOutdated),
    vscode.commands.registerCommand(`${CMD}.runScript`, async (node?: Node) => {
      if (node?.kind === 'script') await vscode.tasks.executeTask(composerTask(node.root, ['run-script', node.name], node.name));
    }),
    vscode.commands.registerCommand(`${CMD}.updatePackage`, async (node?: Node) => {
      if (node?.kind === 'package') await run(node.root, ['update', node.pkg.name, '--with-dependencies'], `update ${node.pkg.name}`);
    }),
    vscode.commands.registerCommand(`${CMD}.removePackage`, async (node?: Node) => {
      if (node?.kind !== 'package') return;
      const ok = await vscode.window.showWarningMessage(`Remove ${node.pkg.name} from composer.json?`, { modal: true }, 'Remove');
      if (ok) await run(node.root, ['remove', node.pkg.name, ...(node.pkg.dev ? ['--dev'] : [])], `remove ${node.pkg.name}`);
    }),
    vscode.commands.registerCommand(`${CMD}.openPackagist`, (node?: Node) => {
      if (node?.kind === 'package') void vscode.env.openExternal(vscode.Uri.parse(`https://packagist.org/packages/${node.pkg.name}`));
    }),
    vscode.commands.registerCommand(`${CMD}.openManifest`, async (node?: Node) => {
      const root = await pickRoot(node);
      if (!root) return;
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(root.dir, 'composer.json')));
      const editor = await vscode.window.showTextDocument(doc, { preview: true });
      if (node?.kind !== 'package') return;
      const line = doc.getText().split('\n').findIndex((l) => l.includes(`"${node.pkg.name}"`));
      if (line >= 0) editor.selection = new vscode.Selection(line, 0, line, doc.lineAt(line).text.length);
      if (line >= 0) editor.revealRange(new vscode.Range(line, 0, line, 0), vscode.TextEditorRevealType.InCenter);
    }),
  );
}
