// Groups and aliases for recent projects. Pure reducers plus a small Memento-backed store.
import { uriKey } from '../openFolder/mru';

export interface ProjectMeta {
  /** Group names in creation order. */
  groups: string[];
  /** uriKey -> display alias. */
  aliases: Record<string, string>;
  /** uriKey -> group name. */
  membership: Record<string, string>;
}

export const emptyMeta = (): ProjectMeta => ({ groups: [], aliases: {}, membership: {} });

const without = (rec: Record<string, string>, key: string): Record<string, string> => {
  const { [key]: _removed, ...rest } = rec;
  return rest;
};

export function addGroup(meta: ProjectMeta, name: string): ProjectMeta {
  const n = name.trim();
  if (!n || meta.groups.includes(n)) return meta;
  return { ...meta, groups: [...meta.groups, n] };
}

export function renameGroup(meta: ProjectMeta, from: string, to: string): ProjectMeta {
  const target = to.trim();
  if (!target || from === target || !meta.groups.includes(from) || meta.groups.includes(target)) return meta;
  const membership = Object.fromEntries(Object.entries(meta.membership).map(([k, g]) => [k, g === from ? target : g]));
  return { ...meta, groups: meta.groups.map((g) => (g === from ? target : g)), membership };
}

/** Deletes a group; its projects become ungrouped. */
export function deleteGroup(meta: ProjectMeta, name: string): ProjectMeta {
  const membership = Object.fromEntries(Object.entries(meta.membership).filter(([, g]) => g !== name));
  return { ...meta, groups: meta.groups.filter((g) => g !== name), membership };
}

/** Sets the alias; empty / whitespace clears it. */
export function setAlias(meta: ProjectMeta, uri: string, alias: string | undefined): ProjectMeta {
  const key = uriKey(uri);
  const a = alias?.trim();
  return { ...meta, aliases: a ? { ...meta.aliases, [key]: a } : without(meta.aliases, key) };
}

/** Moves a project into `group` (created if missing) or out of any group when undefined. */
export function moveToGroup(meta: ProjectMeta, uri: string, group: string | undefined): ProjectMeta {
  const key = uriKey(uri);
  if (!group?.trim()) return { ...meta, membership: without(meta.membership, key) };
  const withGroup = addGroup(meta, group);
  return { ...withGroup, membership: { ...withGroup.membership, [key]: group.trim() } };
}

/** Drops alias and group membership of a project. */
export function forgetProject(meta: ProjectMeta, uri: string): ProjectMeta {
  const key = uriKey(uri);
  return { ...meta, aliases: without(meta.aliases, key), membership: without(meta.membership, key) };
}

export const aliasOf = (meta: ProjectMeta, uri: string): string | undefined => meta.aliases[uriKey(uri)];
export const groupOf = (meta: ProjectMeta, uri: string): string | undefined => meta.membership[uriKey(uri)];

/** Minimal subset of vscode.Memento so the store can be tested with a fake. */
export interface MementoLike {
  get<T>(key: string, defaultValue: T): T;
  update(key: string, value: unknown): Thenable<void>;
}

export const META_KEY = 'stormParity.recentProjects.meta';

export class ProjectMetaStore {
  private listeners: Array<() => void> = [];

  constructor(private readonly memento: MementoLike) {}

  get(): ProjectMeta {
    return { ...emptyMeta(), ...this.memento.get<Partial<ProjectMeta>>(META_KEY, {}) };
  }

  async apply(fn: (meta: ProjectMeta) => ProjectMeta): Promise<void> {
    const before = this.get();
    const after = fn(before);
    if (after === before) return;
    await this.memento.update(META_KEY, after);
    for (const l of this.listeners) l();
  }

  onDidChange(listener: () => void): { dispose(): void } {
    this.listeners.push(listener);
    return { dispose: () => (this.listeners = this.listeners.filter((l) => l !== listener)) };
  }
}
