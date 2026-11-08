import * as path from 'path';
import * as vscode from 'vscode';
import { formatAge, HistoryEntry, lineRange, PruneOptions } from './historyIndex';
import { HistoryStore } from './store';

export const SCHEME = 'storm-parity-history';

interface SnapshotQuery {
  file: string;
  hash: string;
}

interface EntryItem extends vscode.QuickPickItem {
  entry: HistoryEntry;
}

type PickMode = 'diff' | 'restore';

const restoreButton: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('discard'), tooltip: 'Restore this version' };
const deleteButton: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('trash'), tooltip: 'Delete this snapshot' };

const config = (): vscode.WorkspaceConfiguration => vscode.workspace.getConfiguration('stormParity.localHistory');

function pruneOptions(): PruneOptions {
  const c = config();
  return { now: Date.now(), retentionDays: c.get<number>('retentionDays', 7), maxEntries: c.get<number>('maxSnapshotsPerFile', 50) };
}

function workspaceKey(): string {
  return vscode.workspace.workspaceFile?.toString() ?? vscode.workspace.workspaceFolders?.[0]?.uri.toString() ?? 'empty-window';
}

const describe = (e: HistoryEntry): string => new Date(e.timestamp).toLocaleString();

class LocalHistory {
  /** Files known to have at least one snapshot, so the baseline check runs once per file. */
  private readonly known = new Set<string>();

  constructor(
    readonly store: HistoryStore,
    private readonly storageRoot: vscode.Uri,
  ) {}

  isEligible(doc: vscode.TextDocument): boolean {
    if (doc.uri.scheme !== 'file') return false;
    if (doc.uri.fsPath.startsWith(this.storageRoot.fsPath)) return false;
    const maxKb = config().get<number>('maxFileSizeKB', 1024);
    if (doc.getText().length > maxKb * 1024) return false;
    const exclude = config().get<string[]>('exclude', []);
    return !exclude.some((pattern) => vscode.languages.match({ pattern }, doc) > 0);
  }

  /** Before the first recorded save of a file, keep what is on disk so the pre-edit version is not lost. */
  async baseline(doc: vscode.TextDocument): Promise<void> {
    const key = doc.uri.toString();
    if (this.known.has(key)) return;
    if (await this.store.hasHistory(doc.uri)) {
      this.known.add(key);
      return;
    }
    try {
      const disk = new TextDecoder().decode(await vscode.workspace.fs.readFile(doc.uri));
      await this.store.record(doc.uri, disk, 'baseline', pruneOptions());
      this.known.add(key);
    } catch {
      // New file that does not exist on disk yet.
    }
  }

  async snapshot(doc: vscode.TextDocument, source: 'save' | 'label' | 'restore', label?: string): Promise<HistoryEntry | undefined> {
    const entry = await this.store.record(doc.uri, doc.getText(), source, pruneOptions(), label);
    this.known.add(doc.uri.toString());
    return entry;
  }

  snapshotUri(file: vscode.Uri, entry: HistoryEntry): vscode.Uri {
    const query: SnapshotQuery = { file: file.toString(), hash: entry.hash };
    return vscode.Uri.from({ scheme: SCHEME, path: `/${entry.id}/${path.basename(file.path)}`, query: JSON.stringify(query) });
  }

  async provide(uri: vscode.Uri): Promise<string> {
    const q = JSON.parse(uri.query) as SnapshotQuery;
    return this.store.readContent(vscode.Uri.parse(q.file), q.hash);
  }
}

function targetUri(arg: unknown): vscode.Uri | undefined {
  if (arg instanceof vscode.Uri) return arg;
  return vscode.window.activeTextEditor?.document.uri;
}

async function openDiff(lh: LocalHistory, file: vscode.Uri, entry: HistoryEntry, selection?: vscode.Range): Promise<void> {
  const name = path.basename(file.path);
  const tag = entry.label ? `"${entry.label}", ` : '';
  await vscode.commands.executeCommand('vscode.diff', lh.snapshotUri(file, entry), file, `${name} (${tag}${describe(entry)}) vs Current`, {
    preview: true,
    ...(selection ? { selection } : {}),
  });
}

async function restore(lh: LocalHistory, file: vscode.Uri, entry: HistoryEntry): Promise<boolean> {
  const name = path.basename(file.path);
  const choice = await vscode.window.showWarningMessage(
    `Restore ${name} to the version from ${describe(entry)}?`,
    { modal: true, detail: 'The current content is added to local history first, and the change can be undone in the editor.' },
    'Restore',
  );
  if (choice !== 'Restore') return false;
  const doc = await vscode.workspace.openTextDocument(file);
  const text = await lh.store.readContent(file, entry.hash);
  await lh.snapshot(doc, 'restore', 'Before restore');
  const edit = new vscode.WorkspaceEdit();
  edit.replace(file, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), text);
  if (!(await vscode.workspace.applyEdit(edit))) {
    void vscode.window.showErrorMessage(`Local History: could not restore ${name}.`);
    return false;
  }
  await doc.save();
  return true;
}

function toItem(e: HistoryEntry, now: number): EntryItem {
  const icon = e.label ? 'tag' : e.source === 'baseline' ? 'file' : e.source === 'restore' ? 'discard' : 'history';
  const title = e.label ?? formatAge(e.timestamp, now);
  const what = e.source === 'baseline' ? 'before first save' : e.source === 'save' ? 'saved' : e.source;
  return {
    label: `$(${icon}) ${title}`,
    description: `${describe(e)}${e.label ? `, ${formatAge(e.timestamp, now)}` : ''}`,
    detail: `${what}, ${e.size} chars`,
    entry: e,
    buttons: [restoreButton, deleteButton],
  };
}

