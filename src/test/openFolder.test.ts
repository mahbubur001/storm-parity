import * as assert from 'assert';
import * as vscode from 'vscode';
import { RecentEntry, displayName, kindOf, mergeEntries, removeEntry, sameUri, tildify, touchEntry, uriKey } from '../features/openFolder/mru';

const e = (uri: string, kind: RecentEntry['kind'] = 'folder'): RecentEntry => ({ uri, kind });

suite('openFolder: MRU helpers', () => {
  test('touchEntry moves an existing entry to the front without duplicating it', () => {
    const list = [e('file:///a'), e('file:///b'), e('file:///c')];
    assert.deepStrictEqual(
      touchEntry(list, e('file:///b')).map((x) => x.uri),
      ['file:///b', 'file:///a', 'file:///c'],
    );
  });

  test('touchEntry dedupes trailing-slash variants and caps the length', () => {
    const list = [e('file:///a/'), e('file:///b'), e('file:///c')];
    const out = touchEntry(list, e('file:///a'), 2);
    assert.deepStrictEqual(out.map((x) => x.uri), ['file:///a', 'file:///b']);
  });

  test('removeEntry drops matching uris', () => {
    assert.deepStrictEqual(removeEntry([e('file:///a'), e('file:///b/')], 'file:///b').map((x) => x.uri), ['file:///a']);
  });

  test('mergeEntries keeps primary order and appends unseen secondary entries', () => {
    const merged = mergeEntries([e('file:///a'), e('file:///b')], [e('file:///b/'), e('file:///c')]);
    assert.deepStrictEqual(merged.map((x) => x.uri), ['file:///a', 'file:///b', 'file:///c']);
  });

  test('uriKey / sameUri normalise trailing slash and drive letter case', () => {
    assert.strictEqual(uriKey('file:///x/'), 'file:///x');
    assert.ok(sameUri('file:///C%3A/proj', 'file:///c%3A/proj'));
    assert.ok(!sameUri('file:///a', 'file:///b'));
  });

  test('kindOf detects workspace files', () => {
    assert.strictEqual(kindOf('/x/my.code-workspace'), 'workspace');
    assert.strictEqual(kindOf('/x/project'), 'folder');
  });

  test('displayName decodes and labels workspaces', () => {
    assert.strictEqual(displayName('file:///Users/me/my%20app'), 'my app');
    assert.strictEqual(displayName('file:///Users/me/app/'), 'app');
    assert.strictEqual(displayName('file:///w/team.code-workspace'), 'team (Workspace)');
  });

  test('tildify shortens paths under home only', () => {
    assert.strictEqual(tildify('/Users/me/dev/x', '/Users/me'), '~/dev/x');
    assert.strictEqual(tildify('/Users/me', '/Users/me'), '~');
    assert.strictEqual(tildify('/Users/meow/x', '/Users/me'), '/Users/meow/x');
  });
});

suite('openFolder: commands', () => {
  suiteSetup(async () => {
    await vscode.extensions.getExtension('itemcoder.storm-parity')?.activate();
  });

  test('commands are registered', async () => {
    const all = await vscode.commands.getCommands(true);
    for (const id of ['stormParity.openFolder.openFolder', 'stormParity.openFolder.openRecent']) {
      assert.ok(all.includes(id), `${id} missing`);
    }
  });

  test('defaultAction setting defaults to ask', () => {
    assert.strictEqual(vscode.workspace.getConfiguration('stormParity.openFolder').get('defaultAction'), 'ask');
  });
});
