import * as assert from 'assert';
import { execFileSync } from 'child_process';
import { promises as fs, mkdtempSync, rmSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getStatus } from '../util/git';
import { applyPatch, createPatch, revertEntries } from '../features/shelf/ops';
import { ShelfStore, newShelfId } from '../features/shelf/store';

const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' });

suite('shelf: temp repo round trip', () => {
  let repo: string;
  let storage: string;

  setup(async () => {
    repo = mkdtempSync(path.join(os.tmpdir(), 'storm-shelf-repo-'));
    storage = mkdtempSync(path.join(os.tmpdir(), 'storm-shelf-store-'));
    git(repo, 'init', '-q');
    git(repo, 'config', 'user.email', 'test@example.com');
    git(repo, 'config', 'user.name', 'Test');
    git(repo, 'config', 'commit.gpgsign', 'false');
    // Windows runners default to core.autocrlf=true, which would rewrite line endings on checkout.
    git(repo, 'config', 'core.autocrlf', 'false');
    await fs.writeFile(path.join(repo, 'a.txt'), 'one\n');
    await fs.writeFile(path.join(repo, 'gone.txt'), 'bye\n');
    await fs.writeFile(path.join(repo, 'other.txt'), 'keep\n');
    await fs.writeFile(path.join(repo, 'bin.dat'), Buffer.from([0, 1, 2, 3, 255]));
    await fs.mkdir(path.join(repo, 'app', '[id]'), { recursive: true });
    await fs.writeFile(path.join(repo, 'app', '[id]', 'page.ts'), 'page\n');
    await fs.writeFile(path.join(repo, 'app', 'x.ts'), 'x\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'init');
  });

  teardown(() => {
    // Windows can briefly hold locks on files git just touched; retry instead of failing the suite.
    for (const dir of [repo, storage]) {
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      } catch {
        // Leftover temp dirs are harmless.
      }
    }
  });

  test('shelves only the selected files, reverts them, and unshelves them back', async () => {
    await fs.writeFile(path.join(repo, 'a.txt'), 'one\ntwo\n');
    await fs.rm(path.join(repo, 'gone.txt'));
    await fs.mkdir(path.join(repo, 'sub'));
    await fs.writeFile(path.join(repo, 'sub', 'new.txt'), 'fresh\n');
    await fs.writeFile(path.join(repo, 'bin.dat'), Buffer.from([9, 8, 7, 0, 6]));
    await fs.writeFile(path.join(repo, 'app', '[id]', 'page.ts'), 'page v2\n');
    await fs.writeFile(path.join(repo, 'app', 'x.ts'), 'x v2\n');
    await fs.writeFile(path.join(repo, 'other.txt'), 'keep me dirty\n');
    await fs.writeFile(path.join(repo, 'untouched-new.txt'), 'not selected\n');

    const selected = new Set(['a.txt', 'gone.txt', 'sub/new.txt', 'bin.dat', 'app/[id]/page.ts']);
    const entries = (await getStatus(repo)).filter((e) => selected.has(e.path));
    assert.strictEqual(entries.length, selected.size);

    const patch = await createPatch(repo, entries);
    const store = new ShelfStore(storage);
    const entry = {
      id: newShelfId(),
      name: 'Test',
      date: new Date().toISOString(),
      repoRoot: repo,
      repoHash: 'abc123',
      files: entries.map((e) => ({ path: e.path, status: 'M' })),
    };
    await store.add(entry, patch);
    assert.strictEqual((await store.list()).length, 1);

    await revertEntries(repo, entries);

    const after = (await getStatus(repo)).map((e) => e.path).sort();
    assert.deepStrictEqual(after, ['app/x.ts', 'other.txt', 'untouched-new.txt']);
    assert.strictEqual(await fs.readFile(path.join(repo, 'a.txt'), 'utf8'), 'one\n');
    assert.strictEqual(await fs.readFile(path.join(repo, 'gone.txt'), 'utf8'), 'bye\n');
    assert.strictEqual(await fs.readFile(path.join(repo, 'app', 'x.ts'), 'utf8'), 'x v2\n');
    assert.strictEqual(await fs.readFile(path.join(repo, 'other.txt'), 'utf8'), 'keep me dirty\n');
    await assert.rejects(fs.stat(path.join(repo, 'sub', 'new.txt')));

    const result = await applyPatch(repo, store.patchPath(entry));
    assert.deepStrictEqual(result, { threeWay: false, conflicts: false });
    assert.strictEqual(await fs.readFile(path.join(repo, 'a.txt'), 'utf8'), 'one\ntwo\n');
    assert.strictEqual(await fs.readFile(path.join(repo, 'sub', 'new.txt'), 'utf8'), 'fresh\n');
    assert.strictEqual(await fs.readFile(path.join(repo, 'app', '[id]', 'page.ts'), 'utf8'), 'page v2\n');
    assert.deepStrictEqual([...(await fs.readFile(path.join(repo, 'bin.dat')))], [9, 8, 7, 0, 6]);
    await assert.rejects(fs.stat(path.join(repo, 'gone.txt')));

    const restored = await getStatus(repo);
    assert.ok(restored.some((e) => e.path === 'sub/new.txt' && e.x === '?'), 'new file is untracked again');

    await store.remove(entry.id);
    assert.strictEqual((await store.list()).length, 0);
    await assert.rejects(fs.stat(store.patchPath(entry)));
  });

  test('falls back to a 3-way merge when the working tree moved on', async () => {
    const lines = ['l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7', 'l8'];
    await fs.writeFile(path.join(repo, 'a.txt'), lines.join('\n') + '\n');
    git(repo, 'commit', '-q', '-am', 'lines');
    await fs.writeFile(path.join(repo, 'a.txt'), ['shelved', ...lines.slice(1)].join('\n') + '\n');
    const entries = (await getStatus(repo)).filter((e) => e.path === 'a.txt');
    const patch = await createPatch(repo, entries);
    const patchFile = path.join(storage, 'p.patch');
    await fs.writeFile(patchFile, patch);
    await revertEntries(repo, entries);

    // Line 4 sits inside the hunk context, so a plain apply fails but a 3-way merge is clean.
    await fs.writeFile(path.join(repo, 'a.txt'), [...lines.slice(0, 3), 'L4', ...lines.slice(4)].join('\n') + '\n');
    git(repo, 'commit', '-q', '-am', 'move on');
    const result = await applyPatch(repo, patchFile);
    assert.deepStrictEqual(result, { threeWay: true, conflicts: false });
    assert.strictEqual(
      await fs.readFile(path.join(repo, 'a.txt'), 'utf8'),
      ['shelved', 'l2', 'l3', 'L4', ...lines.slice(4)].join('\n') + '\n',
    );
  });

  test('createPatch refuses files without changes and undoes intent-to-add', async () => {
    await assert.rejects(createPatch(repo, [{ path: 'a.txt', x: ' ', y: 'M' }]));
    assert.deepStrictEqual(await getStatus(repo), []);
  });
});
