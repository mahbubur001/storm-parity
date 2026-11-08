import * as os from 'os';
import * as vscode from 'vscode';
import { ProjectMetaStore, aliasOf, groupOf } from '../recentProjects/store';
import { RecentEntry, WORKSPACE_EXT, displayName, kindOf, tildify } from './mru';
import { initMruStore, isCurrentProject, listRecent, openTarget, recordCurrentProject, removeRecent } from './open';
import { openWithPrompt } from './prompt';

export function activate(ctx: vscode.ExtensionContext): void {
  initMruStore(ctx);
  void recordCurrentProject();
  const meta = new ProjectMetaStore(ctx.globalState);

  ctx.subscriptions.push(
    vscode.commands.registerCommand('stormParity.openFolder.openFolder', openFolder),
    vscode.commands.registerCommand('stormParity.openFolder.openRecent', () => openRecent(meta)),
  );
}

async function openFolder(): Promise<void> {
  const current = vscode.workspace.workspaceFolders?.[0]?.uri;
  const picked = await vscode.window.showOpenDialog({
    title: 'Open Folder or Workspace',
    openLabel: 'Open',
    canSelectFolders: true,
    canSelectFiles: true,
    canSelectMany: false,
    filters: { 'Code Workspace': [WORKSPACE_EXT.slice(1)] },
    defaultUri: current ? vscode.Uri.joinPath(current, '..') : undefined,
  });
  const uri = picked?.[0];
  if (!uri) return;

  // A plain file slipped through the filter: just open it as a document.
  const stat = await vscode.workspace.fs.stat(uri);
  if (stat.type & vscode.FileType.File && kindOf(uri.path) !== 'workspace') {
    await vscode.window.showTextDocument(uri);
    return;
  }
  await openWithPrompt(uri);
}

interface RecentItem extends vscode.QuickPickItem {
  entry: RecentEntry;
}

const newWindowButton: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('empty-window'), tooltip: 'Open in New Window' };
const removeButton: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('close'), tooltip: 'Remove from Recent' };

function toItem(entry: RecentEntry, meta: ProjectMetaStore): RecentItem {
  const m = meta.get();
  const uri = vscode.Uri.parse(entry.uri);
  const where = uri.scheme === 'file' ? tildify(uri.fsPath, os.homedir()) : entry.uri;
  const group = groupOf(m, entry.uri);
  return {
    entry,
    label: `${kindOf(uri.path) === 'workspace' ? '$(folder-library)' : '$(folder)'} ${aliasOf(m, entry.uri) ?? entry.label ?? displayName(entry.uri)}`,
    description: group ? `[${group}]  ${where}` : where,
    buttons: [newWindowButton, removeButton],
  };
}

async function openRecent(meta: ProjectMetaStore): Promise<void> {
  const qp = vscode.window.createQuickPick<RecentItem>();
  qp.title = 'Open Recent Project';
  qp.placeholder = 'Type to filter recent folders and workspaces';
  qp.matchOnDescription = true;
  qp.busy = true;
  qp.show();

  const entries = (await listRecent()).filter((e) => !isCurrentProject(e.uri));
  qp.items = entries.map((e) => toItem(e, meta));
  qp.busy = false;

  qp.onDidTriggerItemButton(async ({ item, button }) => {
    if (button === newWindowButton) {
      qp.hide();
      await openTarget(vscode.Uri.parse(item.entry.uri), 'newWindow');
    } else if (button === removeButton) {
      qp.items = qp.items.filter((i) => i !== item);
      await removeRecent(item.entry.uri);
    }
  });
  qp.onDidAccept(async () => {
    const item = qp.selectedItems[0];
    qp.hide();
    if (item) await openWithPrompt(vscode.Uri.parse(item.entry.uri));
  });
  qp.onDidHide(() => qp.dispose());
}
