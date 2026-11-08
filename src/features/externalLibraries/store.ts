import * as vscode from 'vscode';
import { contractPath, effectivePaths, expandPath, mergeManaged, stringList } from './core';

export const SECTION = 'stormParity.externalLibraries';
/** Settings section of the standalone iExternal Libraries extension, read as a fallback. */
export const LEGACY_SECTION = 'iextlibraries';
const INTELEPHENSE_ID = 'bmewburn.vscode-intelephense-client';
const MANAGED_KEY = 'stormParity.externalLibraries.intelephenseManaged';

export interface Library {
  stored: string;
  path: string;
}

function storedPaths(): string[] {
  const config = vscode.workspace.getConfiguration(SECTION);
  const legacy = vscode.workspace.getConfiguration(LEGACY_SECTION).get<unknown>('includePaths');
  return effectivePaths(config.inspect('includePaths'), config.get<unknown>('includePaths'), legacy);
}

function syncEnabled(): boolean {
  const current = vscode.workspace.getConfiguration(SECTION).inspect<boolean>('intelephenseSync');
  if (current?.globalValue !== undefined || current?.workspaceValue !== undefined || current?.workspaceFolderValue !== undefined) {
    return vscode.workspace.getConfiguration(SECTION).get('intelephenseSync', true);
  }
  return vscode.workspace.getConfiguration(LEGACY_SECTION).get('intelephense.sync', true);
}

/**
 * The include-path list (PhpStorm: Settings > PHP > Include Path), stored in the workspace setting
 * `stormParity.externalLibraries.includePaths`, and its mirror in Intelephense's `intelephense.environment.includePaths`.
 */
export class LibraryStore implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;
  private readonly disposables: vscode.Disposable[];

  constructor(private readonly state: vscode.Memento) {
    this.disposables = [
      this.emitter,
      vscode.workspace.onDidChangeConfiguration((e) => {
        const relevant = [`${SECTION}.includePaths`, `${SECTION}.intelephenseSync`, `${LEGACY_SECTION}.includePaths`, `${LEGACY_SECTION}.intelephense`];
        if (!relevant.some((key) => e.affectsConfiguration(key))) return;
        this.emitter.fire();
        void this.syncIntelephense();
      }),
      vscode.extensions.onDidChange(() => void this.syncIntelephense()),
    ];
  }

  /** Relative paths are resolved against the first workspace folder. */
  get base(): string {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
  }

  get libraries(): Library[] {
    const seen = new Set<string>();
    return storedPaths()
      .filter((s) => s.trim())
      .map((s) => ({ stored: s, path: expandPath(s, this.base) }))
      .filter((l) => !seen.has(l.path) && seen.add(l.path));
  }

  async add(absolutePaths: readonly string[]): Promise<number> {
    const current = storedPaths();
    const known = new Set(this.libraries.map((l) => l.path));
    const added = absolutePaths.filter((p) => !known.has(p) && known.add(p));
    if (added.length === 0) return 0;
    await this.write([...current, ...added.map((p) => contractPath(p))]);
    return added.length;
  }

  async remove(absolutePath: string): Promise<void> {
    await this.write(this.libraries.filter((l) => l.path !== absolutePath).map((l) => l.stored));
  }

  /** Always writes the Storm Parity key; the legacy key is left untouched for teammates still on the old extension. */
  private async write(paths: string[]): Promise<void> {
    await vscode.workspace.getConfiguration(SECTION).update('includePaths', paths, vscode.ConfigurationTarget.Workspace);
  }

  /**
   * Mirrors the libraries into Intelephense so completion and Go to Definition index them. Entries the user added to
   * Intelephense themselves are kept; only entries this extension (or the legacy one) added before are replaced.
   */
  async syncIntelephense(): Promise<void> {
    if (!vscode.workspace.workspaceFolders?.length) return;
    if (!syncEnabled()) return;
    if (!vscode.extensions.getExtension(INTELEPHENSE_ID)) return;
    const config = vscode.workspace.getConfiguration('intelephense.environment');
    const currentList = stringList(config.inspect('includePaths')?.workspaceValue);
    // Before the first sync, the legacy extension's libraries are what it put into Intelephense.
    const legacyManaged = stringList(vscode.workspace.getConfiguration(LEGACY_SECTION).get('includePaths')).map((s) => expandPath(s, this.base));
    const managed = this.state.get<string[]>(MANAGED_KEY, legacyManaged);
    const ours = this.libraries.map((l) => l.path);
    const next = mergeManaged(currentList, managed, ours);
    await this.state.update(MANAGED_KEY, ours);
    if (next.length === currentList.length && next.every((p, i) => p === currentList[i])) return;
    // An emptied list is removed instead of leaving "includePaths": [] behind.
    await config.update('includePaths', next.length ? next : undefined, vscode.ConfigurationTarget.Workspace);
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}
