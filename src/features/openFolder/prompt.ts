import * as vscode from 'vscode';
import { displayName, kindOf } from './mru';
import { OpenMode, hasOpenProject, openTarget } from './open';

export type DefaultAction = 'ask' | 'thisWindow' | 'newWindow';

const SECTION = 'stormParity.openFolder';

export function defaultAction(): DefaultAction {
  const v = vscode.workspace.getConfiguration(SECTION).get<string>('defaultAction', 'ask');
  return v === 'thisWindow' || v === 'newWindow' ? v : 'ask';
}

interface ModeItem extends vscode.QuickPickItem {
  mode: OpenMode;
}

/** Shows the This Window / New Window / Attach prompt. Resolves undefined when cancelled. */
export function askMode(uri: vscode.Uri): Promise<OpenMode | undefined> {
  const items: ModeItem[] = [
    { mode: 'thisWindow', label: '$(window) This Window', description: 'Replace the current project' },
    { mode: 'newWindow', label: '$(empty-window) New Window', description: 'Open in a separate window' },
  ];
  if (kindOf(uri.path) === 'folder') {
    items.push({ mode: 'attach', label: '$(add) Attach', description: 'Add to the current workspace (multi-root)' });
  }

  let remember = false;
  const rememberButton = (): vscode.QuickInputButton => ({
    iconPath: new vscode.ThemeIcon(remember ? 'pass-filled' : 'circle-large-outline'),
    tooltip: remember ? 'Remember my choice: on (Attach is never remembered)' : 'Remember my choice: off',
  });

  const qp = vscode.window.createQuickPick<ModeItem>();
  qp.title = `Open ${displayName(uri.toString())}`;
  qp.placeholder = 'Where should the project open? (toggle "Remember my choice" with the button on the right)';
  qp.items = items;
  qp.buttons = [rememberButton()];

  return new Promise((resolve) => {
    let result: OpenMode | undefined;
    qp.onDidTriggerButton(() => {
      remember = !remember;
      qp.buttons = [rememberButton()];
    });
    qp.onDidAccept(async () => {
      result = qp.selectedItems[0]?.mode;
      if (remember && (result === 'thisWindow' || result === 'newWindow')) {
        qp.busy = true;
        await vscode.workspace.getConfiguration(SECTION).update('defaultAction', result, vscode.ConfigurationTarget.Global);
      }
      qp.hide();
    });
    qp.onDidHide(() => {
      qp.dispose();
      resolve(result);
    });
    qp.show();
  });
}

/** Applies stormParity.openFolder.defaultAction; asks only when it is `ask` and a project is already open. */
export async function resolveMode(uri: vscode.Uri): Promise<OpenMode | undefined> {
  const action = defaultAction();
  if (action !== 'ask') return action;
  if (!hasOpenProject()) return 'thisWindow';
  return askMode(uri);
}

export async function openWithPrompt(uri: vscode.Uri): Promise<void> {
  const mode = await resolveMode(uri);
  if (mode) await openTarget(uri, mode);
}
