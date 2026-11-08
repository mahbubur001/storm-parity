import * as assert from 'assert';
import * as vscode from 'vscode';
import {
  MementoLike,
  ProjectMetaStore,
  addGroup,
  aliasOf,
  deleteGroup,
  emptyMeta,
  forgetProject,
  groupOf,
  moveToGroup,
  renameGroup,
  setAlias,
} from '../features/recentProjects/store';

class FakeMemento implements MementoLike {
  private data = new Map<string, unknown>();
  get<T>(key: string, defaultValue: T): T {
    return (this.data.has(key) ? this.data.get(key) : defaultValue) as T;
  }
  async update(key: string, value: unknown): Promise<void> {
    this.data.set(key, value);
  }
}

const A = 'file:///Users/me/a';

suite('recentProjects: group/alias reducers', () => {
  test('addGroup trims and ignores duplicates / blanks', () => {
    let m = addGroup(emptyMeta(), '  Work ');
    m = addGroup(m, 'Work');
    m = addGroup(m, '   ');
    assert.deepStrictEqual(m.groups, ['Work']);
  });

  test('moveToGroup creates the group and assigns membership; undefined ungroups', () => {
    let m = moveToGroup(emptyMeta(), A, 'Clients');
    assert.deepStrictEqual(m.groups, ['Clients']);
    assert.strictEqual(groupOf(m, A), 'Clients');
    assert.strictEqual(groupOf(m, `${A}/`), 'Clients', 'trailing slash variant matches');
    m = moveToGroup(m, A, undefined);
    assert.strictEqual(groupOf(m, A), undefined);
    assert.deepStrictEqual(m.groups, ['Clients']);
  });

  test('renameGroup carries members over and refuses collisions', () => {
    let m = moveToGroup(addGroup(emptyMeta(), 'Other'), A, 'Old');
    m = renameGroup(m, 'Old', 'New');
    assert.deepStrictEqual(m.groups, ['Other', 'New']);
    assert.strictEqual(groupOf(m, A), 'New');
    assert.strictEqual(renameGroup(m, 'New', 'Other'), m);
  });

  test('deleteGroup ungroups its members', () => {
    const m = deleteGroup(moveToGroup(emptyMeta(), A, 'G'), 'G');
    assert.deepStrictEqual(m.groups, []);
    assert.strictEqual(groupOf(m, A), undefined);
  });

  test('setAlias sets and clears with blank input', () => {
    let m = setAlias(emptyMeta(), A, ' Main ');
    assert.strictEqual(aliasOf(m, A), 'Main');
    m = setAlias(m, A, '  ');
    assert.strictEqual(aliasOf(m, A), undefined);
  });

  test('forgetProject drops alias and membership', () => {
    const m = forgetProject(setAlias(moveToGroup(emptyMeta(), A, 'G'), A, 'x'), A);
    assert.strictEqual(aliasOf(m, A), undefined);
    assert.strictEqual(groupOf(m, A), undefined);
    assert.deepStrictEqual(m.groups, ['G']);
  });
});

suite('recentProjects: ProjectMetaStore', () => {
  test('persists through the memento and notifies listeners only on change', async () => {
    const memento = new FakeMemento();
    const store = new ProjectMetaStore(memento);
    let calls = 0;
    store.onDidChange(() => calls++);
    await store.apply((m) => addGroup(m, 'Work'));
    await store.apply((m) => addGroup(m, 'Work'));
    assert.strictEqual(calls, 1);
    assert.deepStrictEqual(new ProjectMetaStore(memento).get().groups, ['Work']);
  });
});

suite('recentProjects: commands', () => {
  suiteSetup(async () => {
    await vscode.extensions.getExtension('itemcoder.storm-parity')?.activate();
  });

  test('commands are registered', async () => {
    const all = await vscode.commands.getCommands(true);
    const ids = ['refresh', 'newGroup', 'open', 'openInNewWindow', 'openInThisWindow', 'rename', 'moveToGroup', 'remove', 'revealInOS', 'renameGroup', 'deleteGroup'];
    for (const id of ids) assert.ok(all.includes(`stormParity.recentProjects.${id}`), `${id} missing`);
  });

  test('refresh runs without a selection', async () => {
    await vscode.commands.executeCommand('stormParity.recentProjects.refresh');
  });
});
