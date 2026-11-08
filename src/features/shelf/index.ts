import * as vscode from 'vscode';
import * as path from 'path';
import { existsSync } from 'fs';
import {
  GitAPI,
  StatusEntry,
  changeKind,
  findRepository,
  getGitApi,
  getStatus,
  repoHash,
  statusLetter,
  toRepoPath,
} from '../../util/git';
import { applyPatch, createPatch, revertEntries, undoIntentToAdd } from './ops';
import { ShelfEntry, ShelfStore, newShelfId } from './store';
import { ShelfNode, ShelfTreeProvider } from './tree';

const cmd = (action: string): string => `stormParity.shelf.${action}`;
const PATCH_SCHEME = 'storm-shelf';
const ASSIGN_TO_CHANGELIST = 'stormParity.changelists.assignFiles';

export function activate(ctx: vscode.ExtensionContext): void {
  const store = new ShelfStore(vscode.Uri.joinPath(ctx.globalStorageUri, 'shelf').fsPath);
  let api: GitAPI | undefined;
  const tree = new ShelfTreeProvider(store, () => api?.repositories.map((r) => r.rootUri.fsPath) ?? []);
  const view = vscode.window.createTreeView('stormParity.shelf', { treeDataProvider: tree, showCollapseAll: true });
  ctx.subscriptions.push(view, tree);

  void getGitApi().then((gitApi) => {
    if (!gitApi) return;
    api = gitApi;
    tree.refresh();
    ctx.subscriptions.push(
      gitApi.onDidOpenRepository(() => tree.refresh()),
      gitApi.onDidCloseRepository(() => tree.refresh()),
    );
  });

  // Read-only patch documents: storm-shelf:/<name>.patch?<id>
  const patchContent = new (class implements vscode.TextDocumentContentProvider {
    async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
      const entry = await store.get(uri.query);
      return entry ? (await store.readPatch(entry)).toString('utf8') : '';
    }
  })();
  ctx.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(PATCH_SCHEME, patchContent));

  const config = () => vscode.workspace.getConfiguration('stormParity.shelf');

  const run = (fn: () => Promise<void>): Promise<void> =>
    fn().catch((err: unknown) => {
      void vscode.window.showErrorMessage(`Storm: ${err instanceof Error ? err.message : String(err)}`);
    });

  const register = (id: string, fn: (...args: unknown[]) => Promise<void>) =>
    ctx.subscriptions.push(vscode.commands.registerCommand(id, (...args: unknown[]) => run(() => fn(...args))));

  const requireApi = (): GitAPI => {
    if (!api) throw new Error('the git extension is not available.');
    return api;
  };

  // ---------------------------------------------------------------------------
  // Shelve
  // ---------------------------------------------------------------------------

  /** Asks for a name, confirms, writes the patch and only then reverts the shelved files. */
  const shelve = async (root: string, selected: readonly string[], defaultName: string, changelist?: string): Promise<void> => {
    const wanted = new Set(selected);
    const entries = (await getStatus(root)).filter((e) => wanted.has(e.path));
    if (entries.length === 0) {
      void vscode.window.showInformationMessage('Storm: nothing to shelve.');
      return;
    }
    const name = await vscode.window.showInputBox({
      title: `Shelve ${entries.length} file${entries.length === 1 ? '' : 's'}`,
      prompt: 'Shelf name',
      value: defaultName,
      validateInput: (v) => (v.trim() ? undefined : 'Name cannot be empty'),
    });
    if (!name?.trim()) return;
    const shown = entries.slice(0, 15).map((e) => `${statusLetter(changeKind(e))}  ${e.path}`);
    if (entries.length > shown.length) shown.push(`... and ${entries.length - shown.length} more`);
    const ok = await vscode.window.showWarningMessage(
      `Shelve ${entries.length} file${entries.length === 1 ? '' : 's'} as "${name.trim()}"?`,
      {
        modal: true,
        detail: `The changes are saved to the shelf and these files are reverted to HEAD (new files are deleted):\n\n${shown.join('\n')}`,
      },
      'Shelve',
    );
    if (ok !== 'Shelve') return;

    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Storm: shelving...' }, async () => {
      const patch = await createPatch(root, entries);
      const entry: ShelfEntry = {
        id: newShelfId(),
        name: name.trim(),
        date: new Date().toISOString(),
        repoRoot: root,
        repoHash: repoHash(root),
        files: entries.map((e) => ({ path: e.path, status: statusLetter(changeKind(e)) })),
        changelist,
      };
      try {
        await store.add(entry, patch);
      } catch (err) {
        await undoIntentToAdd(
          root,
          entries.filter((e) => changeKind(e) === 'untracked').map((e) => e.path),
        );
        throw err;
      }
      tree.refresh();
      try {
        await revertEntries(root, entries);
      } catch (err) {
        throw new Error(`shelved "${entry.name}" but reverting failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
    void vscode.window.showInformationMessage(`Storm: shelved ${entries.length} file(s) as "${name.trim()}".`);
  };

  const groupFrom = (v: unknown): vscode.SourceControlResourceGroup | undefined =>
    typeof v === 'object' && v !== null && 'resourceStates' in v && 'label' in v ? (v as vscode.SourceControlResourceGroup) : undefined;

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

  /** Shelves the given file URIs; they must all live in one repository. */
  const shelveUris = async (uris: vscode.Uri[], defaultName: string, changelist?: string): Promise<void> => {
    const gitApi = requireApi();
    if (uris.length === 0) {
      void vscode.window.showInformationMessage('Storm: nothing to shelve.');
      return;
    }
    const repo = findRepository(gitApi, uris[0]);
    if (!repo) throw new Error('the selected files are not in a git repository.');
    const root = repo.rootUri.fsPath;
    const paths = uris.map((u) => toRepoPath(root, u.fsPath)).filter((p): p is string => p !== undefined);
    await shelve(root, paths, defaultName, changelist);
  };

  const defaultShelfName = (): string => `Shelved changes ${new Date().toLocaleString()}`;

  register(cmd('shelveChangelist'), async (arg) => {
    const group = groupFrom(arg);
    if (!group) {
      await vscode.commands.executeCommand(cmd('shelve'));
      return;
    }
    const listName = group.label.replace(/ \(active\)$/, '');
    await shelveUris(resourceUris([group.resourceStates]), listName, listName);
  });

  register(cmd('shelveFiles'), async (...args) => {
    await shelveUris(resourceUris(args), defaultShelfName());
  });

  register(cmd('shelve'), async () => {
    const gitApi = requireApi();
    const repos = gitApi.repositories;
    if (repos.length === 0) throw new Error('no git repository is open.');
    let root = repos[0].rootUri.fsPath;
    if (repos.length > 1) {
      const active = vscode.window.activeTextEditor?.document.uri;
      const current = active ? findRepository(gitApi, active) : undefined;
      const picked = await vscode.window.showQuickPick(
        repos
          .map((r) => ({ label: path.basename(r.rootUri.fsPath), description: r.rootUri.fsPath, root: r.rootUri.fsPath }))
          .sort((a, b) => (a.root === current?.rootUri.fsPath ? -1 : b.root === current?.rootUri.fsPath ? 1 : 0)),
        { placeHolder: 'Repository to shelve changes from' },
      );
      if (!picked) return;
      root = picked.root;
    }
    const entries = await getStatus(root);
    if (entries.length === 0) {
      void vscode.window.showInformationMessage('Storm: no changes to shelve.');
      return;
    }
    const picked = await vscode.window.showQuickPick(
      entries.map((e: StatusEntry) => ({
        label: path.basename(e.path),
        description: `${statusLetter(changeKind(e))}  ${path.dirname(e.path) === '.' ? '' : path.dirname(e.path)}`,
        picked: true,
        path: e.path,
      })),
      { canPickMany: true, placeHolder: 'Files to shelve', matchOnDescription: true },
    );
    if (!picked?.length) return;
    await shelve(root, picked.map((p) => p.path), defaultShelfName());
  });

  // ---------------------------------------------------------------------------
  // Shelf view actions
  // ---------------------------------------------------------------------------

  const entryFrom = async (arg: unknown): Promise<ShelfEntry | undefined> => {
    const node = arg as ShelfNode | undefined;
    if (node && typeof node === 'object' && 'entry' in node) return node.entry;
    const selected = view.selection[0];
    if (selected) return selected.entry;
    const entries = await tree.visibleEntries();
    if (entries.length === 0) {
      void vscode.window.showInformationMessage('Storm: the shelf is empty.');
      return undefined;
    }
    const picked = await vscode.window.showQuickPick(
      entries.map((e) => ({ label: e.name, description: new Date(e.date).toLocaleString(), detail: `${e.files.length} file(s) in ${e.repoRoot}`, e })),
      { placeHolder: 'Select shelved changes' },
    );
    return picked?.e;
  };

  const unshelve = async (entry: ShelfEntry, silent: boolean): Promise<void> => {
    if (!existsSync(entry.repoRoot)) throw new Error(`repository ${entry.repoRoot} no longer exists.`);
    let remove = config().get<boolean>('removeAfterUnshelve', true);
    if (!silent) {
      const options = [
        { label: 'Unshelve and Remove from Shelf', remove: true },
        { label: 'Unshelve and Keep in Shelf', remove: false },
      ];
      if (!remove) options.reverse();
      const choice = await vscode.window.showQuickPick(options,
        { placeHolder: `Unshelve "${entry.name}" (${entry.files.length} files)` },
      );
      if (!choice) return;
      remove = choice.remove;
    }
    const result = await applyPatch(entry.repoRoot, store.patchPath(entry));
    if (entry.changelist) {
      const paths = entry.files.map((f) => f.path);
      await Promise.resolve(vscode.commands.executeCommand(ASSIGN_TO_CHANGELIST, entry.repoRoot, paths, entry.changelist)).catch(
        () => undefined,
      );
    }
    if (result.conflicts) {
      void vscode.window.showWarningMessage(
        `Storm: "${entry.name}" was applied with conflicts. Resolve them in the Source Control view; the shelf entry was kept.`,
      );
      return;
    }
    if (remove) await store.remove(entry.id);
    tree.refresh();
    if (!silent || result.threeWay) {
      void vscode.window.showInformationMessage(`Storm: unshelved "${entry.name}"${result.threeWay ? ' (3-way merge)' : ''}.`);
    }
  };

  register(cmd('unshelve'), async (arg) => {
    const entry = await entryFrom(arg);
    if (entry) await unshelve(entry, false);
  });

  register(cmd('unshelveSilently'), async (arg) => {
    const entry = await entryFrom(arg);
    if (entry) await unshelve(entry, true);
  });

  register(cmd('delete'), async (arg) => {
    const entry = await entryFrom(arg);
    if (!entry) return;
    const ok = await vscode.window.showWarningMessage(
      `Delete shelved changes "${entry.name}"?`,
      { modal: true, detail: `${entry.files.length} file(s). The patch is removed permanently.` },
      'Delete',
    );
    if (ok !== 'Delete') return;
    await store.remove(entry.id);
    tree.refresh();
  });

  register(cmd('rename'), async (arg) => {
    const entry = await entryFrom(arg);
    if (!entry) return;
    const name = await vscode.window.showInputBox({
      prompt: 'Rename shelved changes',
      value: entry.name,
      validateInput: (v) => (v.trim() ? undefined : 'Name cannot be empty'),
    });
    if (!name?.trim()) return;
    await store.rename(entry.id, name.trim());
    tree.refresh();
  });

  register(cmd('showPatch'), async (arg) => {
    const entry = await entryFrom(arg);
    if (!entry) return;
    const safeName = entry.name.replace(/[\\/:*?"<>|#?]+/g, '_') || 'shelf';
    const uri = vscode.Uri.from({ scheme: PATCH_SCHEME, path: `/${safeName}.patch`, query: entry.id });
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.languages.setTextDocumentLanguage(doc, 'diff');
    await vscode.window.showTextDocument(doc, { preview: true });
  });

  register(cmd('refresh'), async () => tree.refresh());
}
