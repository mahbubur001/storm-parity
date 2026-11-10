import * as vscode from 'vscode';

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
}
