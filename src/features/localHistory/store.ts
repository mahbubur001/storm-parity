import { createHash } from 'crypto';
import * as vscode from 'vscode';
import { EntrySource, HistoryEntry, HistoryIndex, newEntryId, normalizeIndex, orphans, prune, PruneOptions, shouldRecord } from './historyIndex';

const INDEX = 'index.json';
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const hashOf = (s: string, len = 40): string => createHash('sha1').update(s).digest('hex').slice(0, len);

/**
 * Snapshot storage: `<globalStorage>/localHistory/<workspace hash>/<file uri hash>/` holds an
 * `index.json` plus one `<content hash>.txt` per distinct content.
 */
export class HistoryStore {
  readonly root: vscode.Uri;
  private readonly workspaceDir: vscode.Uri;
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(globalStorage: vscode.Uri, workspaceKey: string) {
    this.root = vscode.Uri.joinPath(globalStorage, 'localHistory');
    this.workspaceDir = vscode.Uri.joinPath(this.root, hashOf(workspaceKey, 16));
  }

  fileDir(uri: vscode.Uri): vscode.Uri {
    return vscode.Uri.joinPath(this.workspaceDir, hashOf(uri.toString(), 16));
  }

  contentUri(uri: vscode.Uri, hash: string): vscode.Uri {
    return vscode.Uri.joinPath(this.fileDir(uri), `${hash}.txt`);
  }

  /** Serialises read-modify-write cycles per file so concurrent saves cannot clobber the index. */
  private exclusive<T>(dir: vscode.Uri, task: () => Promise<T>): Promise<T> {
    const key = dir.toString();
    const run = (this.queues.get(key) ?? Promise.resolve()).then(task, task);
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    this.queues.set(key, tail);
    void tail.then(() => {
      if (this.queues.get(key) === tail) this.queues.delete(key);
    });
    return run;
  }

  private async readIndex(dir: vscode.Uri, uri: string): Promise<HistoryIndex> {
    try {
      const raw = decoder.decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(dir, INDEX)));
      return normalizeIndex(JSON.parse(raw), uri);
    } catch {
      return normalizeIndex(undefined, uri);
    }
  }

  private async writeIndex(dir: vscode.Uri, index: HistoryIndex): Promise<void> {
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(dir, INDEX), encoder.encode(JSON.stringify(index)));
  }

  private async deleteContents(dir: vscode.Uri, hashes: readonly string[]): Promise<void> {
    for (const h of hashes) {
      try {
        await vscode.workspace.fs.delete(vscode.Uri.joinPath(dir, `${h}.txt`));
      } catch {
        // Already gone.
      }
    }
  }

  async list(uri: vscode.Uri): Promise<HistoryEntry[]> {
    const index = await this.readIndex(this.fileDir(uri), uri.toString());
    return [...index.entries].reverse();
  }

  async hasHistory(uri: vscode.Uri): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.joinPath(this.fileDir(uri), INDEX));
      return true;
    } catch {
      return false;
    }
  }

  async readContent(uri: vscode.Uri, hash: string): Promise<string> {
    return decoder.decode(await vscode.workspace.fs.readFile(this.contentUri(uri, hash)));
  }

  /** Stores `text` as a new snapshot unless it duplicates the latest one. */
  record(uri: vscode.Uri, text: string, source: EntrySource, opts: PruneOptions, label?: string): Promise<HistoryEntry | undefined> {
    const dir = this.fileDir(uri);
    return this.exclusive(dir, async () => {
      const index = await this.readIndex(dir, uri.toString());
      const hash = hashOf(text);
      if (!shouldRecord(index.entries, hash, source)) return undefined;
      await vscode.workspace.fs.createDirectory(dir);
      const body = this.contentUri(uri, hash);
      try {
        await vscode.workspace.fs.stat(body);
      } catch {
        await vscode.workspace.fs.writeFile(body, encoder.encode(text));
      }
      const entry: HistoryEntry = { id: newEntryId(opts.now), timestamp: opts.now, hash, size: text.length, source, ...(label ? { label } : {}) };
      const { kept, orphanHashes } = prune([...index.entries, entry], opts);
      await this.writeIndex(dir, { ...index, entries: kept });
      await this.deleteContents(dir, orphanHashes);
      return entry;
    });
  }

  remove(uri: vscode.Uri, entryId: string): Promise<void> {
    const dir = this.fileDir(uri);
    return this.exclusive(dir, async () => {
      const index = await this.readIndex(dir, uri.toString());
      const kept = index.entries.filter((e) => e.id !== entryId);
      await this.writeIndex(dir, { ...index, entries: kept });
      await this.deleteContents(dir, orphans(index.entries, kept));
    });
  }

  /** Applies retention to every file of every workspace and removes empty folders. */
  async pruneAll(opts: PruneOptions): Promise<void> {
    for (const ws of await this.children(this.root)) {
      let remaining = 0;
      for (const dir of await this.children(ws)) {
        const empty = await this.exclusive(dir, async () => {
          const index = await this.readIndex(dir, '');
          const { kept, orphanHashes } = prune(index.entries, opts);
          if (kept.length === 0) {
            await vscode.workspace.fs.delete(dir, { recursive: true, useTrash: false });
            return true;
          }
          if (kept.length !== index.entries.length) await this.writeIndex(dir, { ...index, entries: kept });
          await this.deleteContents(dir, orphanHashes);
          return false;
        });
        if (!empty) remaining++;
      }
      if (remaining === 0) await vscode.workspace.fs.delete(ws, { recursive: true, useTrash: false }).then(undefined, () => undefined);
    }
  }

  private async children(dir: vscode.Uri): Promise<vscode.Uri[]> {
    try {
      const entries = await vscode.workspace.fs.readDirectory(dir);
      return entries.filter(([, type]) => type === vscode.FileType.Directory).map(([name]) => vscode.Uri.joinPath(dir, name));
    } catch {
      return [];
    }
  }
}
