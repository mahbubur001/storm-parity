// One SourceControl per git repository, one resource group per changelist.
import * as vscode from 'vscode';
import * as path from 'path';
import {
  ChangeKind,
  GitAPI,
  GitRepository,
  StatusEntry,
  changeKind,
  entryPaths,
  fromRepoPath,
  getStatus,
  runGit,
  statusLetter,
} from '../../util/git';
import { Changelist, ChangelistModel } from './store';

export const SCM_ID = 'stormParity.changelists';
export const OPEN_CHANGE_COMMAND = 'stormParity.changelists.openChange';
export const COMMIT_ACTIVE_COMMAND = 'stormParity.changelists.commitActive';

const KIND_LABEL: Record<ChangeKind, string> = {
  modified: 'Modified',
  added: 'Added',
  deleted: 'Deleted',
  renamed: 'Renamed',
  copied: 'Copied',
  untracked: 'Untracked',
  ignored: 'Ignored',
  conflict: 'Conflict',
};

const KIND_ICON: Record<ChangeKind, [string, string]> = {
  modified: ['diff-modified', 'gitDecoration.modifiedResourceForeground'],
  added: ['diff-added', 'gitDecoration.addedResourceForeground'],
  deleted: ['diff-removed', 'gitDecoration.deletedResourceForeground'],
  renamed: ['diff-renamed', 'gitDecoration.renamedResourceForeground'],
  copied: ['diff-added', 'gitDecoration.addedResourceForeground'],
  untracked: ['diff-added', 'gitDecoration.untrackedResourceForeground'],
  ignored: ['diff-ignored', 'gitDecoration.ignoredResourceForeground'],
  conflict: ['warning', 'gitDecoration.conflictingResourceForeground'],
};

export interface ChangeResourceState extends vscode.SourceControlResourceState {
  readonly entry: StatusEntry;
  readonly kind: ChangeKind;
}

