import * as assert from 'assert';
import * as vscode from 'vscode';
import { ClipRing, distribute, presentItem, textForCopy } from '../features/clipboardHistory/ring';

suite('clipboardHistory', () => {
  suiteSetup(async () => {
    await vscode.extensions.getExtension('itemcoder.storm-parity')?.activate();
  });

  test('commands are registered', async () => {
    const all = await vscode.commands.getCommands(true);
    for (const id of ['copy', 'cut', 'pasteFromHistory', 'clear']) assert.ok(all.includes(`stormParity.clipboardHistory.${id}`), id);
  });

  test('ring keeps most recent first, dedupes and caps size', () => {
    const ring = new ClipRing(3);
    ring.push('a');
    ring.push('b');
    ring.push('c');
    ring.push('a');
    assert.deepStrictEqual(ring.toArray(), ['a', 'c', 'b']);
    ring.push('d');
    assert.deepStrictEqual(ring.toArray(), ['d', 'a', 'c']);
    assert.strictEqual(ring.push('d'), false);
    assert.strictEqual(ring.push('   '), false);
  });

  test('ring restores initial order, promotes, removes and shrinks', () => {
    const ring = new ClipRing(5, ['x', 'y', 'z']);
    assert.deepStrictEqual(ring.toArray(), ['x', 'y', 'z']);
    ring.promote(2);
    assert.deepStrictEqual(ring.toArray(), ['z', 'x', 'y']);
    ring.remove(1);
    assert.deepStrictEqual(ring.toArray(), ['z', 'y']);
    ring.setMax(1);
    assert.deepStrictEqual(ring.toArray(), ['z']);
    ring.clear();
    assert.strictEqual(ring.size, 0);
  });

  test('presentItem uses first non-blank line and counts', () => {
    const p = presentItem('\n  foo()\nbar\n');
    assert.strictEqual(p.label, 'foo()');
    assert.strictEqual(p.description, '3 lines, 13 chars');
    assert.ok(p.detail.includes('bar'));
    assert.strictEqual(presentItem('x').detail, '');
  });

  test('textForCopy mirrors VS Code copy semantics', () => {
    const sel = (text: string, lineText = 'line') => ({ isEmpty: text === '', text, lineText });
    assert.strictEqual(textForCopy([sel('ab'), sel('cd')], '\n', true), 'ab\ncd');
    assert.strictEqual(textForCopy([sel('ab'), sel('')], '\n', true), 'ab');
    assert.strictEqual(textForCopy([sel('', 'one'), sel('', 'two')], '\n', true), 'one\ntwo\n');
    assert.strictEqual(textForCopy([sel('')], '\n', false), '');
  });

  test('distribute spreads lines over matching cursor count', () => {
    assert.deepStrictEqual(distribute('a\nb', 2, true), ['a', 'b']);
    assert.deepStrictEqual(distribute('a\nb', 3, true), ['a\nb', 'a\nb', 'a\nb']);
    assert.deepStrictEqual(distribute('a\nb', 2, false), ['a\nb', 'a\nb']);
    assert.deepStrictEqual(distribute('a', 1, true), ['a']);
  });

  test('copy command records the selection', async () => {
    const doc = await vscode.workspace.openTextDocument({ content: 'alpha beta', language: 'plaintext' });
    const editor = await vscode.window.showTextDocument(doc);
    editor.selection = new vscode.Selection(0, 6, 0, 10);
    await vscode.commands.executeCommand('stormParity.clipboardHistory.copy');
    assert.strictEqual(await vscode.env.clipboard.readText(), 'beta');
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
  });
});
