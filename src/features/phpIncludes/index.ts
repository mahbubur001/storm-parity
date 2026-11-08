import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { includePaths } from '../externalLibraries/store';
import { candidatePaths, constantsOf, Define, evaluate, findDefines, findIncludeAt } from './core';

const MAX_DEPTH = 5;

const isFile = (p: string) => fs.promises.stat(p).then((s) => s.isFile(), () => false);

/** Folders searched for bare relative includes: workspace roots, External Libraries and Intelephense include paths. */
function searchDirs(): string[] {
  const roots = (vscode.workspace.workspaceFolders ?? []).filter((f) => f.uri.scheme === 'file').map((f) => f.uri.fsPath);
  const intelephense = vscode.workspace.getConfiguration('intelephense.environment').get<string[]>('includePaths', []);
  return [...new Set([...roots, ...includePaths(), ...intelephense])];
}

/**
 * WordPress core for ABSPATH: a folder with wp-load.php above a workspace root (the project lives in wp-content), else
 * one of the include paths (WordPress added under External Libraries).
 */
async function wordPressRoot(): Promise<string | undefined> {
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    for (let dir = folder.uri.fsPath; ; dir = path.dirname(dir)) {
      if (await isFile(path.join(dir, 'wp-load.php'))) return dir;
      if (path.dirname(dir) === dir) break;
    }
  }
  for (const dir of searchDirs()) if (await isFile(path.join(dir, 'wp-load.php'))) return dir;
  return undefined;
}

/** WordPress core constants, from the WordPress root. */
async function wordPressConstant(name: string): Promise<string | undefined> {
  if (name === 'WPINC') return 'wp-includes';
  if (!['ABSPATH', 'WP_CONTENT_DIR', 'WP_PLUGIN_DIR'].includes(name)) return undefined;
  const root = await wordPressRoot();
  if (!root) return undefined;
  const abspath = root.replace(/\\/g, '/').replace(/\/$/, '') + '/';
  return name === 'ABSPATH' ? abspath : name === 'WP_CONTENT_DIR' ? abspath + 'wp-content' : abspath + 'wp-content/plugins';
}

/** define() / const declarations across the workspace PHP files, built on first use and dropped when a PHP file changes. */
class DefineIndex implements vscode.Disposable {
  private index?: Promise<Map<string, { file: string; define: Define }>>;
  private readonly watcher = vscode.workspace.createFileSystemWatcher('**/*.php');

  constructor() {
    const reset = () => (this.index = undefined);
    this.watcher.onDidChange(reset);
    this.watcher.onDidCreate(reset);
    this.watcher.onDidDelete(reset);
  }

  get(name: string): Promise<{ file: string; define: Define } | undefined> {
    this.index ??= this.build();
    return this.index.then((m) => m.get(name));
  }

  private async build(): Promise<Map<string, { file: string; define: Define }>> {
    const map = new Map<string, { file: string; define: Define }>();
    const files = await vscode.workspace.findFiles('**/*.php', '**/{node_modules,vendor,.git}/**', 20000);
    for (const uri of files) {
      if (uri.scheme !== 'file') continue;
      const text = await fs.promises.readFile(uri.fsPath, 'utf8').catch(() => '');
      if (!/\bdefine\s*\(|^\s*const\s/m.test(text)) continue;
      for (const define of findDefines(text)) if (!map.has(define.name)) map.set(define.name, { file: uri.fsPath, define });
    }
    return map;
  }

  dispose(): void {
    this.watcher.dispose();
  }
}

/**
 * PhpStorm-style navigation for include paths: Cmd+click (Go to Definition) on `require_once 'app/Foo.php'`,
 * `__DIR__ . '/x.php'`, `MY_PLUGIN_PATH . 'x.php'` or `ABSPATH . 'wp-admin/includes/x.php'` opens that file.
 */
export function activate(ctx: vscode.ExtensionContext): void {
  const defines = new DefineIndex();

  /** Constants used by `names`, resolved through the current file, the workspace index and WordPress core. */
  async function resolveConstants(names: string[], document: vscode.TextDocument, out: Map<string, string>, depth = 0): Promise<void> {
    if (depth > MAX_DEPTH) return;
    const local = findDefines(document.getText());
    for (const name of names) {
      if (out.has(name)) continue;
      const found = local.find((d) => d.name === name);
      const def = found ? { file: document.uri.fsPath, define: found } : await defines.get(name);
      if (def) {
        await resolveConstants(constantsOf(def.define.node), document, out, depth + 1);
        const value = evaluate(def.define.node, def.file, out);
        if (value !== undefined) out.set(name, value);
        continue;
      }
      const wp = await wordPressConstant(name);
      if (wp !== undefined) out.set(name, wp);
    }
  }

  const provider: vscode.DefinitionProvider = {
    async provideDefinition(document, position) {
      if (document.uri.scheme !== 'file') return undefined;
      const include = findIncludeAt(document.lineAt(position.line).text, position.character);
      if (!include) return undefined;
      const constants = new Map<string, string>();
      await resolveConstants(constantsOf(include.node), document, constants);
      const value = evaluate(include.node, document.uri.fsPath, constants);
      if (value === undefined) return undefined;
      for (const candidate of candidatePaths(value, path.dirname(document.uri.fsPath), searchDirs())) {
        if (!(await isFile(candidate))) continue;
        const link: vscode.LocationLink = {
          originSelectionRange: new vscode.Range(position.line, include.start, position.line, include.end),
          targetUri: vscode.Uri.file(candidate),
          targetRange: new vscode.Range(0, 0, 0, 0),
        };
        return [link];
      }
      return undefined;
    },
  };

  ctx.subscriptions.push(defines, vscode.languages.registerDefinitionProvider({ language: 'php', scheme: 'file' }, provider));
}
