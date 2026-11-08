import * as vscode from 'vscode';

/**
 * A subtree another feature appends below the libraries in the External Libraries view, the way PhpStorm's project
 * tree lists "Scratches and Consoles" after "External Libraries". Elements are opaque to the view.
 */
export interface TreeSection {
  readonly onDidChange: vscode.Event<void>;
  getChildren(element?: unknown): vscode.ProviderResult<unknown[]>;
  getTreeItem(element: unknown): vscode.TreeItem | Thenable<vscode.TreeItem>;
}

const sections: TreeSection[] = [];
const changed = new vscode.EventEmitter<void>();
export const onDidChangeSections = changed.event;
export const treeSections = (): readonly TreeSection[] => sections;

export function registerTreeSection(section: TreeSection): vscode.Disposable {
  sections.push(section);
  const sub = section.onDidChange(() => changed.fire());
  changed.fire();
  return new vscode.Disposable(() => {
    sub.dispose();
    sections.splice(sections.indexOf(section), 1);
    changed.fire();
  });
}

/** Context menu commands on a section element receive the view's wrapper node; this returns the section's element. */
export const sectionElement = (arg: unknown): unknown =>
  arg && typeof arg === 'object' && (arg as { kind?: unknown }).kind === 'section' ? (arg as { element: unknown }).element : arg;