export class RepoChangelists implements vscode.Disposable {
  readonly root: string;
  readonly sc: vscode.SourceControl;
  readonly model: ChangelistModel;
  private readonly groups = new Map<string, vscode.SourceControlResourceGroup>();
  private entries: StatusEntry[] = [];
  private readonly disposables: vscode.Disposable[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | undefined;
  private dirty = false;
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;

  constructor(
    readonly repo: GitRepository,
    private readonly api: GitAPI,
    private readonly memento: vscode.Memento,
  ) {
    this.root = repo.rootUri.fsPath;
    this.model = new ChangelistModel(memento.get(this.stateKey));
    this.sc = vscode.scm.createSourceControl(SCM_ID, 'Changelists', repo.rootUri);
    this.sc.acceptInputCommand = { command: COMMIT_ACTIVE_COMMAND, title: 'Commit Active Changelist', arguments: [this.root] };
    this.disposables.push(this.sc, this.changeEmitter, repo.state.onDidChange(() => this.scheduleRefresh()));
    this.render();
    this.scheduleRefresh(0);
  }

  private get stateKey(): string {
    return `stormParity.changelists.state:${this.root}`;
  }

  get name(): string {
    return path.basename(this.root);
  }

  scheduleRefresh(delay = 300): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.refresh();
    }, delay);
  }

  /** Re-reads git status; coalesces concurrent calls. */
  async refresh(): Promise<void> {
    if (this.running) {
      this.dirty = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.dirty = false;
        try {
          this.entries = await getStatus(this.root);
        } catch (err) {
          console.error(`[storm-parity] git status failed in ${this.root}`, err);
        }
        if (this.model.prune(this.entries.map((e) => e.path))) await this.save();
        this.render();
      } while (this.dirty);
    })();
    try {
      await this.running;
    } finally {
      this.running = undefined;
    }
  }

  async save(): Promise<void> {
    await this.memento.update(this.stateKey, this.model.toJSON());
  }

  /** Persists the model and redraws without re-running git. */
  async commitModel(): Promise<void> {
    await this.save();
    this.render();
  }

  entriesOf(listId: string): StatusEntry[] {
    return this.entries.filter((e) => this.model.listOf(e.path) === listId);
  }

  entryFor(uri: vscode.Uri): StatusEntry | undefined {
    return this.entries.find((e) => fromRepoPath(this.root, e.path) === uri.fsPath);
  }

  get allEntries(): readonly StatusEntry[] {
    return this.entries;
  }

  /** The list id behind a resource group handed to a menu command. */
  listIdOf(group: vscode.SourceControlResourceGroup): string | undefined {
    for (const [id, g] of this.groups) if (g === group) return id;
    return undefined;
  }

  ownsGroup(group: vscode.SourceControlResourceGroup): boolean {
    return this.listIdOf(group) !== undefined;
  }

  private render(): void {
    const lists = this.model.lists;
    const ids = new Set(lists.map((l) => l.id));
    for (const [id, g] of this.groups) {
      if (!ids.has(id)) {
        g.dispose();
        this.groups.delete(id);
      }
    }
    const byList = new Map<string, StatusEntry[]>(lists.map((l) => [l.id, []]));
    for (const e of this.entries) byList.get(this.model.listOf(e.path))?.push(e);
    const activeId = this.model.active.id;
    for (const list of lists) {
      let g = this.groups.get(list.id);
      if (!g) {
        g = this.sc.createResourceGroup(list.id, list.name);
        this.groups.set(list.id, g);
      }
      g.label = list.id === activeId ? `${list.name} (active)` : list.name;
      g.hideWhenEmpty = false;
      g.resourceStates = (byList.get(list.id) ?? []).map((e) => this.toResourceState(e));
    }
    const showCount = vscode.workspace.getConfiguration('stormParity.changelists').get<boolean>('showCount', false);
    this.sc.count = showCount ? this.entries.length : 0;
    this.sc.inputBox.placeholder = `Message (commits "${this.model.active.name}")`;
    this.changeEmitter.fire();
  }

  private toResourceState(entry: StatusEntry): ChangeResourceState {
    const kind = changeKind(entry);
    const resourceUri = vscode.Uri.file(fromRepoPath(this.root, entry.path));
    const [icon, color] = KIND_ICON[kind];
    const tooltip = entry.origPath
      ? `${statusLetter(kind)} ${KIND_LABEL[kind]} from ${entry.origPath}`
      : `${statusLetter(kind)} ${KIND_LABEL[kind]}`;
    return {
      entry,
      kind,
      resourceUri,
      contextValue: kind,
      command: { command: OPEN_CHANGE_COMMAND, title: 'Open Changes', arguments: [resourceUri] },
      decorations: {
        strikeThrough: kind === 'deleted',
        tooltip,
        iconPath: new vscode.ThemeIcon(icon, new vscode.ThemeColor(color)),
      },
    };
  }

  /** Opens HEAD vs working tree for a change, or the file itself for new files. */
  async openChange(uri: vscode.Uri): Promise<void> {
    const entry = this.entryFor(uri);
    const kind = entry ? changeKind(entry) : 'modified';
    const title = path.basename(uri.fsPath);
    if (kind === 'untracked' || kind === 'added' || kind === 'copied') {
      await vscode.commands.executeCommand('vscode.open', uri);
      return;
    }
    const left = this.api.toGitUri(entry?.origPath ? vscode.Uri.file(fromRepoPath(this.root, entry.origPath)) : uri, 'HEAD');
    if (kind === 'deleted') {
      await vscode.commands.executeCommand('vscode.open', left, {}, `${title} (Deleted, HEAD)`);
      return;
    }
    await vscode.commands.executeCommand('vscode.diff', left, uri, `${title} (HEAD vs Working Tree)`);
  }

  /** Commits exactly the files of `list`. Returns the commit summary line. */
  async commit(list: Changelist, message: string): Promise<string> {
    const entries = this.entriesOf(list.id);
    if (entries.length === 0) throw new Error(`Changelist "${list.name}" has no changes.`);
    if (!message.trim()) throw new Error('Commit message cannot be empty.');
    // Stage current paths only (a staged rename source no longer exists anywhere but HEAD),
    // then commit both sides of renames so the deletion of the source is included.
    const files = entryPaths(entries);
    await runGit(this.root, ['add', '-A', '--', ...entries.map((e) => e.path)]);
    const out = await runGit(this.root, ['commit', '-m', message, '--', ...files]);
    void this.refresh();
    return out.split('\n')[0]?.trim() ?? '';
  }

  async push(): Promise<void> {
    if (this.repo.push) await this.repo.push();
    else await runGit(this.root, ['push']);
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    for (const g of this.groups.values()) g.dispose();
    this.groups.clear();
    for (const d of this.disposables) d.dispose();
  }
}
