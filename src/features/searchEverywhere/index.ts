import * as vscode from 'vscode';
import { CATEGORIES, Category, parseQuery, prefixFor } from './query';
import {
  ActionEntry,
  collectActions,
  collectSettings,
  commandPaletteItem,
  matchActions,
  matchSettings,
  ResultItem,
  searchFiles,
  searchSymbols,
  SettingEntry,
  Target,
} from './sources';

type PickItem = vscode.QuickPickItem & { target?: Target };

const DEBOUNCE_MS = 120;
const ICONS: Record<Category, string> = { all: 'search', files: 'file', symbols: 'symbol-class', actions: 'symbol-event', settings: 'settings-gear' };

interface CategoryButton extends vscode.QuickInputButton {
  category: Category;
}

const buttons: CategoryButton[] = CATEGORIES.map((c) => ({
  category: c.id,
  iconPath: new vscode.ThemeIcon(ICONS[c.id]),
  tooltip: c.prefix ? `${c.label} (prefix "${c.prefix.trim()}")` : c.label,
}));

const placeholder = `Search everywhere. Prefixes: ${CATEGORIES.filter((c) => c.prefix)
  .map((c) => `"${c.prefix.trim()}" ${c.label.toLowerCase()}`)
  .join(', ')}`;

/** Lazily collected extension contributions, invalidated when extensions change. */
class ContributionCache {
  private actions?: ActionEntry[];
  private settings?: SettingEntry[];

  getActions(): ActionEntry[] {
    return (this.actions ??= collectActions());
  }

  getSettings(): SettingEntry[] {
    return (this.settings ??= collectSettings());
  }

  clear(): void {
    this.actions = undefined;
    this.settings = undefined;
  }
}

const separator = (label: string): PickItem => ({ label, kind: vscode.QuickPickItemKind.Separator });

function helpItems(): PickItem[] {
  return CATEGORIES.filter((c) => c.prefix).map((c) => ({
    label: `$(${ICONS[c.id]}) ${c.label}`,
    description: `type "${c.prefix.trim()}" to search ${c.label.toLowerCase()} only`,
    target: { type: 'prefix', prefix: c.prefix },
    alwaysShow: true,
  }));
}

async function openTarget(target: Target): Promise<void> {
  switch (target.type) {
    case 'file':
      await vscode.window.showTextDocument(target.uri, { preview: false });
      return;
    case 'symbol': {
      const editor = await vscode.window.showTextDocument(target.location.uri, { preview: false });
      const range = target.location.range;
      editor.selection = new vscode.Selection(range.start, range.start);
      editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
      return;
    }
    case 'command':
      await vscode.commands.executeCommand(target.id);
      return;
    case 'commandPalette':
      await vscode.commands.executeCommand('workbench.action.quickOpen', `>${target.text}`);
      return;
    case 'setting':
      await vscode.commands.executeCommand('workbench.action.openSettings', target.key);
      return;
    case 'prefix':
      return;
  }
}

class SearchSession {
  private readonly qp = vscode.window.createQuickPick<PickItem>();
  private readonly disposables: vscode.Disposable[] = [];
  private cts?: vscode.CancellationTokenSource;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly cache: ContributionCache,
    initial: string,
  ) {
    const { qp } = this;
    qp.placeholder = placeholder;
    qp.buttons = buttons;
    qp.matchOnDescription = false;
    qp.matchOnDetail = false;
    qp.value = initial;
    this.disposables.push(
      qp.onDidChangeValue(() => this.schedule()),
      qp.onDidTriggerButton((b) => {
        const category = (b as CategoryButton).category;
        qp.value = prefixFor(category) + parseQuery(qp.value).text;
        this.schedule();
      }),
      qp.onDidAccept(() => this.accept()),
      qp.onDidHide(() => this.dispose()),
    );
  }

  show(): void {
    this.qp.show();
    void this.update();
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.cts?.cancel();
    this.timer = setTimeout(() => void this.update(), DEBOUNCE_MS);
  }

  private async update(): Promise<void> {
    this.cts?.cancel();
    this.cts?.dispose();
    const cts = new vscode.CancellationTokenSource();
    this.cts = cts;
    const token = cts.token;
    const { category, text } = parseQuery(this.qp.value);
    this.qp.title = `Search Everywhere: ${CATEGORIES.find((c) => c.id === category)?.label ?? 'All'}`;

    if (!text) {
      this.qp.items = category === 'all' ? helpItems() : category === 'actions' ? [commandPaletteItem('')] : [];
      return;
    }

    const all = category === 'all';
    const limit = all ? 10 : 100;
    const sections: Array<{ label: string; items: ResultItem[] }> = [];
    const render = (): void => {
      if (token.isCancellationRequested) return;
      const out: PickItem[] = [];
      for (const s of sections) {
        if (s.items.length === 0) continue;
        if (all) out.push(separator(s.label));
        out.push(...s.items);
      }
      this.qp.items = out;
    };
    const section = (label: string): { label: string; items: ResultItem[] } => {
      const s = { label, items: [] as ResultItem[] };
      sections.push(s);
      return s;
    };

    // Fixed section order so results do not jump around while async sources resolve.
    const files = all || category === 'files' ? section('Files') : undefined;
    const symbols = all || category === 'symbols' ? section('Symbols') : undefined;
    const actions = all || category === 'actions' ? section('Actions') : undefined;
    const settings = all || category === 'settings' ? section('Settings') : undefined;

    if (actions) actions.items = [...matchActions(this.cache.getActions(), text, limit), commandPaletteItem(text)];
    if (settings) settings.items = matchSettings(this.cache.getSettings(), text, all ? 5 : limit);
    render();

    this.qp.busy = true;
    const pending: Array<Promise<void>> = [];
    if (files) pending.push(searchFiles(text, limit, token).then((r) => { files.items = r; render(); }));
    if (symbols) pending.push(searchSymbols(text, limit, token).then((r) => { symbols.items = r; render(); }));
    await Promise.allSettled(pending);
    if (!token.isCancellationRequested) this.qp.busy = false;
  }

  private accept(): void {
    const [item] = this.qp.selectedItems;
    const target = item?.target;
    if (!target) return;
    if (target.type === 'prefix') {
      this.qp.value = target.prefix;
      this.schedule();
      return;
    }
    this.qp.hide();
    void openTarget(target).then(undefined, (err: unknown) => {
      void vscode.window.showErrorMessage(`Search Everywhere: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  private dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.cts?.cancel();
    this.cts?.dispose();
    for (const d of this.disposables) d.dispose();
    this.qp.dispose();
  }
}

function initialText(category: Category | undefined): string {
  const editor = vscode.window.activeTextEditor;
  const sel = editor && !editor.selection.isEmpty && editor.selection.isSingleLine ? editor.document.getText(editor.selection) : '';
  return prefixFor(category ?? 'all') + sel;
}

export function activate(ctx: vscode.ExtensionContext): void {
  const cache = new ContributionCache();
  ctx.subscriptions.push(
    vscode.extensions.onDidChange(() => cache.clear()),
    vscode.commands.registerCommand('stormParity.searchEverywhere.open', (category?: Category) => {
      const valid = CATEGORIES.some((c) => c.id === category) ? category : undefined;
      new SearchSession(cache, initialText(valid)).show();
    }),
  );
}
