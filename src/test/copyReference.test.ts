import * as assert from 'assert';
import * as vscode from 'vscode';
import {
  bareName,
  dottedReference,
  pathLineReference,
  phpNamespaceAt,
  phpReference,
  SymbolNode,
  symbolChainAt,
  symbolReference,
} from '../features/copyReference/reference';

const K = vscode.SymbolKind;
const node = (name: string, kind: vscode.SymbolKind, from: number, to: number, children: SymbolNode[] = []): SymbolNode => ({
  name,
  kind,
  range: { start: { line: from, character: 0 }, end: { line: to, character: 80 } },
  children,
});

const phpText = ['<?php', '', 'namespace App\\Http;', '', 'class Foo', '{', '    private $prop;', '    const MAX = 1;', '    public function bar()', '    {', '        $local = 1;', '    }', '}'].join('\n');

const phpTree: SymbolNode[] = [
  node('Foo', K.Class, 4, 12, [
    node('$prop', K.Property, 6, 6),
    node('MAX', K.Constant, 7, 7),
    node('bar', K.Method, 8, 11, [node('$local', K.Variable, 10, 10)]),
  ]),
];

suite('copyReference: PHP FQN', () => {
  test('namespace detection', () => {
    assert.strictEqual(phpNamespaceAt(phpText, 10), 'App\\Http');
    assert.strictEqual(phpNamespaceAt(phpText, 1), undefined);
    assert.strictEqual(phpNamespaceAt('namespace A;\nx\nnamespace B {', 2), 'B');
  });

  const at = (line: number): string | undefined =>
    symbolReference({ languageId: 'php', text: phpText, symbols: phpTree, pos: { line, character: 6 } });

  test('class', () => assert.strictEqual(at(5), 'App\\Http\\Foo'));
  test('property gets a $', () => assert.strictEqual(at(6), 'App\\Http\\Foo::$prop'));
  test('constant', () => assert.strictEqual(at(7), 'App\\Http\\Foo::MAX'));
  test('method, ignoring locals', () => assert.strictEqual(at(10), 'App\\Http\\Foo::bar'));
  test('outside any symbol', () => assert.strictEqual(at(0), undefined));

  test('property without $ in the symbol name', () => {
    assert.strictEqual(phpReference([node('Foo', K.Class, 0, 9), node('prop', K.Property, 1, 1)], 'A'), 'A\\Foo::$prop');
  });
  test('namespace symbol used when no declaration text', () => {
    const chain = [node('App\\Models', K.Namespace, 0, 20), node('User', K.Class, 1, 19)];
    assert.strictEqual(phpReference(chain, undefined), 'App\\Models\\User');
  });
  test('namespaced function', () => {
    assert.strictEqual(phpReference([node('helper', K.Function, 0, 3)], 'App'), 'App\\helper');
  });
  test('no namespace', () => {
    assert.strictEqual(phpReference([node('Foo', K.Class, 0, 3), node('run', K.Method, 1, 2)], undefined), 'Foo::run');
  });
});

suite('copyReference: generic symbols', () => {
  test('dotted path from a hierarchical tree', () => {
    const tree = [node('Foo', K.Class, 0, 10, [node('bar(x: number)', K.Method, 2, 5)])];
    assert.strictEqual(dottedReference(symbolChainAt(tree, { line: 3, character: 2 })), 'Foo.bar');
  });
  test('flat symbol lists are nested by range', () => {
    const flat = [node('bar', K.Method, 2, 5), node('Foo', K.Class, 0, 10)];
    assert.strictEqual(dottedReference(symbolChainAt(flat, { line: 3, character: 0 })), 'Foo.bar');
  });
  test('irrelevant kinds are skipped', () => {
    const tree = [node('Heading', K.String, 0, 10)];
    assert.strictEqual(symbolReference({ languageId: 'markdown', text: '', symbols: tree, pos: { line: 1, character: 0 } }), undefined);
  });
  test('bareName strips signatures', () => {
    assert.strictEqual(bareName('bar(int $x): void'), 'bar');
    assert.strictEqual(bareName('Map<K, V>'), 'Map');
  });
  test('path:line is 1-based', () => assert.strictEqual(pathLineReference('src/a.ts', 41), 'src/a.ts:42'));
});

suite('copyReference: commands', () => {
  suiteSetup(async () => {
    await vscode.extensions.getExtension('itemcoder.storm-parity')?.activate();
  });

  test('commands are registered', async () => {
    const all = await vscode.commands.getCommands(true);
    assert.ok(all.includes('stormParity.copyReference.copyReference'));
    assert.ok(all.includes('stormParity.copyReference.copyReferenceAs'));
  });

  test('falls back to a path:line reference', async () => {
    const doc = await vscode.workspace.openTextDocument({ content: 'one\ntwo\nthree', language: 'plaintext' });
    const editor = await vscode.window.showTextDocument(doc);
    editor.selection = new vscode.Selection(2, 1, 2, 1);
    const copied = await vscode.commands.executeCommand<string>('stormParity.copyReference.copyReference');
    assert.ok(copied?.endsWith(':3'), copied);
    assert.strictEqual(await vscode.env.clipboard.readText(), copied);
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
  });
});
