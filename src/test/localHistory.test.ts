import * as assert from 'assert';
import * as vscode from 'vscode';
import { formatAge, HistoryEntry, lineRange, newEntryId, normalizeIndex, orphans, prune, shouldRecord } from '../features/localHistory/historyIndex';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 8);
const entry = (id: string, ageDays: number, hash = id, extra: Partial<HistoryEntry> = {}): HistoryEntry => ({
  id,
  timestamp: NOW - ageDays * DAY,
  hash,
  size: 1,
  source: 'save',
  ...extra,
});

suite('localHistory: index pruning', () => {
  test('drops entries older than the retention window', () => {
    const { kept, orphanHashes } = prune([entry('a', 10), entry('b', 3), entry('c', 0)], { now: NOW, retentionDays: 7, maxEntries: 50 });
    assert.deepStrictEqual(kept.map((e) => e.id), ['b', 'c']);
    assert.deepStrictEqual(orphanHashes, ['a']);
  });

  test('keeps only the newest maxEntries, oldest first', () => {
    const entries = [entry('c', 1), entry('a', 3), entry('b', 2), entry('d', 0)];
    const { kept } = prune(entries, { now: NOW, retentionDays: 7, maxEntries: 2 });
    assert.deepStrictEqual(kept.map((e) => e.id), ['c', 'd']);
  });

  test('shared content hashes are not orphaned while still referenced', () => {
    const { orphanHashes } = prune([entry('a', 9, 'h1'), entry('b', 1, 'h1'), entry('c', 9, 'h2')], { now: NOW, retentionDays: 7, maxEntries: 50 });
    assert.deepStrictEqual(orphanHashes, ['h2']);
  });

  test('orphans()', () => {
    assert.deepStrictEqual(orphans([entry('a', 0, 'x'), entry('b', 0, 'y')], [entry('b', 0, 'y')]), ['x']);
  });

  test('normalizeIndex tolerates garbage and sorts', () => {
    assert.deepStrictEqual(normalizeIndex(null, 'u').entries, []);
    assert.deepStrictEqual(normalizeIndex({ entries: 'nope' }, 'u').entries, []);
    const idx = normalizeIndex({ uri: 'file:///x', entries: [entry('b', 0), { bogus: true }, entry('a', 1)] }, 'u');
    assert.strictEqual(idx.uri, 'file:///x');
    assert.deepStrictEqual(idx.entries.map((e) => e.id), ['a', 'b']);
  });
});

suite('localHistory: helpers', () => {
  test('shouldRecord dedupes saves but never labels', () => {
    const entries = [entry('a', 0, 'h')];
    assert.strictEqual(shouldRecord(entries, 'h', 'save'), false);
    assert.strictEqual(shouldRecord(entries, 'h2', 'save'), true);
    assert.strictEqual(shouldRecord(entries, 'h', 'label'), true);
    assert.strictEqual(shouldRecord([], 'h', 'save'), true);
  });

  test('entry ids are unique within the same millisecond', () => {
    const a = newEntryId(NOW);
    const b = newEntryId(NOW);
    assert.notStrictEqual(a, b);
  });

  test('lineRange', () => {
    assert.strictEqual(lineRange('a\r\nb\nc\nd', 1, 2), 'b\nc');
    assert.strictEqual(lineRange('a', 3, 5), '');
  });

  test('formatAge', () => {
    assert.strictEqual(formatAge(NOW - 10_000, NOW), 'just now');
    assert.strictEqual(formatAge(NOW - 5 * 60_000, NOW), '5 min ago');
    assert.strictEqual(formatAge(NOW - 3 * 3_600_000, NOW), '3 h ago');
    assert.strictEqual(formatAge(NOW - DAY, NOW), '1 day ago');
    assert.strictEqual(formatAge(NOW - 4 * DAY, NOW), '4 days ago');
  });
});

suite('localHistory: commands', () => {
  suiteSetup(async () => {
    await vscode.extensions.getExtension('itemcoder.storm-parity')?.activate();
  });

  test('commands are registered', async () => {
    const all = await vscode.commands.getCommands(true);
    for (const id of ['putLabel', 'showHistory', 'showHistoryForSelection', 'restore']) {
      assert.ok(all.includes(`stormParity.localHistory.${id}`), id);
    }
  });
});
