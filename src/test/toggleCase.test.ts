import * as assert from 'assert';
import * as vscode from 'vscode';
import { convertCase, cycleCase, detectCase, splitWords, toggleUpperLower } from '../features/toggleCase/caseConvert';

suite('toggleCase: splitWords', () => {
  const cases: Array<[string, string[]]> = [
    ['fooBarBaz', ['foo', 'Bar', 'Baz']],
    ['FooBar', ['Foo', 'Bar']],
    ['foo_bar_baz', ['foo', 'bar', 'baz']],
    ['foo-bar', ['foo', 'bar']],
    ['FOO_BAR', ['FOO', 'BAR']],
    ['XMLHttpRequest', ['XML', 'Http', 'Request']],
    ['getHTTPServer', ['get', 'HTTP', 'Server']],
    ['base64Encode', ['base64', 'Encode']],
    ['foo bar.baz', ['foo', 'bar', 'baz']],
    ['__a__b__', ['a', 'b']],
    ['', []],
  ];
  for (const [input, expected] of cases) {
    test(JSON.stringify(input), () => assert.deepStrictEqual(splitWords(input), expected));
  }
});

suite('toggleCase: convertCase', () => {
  test('all styles from camel', () => {
    assert.strictEqual(convertCase('userIdValue', 'snake'), 'user_id_value');
    assert.strictEqual(convertCase('userIdValue', 'kebab'), 'user-id-value');
    assert.strictEqual(convertCase('userIdValue', 'pascal'), 'UserIdValue');
    assert.strictEqual(convertCase('userIdValue', 'screamingSnake'), 'USER_ID_VALUE');
    assert.strictEqual(convertCase('USER_ID_VALUE', 'camel'), 'userIdValue');
  });
  test('acronyms are normalised', () => {
    assert.strictEqual(convertCase('XMLHttpRequest', 'camel'), 'xmlHttpRequest');
    assert.strictEqual(convertCase('XMLHttpRequest', 'snake'), 'xml_http_request');
  });
  test('keeps leading and trailing punctuation', () => {
    assert.strictEqual(convertCase('$userName', 'snake'), '$user_name');
    assert.strictEqual(convertCase('_private_thing_', 'camel'), '_privateThing_');
  });
  test('non-word text is untouched', () => {
    assert.strictEqual(convertCase('---', 'camel'), '---');
  });
});

suite('toggleCase: detect and cycle', () => {
  test('detectCase', () => {
    assert.strictEqual(detectCase('fooBar'), 'camel');
    assert.strictEqual(detectCase('foo_bar'), 'snake');
    assert.strictEqual(detectCase('foo-bar'), 'kebab');
    assert.strictEqual(detectCase('FooBar'), 'pascal');
    assert.strictEqual(detectCase('FOO_BAR'), 'screamingSnake');
    assert.strictEqual(detectCase('foo bar'), undefined);
  });
  test('full cycle returns to the start', () => {
    const seen: string[] = [];
    let cur = 'fooBarBaz';
    for (let i = 0; i < 5; i++) {
      cur = cycleCase(cur);
      seen.push(cur);
    }
    assert.deepStrictEqual(seen, ['foo_bar_baz', 'foo-bar-baz', 'FooBarBaz', 'FOO_BAR_BAZ', 'fooBarBaz']);
  });
  test('single word skips no-op styles', () => {
    assert.strictEqual(cycleCase('foo'), 'Foo');
    assert.strictEqual(cycleCase('Foo'), 'FOO');
  });
  test('toggleUpperLower', () => {
    assert.strictEqual(toggleUpperLower('Hello'), 'HELLO');
    assert.strictEqual(toggleUpperLower('HELLO'), 'hello');
    assert.strictEqual(toggleUpperLower('123'), '123');
  });
});

suite('toggleCase: commands', () => {
  suiteSetup(async () => {
    await vscode.extensions.getExtension('itemcoder.storm-parity')?.activate();
  });

  test('commands are registered', async () => {
    const all = await vscode.commands.getCommands(true);
    for (const id of ['toggleCase', 'cycleCase', 'toCamelCase', 'toSnakeCase', 'toKebabCase', 'toPascalCase', 'toScreamingSnakeCase']) {
      assert.ok(all.includes(`stormParity.toggleCase.${id}`), id);
    }
  });

  test('toggleCase works on the word under each cursor', async () => {
    const doc = await vscode.workspace.openTextDocument({ content: 'alpha beta', language: 'plaintext' });
    const editor = await vscode.window.showTextDocument(doc);
    editor.selections = [new vscode.Selection(0, 1, 0, 1), new vscode.Selection(0, 8, 0, 8)];
    await vscode.commands.executeCommand('stormParity.toggleCase.toggleCase');
    assert.strictEqual(doc.getText(), 'ALPHA BETA');
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
  });

  test('cycleCase converts the selection', async () => {
    const doc = await vscode.workspace.openTextDocument({ content: 'myVar', language: 'plaintext' });
    const editor = await vscode.window.showTextDocument(doc);
    editor.selection = new vscode.Selection(0, 0, 0, 5);
    await vscode.commands.executeCommand('stormParity.toggleCase.cycleCase');
    assert.strictEqual(doc.getText(), 'my_var');
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
  });
});
