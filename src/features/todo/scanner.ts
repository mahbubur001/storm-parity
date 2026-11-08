import * as vscode from 'vscode';
import { buildTodoRegex, combineGlobs, findTodos, looksBinary, TodoMatch } from './matcher';

const CONFIG = 'stormParity.todo';
const BATCH = 40;

export interface FileTodos {
  uri: vscode.Uri;
  todos: TodoMatch[];
}

interface ScanSettings {
  regex: RegExp | undefined;
  exclude: string | undefined;
  maxFiles: number;
  maxBytes: number;
}

function readSettings(): ScanSettings {
  const cfg = vscode.workspace.getConfiguration(CONFIG);
  let regex: RegExp | undefined;
  try {
    regex = buildTodoRegex(cfg.get<string[]>('patterns', ['TODO', 'FIXME', 'HACK', 'XXX']), cfg.get<string>('regex', ''));
  } catch (err) {
    void vscode.window.showErrorMessage(`Storm TODO: invalid regex setting: ${err instanceof Error ? err.message : String(err)}`);
  }
  const enabledKeys = (obj: Record<string, unknown> | undefined): string[] =>
    Object.entries(obj ?? {})
      .filter(([, v]) => v === true)
      .map(([k]) => k);
  const exclude = combineGlobs([
    ...enabledKeys(vscode.workspace.getConfiguration('files').get<Record<string, unknown>>('exclude')),
    ...enabledKeys(vscode.workspace.getConfiguration('search').get<Record<string, unknown>>('exclude')),
    ...cfg.get<string[]>('exclude', []),
  ]);
  return {
    regex,
    exclude,
    maxFiles: cfg.get<number>('maxFiles', 5000),
    maxBytes: cfg.get<number>('maxFileSizeKB', 512) * 1024,
  };
}

/** Workspace-wide index of TODO matches, updated in full or per file. */
export class TodoIndex implements vscode.Disposable {
  private readonly files = new Map<string, FileTodos>();
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;
  private settings = readSettings();
  private cts: vscode.CancellationTokenSource | undefined;
  scanning = false;

  get all(): FileTodos[] {
    return [...this.files.values()];
  }

  reloadSettings(): void {
    this.settings = readSettings();
  }

  async scanAll(): Promise<void> {
    this.cts?.cancel();
    const cts = (this.cts = new vscode.CancellationTokenSource());
    const token = cts.token;
    this.scanning = true;
    this.emitter.fire();
    try {
      const uris = await vscode.workspace.findFiles('**/*', this.settings.exclude ?? null, this.settings.maxFiles, token);
      if (token.isCancellationRequested) return;
      this.files.clear();
      for (let i = 0; i < uris.length; i += BATCH) {
        if (token.isCancellationRequested) return;
        await Promise.all(uris.slice(i, i + BATCH).map((u) => this.scanUri(u, false)));
        this.emitter.fire();
        // Yield to the extension host event loop between batches.
        await new Promise<void>((r) => setImmediate(r));
      }
    } finally {
      if (this.cts === cts) {
        this.scanning = false;
        this.cts = undefined;
        cts.dispose();
        this.emitter.fire();
      }
    }
  }

  /** Re-scans one file from disk if it is included by the workspace globs. */
  async updateUri(uri: vscode.Uri): Promise<void> {
    if (!(await this.isIncluded(uri))) {
      this.remove(uri);
      return;
    }
    await this.scanUri(uri, true);
  }

  /** Re-scans an open document from its in-memory text. */
  async updateDocument(doc: vscode.TextDocument): Promise<void> {
    if (doc.uri.scheme !== 'file' && doc.uri.scheme !== 'vscode-remote') return;
    if (!(await this.isIncluded(doc.uri))) return;
    this.set(doc.uri, this.settings.regex ? findTodos(doc.getText(), this.settings.regex) : []);
    this.emitter.fire();
  }

  remove(uri: vscode.Uri): void {
    const key = uri.toString();
    let changed = this.files.delete(key);
    // A deleted folder removes everything below it.
    const prefix = key.endsWith('/') ? key : `${key}/`;
    for (const k of [...this.files.keys()]) if (k.startsWith(prefix)) changed = this.files.delete(k) || changed;
    if (changed) this.emitter.fire();
  }

  private async isIncluded(uri: vscode.Uri): Promise<boolean> {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder) return false;
    const rel = vscode.workspace.asRelativePath(uri, false).replace(/[[\]{}*?]/g, (c) => `[${c}]`);
    const found = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, rel), this.settings.exclude ?? null, 1);
    return found.length > 0;
  }

  private async scanUri(uri: vscode.Uri, fire: boolean): Promise<void> {
    const regex = this.settings.regex;
    let todos: TodoMatch[] = [];
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (regex && stat.type & vscode.FileType.File && stat.size <= this.settings.maxBytes) {
        const bytes = await vscode.workspace.fs.readFile(uri);
        if (!looksBinary(bytes)) todos = findTodos(new TextDecoder().decode(bytes), regex);
      }
    } catch {
      todos = [];
    }
    this.set(uri, todos);
    if (fire) this.emitter.fire();
  }

  private set(uri: vscode.Uri, todos: TodoMatch[]): void {
    if (todos.length === 0) this.files.delete(uri.toString());
    else this.files.set(uri.toString(), { uri, todos });
  }

  dispose(): void {
    this.cts?.cancel();
    this.emitter.dispose();
  }
}
