import * as path from 'path';
import * as vscode from 'vscode';
import { GitAPI, GitRepository, getGitApi } from '../../util/git';

/**
 * PhpStorm's main toolbar (project, branch, commit, run, search) as editor title actions. VS Code has no title bar
 * contribution point, so the buttons live in `editor/title` and only show while
 * `workbench.editor.editorActionsLocation` is `titleBar`, which moves editor actions into the title bar.
 */
export function activate(ctx: vscode.ExtensionContext): void {
  ctx.subscriptions.push(
    vscode.commands.registerCommand('stormParity.toolbar.checkout', async () => {
      try {
        await vscode.commands.executeCommand('git.checkout');
      } catch {
        void vscode.window.showWarningMessage('Checkout needs the built-in Git extension.');
      }
    }),
  );
  activateProjectWidget(ctx);
}

/**
 * PhpStorm's top-left project and branch widgets. The custom title bar always centres the window title and offers
 * extensions no left-hand slot, so they sit at the far left of the status bar instead.
 */
function activateProjectWidget(ctx: vscode.ExtensionContext): void {
  const project = vscode.window.createStatusBarItem('stormParity.toolbar.project', vscode.StatusBarAlignment.Left, 10000);
  project.name = 'Project';
  const branch = vscode.window.createStatusBarItem('stormParity.toolbar.branch', vscode.StatusBarAlignment.Left, 9999);
  branch.name = 'Branch';
  branch.tooltip = 'Checkout Branch...';
  branch.command = 'stormParity.toolbar.checkout';

  let api: GitAPI | undefined;
  const repoSubs = new Map<GitRepository, vscode.Disposable>();

  const render = (): void => {
    if (!vscode.workspace.getConfiguration('stormParity.toolbar').get<boolean>('showStatusBarProject', true)) {
      project.hide();
      branch.hide();
      return;
    }
    const name = projectName();
    if (name) {
      const recent = vscode.workspace.getConfiguration('stormParity.openFolder').get<boolean>('enabled', true);
      project.text = `$(folder) ${name}`;
      project.tooltip = 'Recent Projects';
      project.command = recent ? 'stormParity.openFolder.openRecent' : 'workbench.action.openRecent';
      project.show();
    } else {
      project.hide();
    }
    const head = api && currentRepo(api)?.state.HEAD;
    const label = head?.name ?? head?.commit?.slice(0, 8);
    if (label) {
      branch.text = `$(git-branch) ${label}`;
      branch.show();
    } else {
      branch.hide();
    }
  };

  const watch = (repo: GitRepository): void => {
    repoSubs.set(repo, repo.state.onDidChange(render));
    render();
  };
  const unwatch = (repo: GitRepository): void => {
    repoSubs.get(repo)?.dispose();
    repoSubs.delete(repo);
    render();
  };

  void getGitApi().then((gitApi) => {
    if (!gitApi) return;
    api = gitApi;
    gitApi.repositories.forEach(watch);
    ctx.subscriptions.push(gitApi.onDidOpenRepository(watch), gitApi.onDidCloseRepository(unwatch));
  });

  ctx.subscriptions.push(
    project,
    branch,
    { dispose: () => repoSubs.forEach((d) => d.dispose()) },
    vscode.window.onDidChangeActiveTextEditor(render),
    vscode.workspace.onDidChangeWorkspaceFolders(render),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('stormParity.toolbar.showStatusBarProject') || e.affectsConfiguration('stormParity.openFolder.enabled')) render();
    }),
  );
  render();
}

/** The folder name for a single-folder window (also when opened as a one-folder workspace), else the workspace name. */
function projectName(): string | undefined {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 1) return folders[0].name;
  return vscode.workspace.name?.replace(/ \(Workspace\)$/, '');
}

/** The repository of the active file, else of the first workspace folder, else the first one open. */
function currentRepo(api: GitAPI): GitRepository | undefined {
  const repos = api.repositories;
  const containing = (uri: vscode.Uri | undefined): GitRepository | undefined => {
    if (!uri || uri.scheme !== 'file') return undefined;
    // Deepest root wins so a nested repository beats its parent.
    return repos
      .filter((r) => isInside(uri.fsPath, r.rootUri.fsPath))
      .sort((a, b) => b.rootUri.fsPath.length - a.rootUri.fsPath.length)[0];
  };
  return (
    containing(vscode.window.activeTextEditor?.document.uri) ??
    containing(vscode.workspace.workspaceFolders?.[0]?.uri) ??
    repos[0]
  );
}

function isInside(file: string, root: string): boolean {
  const rel = path.relative(root, file);
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}
