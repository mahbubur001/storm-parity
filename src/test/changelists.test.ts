import * as assert from 'assert';
import { changeKind, entryPaths, parsePorcelainZ, toRepoPath } from '../util/git';
import { ChangelistModel, DEFAULT_LIST_ID, normalizeState } from '../features/changelists/store';

suite('changelists: porcelain parsing', () => {
  test('parses modified, untracked, deleted, added and renamed entries', () => {
    const out = [' M src/a.ts', '?? new file.txt', ' D gone.md', 'A  added.ts', 'R  to.ts', 'from.ts', 'MM both.ts', ''].join('\0');
    const entries = parsePorcelainZ(out);
    assert.deepStrictEqual(
      entries.map((e) => [e.path, changeKind(e), e.origPath]),
      [
        ['src/a.ts', 'modified', undefined],
        ['new file.txt', 'untracked', undefined],
        ['gone.md', 'deleted', undefined],
        ['added.ts', 'added', undefined],
        ['to.ts', 'renamed', 'from.ts'],
        ['both.ts', 'modified', undefined],
      ],
    );
  });

  test('handles conflicts, intent-to-add, ignored and empty output', () => {
    const entries = parsePorcelainZ(['UU c.ts', 'AA d.ts', ' A ita.ts', '!! ignored.log', ''].join('\0'));
    assert.deepStrictEqual(
      entries.map((e) => changeKind(e)),
      ['conflict', 'conflict', 'added', 'ignored'],
    );
    assert.deepStrictEqual(parsePorcelainZ(''), []);
  });

  test('keeps special characters in paths verbatim', () => {
    const [e] = parsePorcelainZ(' M app/[id]/page "x".tsx\0');
    assert.strictEqual(e.path, 'app/[id]/page "x".tsx');
  });

  test('entryPaths includes rename sources once', () => {
    const entries = parsePorcelainZ(['R  b.ts', 'a.ts', ' M a.ts', ''].join('\0'));
    assert.deepStrictEqual(entryPaths(entries).sort(), ['a.ts', 'b.ts']);
  });

  test('toRepoPath rejects files outside the root', () => {
    assert.strictEqual(toRepoPath('/repo', '/repo/src/x.ts'), 'src/x.ts');
    assert.strictEqual(toRepoPath('/repo', '/other/x.ts'), undefined);
    assert.strictEqual(toRepoPath('/repo', '/repo'), undefined);
  });
});

suite('changelists: model', () => {
  test('always has a default active list', () => {
    const m = new ChangelistModel(undefined);
    assert.strictEqual(m.lists.length, 1);
    assert.strictEqual(m.active.id, DEFAULT_LIST_ID);
    assert.strictEqual(m.active.name, 'Changes');
  });

  test('unassigned files go to the active list', () => {
    const m = new ChangelistModel();
    const feature = m.add('Feature', '', 'cl-1');
    m.assign(['a.ts'], DEFAULT_LIST_ID);
    m.setActive(feature.id);
    const groups = m.group(['a.ts', 'b.ts']);
    assert.deepStrictEqual(groups.get(DEFAULT_LIST_ID), ['a.ts']);
    assert.deepStrictEqual(groups.get('cl-1'), ['b.ts']);
  });

  test('prune drops assignments for files that are no longer changed', () => {
    const m = new ChangelistModel();
    m.add('Feature', '', 'cl-1');
    m.assign(['a.ts', 'b.ts'], 'cl-1');
    assert.strictEqual(m.prune(['a.ts']), true);
    assert.deepStrictEqual(m.toJSON().assignments, { 'a.ts': 'cl-1' });
    assert.strictEqual(m.prune(['a.ts']), false);
  });

  test('deleting a list moves its files to the default list and resets active', () => {
    const m = new ChangelistModel();
    m.add('Feature', '', 'cl-1');
    m.add('Other', '', 'cl-2');
    m.assign(['a.ts'], 'cl-1');
    m.setActive('cl-1');
    m.remove('cl-1');
    assert.strictEqual(m.active.id, DEFAULT_LIST_ID);
    assert.strictEqual(m.listOf('a.ts'), DEFAULT_LIST_ID);
    m.setActive('cl-2');
    assert.strictEqual(m.listOf('a.ts'), DEFAULT_LIST_ID);
  });

  test('default list cannot be deleted; names must be unique and non-empty', () => {
    const m = new ChangelistModel();
    assert.throws(() => m.remove(DEFAULT_LIST_ID));
    m.add('Feature');
    assert.throws(() => m.add('feature'));
    assert.throws(() => m.add('  '));
    assert.throws(() => m.rename(DEFAULT_LIST_ID, 'Feature'));
  });

  test('normalizeState repairs invalid persisted data', () => {
    const s = normalizeState({
      lists: [{ id: 'cl-1', name: 'X' }, { id: 'cl-1', name: 'Dup' }, { nope: true }],
      activeId: 'missing',
      assignments: { 'a.ts': 'cl-1', 'b.ts': 'missing', 'c.ts': 3 },
    });
    assert.deepStrictEqual(
      s.lists.map((l) => l.id),
      [DEFAULT_LIST_ID, 'cl-1'],
    );
    assert.strictEqual(s.activeId, DEFAULT_LIST_ID);
    assert.deepStrictEqual(s.assignments, { 'a.ts': 'cl-1' });
  });

  test('round-trips through JSON', () => {
    const m = new ChangelistModel();
    m.add('Feature', 'Fix the thing', 'cl-1');
    m.setActive('cl-1');
    m.assign(['x.ts'], DEFAULT_LIST_ID);
    const copy = new ChangelistModel(JSON.parse(JSON.stringify(m.toJSON())));
    assert.deepStrictEqual(copy.toJSON(), m.toJSON());
    assert.strictEqual(copy.get('cl-1')?.description, 'Fix the thing');
  });
});
