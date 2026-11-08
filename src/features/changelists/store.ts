// Pure changelist model: lists, active list and file assignments for one repository.
// No vscode imports so it can be unit tested in isolation.

export interface Changelist {
  id: string;
  name: string;
  description: string;
}

export interface ChangelistState {
  lists: Changelist[];
  activeId: string;
  /** repo-relative path -> list id. Unassigned files belong to the active list. */
  assignments: Record<string, string>;
}

export const DEFAULT_LIST_ID = 'default';
export const DEFAULT_LIST_NAME = 'Changes';

let counter = 0;
export function newListId(): string {
  return `cl-${Date.now().toString(36)}-${(counter++).toString(36)}`;
}

export class ChangelistModel {
  private state: ChangelistState;

  constructor(raw?: unknown) {
    this.state = normalizeState(raw);
  }

  get lists(): readonly Changelist[] {
    return this.state.lists;
  }

  get active(): Changelist {
    return this.get(this.state.activeId) ?? this.state.lists[0];
  }

  get(id: string): Changelist | undefined {
    return this.state.lists.find((l) => l.id === id);
  }

  findByName(name: string): Changelist | undefined {
    const key = name.trim().toLowerCase();
    return this.state.lists.find((l) => l.name.toLowerCase() === key);
  }

  isDefault(id: string): boolean {
    return id === DEFAULT_LIST_ID;
  }

  add(name: string, description = '', id = newListId()): Changelist {
    const clean = name.trim();
    if (!clean) throw new Error('Changelist name cannot be empty.');
    if (this.findByName(clean)) throw new Error(`A changelist named "${clean}" already exists.`);
    const list: Changelist = { id, name: clean, description };
    this.state.lists.push(list);
    return list;
  }

  rename(id: string, name: string): void {
    const list = this.require(id);
    const clean = name.trim();
    if (!clean) throw new Error('Changelist name cannot be empty.');
    const other = this.findByName(clean);
    if (other && other.id !== id) throw new Error(`A changelist named "${clean}" already exists.`);
    list.name = clean;
  }

  setDescription(id: string, description: string): void {
    this.require(id).description = description;
  }

  /** Removes a list; its files move to the default list. The default list cannot be removed. */
  remove(id: string): void {
    if (this.isDefault(id)) throw new Error('The default changelist cannot be deleted.');
    this.require(id);
    this.state.lists = this.state.lists.filter((l) => l.id !== id);
    if (this.state.activeId === id) this.state.activeId = DEFAULT_LIST_ID;
    for (const [p, listId] of Object.entries(this.state.assignments)) {
      if (listId === id) this.state.assignments[p] = DEFAULT_LIST_ID;
    }
  }

  setActive(id: string): void {
    this.require(id);
    this.state.activeId = id;
  }

  assign(paths: Iterable<string>, id: string): void {
    this.require(id);
    for (const p of paths) this.state.assignments[p] = id;
  }

  /** The list a changed file belongs to. */
  listOf(path: string): string {
    const id = this.state.assignments[path];
    return id !== undefined && this.get(id) ? id : this.active.id;
  }

  /** Drops assignments for files that are no longer changed or point at deleted lists. Returns true when anything changed. */
  prune(changedPaths: Iterable<string>): boolean {
    const keep = new Set(changedPaths);
    let changed = false;
    for (const [p, id] of Object.entries(this.state.assignments)) {
      if (!keep.has(p) || !this.get(id)) {
        delete this.state.assignments[p];
        changed = true;
      }
    }
    return changed;
  }

  /** Groups paths by list id. Every list gets an entry (possibly empty). */
  group(paths: Iterable<string>): Map<string, string[]> {
    const out = new Map<string, string[]>(this.state.lists.map((l) => [l.id, []]));
    for (const p of paths) out.get(this.listOf(p))?.push(p);
    return out;
  }

  toJSON(): ChangelistState {
    return {
      lists: this.state.lists.map((l) => ({ ...l })),
      activeId: this.state.activeId,
      assignments: { ...this.state.assignments },
    };
  }

  private require(id: string): Changelist {
    const list = this.get(id);
    if (!list) throw new Error(`Unknown changelist: ${id}`);
    return list;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Validates persisted state, always yielding a default list and a valid active id. */
export function normalizeState(raw: unknown): ChangelistState {
  const lists: Changelist[] = [];
  const src = isRecord(raw) ? raw : {};
  if (Array.isArray(src.lists)) {
    for (const l of src.lists) {
      if (!isRecord(l) || typeof l.id !== 'string' || typeof l.name !== 'string' || !l.name.trim()) continue;
      if (lists.some((x) => x.id === l.id)) continue;
      lists.push({ id: l.id, name: l.name, description: typeof l.description === 'string' ? l.description : '' });
    }
  }
  if (!lists.some((l) => l.id === DEFAULT_LIST_ID)) {
    lists.unshift({ id: DEFAULT_LIST_ID, name: DEFAULT_LIST_NAME, description: '' });
  }
  const activeId = typeof src.activeId === 'string' && lists.some((l) => l.id === src.activeId) ? src.activeId : DEFAULT_LIST_ID;
  const assignments: Record<string, string> = {};
  if (isRecord(src.assignments)) {
    for (const [p, id] of Object.entries(src.assignments)) {
      if (typeof id === 'string' && lists.some((l) => l.id === id)) assignments[p] = id;
    }
  }
  return { lists, activeId, assignments };
}
