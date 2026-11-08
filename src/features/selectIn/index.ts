import * as path from 'path';
import * as vscode from 'vscode';

interface Target extends vscode.QuickPickItem {
  run: (uri: vscode.Uri) => Thenable<unknown> | void;
}

/** The file the user is looking at: the active editor, else the active tab (images, diffs, notebooks...). */
function currentUri(arg?: unknown): vscode.Uri | undefined {
  if (arg instanceof vscode.Uri) return arg;
  const editor = vscode.window.activeTextEditor?.document.uri;
  if (editor) return editor;
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  if (input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom || input instanceof vscode.TabInputNotebook) return input.uri;
  if (input instanceof vscode.TabInputTextDiff) return input.modified;
  return undefined;
}

/** New terminals go next to existing terminal tabs (Terminal Tabs Below), else to the default location. */
function terminalLocation(): vscode.TerminalOptions['location'] {
  const group = [...vscode.window.tabGroups.all].reverse().find((g) => g.tabs.some((t) => t.input instanceof vscode.TabInputTerminal));
  return group ? { viewColumn: group.viewColumn } : undefined;
}

/**
 * PhpStorm's Select In (Opt+F1): one popup to reveal the current file in the Explorer, Finder, a terminal at its
 * folder, Outline, Timeline or Source Control. Entries are numbered like PhpStorm's; typing the number selects one.
 */
export function activate(ctx: vscode.ExtensionContext): void {
  ctx.subscriptions.push(
    vscode.commands.registerCommand('stormParity.selectIn.show', async (arg?: unknown) => {
      const uri = currentUri(arg);
      if (!uri) {
        void vscode.window.showInformationMessage('Storm: open a file first.');
        return;
      }
      const isFile = uri.scheme === 'file';
      const inWorkspace = !!vscode.workspace.getWorkspaceFolder(uri);
      const os = process.platform === 'darwin' ? 'Finder' : process.platform === 'win32' ? 'File Explorer' : 'File Manager';
      const targets: Target[] = [
        ...(inWorkspace ? [{ label: '$(files) Project View', description: 'Explorer', run: (u: vscode.Uri) => vscode.commands.executeCommand('revealInExplorer', u) }] : []),
        ...(isFile ? [{ label: `$(folder-opened) ${os}`, run: (u: vscode.Uri) => vscode.commands.executeCommand('revealFileInOS', u) }] : []),
        ...(isFile
          ? [
              {
                label: '$(terminal) Terminal',
                description: 'new terminal in the file folder',
                run: (u: vscode.Uri) => vscode.window.createTerminal({ cwd: path.dirname(u.fsPath), location: terminalLocation() }).show(),
              },
            ]
          : []),
        { label: '$(symbol-class) File Structure', description: 'Outline', run: () => vscode.commands.executeCommand('outline.focus') },
        { label: '$(history) Timeline', description: 'local history and commits', run: () => vscode.commands.executeCommand('timeline.focus') },
        ...(inWorkspace ? [{ label: '$(source-control) Commit', description: 'Source Control', run: () => vscode.commands.executeCommand('workbench.view.scm') }] : []),
      ];
      targets.forEach((t, i) => (t.label = `${i + 1}. ${t.label}`));
      const pick = await vscode.window.showQuickPick(targets, { title: `Select In: ${path.basename(uri.path)}`, placeHolder: 'Reveal the file in...' });
      await pick?.run(uri);
    }),
  );
}
