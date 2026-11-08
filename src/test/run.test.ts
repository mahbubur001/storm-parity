import * as assert from 'assert';
import * as vscode from 'vscode';
import { canDebug, launchTargets, parseTarget, sameTarget, targetKey } from '../features/run/core';

suite('run', () => {
  suiteSetup(async () => {
    await vscode.extensions.getExtension('itemcoder.storm-parity')?.activate();
  });

  test('commands are registered', async () => {
    const all = await vscode.commands.getCommands(true);
    for (const id of ['select', 'run', 'debug', 'runAny', 'debugAny', 'stop']) assert.ok(all.includes(`stormParity.run.${id}`), id);
  });

  test('launchTargets reads configurations then compounds and skips unnamed entries', () => {
    const targets = launchTargets(
      { configurations: [{ name: 'Listen for Xdebug', type: 'php' }, { type: 'node' }, { name: '  ' }, 'junk'], compounds: [{ name: 'All' }] },
      'file:///app',
    );
    assert.deepStrictEqual(targets, [
      { kind: 'launch', name: 'Listen for Xdebug', folder: 'file:///app' },
      { kind: 'compound', name: 'All', folder: 'file:///app' },
    ]);
    assert.deepStrictEqual(launchTargets(undefined), []);
    assert.deepStrictEqual(launchTargets({ configurations: 'nope' }), []);
  });

  test('targets are identified by kind, folder, source and name', () => {
    const a = { kind: 'task' as const, name: 'test', source: 'composer', folder: 'file:///a' };
    assert.ok(sameTarget(a, { ...a }));
    assert.ok(!sameTarget(a, { ...a, source: 'npm' }));
    assert.ok(!sameTarget(a, { ...a, folder: 'file:///b' }));
    assert.ok(!sameTarget(a, undefined));
    assert.notStrictEqual(targetKey(a), targetKey({ ...a, kind: 'launch' }));
  });

  test('only launch configurations can be debugged', () => {
    assert.ok(canDebug({ kind: 'launch', name: 'x' }));
    assert.ok(canDebug({ kind: 'compound', name: 'x' }));
    assert.ok(!canDebug({ kind: 'task', name: 'x' }));
  });

  test('parseTarget restores a persisted selection and rejects junk', () => {
    assert.deepStrictEqual(parseTarget({ kind: 'task', name: 'build', source: 'npm', folder: '' }), { kind: 'task', name: 'build', source: 'npm', folder: undefined });
    assert.strictEqual(parseTarget({ kind: 'shell', name: 'x' }), undefined);
    assert.strictEqual(parseTarget({ kind: 'launch', name: '' }), undefined);
    assert.strictEqual(parseTarget('launch'), undefined);
    assert.strictEqual(parseTarget(undefined), undefined);
  });

  test('stop is a no-op when nothing runs', async () => {
    await vscode.commands.executeCommand('stormParity.run.stop');
  });
});
