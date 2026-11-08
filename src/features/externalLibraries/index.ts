import { promises as fs } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { isDirectory, parsePhpStormIncludePaths, resolveInput } from './core';
import { LibraryStore, SECTION } from './store';
import { LibraryTree } from './tree';

const VIEW_ID = 'stormParity.externalLibraries';
const CMD = 'stormParity.externalLibraries';
const LEGACY_EXTENSION_ID = 'itemcoder.iextlibraries';

/** PhpStorm's .idea/php.xml in each workspace folder that has one. */
async function phpStormConfigs(): Promise<{ folder: vscode.WorkspaceFolder; file: string }[]> {
  const found: { folder: vscode.WorkspaceFolder; file: string }[] = [];
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const file = path.join(folder.uri.fsPath, '.idea', 'php.xml');
    if (await fs.access(file).then(() => true, () => false)) found.push({ folder, file });
  }
  return found;
}

async function addPaths(store: LibraryStore, paths: readonly string[]): Promise<void> {
  const added = await store.add(paths);
  if (added === 0) void vscode.window.showInformationMessage('Already in External Libraries.');
  else await vscode.commands.executeCommand(`${VIEW_ID}.focus`);
}

async function addLibrary(store: LibraryStore): Promise<void> {
  if (!vscode.workspace.workspaceFolders?.length) {
    void vscode.window.showErrorMessage('Open a folder first: external libraries belong to a workspace.');
    return;
  }
  const choice = await vscode.window.showQuickPick(
    [
      { label: '$(folder-opened) Choose Folders...', description: 'pick one or more folders', pick: 'browse' as const },
      { label: '$(edit) Enter a Path...', description: 'absolute, ~/..., or relative to the workspace', pick: 'path' as const },
    ],
    { title: 'Add External Library', placeHolder: 'Folders outside the project to index for completion and navigation' },
  );
  if (!choice) return;
  if (choice.pick === 'browse') {
    const uris = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: true, openLabel: 'Add to External Libraries' });
    if (uris?.length) await addPaths(store, uris.map((u) => u.fsPath));
    return;
  }
  const input = await vscode.window.showInputBox({
    title: 'Add External Library',
    prompt: 'Folder path',
    placeHolder: '~/code/wordpress',
    ignoreFocusOut: true,
    validateInput: async (value) => (!value.trim() || (await isDirectory(resolveInput(value, store.base))) ? undefined : 'No folder at this path.'),
  });
  if (input?.trim()) await addPaths(store, [resolveInput(input, store.base)]);
}

async function importPhpStorm(store: LibraryStore): Promise<void> {
  const configs = await phpStormConfigs();
  const lists = await Promise.all(
    configs.map(({ folder, file }) =>
      fs.readFile(file, 'utf8').then(
        (xml) => parsePhpStormIncludePaths(xml, folder.uri.fsPath),
        () => [],
      ),
    ),
  );
  const all = lists.flat();
  if (all.length === 0) {
    void vscode.window.showInformationMessage(configs.length ? 'No include paths in .idea/php.xml.' : 'No PhpStorm project (.idea/php.xml) in this workspace.');
    return;
  }
  const added = await store.add(all);
  void vscode.window.showInformationMessage(
    added ? `Imported ${added} include path${added === 1 ? '' : 's'} from PhpStorm.` : 'All PhpStorm include paths are already in External Libraries.',
  );
}

/** Library node passed by a view context menu, or the user picks one. */
async function pickLibrary(store: LibraryStore, node: { path: string } | undefined): Promise<string | undefined> {
  if (node) return node.path;
  const items = store.libraries.map((l) => ({ label: path.basename(l.path), description: l.stored, path: l.path }));
  if (items.length === 0) return undefined;
  return (await vscode.window.showQuickPick(items, { title: 'Remove External Library' }))?.path;
}

/**
 * The standalone iExternal Libraries extension would show a second view and fight over Intelephense's include
 * paths, so while it is installed this feature stays off and offers to uninstall it.
 */
async function offerLegacyUninstall(): Promise<void> {
  const choice = await vscode.window.showInformationMessage(
    'iExternal Libraries is now part of Storm Parity. Uninstall the old extension to switch over; your include paths carry over automatically.',
    'Uninstall iExternal Libraries',
  );
  if (choice !== 'Uninstall iExternal Libraries') return;
  await vscode.commands.executeCommand('workbench.extensions.uninstallExtension', LEGACY_EXTENSION_ID);
  const reload = await vscode.window.showInformationMessage('Reload the window to finish switching to Storm Parity External Libraries.', 'Reload');
  if (reload === 'Reload') await vscode.commands.executeCommand('workbench.action.reloadWindow');
}

export function activate(ctx: vscode.ExtensionContext): { store: LibraryStore; tree: LibraryTree } | undefined {
  if (vscode.extensions.getExtension(LEGACY_EXTENSION_ID)) {
    void vscode.commands.executeCommand('setContext', `${CMD}.legacyInstalled`, true);
    void offerLegacyUninstall();
    return undefined;
  }

  const store = new LibraryStore(ctx.workspaceState);
  const tree = new LibraryTree(store);
  const view = vscode.window.createTreeView(VIEW_ID, { treeDataProvider: tree, showCollapseAll: true });

  const updateContext = async () => {
    await vscode.commands.executeCommand('setContext', `${CMD}.hasPhpStormProject`, (await phpStormConfigs()).length > 0);
  };

  ctx.subscriptions.push(
    store,
    tree,
    view,
    vscode.workspace.onDidChangeWorkspaceFolders(() => void updateContext()),
    vscode.commands.registerCommand(`${CMD}.add`, () => addLibrary(store)),
    vscode.commands.registerCommand(`${CMD}.importPhpStorm`, () => importPhpStorm(store)),
    vscode.commands.registerCommand(`${CMD}.refresh`, () => tree.refresh()),
    vscode.commands.registerCommand(`${CMD}.configure`, () => vscode.commands.executeCommand('workbench.action.openWorkspaceSettings', SECTION)),
    vscode.commands.registerCommand(`${CMD}.remove`, async (node?: { path: string }) => {
      const target = await pickLibrary(store, node);
      if (target) await store.remove(target);
    }),
    vscode.commands.registerCommand(`${CMD}.revealInOS`, (node: { path: string }) => vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(node.path))),
    vscode.commands.registerCommand(`${CMD}.copyPath`, (node: { path: string }) => vscode.env.clipboard.writeText(node.path)),
  );
  void updateContext();
  // Other features (Scratches) show inside this view instead of their own while it is available.
  void vscode.commands.executeCommand('setContext', `${CMD}.active`, true);
  void store.syncIntelephense();
  return { store, tree };
}
