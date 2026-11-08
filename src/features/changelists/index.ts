import * as vscode from 'vscode';
import { GitAPI, GitRepository, findRepository, getGitApi, isInside, toRepoPath } from '../../util/git';
import { COMMIT_ACTIVE_COMMAND, OPEN_CHANGE_COMMAND, RepoChangelists } from './repo';
import { Changelist } from './store';

const cmd = (action: string): string => `stormParity.changelists.${action}`;

export function activate(ctx: vscode.ExtensionContext): void {
  const controllers = new Map<string, RepoChangelists>();
  let api: GitAPI | undefined;

  const statusBar = vscode.window.createStatusBarItem('stormParity.changelists.active', vscode.StatusBarAlignment.Left, 50);
  statusBar.name = 'Storm: Active Changelist';
  statusBar.command = cmd('setActive');
  ctx.subscriptions.push(statusBar, { dispose: () => controllers.forEach((c) => c.dispose()) });

  const config = () => vscode.workspace.getConfiguration('stormParity.changelists');

  const currentController = (): RepoChangelists | undefined => {
    const uri = vscode.window.activeTextEditor?.document.uri;
    if (uri?.scheme === 'file') {
      for (const c of controllers.values()) if (isInside(c.root, uri.fsPath)) return c;
    }
    return controllers.values().next().value;
  };

  const updateStatusBar = (): void => {
    const c = currentController();
    if (!c || !config().get<boolean>('showStatusBar', true)) {
      statusBar.hide();
      return;
    }
    const multi = controllers.size > 1;
    statusBar.text = `$(checklist) ${c.model.active.name}`;
    statusBar.tooltip = `Active changelist${multi ? ` in ${c.name}` : ''}. Click to switch.`;
    statusBar.show();
  };

  const addRepo = (repo: GitRepository): void => {
    const root = repo.rootUri.fsPath;
    if (controllers.has(root) || !api) return;
    const c = new RepoChangelists(repo, api, ctx.workspaceState);
    c.onDidChange(updateStatusBar);
    controllers.set(root, c);
    updateStatusBar();
  };

  const removeRepo = (repo: GitRepository): void => {
    const root = repo.rootUri.fsPath;
    controllers.get(root)?.dispose();
    controllers.delete(root);
    updateStatusBar();
  };

  void getGitApi().then((gitApi) => {
    if (!gitApi) return;
    api = gitApi;
    gitApi.repositories.forEach(addRepo);
    ctx.subscriptions.push(gitApi.onDidOpenRepository(addRepo), gitApi.onDidCloseRepository(removeRepo));
  });

  // ---------------------------------------------------------------------------
  // Argument resolution
  // ---------------------------------------------------------------------------

  const controllerForUri = (uri: vscode.Uri): RepoChangelists | undefined => {
    if (api) {
      const repo = findRepository(api, uri);
      if (repo) return controllers.get(repo.rootUri.fsPath);
    }
    return undefined;
  };

  const pickController = async (): Promise<RepoChangelists | undefined> => {
    const all = [...controllers.values()];
    if (all.length === 0) {
      void vscode.window.showInformationMessage('Storm: no git repository found for changelists.');
      return undefined;
    }
    if (all.length === 1) return all[0];
    const current = currentController();
    const items = all.map((c) => ({ label: c.name, description: c.root, c }));
    items.sort((a, b) => (a.c === current ? -1 : b.c === current ? 1 : 0));
    return (await vscode.window.showQuickPick(items, { placeHolder: 'Select repository' }))?.c;
  };

  const isGroup = (v: unknown): v is vscode.SourceControlResourceGroup =>
    typeof v === 'object' && v !== null && 'resourceStates' in v && 'id' in v;

  /** Resolves (controller, list) from a resource group argument or by asking. */
  const resolveList = async (
    arg: unknown,
    placeHolder: string,
    filter: (l: Changelist) => boolean = () => true,
  ): Promise<[RepoChangelists, Changelist] | undefined> => {
    if (typeof arg === 'string' && controllers.has(arg)) {
      const c = controllers.get(arg)!;
      return [c, c.model.active];
    }
    if (isGroup(arg)) {
      for (const c of controllers.values()) {
        const id = c.listIdOf(arg);
        const list = id ? c.model.get(id) : undefined;
        if (list) return [c, list];
      }
    }
    const c = await pickController();
    if (!c) return undefined;
    const list = await pickList(c, placeHolder, false, filter);
    return list ? [c, list] : undefined;
  };

  const pickList = async (
    c: RepoChangelists,
    placeHolder: string,
    allowNew: boolean,
    filter: (l: Changelist) => boolean = () => true,
  ): Promise<Changelist | undefined> => {
    type Item = vscode.QuickPickItem & { list?: Changelist };
    const items: Item[] = c.model.lists.filter(filter).map((list) => ({
      label: list.name,
      description: [list.id === c.model.active.id ? 'active' : '', `${c.entriesOf(list.id).length} files`].filter(Boolean).join(', '),
      detail: list.description || undefined,
      list,
    }));
    if (allowNew) items.push({ label: '$(add) New Changelist...', alwaysShow: true });
    if (items.length === 0) return undefined;
    const picked = await vscode.window.showQuickPick(items, { placeHolder });
    if (!picked) return undefined;
    return picked.list ?? (await createList(c));
  };

  const createList = async (c: RepoChangelists): Promise<Changelist | undefined> => {
    const name = await vscode.window.showInputBox({
      prompt: 'New changelist name',
      validateInput: (v) => (!v.trim() ? 'Name cannot be empty' : c.model.findByName(v) ? 'A changelist with this name exists' : undefined),
    });
    if (!name) return undefined;
    const description = await vscode.window.showInputBox({ prompt: 'Comment (optional, used as the default commit message)' });
    const list = c.model.add(name, description ?? '');
    if (config().get<boolean>('makeNewListActive', false)) c.model.setActive(list.id);
    await c.commitModel();
    return list;
  };

  /** Collects resource-state-like arguments (multi-select passes several, sometimes as an array). */
  const resourceUris = (args: unknown[]): vscode.Uri[] => {
    const out: vscode.Uri[] = [];
    const visit = (v: unknown): void => {
      if (Array.isArray(v)) v.forEach(visit);
      else if (v instanceof vscode.Uri) out.push(v);
      else if (typeof v === 'object' && v !== null && 'resourceUri' in v) {
        const u = (v as { resourceUri: unknown }).resourceUri;
        if (u instanceof vscode.Uri) out.push(u);
      }
    };
    args.forEach(visit);
    return out;
  };

  const run = (fn: () => Promise<void>): Promise<void> =>
    fn().catch((err: unknown) => {
      void vscode.window.showErrorMessage(`Storm: ${err instanceof Error ? err.message : String(err)}`);
    });

  // ---------------------------------------------------------------------------
  // Commit
  // ---------------------------------------------------------------------------

  const commitList = async (c: RepoChangelists, list: Changelist, opts: { fromInput: boolean; push: boolean }): Promise<void> => {
    const count = c.entriesOf(list.id).length;
    if (count === 0) {
      void vscode.window.showInformationMessage(`Storm: changelist "${list.name}" has no changes to commit.`);
      return;
    }
    let message = c.sc.inputBox.value;
    if (!opts.fromInput || !message.trim()) {
      const typed = await vscode.window.showInputBox({
        title: `Commit ${count} file${count === 1 ? '' : 's'} of "${list.name}"${opts.push ? ' and push' : ''}`,
        prompt: 'Commit message',
        value: message.trim() ? message : list.description,
        validateInput: (v) => (v.trim() ? undefined : 'Commit message cannot be empty'),
      });
      if (typed === undefined) return;
      message = typed;
    }
    if (!message.trim()) {
      void vscode.window.showWarningMessage('Storm: commit message cannot be empty.');
      return;
    }
    const summary = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.SourceControl, title: `Committing ${list.name}` },
      () => c.commit(list, message),
    );
    c.sc.inputBox.value = '';
    if (opts.push) {
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Storm: pushing...' }, () => c.push());
      void vscode.window.showInformationMessage(`Storm: committed and pushed. ${summary}`);
    } else {
      void vscode.window.showInformationMessage(`Storm: committed. ${summary}`);
    }
  };

  // ---------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------

  const register = (id: string, fn: (...args: unknown[]) => Promise<void>) =>
    ctx.subscriptions.push(vscode.commands.registerCommand(id, (...args: unknown[]) => run(() => fn(...args))));

  register(cmd('new'), async () => {
    const c = await pickController();
    if (c) await createList(c);
  });

  register(cmd('rename'), async (arg) => {
    const r = await resolveList(arg, 'Changelist to rename');
    if (!r) return;
    const [c, list] = r;
    const name = await vscode.window.showInputBox({
      prompt: `Rename changelist "${list.name}"`,
      value: list.name,
      validateInput: (v) => {
        if (!v.trim()) return 'Name cannot be empty';
        const other = c.model.findByName(v);
        return other && other.id !== list.id ? 'A changelist with this name exists' : undefined;
      },
    });
    if (!name) return;
    c.model.rename(list.id, name);
    await c.commitModel();
  });

  register(cmd('editComment'), async (arg) => {
    const r = await resolveList(arg, 'Changelist to edit');
    if (!r) return;
    const [c, list] = r;
    const description = await vscode.window.showInputBox({
      prompt: `Comment for "${list.name}" (default commit message)`,
      value: list.description,
    });
    if (description === undefined) return;
    c.model.setDescription(list.id, description);
    await c.commitModel();
  });

  register(cmd('delete'), async (arg) => {
    const r = await resolveList(arg, 'Changelist to delete', (l) => l.id !== 'default');
    if (!r) return;
    const [c, list] = r;
    if (c.model.isDefault(list.id)) {
      void vscode.window.showWarningMessage('Storm: the default changelist cannot be deleted.');
      return;
    }
    const n = c.entriesOf(list.id).length;
    const defaultName = c.model.get('default')?.name ?? 'Changes';
    const ok = await vscode.window.showWarningMessage(
      `Delete changelist "${list.name}"?`,
      { modal: true, detail: n ? `${n} file(s) will move to "${defaultName}". No files are changed on disk.` : undefined },
      'Delete',
    );
    if (ok !== 'Delete') return;
    c.model.remove(list.id);
    await c.commitModel();
  });

  register(cmd('setActive'), async (arg) => {
    const r = await resolveList(arg, 'Set active changelist');
    if (!r) return;
    const [c, list] = r;
    c.model.setActive(list.id);
    if (!c.sc.inputBox.value.trim() && list.description) c.sc.inputBox.value = list.description;
    await c.commitModel();
  });

  register(cmd('moveFiles'), async (...args) => {
    let uris = resourceUris(args);
    if (uris.length === 0) {
      const doc = vscode.window.activeTextEditor?.document;
      if (doc?.uri.scheme === 'file') uris = [doc.uri];
    }
    if (uris.length === 0) {
      void vscode.window.showInformationMessage('Storm: select changed files to move.');
      return;
    }
    const c = controllerForUri(uris[0]);
    if (!c) return;
    const paths = uris
      .filter((u) => controllerForUri(u) === c)
      .map((u) => toRepoPath(c.root, u.fsPath))
      .filter((p): p is string => p !== undefined && c.allEntries.some((e) => e.path === p));
    if (paths.length === 0) {
      void vscode.window.showInformationMessage('Storm: the selected file has no changes.');
      return;
    }
    const current = new Set(paths.map((p) => c.model.listOf(p)));
    const target = await pickList(
      c,
      `Move ${paths.length} file${paths.length === 1 ? '' : 's'} to changelist`,
      true,
      (l) => !(current.size === 1 && current.has(l.id)),
    );
    if (!target) return;
    c.model.assign(paths, target.id);
    await c.commitModel();
  });

  register(cmd('moveAll'), async (arg) => {
    const r = await resolveList(arg, 'Move all files from changelist');
    if (!r) return;
    const [c, from] = r;
    const paths = c.entriesOf(from.id).map((e) => e.path);
    if (paths.length === 0) {
      void vscode.window.showInformationMessage(`Storm: "${from.name}" is empty.`);
      return;
    }
    const target = await pickList(c, `Move all ${paths.length} files of "${from.name}" to`, true, (l) => l.id !== from.id);
    if (!target) return;
    c.model.assign(paths, target.id);
    await c.commitModel();
  });

  register(cmd('commit'), async (arg) => {
    const r = await resolveList(arg, 'Changelist to commit');
    if (r) await commitList(r[0], r[1], { fromInput: false, push: false });
  });

  register(cmd('commitAndPush'), async (arg) => {
    const r = await resolveList(arg, 'Changelist to commit and push');
    if (r) await commitList(r[0], r[1], { fromInput: false, push: true });
  });

  register(COMMIT_ACTIVE_COMMAND, async (arg) => {
    let c: RepoChangelists | undefined;
    if (typeof arg === 'string') c = controllers.get(arg);
    else if (typeof arg === 'object' && arg !== null && 'rootUri' in arg) {
      const rootUri = (arg as vscode.SourceControl).rootUri;
      c = rootUri ? controllers.get(rootUri.fsPath) : undefined;
    }
    c ??= await pickController();
    if (c) await commitList(c, c.model.active, { fromInput: true, push: false });
  });

  register(cmd('refresh'), async () => {
    await Promise.all([...controllers.values()].map((c) => c.refresh()));
  });

  register(OPEN_CHANGE_COMMAND, async (...args) => {
    const [uri] = resourceUris(args);
    if (!uri) return;
    const c = controllerForUri(uri);
    if (c) await c.openChange(uri);
    else await vscode.commands.executeCommand('vscode.open', uri);
  });

  register(cmd('openFile'), async (...args) => {
    for (const uri of resourceUris(args)) await vscode.commands.executeCommand('vscode.open', uri);
  });

  ctx.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(updateStatusBar),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('stormParity.changelists')) {
        updateStatusBar();
        controllers.forEach((c) => c.scheduleRefresh(0));
      }
    }),
  );
}
