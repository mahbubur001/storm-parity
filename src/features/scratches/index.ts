import * as vscode from 'vscode';
import { nextScratchName, orderByRecent, touchRecent, validateFileName } from './names';

const RECENT_KEY = 'stormParity.scratches.recentLanguages';
const VIEW_ID = 'stormParity.scratches';

interface LanguageInfo {
  id: string;
  name: string;
  ext: string;
}

interface LanguagePick extends vscode.QuickPickItem {
  lang?: LanguageInfo;
}

interface LanguageContribution {
  id?: string;
  extensions?: string[];
  aliases?: string[];
}

/** Language id to display name and preferred file extension, from every extension's contributes.languages. */
function languageCatalogue(): Map<string, { name?: string; ext?: string }> {
  const map = new Map<string, { name?: string; ext?: string }>();
  for (const ext of vscode.extensions.all) {
    const langs = (ext.packageJSON as { contributes?: { languages?: LanguageContribution[] } }).contributes?.languages;
    if (!Array.isArray(langs)) continue;
    for (const l of langs) {
      if (!l.id) continue;
      const entry = map.get(l.id) ?? {};
      entry.name ??= l.aliases?.[0];
      entry.ext ??= l.extensions?.find((e) => /^\.[\w.+-]+$/.test(e))?.replace(/^\./, '');
      map.set(l.id, entry);
    }
  }
  return map;
}

