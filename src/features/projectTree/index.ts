import * as path from 'path';
import * as vscode from 'vscode';
import { classify } from './core';
import { initRootPath, isRootPathWorkspace, registerRootPathCommands } from './rootPath';

const COLOR = new vscode.ThemeColor('stormParity.projectTree.excludedForeground');

/**
 * PhpStorm-style project tree: excluded folders and library roots get their own colour in the Explorer, library roots
 * also an `L` badge. The API can't print text after a name, so PhpStorm's "library root" label lives in the tooltip.
 */
export function activate(ctx: vscode.ExtensionContext): void {
  initRootPath(ctx);
  registerRootPathCommands(ctx);
  void vscode.commands.executeCommand('setContext', 'stormParity.projectTree.rootPath', isRootPathWorkspace());
  const changed = new vscode.EventEmitter<undefined>();
  const list = (key: string) => vscode.workspace.getConfiguration('stormParity.projectTree').get<string[]>(key, []);

  const provider: vscode.FileDecorationProvider = {
    onDidChangeFileDecorations: changed.event,
    async provideFileDecoration(uri) {
      if (uri.scheme !== 'file') return undefined;
      const folder = vscode.workspace.getWorkspaceFolder(uri);
      if (!folder) return undefined;
      const rel = path.relative(folder.uri.fsPath, uri.fsPath).split(path.sep).join('/');
      const kind = classify(rel, list('libraryRoots'), list('excluded'));
      if (!kind) return undefined;
      try {
        if (!((await vscode.workspace.fs.stat(uri)).type & vscode.FileType.Directory)) return undefined;
      } catch {
        return undefined;
      }
      return kind === 'library'
        ? new vscode.FileDecoration('L', 'library root', COLOR)
        : new vscode.FileDecoration(undefined, 'excluded', COLOR);
    },
  };

  ctx.subscriptions.push(
    changed,
    vscode.window.registerFileDecorationProvider(provider),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('stormParity.projectTree')) changed.fire(undefined);
    }),
  );
}
