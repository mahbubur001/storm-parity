import * as path from 'path';
import * as vscode from 'vscode';
import { excludeGlob, fileGlob, fuzzyScore } from './query';

export type Target =
  | { type: 'file'; uri: vscode.Uri }
  | { type: 'symbol'; location: vscode.Location }
  | { type: 'command'; id: string }
  | { type: 'commandPalette'; text: string }
  | { type: 'setting'; key: string }
  | { type: 'prefix'; prefix: string };

export interface ResultItem extends vscode.QuickPickItem {
  target: Target;
  score: number;
}

export interface ActionEntry {
  id: string;
  title: string;
  extension: string;
}

export interface SettingEntry {
  key: string;
  description: string;
  extension: string;
}

interface ContributedCommand {
  command?: unknown;
  title?: unknown;
  category?: unknown;
}

interface MenuItem {
  command?: unknown;
  when?: unknown;
}

const asText = (v: unknown): string | undefined => {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && 'value' in v && typeof (v as { value: unknown }).value === 'string') return (v as { value: string }).value;
  return undefined;
};

// Unresolved NLS placeholders like `%command.title%` are useless as labels.
const usable = (s: string | undefined): s is string => !!s && !/^%.*%$/.test(s);

/** Commands contributed by every installed extension (built-in command titles are not exposed by the API). */
export function collectActions(): ActionEntry[] {
  const out: ActionEntry[] = [];
  for (const ext of vscode.extensions.all) {
    const pkg = ext.packageJSON as { displayName?: string; name?: string; contributes?: { commands?: unknown; menus?: { commandPalette?: unknown } } };
    const contributes = pkg.contributes;
    if (!contributes) continue;
    const hidden = new Set<string>();
    if (Array.isArray(contributes.menus?.commandPalette)) {
      for (const m of contributes.menus.commandPalette as MenuItem[]) {
        if (typeof m.command === 'string' && m.when === 'false') hidden.add(m.command);
      }
    }
    const cmds = Array.isArray(contributes.commands) ? (contributes.commands as ContributedCommand[]) : contributes.commands ? [contributes.commands as ContributedCommand] : [];
    const extName = usable(pkg.displayName) ? pkg.displayName : (pkg.name ?? ext.id);
    for (const c of cmds) {
      const title = asText(c.title);
      if (typeof c.command !== 'string' || !usable(title) || hidden.has(c.command)) continue;
      const category = asText(c.category);
      out.push({ id: c.command, title: usable(category) ? `${category}: ${title}` : title, extension: extName });
    }
  }
  return out;
}

/** Settings contributed by every installed extension. */
export function collectSettings(): SettingEntry[] {
  const out: SettingEntry[] = [];
  for (const ext of vscode.extensions.all) {
    const pkg = ext.packageJSON as { displayName?: string; name?: string; contributes?: { configuration?: unknown } };
    const cfg = pkg.contributes?.configuration;
    if (!cfg) continue;
    const extName = usable(pkg.displayName) ? pkg.displayName : (pkg.name ?? ext.id);
    const sections = (Array.isArray(cfg) ? cfg : [cfg]) as Array<{ properties?: Record<string, { description?: unknown; markdownDescription?: unknown; deprecationMessage?: unknown }> }>;
    for (const section of sections) {
      for (const [key, prop] of Object.entries(section.properties ?? {})) {
        if (prop?.deprecationMessage) continue;
        const desc = asText(prop?.description) ?? asText(prop?.markdownDescription) ?? '';
        out.push({ key, description: usable(desc) ? desc.replace(/\s+/g, ' ') : '', extension: extName });
      }
    }
  }
  return out;
}

export function matchActions(actions: readonly ActionEntry[], text: string, limit: number): ResultItem[] {
  const items: ResultItem[] = [];
  for (const a of actions) {
    const score = fuzzyScore(text, a.title) ?? fuzzyScore(text, a.id);
    if (score === undefined) continue;
    items.push({ label: `$(symbol-event) ${a.title}`, description: a.extension, target: { type: 'command', id: a.id }, score, alwaysShow: true });
  }
  return top(items, limit);
}

export function commandPaletteItem(text: string): ResultItem {
  return {
    label: '$(terminal) Search all commands in the Command Palette',
    description: text ? `> ${text}` : undefined,
    target: { type: 'commandPalette', text },
    score: -Infinity,
    alwaysShow: true,
  };
}

export function matchSettings(settings: readonly SettingEntry[], text: string, limit: number): ResultItem[] {
  const items: ResultItem[] = [];
  for (const s of settings) {
    const score = fuzzyScore(text, s.key) ?? (text.length > 2 ? fuzzyScore(text, s.description) : undefined);
    if (score === undefined) continue;
    items.push({
      label: `$(settings-gear) ${s.key}`,
      description: s.extension,
      detail: s.description || undefined,
      target: { type: 'setting', key: s.key },
      score,
      alwaysShow: true,
    });
  }
  return top(items, limit);
}

let cachedExclude: { key: string; glob: string | undefined } | undefined;

function currentExclude(): string | undefined {
  const files = vscode.workspace.getConfiguration('files').get<Record<string, unknown>>('exclude');
  const search = vscode.workspace.getConfiguration('search').get<Record<string, unknown>>('exclude');
  const key = JSON.stringify([files, search]);
  if (cachedExclude?.key !== key) cachedExclude = { key, glob: excludeGlob(files, search) };
  return cachedExclude.glob;
}

export async function searchFiles(text: string, limit: number, token: vscode.CancellationToken): Promise<ResultItem[]> {
  if (!text || !vscode.workspace.workspaceFolders?.length) return [];
  // Over-fetch, then rank with the fuzzy scorer.
  const uris = await vscode.workspace.findFiles(fileGlob(text), currentExclude(), limit * 10, token);
  if (token.isCancellationRequested) return [];
  const items: ResultItem[] = [];
  for (const uri of uris) {
    const rel = vscode.workspace.asRelativePath(uri, true);
    const name = path.basename(uri.path);
    const score = text.includes('/') ? fuzzyScore(text.replace(/\//g, ' '), rel) : fuzzyScore(text, name);
    if (score === undefined) continue;
    items.push({ label: `$(file) ${name}`, description: path.dirname(rel) === '.' ? '' : path.dirname(rel), target: { type: 'file', uri }, score, alwaysShow: true });
  }
  return top(items, limit);
}

const symbolIcon = (kind: vscode.SymbolKind): string => {
  const name = vscode.SymbolKind[kind]?.toLowerCase() ?? 'misc';
  return `$(symbol-${name === 'typeparameter' ? 'type-parameter' : name === 'enummember' ? 'enum-member' : name})`;
};

export async function searchSymbols(text: string, limit: number, token: vscode.CancellationToken): Promise<ResultItem[]> {
  if (!text) return [];
  let symbols: vscode.SymbolInformation[] | undefined;
  try {
    symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>('vscode.executeWorkspaceSymbolProvider', text);
  } catch {
    return [];
  }
  if (token.isCancellationRequested || !symbols) return [];
  const items: ResultItem[] = [];
  for (const s of symbols) {
    const score = fuzzyScore(text, s.name) ?? 0;
    items.push({
      label: `${symbolIcon(s.kind)} ${s.name}`,
      description: s.containerName || undefined,
      detail: vscode.workspace.asRelativePath(s.location.uri, true),
      target: { type: 'symbol', location: s.location },
      score,
      alwaysShow: true,
    });
  }
  return top(items, limit);
}

function top(items: ResultItem[], limit: number): ResultItem[] {
  return items.sort((a, b) => b.score - a.score).slice(0, limit);
}
