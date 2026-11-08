import * as vscode from 'vscode';
import { parseLocations, recordLocation, RecentLocation, removeLocations, renameLocations, shiftLocations } from './model';
import { baseName, readLines, relativePath, restoreEditor, showLine, snapshotEditor, toLineChange } from './editorUtil';

const STATE_KEY = 'stormParity.recentLocations.items';
const PICKER_CONTEXT = 'stormParity.recentLocations.pickerOpen';
const RECORD_SCHEMES = new Set(['file', 'vscode-remote']);
const SELECTION_DEBOUNCE_MS = 400;

interface LocationItem extends vscode.QuickPickItem {
  location: RecentLocation;
}

function settings(): { maxEntries: number; mergeDistance: number } {
  const c = vscode.workspace.getConfiguration('stormParity.recentLocations');
  return { maxEntries: c.get<number>('maxEntries', 50), mergeDistance: c.get<number>('mergeDistance', 5) };
}

async function toItems(list: readonly RecentLocation[], changedOnly: boolean): Promise<LocationItem[]> {
  const cache = new Map<string, string[]>();
  const items: LocationItem[] = [];
  for (const location of list) {
    if (changedOnly && !location.changed) continue;
    const uri = vscode.Uri.parse(location.uri);
    if (!cache.has(location.uri)) cache.set(location.uri, await readLines(uri));
    const lines = cache.get(location.uri) ?? [];
    const text = lines[location.line]?.trim() ?? '';
    const context = lines.slice(location.line + 1, location.line + 3).map((l) => l.trim()).find(Boolean);
    items.push({
      location,
      label: `${location.changed ? '$(edit) ' : '$(eye) '}${baseName(uri)}:${location.line + 1}`,
      description: relativePath(uri),
      detail: context ? `${text}  |  ${context}` : text,
    });
  }
  return items;
}

export function activate(ctx: vscode.ExtensionContext): void {
  let list = parseLocations(ctx.workspaceState.get<unknown>(STATE_KEY));
  let suspended = false;
  let togglePicker: (() => void) | undefined;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let selectionTimer: ReturnType<typeof setTimeout> | undefined;

  const update = (next: RecentLocation[] | undefined): void => {
    if (!next) return;
    list = next;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void ctx.workspaceState.update(STATE_KEY, list), 500);
  };

  const record = (doc: vscode.TextDocument, pos: vscode.Position, changed: boolean): void => {
    if (suspended || !RECORD_SCHEMES.has(doc.uri.scheme)) return;
    const entry = { uri: doc.uri.toString(), line: pos.line, character: pos.character, changed, timestamp: Date.now() };
    update(recordLocation(list, entry, settings()));
  };

  const recordActiveNow = (): void => {
    clearTimeout(selectionTimer);
    const e = vscode.window.activeTextEditor;
    if (e) record(e.document, e.selection.active, false);
  };

  const show = async (): Promise<void> => {
    recordActiveNow();
    const original = snapshotEditor();
    const qp = vscode.window.createQuickPick<LocationItem>();
    qp.matchOnDescription = true;
    qp.matchOnDetail = true;
    let changedOnly = false;
    let accepted = false;
    let previewed = false;

    const render = async (): Promise<void> => {
      qp.title = changedOnly ? 'Recently Changed Locations' : 'Recent Locations';
      qp.placeholder = changedOnly ? 'Changed locations (press again to show all)' : 'Viewed and changed locations (press again for changed only)';
      qp.buttons = [
        {
          iconPath: new vscode.ThemeIcon(changedOnly ? 'filter-filled' : 'filter'),
          tooltip: changedOnly ? 'Show all locations' : 'Show changed locations only',
        },
      ];
      qp.items = await toItems(list, changedOnly);
    };
    togglePicker = () => {
      changedOnly = !changedOnly;
      void render();
    };

    const preview = (item: LocationItem | undefined, final: boolean): Promise<unknown> | undefined =>
      item &&
      showLine(vscode.Uri.parse(item.location.uri), item.location.line, item.location.character, {
        preview: !final,
        preserveFocus: !final,
        viewColumn: original?.viewColumn,
      }).then(undefined, () => undefined);

    suspended = true;
    const disposables: vscode.Disposable[] = [
      qp.onDidTriggerButton(() => togglePicker?.()),
      qp.onDidChangeActive(([item]) => {
        previewed = true;
        void preview(item, false);
      }),
      qp.onDidAccept(() => {
        const [item] = qp.selectedItems;
        if (!item) return;
        accepted = true;
        qp.hide();
        void preview(item, true);
      }),
      qp.onDidHide(async () => {
        disposables.forEach((d) => d.dispose());
        qp.dispose();
        togglePicker = undefined;
        void vscode.commands.executeCommand('setContext', PICKER_CONTEXT, false);
        if (!accepted && previewed && original) await restoreEditor(original).then(undefined, () => undefined);
        suspended = false;
        recordActiveNow();
      }),
    ];
    await render();
    void vscode.commands.executeCommand('setContext', PICKER_CONTEXT, true);
    qp.show();
  };

  ctx.subscriptions.push(
    { dispose: () => [saveTimer, selectionTimer].forEach(clearTimeout) },
    vscode.commands.registerCommand('stormParity.recentLocations.show', show),
    vscode.commands.registerCommand('stormParity.recentLocations.toggleChangedOnly', () => togglePicker?.()),
    vscode.commands.registerCommand('stormParity.recentLocations.clear', () => update([])),

    vscode.window.onDidChangeTextEditorSelection((e) => {
      if (e.textEditor !== vscode.window.activeTextEditor) return;
      clearTimeout(selectionTimer);
      selectionTimer = setTimeout(() => record(e.textEditor.document, e.textEditor.selection.active, false), SELECTION_DEBOUNCE_MS);
    }),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.contentChanges.length === 0) return;
      const uri = e.document.uri.toString();
      update(shiftLocations(list, uri, e.contentChanges.map(toLineChange)));
      if (vscode.window.activeTextEditor?.document === e.document) {
        const start = e.contentChanges.reduce((min, c) => (c.range.start.isBefore(min) ? c.range.start : min), e.contentChanges[0].range.start);
        record(e.document, start, true);
      }
    }),
    vscode.workspace.onDidRenameFiles((e) => {
      for (const f of e.files) update(renameLocations(list, f.oldUri.toString(), f.newUri.toString()));
    }),
    vscode.workspace.onDidDeleteFiles((e) => {
      for (const uri of e.files) update(removeLocations(list, uri.toString()));
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('stormParity.recentLocations.maxEntries')) update(list.slice(0, Math.max(1, settings().maxEntries)));
    }),
  );
}
