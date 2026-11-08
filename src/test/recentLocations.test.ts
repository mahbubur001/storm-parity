import * as assert from 'assert';
import * as vscode from 'vscode';
import { shiftLine } from '../features/recentLocations/lineShift';
import { parseLocations, recordLocation, RecentLocation, removeLocations, renameLocations, shiftLocations } from '../features/recentLocations/model';

const A = 'file:///a.php';
const B = 'file:///b.php';
const opts = { mergeDistance: 5, maxEntries: 3 };
const loc = (uri: string, line: number, changed = false): RecentLocation => ({ uri, line, character: 0, changed, timestamp: 0 });

suite('recentLocations: model', () => {
  test('line shifting matches bookmarks semantics', () => {
    assert.strictEqual(shiftLine(10, { startLine: 2, startCharacter: 0, endLine: 4, text: '' }), 8);
    assert.strictEqual(shiftLine(3, { startLine: 2, startCharacter: 1, endLine: 4, text: '' }), 2);
  });

  test('nearby entries in the same file merge and move to the front', () => {
    let list = recordLocation([], loc(A, 10), opts);
    list = recordLocation(list, loc(B, 1), opts);
    list = recordLocation(list, loc(A, 13), opts);
    assert.deepStrictEqual(list.map((l) => `${l.uri}:${l.line}`), [`${A}:13`, `${B}:1`]);
  });

  test('distant entries in the same file are separate', () => {
    const list = recordLocation(recordLocation([], loc(A, 10), opts), loc(A, 40), opts);
    assert.strictEqual(list.length, 2);
  });

  test('a viewed revisit keeps the changed line and flag', () => {
    const list = recordLocation(recordLocation([], loc(A, 10, true), opts), loc(A, 12), opts);
    assert.deepStrictEqual([list[0].line, list[0].changed], [10, true]);
  });

  test('the list is capped at maxEntries', () => {
    let list: RecentLocation[] = [];
    for (let i = 0; i < 5; i++) list = recordLocation(list, loc(A, i * 100), opts);
    assert.deepStrictEqual(list.map((l) => l.line), [400, 300, 200]);
  });

  test('edits shift and collapse entries', () => {
    const list = [loc(A, 3), loc(A, 4), loc(B, 4), loc(A, 1)];
    const next = shiftLocations(list, A, [{ startLine: 2, startCharacter: 0, endLine: 4, text: '' }]);
    assert.deepStrictEqual(next?.map((l) => `${l.uri}:${l.line}`), [`${A}:2`, `${B}:4`, `${A}:1`]);
    assert.strictEqual(shiftLocations(list, A, [{ startLine: 9, startCharacter: 0, endLine: 9, text: 'x' }]), undefined);
  });

  test('rename, delete and parse', () => {
    const list = [loc('file:///src/a.php', 1), loc(B, 2)];
    assert.strictEqual(renameLocations(list, 'file:///src', 'file:///lib')?.[0].uri, 'file:///lib/a.php');
    assert.strictEqual(removeLocations(list, B)?.length, 1);
    assert.strictEqual(removeLocations(list, 'file:///nope'), undefined);
    assert.strictEqual(parseLocations([{ uri: A, line: 1, character: 0 }, null, 'x']).length, 1);
    assert.deepStrictEqual(parseLocations('garbage'), []);
  });
});

suite('recentLocations: commands', () => {
  suiteSetup(async () => {
    await vscode.extensions.getExtension('itemcoder.storm-parity')?.activate();
  });

  test('commands are registered', async () => {
    const all = new Set(await vscode.commands.getCommands(true));
    for (const id of ['show', 'toggleChangedOnly', 'clear']) assert.ok(all.has(`stormParity.recentLocations.${id}`), id);
  });
});
