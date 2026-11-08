import * as assert from 'assert';
import * as vscode from 'vscode';
import { excludeGlob, fileGlob, fuzzyScore, parseQuery } from '../features/searchEverywhere/query';
import { collectActions, collectSettings, matchActions, matchSettings } from '../features/searchEverywhere/sources';

suite('searchEverywhere: query parsing', () => {
  test('prefixes select categories', () => {
    assert.deepStrictEqual(parseQuery('f foo'), { category: 'files', text: 'foo' });
    assert.deepStrictEqual(parseQuery('#Foo'), { category: 'symbols', text: 'Foo' });
    assert.deepStrictEqual(parseQuery('>format'), { category: 'actions', text: 'format' });
    assert.deepStrictEqual(parseQuery('@set tab size'), { category: 'settings', text: 'tab size' });
    assert.deepStrictEqual(parseQuery('  foo '), { category: 'all', text: 'foo' });
    assert.deepStrictEqual(parseQuery('foo'), { category: 'all', text: 'foo' });
  });
});

suite('searchEverywhere: fuzzy scoring', () => {
  test('non-subsequence does not match', () => assert.strictEqual(fuzzyScore('xyz', 'UserController.php'), undefined));
  test('exact > prefix > substring > subsequence', () => {
    const exact = fuzzyScore('user', 'user')!;
    const prefix = fuzzyScore('user', 'userService')!;
    const sub = fuzzyScore('user', 'AppUser')!;
    const seq = fuzzyScore('usr', 'UserService')!;
    assert.ok(exact > prefix && prefix > sub && sub > seq, `${exact} ${prefix} ${sub} ${seq}`);
  });
  test('word starts beat scattered hits', () => {
    assert.ok(fuzzyScore('uc', 'UserController')! > fuzzyScore('uc', 'unicorn_case')!);
  });
  test('multiple terms all need to match', () => {
    assert.ok(fuzzyScore('tab size', 'editor.tabSize') !== undefined);
    assert.strictEqual(fuzzyScore('tab zzz', 'editor.tabSize'), undefined);
  });
});

suite('searchEverywhere: globs', () => {
  test('file name glob is case-insensitive and fuzzy', () => {
    assert.strictEqual(fileGlob('ab'), '**/*[aA]*[bB]*');
    assert.strictEqual(fileGlob('a.b'), '**/*[aA]*.*[bB]*');
  });
  test('path segments and metacharacters', () => {
    assert.strictEqual(fileGlob('s/a'), '**/*[sS]*/**/*[aA]*');
    assert.strictEqual(fileGlob('a*{'), '**/*[aA]*');
    assert.strictEqual(fileGlob(''), '**/*');
  });
  test('exclude glob merges enabled keys only', () => {
    assert.strictEqual(excludeGlob({ '**/.git': true, '**/x': false }, { '**/node_modules': true, '**/*.js': { when: '$(basename).ts' } }), '{**/.git,**/node_modules}');
    assert.strictEqual(excludeGlob({ '**/.git': true }), '**/.git');
    assert.strictEqual(excludeGlob({}, undefined), undefined);
  });
});

suite('searchEverywhere: contributions', () => {
  suiteSetup(async () => {
    await vscode.extensions.getExtension('itemcoder.storm-parity')?.activate();
  });

  test('command is registered', async () => {
    assert.ok((await vscode.commands.getCommands(true)).includes('stormParity.searchEverywhere.open'));
  });

  test('own actions and settings are discoverable', () => {
    const actions = matchActions(collectActions(), 'Storm Search Everywhere', 5);
    assert.ok(actions.some((a) => a.target.type === 'command' && a.target.id === 'stormParity.searchEverywhere.open'));
    const settings = matchSettings(collectSettings(), 'stormParity.searchEverywhere.enabled', 5);
    assert.ok(settings.some((s) => s.target.type === 'setting' && s.target.key === 'stormParity.searchEverywhere.enabled'));
  });
});
