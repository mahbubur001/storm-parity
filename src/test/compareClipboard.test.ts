import * as assert from 'assert';
import * as vscode from 'vscode';
import { SCHEME } from '../features/compareClipboard';

suite('compareClipboard', () => {
  suiteSetup(async () => {
    await vscode.extensions.getExtension('itemcoder.storm-parity')?.activate();
  });

  test('command is registered', async () => {
    const all = await vscode.commands.getCommands(true);
    assert.ok(all.includes('stormParity.compareClipboard.compare'));
  });

  test('opens a diff whose left side holds the clipboard text', async () => {
    await vscode.env.clipboard.writeText('from clipboard');
    const doc = await vscode.workspace.openTextDocument({ content: 'alpha\nbeta', language: 'plaintext' });
    const editor = await vscode.window.showTextDocument(doc);
    editor.selection = new vscode.Selection(1, 0, 1, 4);
    await vscode.commands.executeCommand('stormParity.compareClipboard.compare');

    const virtual = vscode.workspace.textDocuments.filter((d) => d.uri.scheme === SCHEME);
    assert.ok(virtual.some((d) => d.uri.path.startsWith('/clipboard/') && d.getText() === 'from clipboard'));
    assert.ok(virtual.some((d) => d.uri.path.startsWith('/selection/') && d.getText() === 'beta'));
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    await vscode.window.showTextDocument(doc);
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
  });
});