async function availableLanguages(): Promise<LanguageInfo[]> {
  const ids = await vscode.languages.getLanguages();
  const cat = languageCatalogue();
  const out: LanguageInfo[] = [];
  for (const id of ids) {
    const info = cat.get(id);
    const ext = id === 'plaintext' ? 'txt' : info?.ext;
    if (!ext) continue;
    out.push({ id, name: info?.name ?? id, ext });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

class ScratchItem extends vscode.TreeItem {
  constructor(public readonly uri: vscode.Uri, name: string) {
    super(uri, vscode.TreeItemCollapsibleState.None);
    this.label = name;
    this.contextValue = 'scratchFile';
    this.tooltip = uri.fsPath;
    this.command = { command: 'vscode.open', title: 'Open', arguments: [uri] };
  }
}

class ScratchesProvider implements vscode.TreeDataProvider<ScratchItem> {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly dir: vscode.Uri) {}

  refresh(): void {
    this.emitter.fire();
  }

  getTreeItem(item: ScratchItem): vscode.TreeItem {
    return item;
  }

  async getChildren(): Promise<ScratchItem[]> {
    const names = await listScratches(this.dir);
    return names.map((n) => new ScratchItem(vscode.Uri.joinPath(this.dir, n), n));
  }

  dispose(): void {
    this.emitter.dispose();
  }
}

async function listScratches(dir: vscode.Uri): Promise<string[]> {
  try {
    const entries = await vscode.workspace.fs.readDirectory(dir);
    return entries
      .filter(([, type]) => type & vscode.FileType.File)
      .map(([name]) => name)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  } catch {
    return [];
  }
}

export async function activate(ctx: vscode.ExtensionContext): Promise<void> {
  const dir = vscode.Uri.joinPath(ctx.globalStorageUri, 'scratches');
  await vscode.workspace.fs.createDirectory(dir);

  const provider = new ScratchesProvider(dir);
  const view = vscode.window.createTreeView(VIEW_ID, { treeDataProvider: provider, showCollapseAll: false });
  const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(dir, '*'));
  const refresh = (): void => provider.refresh();

  const pickLanguage = async (): Promise<LanguageInfo | undefined> => {
    const recent = ctx.globalState.get<string[]>(RECENT_KEY, []);
    const langs = await availableLanguages();
    const ordered = orderByRecent(langs, recent, (l) => l.id);
    const recentCount = ordered.findIndex((l) => !recent.includes(l.id));
    const toPick = (lang: LanguageInfo): LanguagePick => ({ label: lang.name, description: `.${lang.ext}`, lang });
    const items: LanguagePick[] = [];
    const split = recentCount < 0 ? ordered.length : recentCount;
    if (split > 0) items.push({ label: 'Recently used', kind: vscode.QuickPickItemKind.Separator }, ...ordered.slice(0, split).map(toPick));
    if (split < ordered.length) items.push({ label: 'All languages', kind: vscode.QuickPickItemKind.Separator }, ...ordered.slice(split).map(toPick));
    const pick = await vscode.window.showQuickPick(items, { title: 'New Scratch File', placeHolder: 'Select a language', matchOnDescription: true });
    return pick?.lang;
  };

  const createScratch = async (lang: LanguageInfo, content: string): Promise<void> => {
    const name = nextScratchName(await listScratches(dir), lang.ext);
    const uri = vscode.Uri.joinPath(dir, name);
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content));
    await ctx.globalState.update(RECENT_KEY, touchRecent(ctx.globalState.get<string[]>(RECENT_KEY, []), lang.id));
    let doc = await vscode.workspace.openTextDocument(uri);
    if (doc.languageId !== lang.id) doc = await vscode.languages.setTextDocumentLanguage(doc, lang.id);
    await vscode.window.showTextDocument(doc);
    refresh();
  };

  const targetUri = (item?: ScratchItem): vscode.Uri | undefined => {
    if (item) return item.uri;
    const selected = view.selection[0];
    if (selected) return selected.uri;
    const active = vscode.window.activeTextEditor?.document.uri;
    return active && active.toString().startsWith(dir.toString() + '/') ? active : undefined;
  };

  ctx.subscriptions.push(
    provider,
    view,
    watcher,
    watcher.onDidCreate(refresh),
    watcher.onDidDelete(refresh),
    watcher.onDidChange(refresh),
    vscode.commands.registerCommand('stormParity.scratches.new', async () => {
      const lang = await pickLanguage();
      if (lang) await createScratch(lang, '');
    }),
    vscode.commands.registerCommand('stormParity.scratches.newFromSelection', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        void vscode.window.showWarningMessage('Storm: open an editor to create a scratch from its selection.');
        return;
      }
      const doc = editor.document;
      const content = editor.selections.some((s) => !s.isEmpty)
        ? editor.selections.filter((s) => !s.isEmpty).map((s) => doc.getText(s)).join(doc.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n')
        : doc.getText();
      const langs = await availableLanguages();
      const lang = langs.find((l) => l.id === doc.languageId) ?? (await pickLanguage());
      if (lang) await createScratch(lang, content);
    }),
    vscode.commands.registerCommand('stormParity.scratches.refresh', refresh),
    vscode.commands.registerCommand('stormParity.scratches.rename', async (item?: ScratchItem) => {
      const uri = targetUri(item);
      if (!uri) return;
      const oldName = uri.path.split('/').pop() ?? '';
      const dot = oldName.lastIndexOf('.');
      const newName = await vscode.window.showInputBox({
        title: 'Rename Scratch File',
        value: oldName,
        valueSelection: [0, dot > 0 ? dot : oldName.length],
        validateInput: validateFileName,
      });
      if (!newName || newName.trim() === oldName) return;
      const target = vscode.Uri.joinPath(dir, newName.trim());
      try {
        await vscode.workspace.fs.rename(uri, target, { overwrite: false });
      } catch (err) {
        void vscode.window.showErrorMessage(`Storm: could not rename scratch: ${err instanceof Error ? err.message : String(err)}`);
      }
      refresh();
    }),
    vscode.commands.registerCommand('stormParity.scratches.delete', async (item?: ScratchItem) => {
      const uri = targetUri(item);
      if (!uri) return;
      const name = uri.path.split('/').pop();
      const ok = await vscode.window.showWarningMessage(`Delete scratch file "${name}"?`, { modal: true }, 'Delete');
      if (ok !== 'Delete') return;
      await vscode.workspace.fs.delete(uri, { useTrash: false });
      refresh();
    }),
    vscode.commands.registerCommand('stormParity.scratches.reveal', async (item?: ScratchItem) => {
      const uri = targetUri(item) ?? dir;
      await vscode.commands.executeCommand('revealFileInOS', uri);
    }),
  );
}
