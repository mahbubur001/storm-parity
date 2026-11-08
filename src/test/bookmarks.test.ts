import * as assert from 'assert';
import * as vscode from 'vscode';
import { LineChange, shiftLine, shiftLineAll } from '../features/bookmarks/lineShift';
import { BookmarkStore, normalizeMnemonic } from '../features/bookmarks/model';

const change = (startLine: number, startCharacter: number, endLine: number, text: string): LineChange => ({
  startLine,
  startCharacter,
  endLine,
  text,
});

suite('bookmarks: line shifting', () => {
  test('lines above the change are untouched', () => {
    assert.strictEqual(shiftLine(2, change(5, 0, 5, '\n\n')), 2);
  });

  test('inserted lines push following lines down', () => {
    assert.strictEqual(shiftLine(10, change(5, 3, 5, 'a\nb\nc')), 12);
  });

  test('Enter at end of the bookmarked line keeps it in place', () => {
    assert.strictEqual(shiftLine(5, change(5, 20, 5, '\n')), 5);
  });

  test('insertion at column 0 of the bookmarked line pushes it down', () => {
    assert.strictEqual(shiftLine(5, change(5, 0, 5, 'x\n')), 6);
  });

  test('deleting lines pulls following lines up', () => {
    assert.strictEqual(shiftLine(10, change(2, 0, 5, '')), 7);
  });

  test('a deleted bookmarked line moves to the change start', () => {
    assert.strictEqual(shiftLine(3, change(2, 4, 5, '')), 2);
    assert.strictEqual(shiftLine(2, change(2, 0, 3, '')), 2);
  });

  test('the tail line of a multi-line replacement lands after the inserted text', () => {
    assert.strictEqual(shiftLine(5, change(2, 4, 5, 'one\ntwo')), 3);
  });

  test('sequential changes compose', () => {
    assert.strictEqual(shiftLineAll(10, [change(8, 0, 8, '\n'), change(1, 0, 3, '')]), 9);
  });
});

suite('bookmarks: store and mnemonics', () => {
  const A = 'file:///a.php';
  const B = 'file:///b.php';

  test('normalizeMnemonic accepts 0-9 and A-Z only', () => {
    assert.strictEqual(normalizeMnemonic('a'), 'A');
    assert.strictEqual(normalizeMnemonic(' 7 '), '7');
    assert.strictEqual(normalizeMnemonic('ab'), undefined);
    assert.strictEqual(normalizeMnemonic('#'), undefined);
    assert.strictEqual(normalizeMnemonic(undefined), undefined);
  });

  test('toggle adds and removes an anonymous bookmark', () => {
    const s = new BookmarkStore();
    assert.strictEqual(s.toggle(A, 3), true);
    assert.strictEqual(s.at(A, 3)?.mnemonic, undefined);
    assert.strictEqual(s.toggle(A, 3), false);
    assert.strictEqual(s.size, 0);
  });

  test('a mnemonic is unique: reassigning moves it', () => {
    const s = new BookmarkStore();
    s.assignMnemonic(A, 1, 'x');
    s.assignMnemonic(B, 9, 'X');
    assert.strictEqual(s.byMnemonic('x')?.uri, B);
    assert.strictEqual(s.at(A, 1), undefined);
    assert.strictEqual(s.takenMnemonics().size, 1);
  });

  test('toggleMnemonic removes the bookmark when the same mnemonic is toggled again', () => {
    const s = new BookmarkStore();
    assert.strictEqual(s.toggleMnemonic(A, 4, '1'), true);
    assert.strictEqual(s.toggleMnemonic(A, 4, '2'), true);
    assert.strictEqual(s.at(A, 4)?.mnemonic, '2');
    assert.strictEqual(s.toggleMnemonic(A, 4, '2'), false);
    assert.strictEqual(s.size, 0);
  });

  test('edits shift bookmarks and collapsed lines keep the mnemonic one', () => {
    const s = new BookmarkStore();
    s.toggle(A, 3);
    s.assignMnemonic(A, 4, 'M');
    s.setDescription(A, 3, 'first');
    s.toggle(A, 10);
    assert.strictEqual(s.applyEdits(A, [change(3, 0, 5, '')]), true);
    const lines = s.forUri(A);
    assert.deepStrictEqual(lines.map((b) => b.line), [3, 8]);
    assert.strictEqual(lines[0].mnemonic, 'M');
    assert.strictEqual(lines[0].description, 'first');
  });

  test('renames re-key files and folders, deletes drop them', () => {
    const s = new BookmarkStore();
    s.toggle('file:///src/x.php', 1);
    s.toggle('file:///src/sub/y.php', 2);
    s.toggle('file:///srcother/z.php', 3);
    assert.strictEqual(s.rename('file:///src', 'file:///lib'), true);
    assert.deepStrictEqual(s.uris(), ['file:///lib/sub/y.php', 'file:///lib/x.php', 'file:///srcother/z.php']);
    assert.strictEqual(s.deleteUri('file:///lib/sub'), true);
    assert.strictEqual(s.size, 2);
  });

  test('neighbour wraps around', () => {
    const s = new BookmarkStore();
    [2, 5, 9].forEach((l) => s.toggle(A, l));
    assert.strictEqual(s.neighbour(A, 5, 1)?.line, 9);
    assert.strictEqual(s.neighbour(A, 9, 1)?.line, 2);
    assert.strictEqual(s.neighbour(A, 2, -1)?.line, 9);
  });

  test('persisted data is validated and round-trips', () => {
    const s = new BookmarkStore([{ uri: A, line: 1, mnemonic: 'q' }, { uri: A, line: 1 }, { bogus: true }, { uri: B, line: 2, mnemonic: 'Q' }]);
    assert.strictEqual(s.size, 2);
    assert.strictEqual(s.byMnemonic('Q')?.uri, A);
    assert.deepStrictEqual(new BookmarkStore(s.toJSON()).toJSON(), s.toJSON());
  });
});

suite('bookmarks: commands', () => {
  suiteSetup(async () => {
    await vscode.extensions.getExtension('itemcoder.storm-parity')?.activate();
  });

  test('commands are registered', async () => {
    const all = new Set(await vscode.commands.getCommands(true));
    for (const id of ['toggle', 'toggleMnemonic', 'toggleNumeric', 'jumpToMnemonic', 'showAll', 'next', 'previous', 'editDescription', 'delete', 'clearAll']) {
      assert.ok(all.has(`stormParity.bookmarks.${id}`), id);
    }
  });

  test('toggle and numeric mnemonic work on the active editor', async () => {
    const doc = await vscode.workspace.openTextDocument({ content: 'a\nb\nc\nd\n' });
    const editor = await vscode.window.showTextDocument(doc);
    editor.selection = new vscode.Selection(2, 0, 2, 0);
    await vscode.commands.executeCommand('stormParity.bookmarks.toggleNumeric', '3');
    editor.selection = new vscode.Selection(0, 0, 0, 0);
    await vscode.commands.executeCommand('stormParity.bookmarks.jumpToMnemonic', '3');
    assert.strictEqual(vscode.window.activeTextEditor?.selection.active.line, 2);
    await vscode.commands.executeCommand('stormParity.bookmarks.toggleNumeric', '3');
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  });
});
