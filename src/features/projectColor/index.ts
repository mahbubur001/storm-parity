import * as vscode from 'vscode';
import { colorKeys, mergeColors, normalizeHex, PALETTE } from './core';

const KEYS_STATE = 'stormParity.projectColor.keys';
const COLOR_STATE = 'stormParity.projectColor.color';

interface ColorPick extends vscode.QuickPickItem {
  hex?: string;
  action?: 'custom' | 'reset';
}

/**
 * PhpStorm-style project colour: tints this window's title bar (optionally the status bar) so windows of different
 * projects are told apart at a glance. VS Code only applies colours through `workbench.colorCustomizations`, so this
 * writes the workspace settings, but only on request and only its own keys, which Reset removes again.
 */
export function activate(ctx: vscode.ExtensionContext): void {
  const workbench = () => vscode.workspace.getConfiguration('workbench');
  const ownKeys = () => ctx.workspaceState.get<string[]>(KEYS_STATE, []);

  const apply = async (hex: string | undefined) => {
    const statusBar = vscode.workspace.getConfiguration('stormParity.projectColor').get<boolean>('statusBar', false);
    const ours = hex ? colorKeys(hex, statusBar) : {};
    const existing = workbench().inspect<Record<string, unknown>>('colorCustomizations')?.workspaceValue;
    await workbench().update('colorCustomizations', mergeColors(existing, ownKeys(), ours), vscode.ConfigurationTarget.Workspace);
    await ctx.workspaceState.update(KEYS_STATE, Object.keys(ours));
    await ctx.workspaceState.update(COLOR_STATE, hex);
  };

  const needsFolder = () => {
    if (vscode.workspace.workspaceFolders?.length) return false;
    void vscode.window.showInformationMessage('Storm: open a folder first; the project colour is saved in its workspace settings.');
    return true;
  };

  ctx.subscriptions.push(
    vscode.commands.registerCommand('stormParity.projectColor.set', async () => {
      if (needsFolder()) return;
      const current = ctx.workspaceState.get<string>(COLOR_STATE);
      const items: ColorPick[] = [
        ...PALETTE.map((c): ColorPick => ({ label: `${c.hex === current ? '$(check)' : '$(circle-filled)'} ${c.name}`, description: c.hex, hex: c.hex })),
        { label: '', kind: vscode.QuickPickItemKind.Separator },
        { label: '$(edit) Custom...', description: 'any #RRGGBB', action: 'custom' },
        ...(current ? [{ label: '$(discard) Reset', description: 'remove the project colour', action: 'reset' as const }] : []),
      ];
      const pick = await vscode.window.showQuickPick(items, { title: 'Project Color', placeHolder: 'Color for this project window' });
      if (!pick) return;
      if (pick.action === 'reset') return apply(undefined);
      let hex = pick.hex;
      if (pick.action === 'custom') {
        const input = await vscode.window.showInputBox({
          title: 'Project Color',
          prompt: 'Hex colour, e.g. #3574F0',
          value: current ?? '',
          validateInput: (v) => (normalizeHex(v) ? undefined : 'Use #RGB or #RRGGBB'),
        });
        hex = input === undefined ? undefined : normalizeHex(input);
      }
      if (hex) await apply(hex);
    }),
    vscode.commands.registerCommand('stormParity.projectColor.reset', async () => {
      if (!needsFolder()) await apply(undefined);
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      const color = ctx.workspaceState.get<string>(COLOR_STATE);
      if (color && e.affectsConfiguration('stormParity.projectColor.statusBar')) void apply(color);
    }),
  );
}
