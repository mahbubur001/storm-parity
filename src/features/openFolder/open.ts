// Opening with the where-to-open prompt, plus the recent-list plumbing behind Open Recent.
import * as fs from 'fs';
import * as vscode from 'vscode';
import { RecentEntry, kindOf, mergeEntries, removeEntry, sameUri, touchEntry } from './mru';

export type OpenMode = 'thisWindow' | 'newWindow' | 'attach';

const MRU_KEY = 'stormParity.openFolder.mru';
const MRU_MAX = 50;

/** Own MRU kept in globalState. Used as fallback and to remember opens VS Code may not know yet. */
export class MruStore {
  constructor(private readonly memento: vscode.Memento) {}

  list(): RecentEntry[] {
    return this.memento.get<RecentEntry[]>(MRU_KEY, []);
  }

  async touch(uri: vscode.Uri): Promise<void> {
    const entry: RecentEntry = { uri: uri.toString(), kind: kindOf(uri.path), lastOpened: Date.now() };
    await this.memento.update(MRU_KEY, touchEntry(this.list(), entry, MRU_MAX));
  }

  async remove(uri: string): Promise<void> {
    await this.memento.update(MRU_KEY, removeEntry(this.list(), uri));
  }
}

let store: MruStore | undefined;

/** Returns the shared store, creating it on first call. Safe to call from any feature. */
export function initMruStore(ctx: vscode.ExtensionContext): MruStore {
  store ??= new MruStore(ctx.globalState);
  return store;
}

/** The uri of the folder / workspace file open in this window, if any. */
export function currentProjectUri(): vscode.Uri | undefined {
  const wsFile = vscode.workspace.workspaceFile;
  if (wsFile) return wsFile.scheme === 'untitled' ? undefined : wsFile;
  const folders = vscode.workspace.workspaceFolders;
  return folders?.length === 1 ? folders[0].uri : undefined;
}

export function isCurrentProject(uri: string): boolean {
  const current = currentProjectUri();
  return !!current && sameUri(current.toString(), uri);
}

export function hasOpenProject(): boolean {
  return !!vscode.workspace.workspaceFile || (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
}

/** Records the current window's project in the MRU. */
export async function recordCurrentProject(): Promise<void> {
  const current = currentProjectUri();
  if (current && store) await store.touch(current);
}

function toUri(value: unknown): vscode.Uri | undefined {
  if (value instanceof vscode.Uri) return value;
  if (typeof value === 'string') {
    try {
      return vscode.Uri.parse(value, true);
    } catch {
      return undefined;
    }
  }
  if (value && typeof value === 'object' && 'scheme' in value && 'path' in value) {
    const v = value as { scheme: string; authority?: string; path: string; query?: string; fragment?: string };
    return vscode.Uri.from({ scheme: v.scheme, authority: v.authority, path: v.path, query: v.query, fragment: v.fragment });
  }
  return undefined;
}

interface RawRecent {
  folderUri?: unknown;
  workspace?: { configPath?: unknown };
  label?: string;
}

/** Reads VS Code's own recent list via the internal command. Undefined when unavailable. */
async function readBuiltinRecent(): Promise<RecentEntry[] | undefined> {
  try {
    const res = await vscode.commands.executeCommand<{ workspaces?: RawRecent[] } | undefined>('_workbench.getRecentlyOpened');
    if (!res || !Array.isArray(res.workspaces)) return undefined;
    const out: RecentEntry[] = [];
    for (const w of res.workspaces) {
      const folder = toUri(w.folderUri);
      if (folder) {
        out.push({ uri: folder.toString(), kind: 'folder', label: w.label });
        continue;
      }
      const ws = toUri(w.workspace?.configPath);
      if (ws) out.push({ uri: ws.toString(), kind: 'workspace', label: w.label });
    }
    return out;
  } catch {
    return undefined;
  }
}

/** True unless the uri is a local path that no longer exists. Remote uris are kept. */
export function entryExists(uri: string): boolean {
  const parsed = vscode.Uri.parse(uri);
  return parsed.scheme !== 'file' || fs.existsSync(parsed.fsPath);
}

/** Recent folders/workspaces: VS Code's list first (if readable), then our MRU, minus missing local paths. */
export async function listRecent(): Promise<RecentEntry[]> {
  const own = store?.list() ?? [];
  const builtin = await readBuiltinRecent();
  return (builtin ? mergeEntries(builtin, own) : own).filter((e) => entryExists(e.uri));
}

/** Removes an entry from both our MRU and VS Code's recent list. */
export async function removeRecent(uri: string): Promise<void> {
  try {
    await vscode.commands.executeCommand('vscode.removeFromRecentlyOpened', vscode.Uri.parse(uri));
  } catch {
    // not in VS Code's list, or command unavailable
  }
  await store?.remove(uri);
}

/** Opens a folder or .code-workspace file in the given mode. */
export async function openTarget(uri: vscode.Uri, mode: OpenMode): Promise<void> {
  if (mode === 'attach' && kindOf(uri.path) === 'folder') {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.some((f) => sameUri(f.uri.toString(), uri.toString()))) {
      void vscode.window.showInformationMessage(`${uri.fsPath || uri.toString()} is already part of this workspace.`);
      return;
    }
    if (!vscode.workspace.updateWorkspaceFolders(folders.length, 0, { uri })) {
      void vscode.window.showErrorMessage('Could not add the folder to the current workspace.');
    }
    return;
  }
  await store?.touch(uri);
  await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: mode === 'newWindow' });
}
