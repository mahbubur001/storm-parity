import * as assert from 'assert';
import * as vscode from 'vscode';
import {
  buildBlockSnippet,
  buildInlineSnippet,
  escapeSnippet,
  mnemonic,
  stripCommonIndent,
  templatesFor,
} from '../features/surroundWith/templates';

suite('surroundWith', () => {
  suiteSetup(async () => {
    await vscode.extensions.getExtension('itemcoder.storm-parity')?.activate();
  });

  test('command is registered', async () => {
    const all = await vscode.commands.getCommands(true);
    assert.ok(all.includes('stormParity.surroundWith.surround'));
  });

  test('escapeSnippet escapes $, } and backslash', () => {
    assert.strictEqual(escapeSnippet('$a = {b}; \\n'), '\\$a = {b\\}; \\\\n');
  });

  test('stripCommonIndent keeps relative indentation and blanks empty lines', () => {
    assert.deepStrictEqual(stripCommonIndent(['    a', '      b', '  ', '    c']), ['a', '  b', '', 'c']);
    assert.deepStrictEqual(stripCommonIndent(['\tx', '\t\ty']), ['x', '\ty']);
  });

  test('block snippet indents the body by one tab', () => {
    const tpl = templatesFor('php').find((t) => t.label === 'if')!;
    assert.strictEqual(buildBlockSnippet(tpl, ['    $x = 1;', '    if ($y) {', '        go();', '    }']),
      'if (${1:true}) {\n\t\\$x = 1;\n\tif (\\$y) {\n\t    go();\n\t\\}\n}');
  });

  test('empty body gets a final tabstop unless the template has one', () => {
    const ifTpl = templatesFor('typescript').find((t) => t.label === 'if')!;
    assert.strictEqual(buildBlockSnippet(ifTpl, ['   ']), 'if (${1:true}) {\n\t$0\n}');
    const ifElse = templatesFor('typescript').find((t) => t.label === 'if / else')!;
    assert.strictEqual(buildBlockSnippet(ifElse, ['']), 'if (${1:true}) {\n\t\n} else {\n\t$0\n}');
  });

  test('inline wrap and linked HTML tag', () => {
    const tag = templatesFor('html')[0];
    assert.strictEqual(buildInlineSnippet(tag, 'hi $1'), '<${1:div}>hi \\$1</${1}>');
    const parens = templatesFor('plaintext').find((t) => t.label === '( )')!;
    assert.strictEqual(buildInlineSnippet(parens, 'a'), '(a)');
  });

  test('language catalogue', () => {
    const php = templatesFor('php').map((t) => t.label);
    for (const l of ['if', 'foreach', 'try / catch', 'region', 'function']) assert.ok(php.includes(l), l);
    assert.ok(templatesFor('typescriptreact').some((t) => t.label === 'arrow IIFE'));
    assert.ok(templatesFor('python').some((t) => t.label === 'region' && t.head[0].startsWith('# region')));
    assert.ok(!templatesFor('plaintext').some((t) => t.label === 'region'));
  });

  test('mnemonics follow 1-9, 0, A-Z', () => {
    assert.strictEqual(mnemonic(0), '1');
    assert.strictEqual(mnemonic(8), '9');
    assert.strictEqual(mnemonic(9), '0');
    assert.strictEqual(mnemonic(10), 'A');
    assert.strictEqual(mnemonic(36), undefined);
  });

  test('snippet inserts with correct indentation', async () => {
    const doc = await vscode.workspace.openTextDocument({ content: 'function f() {\n    a();\n    b();\n}', language: 'javascript' });
    const editor = await vscode.window.showTextDocument(doc);
    editor.options = { insertSpaces: true, tabSize: 4 };
    const tpl = templatesFor('javascript').find((t) => t.label === 'if')!;
    const range = new vscode.Range(1, 4, 2, 8);
    await editor.insertSnippet(new vscode.SnippetString(buildBlockSnippet(tpl, ['    a();', '    b();'])), range);
    assert.strictEqual(doc.getText(), 'function f() {\n    if (true) {\n        a();\n        b();\n    }\n}');
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
  });
});
