import * as assert from 'assert';
import * as vscode from 'vscode';
import { escapeSnippet, expand, findPostfix, templatesFor, TEMPLATES } from '../features/postfix/core';

const tpl = (key: string) => TEMPLATES.find((t) => t.key === key)!;

suite('postfix', () => {
  suiteSetup(async () => {
    await vscode.extensions.getExtension('itemcoder.storm-parity')?.activate();
  });

  test('finds the PHP expression before the dot', () => {
    assert.deepStrictEqual(findPostfix('    $user.if'), { start: 4, expr: '$user', typed: 'if', className: false });
    assert.strictEqual(findPostfix('$this->items.fore')?.expr, '$this->items');
    assert.strictEqual(findPostfix('$a?->b()->c[0].')?.expr, '$a?->b()->c[0]');
    assert.strictEqual(findPostfix('return Foo::make($x, [1, 2]).var')?.expr, 'Foo::make($x, [1, 2])');
    assert.strictEqual(findPostfix('strlen($name).')?.expr, 'strlen($name)');
    assert.deepStrictEqual(findPostfix('\\App\\Models\\User.new'), { start: 0, expr: '\\App\\Models\\User', typed: 'new', className: true });
  });

  test('leaves concatenation, numbers, strings and comments alone', () => {
    assert.strictEqual(findPostfix('$a . '), undefined);
    assert.strictEqual(findPostfix('$a .if'), undefined);
    assert.strictEqual(findPostfix('$x = 1.5'), undefined);
    assert.strictEqual(findPostfix('echo "Hello $user.if'), undefined);
    assert.strictEqual(findPostfix("echo 'a.b'; // $user.if"), undefined);
    assert.strictEqual(findPostfix('# $user.if'), undefined);
    assert.strictEqual(findPostfix('foo)].if'), undefined);
    assert.strictEqual(findPostfix("echo 'x'; $user.if")?.expr, '$user');
  });

  test('class names get .new, values get the value templates', () => {
    const value = templatesFor(findPostfix('$x.')!).map((t) => t.key);
    assert.ok(value.includes('foreach') && value.includes('if') && !value.includes('new'));
    assert.deepStrictEqual(templatesFor(findPostfix('User.')!).map((t) => t.key), ['new']);
  });

  test('expands templates with the expression escaped for snippets', () => {
    assert.strictEqual(escapeSnippet('$a->b}\\'), '\\$a->b\\}\\\\');
    assert.strictEqual(expand(tpl('foreach'), '$items'), 'foreach (\\$items as \\$${1:item}) {\n\t$0\n}');
    assert.strictEqual(expand(tpl('return'), '$x'), 'return \\$x;');
    assert.strictEqual(expand(tpl('new'), 'User'), 'new User($0)');
  });

  test('completion in a PHP document replaces the expression', async () => {
    const doc = await vscode.workspace.openTextDocument({ language: 'php', content: '<?php\n    $items.fore' });
    const editor = await vscode.window.showTextDocument(doc);
    const pos = new vscode.Position(1, doc.lineAt(1).text.length);
    const list = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', doc.uri, pos, '.');
    const item = list.items.find((i) => (typeof i.label === 'string' ? i.label : i.label.label) === 'foreach');
    assert.ok(item, 'foreach offered');
    assert.ok(item.range instanceof vscode.Range && item.range.start.character === 4, 'replaces from the expression start');
    await editor.insertSnippet(item.insertText as vscode.SnippetString, item.range as vscode.Range);
    assert.strictEqual(doc.lineAt(1).text, '    foreach ($items as $item) {');
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
  });
});
