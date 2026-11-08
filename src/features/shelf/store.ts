// Shelf storage: <base>/index.json plus <base>/<repoHash>/<id>.patch. Node-only, no vscode imports.
import { promises as fs } from 'fs';
import * as path from 'path';

export interface ShelvedFile {
  path: string;
  /** Status letter at shelve time (M, A, D, R, U, ...). */
  status: string;
}

export interface ShelfEntry {
  id: string;
  name: string;
  /** ISO timestamp. */
  date: string;
  repoRoot: string;
  repoHash: string;
  files: ShelvedFile[];
  /** Changelist the files came from, restored on unshelve when possible. */
  changelist?: string;
}

interface IndexFile {
  version: 1;
  entries: ShelfEntry[];
}

function isEntry(v: unknown): v is ShelfEntry {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.id === 'string' &&
    typeof e.name === 'string' &&
    typeof e.date === 'string' &&
    typeof e.repoRoot === 'string' &&
    typeof e.repoHash === 'string' &&
    Array.isArray(e.files)
  );
}

export class ShelfStore {
  private cache: ShelfEntry[] | undefined;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(readonly baseDir: string) {}

  private get indexPath(): string {
    return path.join(this.baseDir, 'index.json');
  }

  patchPath(entry: Pick<ShelfEntry, 'id' | 'repoHash'>): string {
    if (!/^[\w-]+$/.test(entry.id) || !/^[\w-]+$/.test(entry.repoHash)) throw new Error('Invalid shelf entry id.');
    return path.join(this.baseDir, entry.repoHash, `${entry.id}.patch`);
  }

  async list(): Promise<ShelfEntry[]> {
    if (!this.cache) {
      try {
        const raw: unknown = JSON.parse(await fs.readFile(this.indexPath, 'utf8'));
        const entries = typeof raw === 'object' && raw !== null ? (raw as Partial<IndexFile>).entries : undefined;
        this.cache = Array.isArray(entries) ? entries.filter(isEntry) : [];
      } catch {
        this.cache = [];
      }
    }
    return [...this.cache].sort((a, b) => b.date.localeCompare(a.date));
  }

  async get(id: string): Promise<ShelfEntry | undefined> {
    return (await this.list()).find((e) => e.id === id);
  }

  /** Writes the patch, verifies it, then records the entry. */
  add(entry: ShelfEntry, patch: Buffer): Promise<void> {
    return this.serial(async () => {
      const file = this.patchPath(entry);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, patch);
      const written = await fs.readFile(file);
      if (!written.equals(patch)) throw new Error('Shelf patch could not be verified after writing.');
      const entries = await this.list();
      entries.push(entry);
      await this.writeIndex(entries);
    });
  }

  remove(id: string): Promise<void> {
    return this.serial(async () => {
      const entries = await this.list();
      const entry = entries.find((e) => e.id === id);
      if (!entry) return;
      await this.writeIndex(entries.filter((e) => e.id !== id));
      await fs.rm(this.patchPath(entry), { force: true });
    });
  }

  rename(id: string, name: string): Promise<void> {
    return this.serial(async () => {
      const entries = await this.list();
      const entry = entries.find((e) => e.id === id);
      if (!entry) throw new Error('Shelf entry not found.');
      entry.name = name;
      await this.writeIndex(entries);
    });
  }

  async readPatch(entry: ShelfEntry): Promise<Buffer> {
    return fs.readFile(this.patchPath(entry));
  }

  private async writeIndex(entries: ShelfEntry[]): Promise<void> {
    await fs.mkdir(this.baseDir, { recursive: true });
    const data: IndexFile = { version: 1, entries };
    const tmp = `${this.indexPath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data, null, 2));
    await fs.rename(tmp, this.indexPath);
    this.cache = entries;
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
  }
}

let counter = 0;
export function newShelfId(): string {
  return `${Date.now().toString(36)}-${(counter++).toString(36)}`;
}
