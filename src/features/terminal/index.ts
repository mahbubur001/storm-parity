import * as vscode from 'vscode';

const TABS_SETTING = 'tabs.enabled';

/**
 * PhpStorm-like terminal: shortcuts are plain keybindings to built-in commands (see contributes.json); this module
 * only adds the compact-tabs toggle, which hides VS Code's side tab list in favour of the title-bar dropdown.
 */
export function activate(ctx: vscode.ExtensionContext): void {
  ctx.subscriptions.push(
    vscode.commands.registerCommand('stormParity.terminal.toggleCompactTabs', async () => {
      const config = vscode.workspace.getConfiguration('terminal.integrated');
      const compact = config.get<boolean>(TABS_SETTING, true);
      await config.update(TABS_SETTING, !compact, vscode.ConfigurationTarget.Global);
      void vscode.window.setStatusBarMessage(compact ? 'Terminal: compact tabs (dropdown in the panel title)' : 'Terminal: tab list restored', 3000);
    }),
  );
}
