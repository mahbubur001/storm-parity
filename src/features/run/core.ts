// Pure helpers for the Run widget (no vscode import, unit tested).

export type RunKind = 'launch' | 'compound' | 'task';

/** A run configuration: a launch.json configuration or compound, or a task (tasks.json, npm, composer, ...). */
export interface RunTarget {
  kind: RunKind;
  name: string;
  /** Workspace folder URI (string); undefined for workspace-level (.code-workspace) launch configurations. */
  folder?: string;
  /** Task source (Workspace, npm, composer, ...); tasks only. */
  source?: string;
}

export const targetKey = (t: RunTarget): string => [t.kind, t.folder ?? '', t.source ?? '', t.name].join('\u0000');

export const sameTarget = (a: RunTarget | undefined, b: RunTarget | undefined): boolean => !!a && !!b && targetKey(a) === targetKey(b);

/** Launch configurations can be debugged; tasks only run. */
export const canDebug = (t: RunTarget): boolean => t.kind !== 'task';

interface LaunchSection {
  configurations?: unknown;
  compounds?: unknown;
}

const names = (list: unknown): string[] =>
  Array.isArray(list)
    ? list
        .map((c) => (c && typeof c === 'object' ? (c as { name?: unknown }).name : undefined))
        .filter((n): n is string => typeof n === 'string' && n.trim() !== '')
    : [];

/** Targets declared in one `launch` settings section (a folder's launch.json or the workspace file). */
export function launchTargets(launch: LaunchSection | undefined, folder?: string): RunTarget[] {
  return [
    ...names(launch?.configurations).map((name): RunTarget => ({ kind: 'launch', name, folder })),
    ...names(launch?.compounds).map((name): RunTarget => ({ kind: 'compound', name, folder })),
  ];
}

/** Restores a persisted selection, dropping anything that is not a well-formed target. */
export function parseTarget(value: unknown): RunTarget | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const v = value as Record<string, unknown>;
  if (v.kind !== 'launch' && v.kind !== 'compound' && v.kind !== 'task') return undefined;
  if (typeof v.name !== 'string' || !v.name) return undefined;
  const opt = (x: unknown) => (typeof x === 'string' && x ? x : undefined);
  return { kind: v.kind, name: v.name, folder: opt(v.folder), source: opt(v.source) };
}
