import * as assert from 'assert';
import * as vscode from 'vscode';
import { buildTodoRegex, combineGlobs, findTodos, looksBinary, matchLine } from '../features/todo/matcher';

suite('todo', () => {
  suiteSetup(async () => {
    await vscode.extensions.getExtension('itemcoder.storm-parity')?.activate();
  });

  test('commands are registered', async () => {
    const all = await vscode.commands.getCommands(true);
    for (const id of ['refresh', 'currentFileOnly', 'allFiles', 'filterTags', 'clearFilters']) {
      assert.ok(all.includes(`stormParity.todo.${id}`), id);
    }
  });

  const re = buildTodoRegex(['TODO', 'FIXME', 'HACK', 'XXX'])!;

  test('matches tags after comment openers', () => {
    assert.deepStrictEqual(matchLine('  // TODO: fix this', re), { column: 5, tag: 'TODO', text: 'TODO: fix this' });
    assert.strictEqual(matchLine('# FIXME later', re)?.tag, 'FIXME');
    assert.strictEqual(matchLine('/* HACK around bug */', re)?.text, 'HACK around bug');
    assert.strictEqual(matchLine(' * XXX doc block', re)?.tag, 'XXX');
    assert.strictEqual(matchLine('<!-- TODO markup -->', re)?.text, 'TODO markup');
    assert.strictEqual(matchLine('$a = 1; // see TODO here', re)?.tag, 'TODO');
  });

  test('requires case-sensitive whole words and a comment context', () => {
    assert.strictEqual(matchLine('// todo lower', re), undefined);
    assert.strictEqual(matchLine('// TODOS plural', re), undefined);
    assert.strictEqual(matchLine('const TODO = 1;', re), undefined);
    assert.strictEqual(matchLine('// $TODO var', re), undefined);
  });

  test('findTodos reports zero-based lines', () => {
    const found = findTodos('a\n// TODO one\nb\r\n# FIXME two', re);
    assert.deepStrictEqual(found.map((f) => [f.line, f.tag]), [[1, 'TODO'], [3, 'FIXME']]);
  });

  test('custom regex uses group 1 as tag', () => {
    const custom = buildTodoRegex([], String.raw`@(todo)\b`)!;
    assert.strictEqual(matchLine('x @todo y', custom)?.tag, 'todo');
    assert.strictEqual(buildTodoRegex([]), undefined);
  });

  test('helpers', () => {
    assert.ok(looksBinary(new Uint8Array([65, 0, 66])));
    assert.ok(!looksBinary(new TextEncoder().encode('plain')));
    assert.strictEqual(combineGlobs([]), undefined);
    assert.strictEqual(combineGlobs(['**/a']), '**/a');
    assert.strictEqual(combineGlobs(['**/a', '**/b', '**/a']), '{**/a,**/b}');
  });
});