/** Entries whose selected line range differs from the current text, naive line-number mapping. */
async function filterBySelection(lh: LocalHistory, file: vscode.Uri, entries: HistoryEntry[], range: vscode.Range, current: string): Promise<HistoryEntry[]> {
  const endLine = range.end.character === 0 && range.end.line > range.start.line ? range.end.line - 1 : range.end.line;
  const now = lineRange(current, range.start.line, endLine);
  const byHash = new Map<string, boolean>();
  const out: HistoryEntry[] = [];
  for (const e of entries) {
    let differs = byHash.get(e.hash);
    if (differs === undefined) {
      try {
        differs = lineRange(await lh.store.readContent(file, e.hash), range.start.line, endLine) !== now;
      } catch {
        differs = false;
      }
      byHash.set(e.hash, differs);
    }
    if (differs) out.push(e);
  }
  return out;
}

async function pickHistory(lh: LocalHistory, file: vscode.Uri, mode: PickMode, selection?: vscode.Range): Promise<void> {
  const name = path.basename(file.path);
  let entries = await lh.store.list(file);
  if (selection) {
    const doc = await vscode.workspace.openTextDocument(file);
    entries = await filterBySelection(lh, file, entries, selection, doc.getText());
  }
  if (entries.length === 0) {
    void vscode.window.showInformationMessage(`Local History: no ${selection ? 'changes to the selected lines' : 'snapshots'} for ${name}.`);
    return;
  }

  const qp = vscode.window.createQuickPick<EntryItem>();
  qp.title = `Local History: ${name}${selection ? ` (lines ${selection.start.line + 1}-${selection.end.line + 1})` : ''}`;
  qp.placeholder = mode === 'restore' ? 'Pick a version to restore' : 'Pick a version to compare with the current file';
  qp.matchOnDescription = true;
  qp.matchOnDetail = true;
  const refresh = (): void => {
    const now = Date.now();
    qp.items = entries.map((e) => toItem(e, now));
  };
  refresh();

  const disposables: vscode.Disposable[] = [
    qp.onDidAccept(async () => {
      const [item] = qp.selectedItems;
      if (!item) return;
      qp.hide();
      if (mode === 'restore') await restore(lh, file, item.entry);
      else await openDiff(lh, file, item.entry, selection);
    }),
    qp.onDidTriggerItemButton(async ({ item, button }) => {
      if (button === restoreButton) {
        qp.hide();
        await restore(lh, file, item.entry);
      } else if (button === deleteButton) {
        await lh.store.remove(file, item.entry.id);
        entries = entries.filter((e) => e.id !== item.entry.id);
        if (entries.length === 0) qp.hide();
        else refresh();
      }
    }),
    qp.onDidHide(() => {
      for (const d of disposables) d.dispose();
      qp.dispose();
    }),
  ];
  qp.show();
}

async function putLabel(lh: LocalHistory): Promise<number | undefined> {
  const label = await vscode.window.showInputBox({ title: 'Local History: Put Label', prompt: 'Label for the current state of all open files', placeHolder: 'e.g. before refactoring' });
  if (!label?.trim()) return undefined;
  const docs = vscode.workspace.textDocuments.filter((d) => lh.isEligible(d) && (!vscode.workspace.workspaceFolders || vscode.workspace.getWorkspaceFolder(d.uri)));
  let count = 0;
  for (const doc of docs) if (await lh.snapshot(doc, 'label', label.trim())) count++;
  vscode.window.setStatusBarMessage(`$(tag) Local History: label "${label.trim()}" put on ${count} file${count === 1 ? '' : 's'}`, 4000);
  return count;
}

export function activate(ctx: vscode.ExtensionContext): void {
  const store = new HistoryStore(ctx.globalStorageUri, workspaceKey());
  const lh = new LocalHistory(store, store.root);
  const report = (err: unknown): void => console.error('[storm-parity] localHistory', err);

  ctx.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, { provideTextDocumentContent: (uri) => lh.provide(uri) }),
    vscode.workspace.onWillSaveTextDocument((e) => {
      if (lh.isEligible(e.document)) e.waitUntil(lh.baseline(e.document).catch(report));
    }),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (lh.isEligible(doc)) lh.snapshot(doc, 'save').catch(report);
    }),
    vscode.commands.registerCommand('stormParity.localHistory.putLabel', () => putLabel(lh)),
    vscode.commands.registerCommand('stormParity.localHistory.showHistory', (arg?: unknown) => {
      const file = targetUri(arg);
      return file ? pickHistory(lh, file, 'diff') : undefined;
    }),
    vscode.commands.registerCommand('stormParity.localHistory.showHistoryForSelection', () => {
      const editor = vscode.window.activeTextEditor;
      return editor ? pickHistory(lh, editor.document.uri, 'diff', editor.selection) : undefined;
    }),
    vscode.commands.registerCommand('stormParity.localHistory.restore', (arg?: unknown) => {
      const file = targetUri(arg);
      return file ? pickHistory(lh, file, 'restore') : undefined;
    }),
  );

  void store.pruneAll(pruneOptions()).catch(report);
}
