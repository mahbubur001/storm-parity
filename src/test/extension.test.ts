import * as assert from 'assert';
import * as vscode from 'vscode';

suite('storm-parity', () => {
  test('hello command runs', async () => {
    const result = await vscode.commands.executeCommand('stormParity.hello.sayHello');
    assert.strictEqual(result, 'hello');
  });
});
