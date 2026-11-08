import * as vscode from 'vscode';
import { initMruStore, onDidChangeRecent, openTarget, recordCurrentProject, removeRecent } from '../openFolder/open';
import { openWithPrompt } from '../openFolder/prompt';
import { ProjectMetaStore, aliasOf, addGroup, deleteGroup, forgetProject, groupOf, moveToGroup, renameGroup, setAlias } from './store';
import { Node, RecentProjectsProvider } from './tree';
import { displayName } from '../openFolder/mru';

type ProjectNode = Extract<Node, { type: 'project' }>;
type GroupNode = Extract<Node, { type: 'group' }>;

const VIEW_ID = 'stormParity.recentProjects';

export function activate(ctx: vscode.ExtensionContext): void {
  initMruStore(ctx);
  void recordCurrentProject();
  const meta = new ProjectMetaStore(ctx.globalState);
  const provider = new RecentProjectsProvider(meta);
  const view = vscode.window.createTreeView(VIEW_ID, { treeDataProvider: provider, showCollapseAll: true });

  const selected = <T extends Node['type']>(type: T, node?: Node): Extract<Node, { type: T }> | undefined => {
    const n = node ?? view.selection[0];
    return n?.type === type ? (n as Extract<Node, { type: T }>) : undefined;
  };
  const projectUri = (node?: Node): vscode.Uri | undefined => {
    const p = selected('project', node);
    return p && vscode.Uri.parse(p.entry.uri);
  };

  const cmd = (name: string, fn: (node?: Node) => unknown) => vscode.commands.registerCommand(`stormParity.recentProjects.${name}`, fn);

  ctx.subscriptions.push(
    provider,
    view,
    meta.onDidChange(() => provider.refresh()),
    onDidChangeRecent(() => provider.refresh()),
    vscode.window.onDidChangeWindowState((s) => s.focused && provider.refresh()),
    vscode.workspace.onDidChangeWorkspaceFolders(() => provider.refresh()),

    cmd('refresh', () => provider.refresh()),

    cmd('open', async (node) => {
      const uri = projectUri(node);
      if (uri) await openWithPrompt(uri);
    }),

    cmd('openInNewWindow', async (node) => {
      const uri = projectUri(node);
      if (uri) await openTarget(uri, 'newWindow');
    }),

    cmd('openInThisWindow', async (node) => {
      const uri = projectUri(node);
      if (uri) await openTarget(uri, 'thisWindow');
    }),

    cmd('rename', async (node) => {
      const p = selected('project', node);
      if (!p) return;
      const alias = await vscode.window.showInputBox({
        title: 'Rename Project',
        prompt: `Display name for ${displayName(p.entry.uri)} (leave empty to reset)`,
        value: aliasOf(meta.get(), p.entry.uri) ?? displayName(p.entry.uri),
      });
      if (alias !== undefined) await meta.apply((m) => setAlias(m, p.entry.uri, alias === displayName(p.entry.uri) ? undefined : alias));
    }),

    cmd('remove', async (node) => {
      const p = selected('project', node);
      if (!p) return;
      await meta.apply((m) => forgetProject(m, p.entry.uri));
      await removeRecent(p.entry.uri);
    }),

    cmd('moveToGroup', async (node) => {
      const p: ProjectNode | undefined = selected('project', node);
      if (!p) return;
      const m = meta.get();
      const current = groupOf(m, p.entry.uri);
      const NEW = '$(add) New Group...';
      const NONE = '$(close) No Group';
      const choice = await vscode.window.showQuickPick([...m.groups.filter((g) => g !== current), NEW, ...(current ? [NONE] : [])], {
        title: `Move ${aliasOf(m, p.entry.uri) ?? displayName(p.entry.uri)} to Group`,
      });
      if (!choice) return;
      const group = choice === NEW ? await askGroupName('New Group') : choice === NONE ? undefined : choice;
      if (choice === NEW && !group) return;
      await meta.apply((x) => moveToGroup(x, p.entry.uri, group));
    }),

    cmd('newGroup', async () => {
      const name = await askGroupName('New Group');
      if (name) await meta.apply((m) => addGroup(m, name));
    }),

    cmd('renameGroup', async (node) => {
      const g: GroupNode | undefined = selected('group', node);
      if (!g) return;
      const name = await askGroupName('Rename Group', g.name);
      if (name) await meta.apply((m) => renameGroup(m, g.name, name));
    }),

    cmd('deleteGroup', async (node) => {
      const g = selected('group', node);
      if (!g) return;
      const ok = await vscode.window.showWarningMessage(`Delete group "${g.name}"? Its projects stay in the recent list.`, { modal: true }, 'Delete');
      if (ok === 'Delete') await meta.apply((m) => deleteGroup(m, g.name));
    }),

    cmd('revealInOS', async (node) => {
      const uri = projectUri(node);
      if (uri) await vscode.commands.executeCommand('revealFileInOS', uri);
    }),
  );

  async function askGroupName(title: string, value?: string): Promise<string | undefined> {
    const existing = meta.get().groups;
    const name = await vscode.window.showInputBox({
      title,
      value,
      prompt: 'Group name',
      validateInput: (v) => (!v.trim() ? 'Name is required' : v.trim() !== value && existing.includes(v.trim()) ? 'A group with this name already exists' : undefined),
    });
    return name?.trim() || undefined;
  }
}
