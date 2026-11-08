import * as assert from 'assert';
import * as vscode from 'vscode';
import { nextScratchName, orderByRecent, touchRecent, validateFileName } from '../features/scratches/names';

suite('scratches', () => {
  suiteSetup(async () => {
    await vscode.extensions.getExtension('itemcoder.storm-parity')?.activate();
  });

  test('commands are registered', async () => {
    const all = await vscode.commands.getCommands(true);
    for (const id of ['new', 'newFromSelection', 'refresh', 'rename', 'delete', 'reveal']) {
      assert.ok(all.includes(`stormParity.scratches.${id}`), id);
    }
  });

  test('nextScratchName numbers across extensions', () => {
    assert.strictEqual(nextScratchName([], 'php'), 'scratch_1.php');
    assert.strictEqual(nextScratchName(['scratch_1.php', 'scratch_7.ts', 'notes.md', 'scratch_x.js'], '.json'), 'scratch_8.json');
    assert.strictEqual(nextScratchName(['scratch_2'], ''), 'scratch_3');
  });

  test('validateFileName', () => {
    assert.strictEqual(validateFileName('ok.php'), undefined);
    assert.ok(validateFileName(''));
    assert.ok(validateFileName('a/b'));
    assert.ok(validateFileName('..'));
  });

  test('recent languages ordering', () => {
    const langs = ['css', 'php', 'sql', 'ts'];
    assert.deepStrictEqual(orderByRecent(langs, ['sql', 'css'], (l) => l), ['sql', 'css', 'php', 'ts']);
    assert.deepStrictEqual(touchRecent(['a', 'b', 'c'], 'c', 3), ['c', 'a', 'b']);
    assert.deepStrictEqual(touchRecent(['a', 'b', 'c'], 'd', 3), ['d', 'a', 'b']);
  });
});
