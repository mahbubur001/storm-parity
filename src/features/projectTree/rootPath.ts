// PhpStorm shows "name ~/path" on the project root. A single-folder window has no root row, so this opens the folder
// as a one-folder workspace whose folder name carries the path. The .code-workspace file lives in global storage.
import * as crypto from 'crypto';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { tildify } from '../openFolder/mru';

let storage: vscode.Uri | undefined;

export function initRootPath(ctx: vscode.ExtensionContext): void {
  storage = vscode.Uri.joinPath(ctx.globalStorageUri, 'rootPath');
}

export const rootLabel = (fsPath: string, home = os.homedir()): string => `${path.basename(fsPath)} ${tildify(fsPath, home)}`;

/** True when the window runs a workspace file written by `rootPathWorkspace`. */
export function isRootPathWorkspace(): boolean {
  const file = vscode.workspace.workspaceFile;
  return !!storage && file?.scheme === 'file' && file.fsPath.startsWith(storage.fsPath + path.sep);
}

/** Writes (or refreshes) the workspace file for a local folder, keeping any settings stored in it. */
export async function rootPathWorkspace(folder: vscode.Uri): Promise<vscode.Uri | undefined> {
  if (!storage || folder.scheme !== 'file') return undefined;
  const hash = crypto.createHash('sha1').update(folder.fsPath).digest('hex').slice(0, 10);
  const file = vscode.Uri.joinPath(storage, hash, `${path.basename(folder.fsPath)}.code-workspace`);
  let settings: unknown = {};
  try {
    settings = JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(file)).toString('utf8')).settings ?? {};
  } catch {
    // new file, or one VS Code rewrote with comments: start with empty settings
  }
  const ws = { folders: [{ name: rootLabel(folder.fsPath), path: folder.fsPath }], settings };
  await vscode.workspace.fs.writeFile(file, Buffer.from(JSON.stringify(ws, null, 2) + '\n'));
  return file;
}

/** What Storm's Open Folder should open for `folder`: the root-path workspace when the setting is on. */
export async function openTargetFor(folder: vscode.Uri): Promise<vscode.Uri> {
  const on = vscode.workspace.getConfiguration('stormParity.projectTree').get<boolean>('openWithRootPath', false);
  return (on && (await rootPathWorkspace(folder))) || folder;
}

export function registerRootPathCommands(ctx: vscode.ExtensionContext): void {
  const open = (uri: vscode.Uri) => vscode.commands.executeCommand('vscode.openFolder', uri, { forceReuseWindow: true });
  ctx.subscriptions.push(
    vscode.commands.registerCommand('stormParity.projectTree.showRootPath', async () => {
      if (isRootPathWorkspace()) return;
      const folders = vscode.workspace.workspaceFolders ?? [];
      if (vscode.workspace.workspaceFile || folders.length !== 1) {
        void vscode.window.showInformationMessage('Storm: the project path can be shown for a single open folder only.');
        return;
      }
      const file = await rootPathWorkspace(folders[0].uri);
      if (file) await open(file);
      else void vscode.window.showInformationMessage('Storm: the project path can be shown for local folders only.');
    }),
    vscode.commands.registerCommand('stormParity.projectTree.hideRootPath', async () => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (isRootPathWorkspace() && folder) await open(folder.uri);
    }),
  );
}
