import * as assert from 'assert';
import * as vscode from 'vscode';

suite('terminal', () => {
  test('toggleCompactTabs flips terminal.integrated.tabs.enabled', async () => {
    await vscode.extensions.getExtension('itemcoder.storm-parity')?.activate();
    const config = () => vscode.workspace.getConfiguration('terminal.integrated');
    const before = config().get<boolean>('tabs.enabled', true);
    try {
      await vscode.commands.executeCommand('stormParity.terminal.toggleCompactTabs');
      assert.strictEqual(config().get<boolean>('tabs.enabled'), !before);
      await vscode.commands.executeCommand('stormParity.terminal.toggleCompactTabs');
      assert.strictEqual(config().get<boolean>('tabs.enabled'), before);
    } finally {
      await config().update('tabs.enabled', undefined, vscode.ConfigurationTarget.Global);
    }
  });
});
