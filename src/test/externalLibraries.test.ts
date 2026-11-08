import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  contractPath,
  effectivePaths,
  expandPath,
  isDirectory,
  listDirectory,
  mergeManaged,
  parsePhpStormIncludePaths,
  resolveInput,
} from '../features/externalLibraries/core';

suite('externalLibraries: core', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'storm-extlib-'));
  const home = path.join(tmp, 'home');

  suiteTeardown(() => {
    try {
      fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // Leftover temp dirs are harmless.
    }
  });

  test('expandPath expands ~ and resolves relative paths against the workspace', () => {
    const base = path.join(tmp, 'project');
    assert.strictEqual(expandPath('~', base, home), home);
    assert.strictEqual(expandPath('~/libs/wp', base, home), path.join(home, 'libs', 'wp'));
    assert.strictEqual(expandPath('../shared', base, home), path.join(tmp, 'shared'));
    assert.strictEqual(expandPath(path.join(tmp, 'abs'), base, home), path.join(tmp, 'abs'));
  });

  test('contractPath stores home paths as ~/... and keeps others absolute', () => {
    assert.strictEqual(contractPath(path.join(home, 'code', 'wordpress'), home), '~/code/wordpress');
    assert.strictEqual(contractPath(home, home), '~');
    const outside = path.join(tmp, 'elsewhere');
    assert.strictEqual(contractPath(outside, home), outside);
    assert.strictEqual(expandPath(contractPath(path.join(home, 'a b', 'c'), home), tmp, home), path.join(home, 'a b', 'c'));
  });

  test('resolveInput strips quotes and spaces from pasted paths', () => {
    const base = path.join(tmp, 'project');
    assert.strictEqual(resolveInput('  "../shared lib" ', base), path.join(tmp, 'shared lib'));
    assert.strictEqual(resolveInput("'vendor'", base), path.join(base, 'vendor'));
  });

  test('parsePhpStormIncludePaths reads include_path entries and expands PhpStorm macros', () => {
    const project = path.join(tmp, 'project');
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<project version="4">
  <component name="PhpIncludePathManager">
    <include_path>
      <path value="$USER_HOME$/Downloads/woocommerce-delivery-notes" />
      <path value="$PROJECT_DIR$/../wordpress" />
      <path value="/opt/stubs &amp; more" />
    </include_path>
  </component>
</project>`;
    assert.deepStrictEqual(parsePhpStormIncludePaths(xml, project, home), [
      path.join(home, 'Downloads', 'woocommerce-delivery-notes'),
      path.join(tmp, 'wordpress'),
      path.resolve(project, '/opt/stubs & more'),
    ]);
    assert.deepStrictEqual(parsePhpStormIncludePaths('<project version="4"></project>', project, home), []);
  });

  test('mergeManaged keeps the user entries and replaces the ones it added before', () => {
    assert.deepStrictEqual(mergeManaged(['/user/a', '/old/ours'], ['/old/ours'], ['/new/ours']), ['/user/a', '/new/ours']);
    assert.deepStrictEqual(mergeManaged([], [], ['/x', '/x']), ['/x']);
    assert.deepStrictEqual(mergeManaged(['/x'], ['/x'], []), []);
    assert.deepStrictEqual(mergeManaged(['/x'], [], ['/x']), ['/x']);
  });

  test('effectivePaths falls back to the legacy iextlibraries setting until the new one is set', () => {
    assert.deepStrictEqual(effectivePaths({}, [], ['~/wp']), ['~/wp'], 'new key unset: legacy wins');
    assert.deepStrictEqual(effectivePaths(undefined, undefined, ['~/wp', 3]), ['~/wp'], 'non-strings are dropped');
    assert.deepStrictEqual(effectivePaths({ workspaceValue: ['~/sdk'] }, ['~/sdk'], ['~/wp']), ['~/sdk'], 'new key set: it wins');
    assert.deepStrictEqual(effectivePaths({ workspaceValue: [] }, [], ['~/wp']), [], 'an explicitly emptied list stays empty');
    assert.deepStrictEqual(effectivePaths({ globalValue: ['/g'] }, ['/g'], undefined), ['/g']);
    assert.deepStrictEqual(effectivePaths({}, [], undefined), []);
  });

  test('listDirectory lists folders first in natural order and follows symlinks', async () => {
    const lib = path.join(tmp, 'lib');
    fs.mkdirSync(path.join(lib, 'src'), { recursive: true });
    fs.mkdirSync(path.join(lib, 'Assets'));
    for (const f of ['file10.php', 'file2.php', 'README.md']) fs.writeFileSync(path.join(lib, f), '');
    let linked = true;
    try {
      fs.symlinkSync(path.join(lib, 'src'), path.join(lib, 'zz-link'), process.platform === 'win32' ? 'junction' : 'dir');
    } catch {
      linked = false;
    }
    const names = (await listDirectory(lib)).map((e) => `${e.isDirectory ? 'd' : 'f'}:${e.name}`);
    assert.deepStrictEqual(names, ['d:Assets', 'd:src', ...(linked ? ['d:zz-link'] : []), 'f:file2.php', 'f:file10.php', 'f:README.md']);
    assert.strictEqual(await isDirectory(lib), true);
    assert.strictEqual(await isDirectory(path.join(lib, 'README.md')), false);
    assert.strictEqual(await isDirectory(path.join(tmp, 'missing')), false);
  });
});

suite('externalLibraries: commands', () => {
  test('commands are registered', async () => {
    await vscode.extensions.getExtension('itemcoder.storm-parity')?.activate();
    const all = new Set(await vscode.commands.getCommands(true));
    for (const c of ['add', 'importPhpStorm', 'remove', 'refresh', 'configure', 'revealInOS', 'copyPath']) {
      assert.ok(all.has(`stormParity.externalLibraries.${c}`), c);
    }
  });
});
