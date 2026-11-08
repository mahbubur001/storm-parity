import * as assert from 'assert';
import * as vscode from 'vscode';

suite('selectIn', () => {
  suiteSetup(async () => {
    await vscode.extensions.getExtension('itemcoder.storm-parity')?.activate();
  });

  test('command is registered', async () => {
    assert.ok((await vscode.commands.getCommands(true)).includes('stormParity.selectIn.show'));
  });
});
