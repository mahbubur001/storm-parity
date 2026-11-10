import * as vscode from 'vscode';
import { EditorLayout, withBottomGroup } from './layout';

const TABS_SETTING = 'tabs.enabled';
const MODE_SETTING = 'tabsBelow';
const SHOW_TABS = 'showTabs';
const PREV_SHOW_TABS_KEY = 'terminal.prevShowTabs';

/** Resolves once `check` passes (VS Code applies terminal moves and reveals asynchronously), or after `timeoutMs`. */
async function settle(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
}

const terminalTabCount = () => vscode.window.tabGroups.all.reduce((n, g) => n + g.tabs.filter(isTerminalTab).length, 0);
const activeTabIsTerminal = () => vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputTerminal;

/** Column of the group whose active tab is this terminal, if any (tabs carry no terminal identity, so match the active one). */
function terminalGroupOf(terminal: vscode.Terminal): vscode.ViewColumn | undefined {
  const group = vscode.window.tabGroups.all.find((g) => g.activeTab?.input instanceof vscode.TabInputTerminal && g.activeTab.label === terminal.name);
  return group?.viewColumn;
}

const config = () => vscode.workspace.getConfiguration('stormParity.terminal');
const isTerminalTab = (tab: vscode.Tab) => tab.input instanceof vscode.TabInputTerminal;

/** The editor group holding terminal tabs: the last group that has one. */
function terminalGroup(): vscode.TabGroup | undefined {
  return [...vscode.window.tabGroups.all].reverse().find((g) => g.tabs.some(isTerminalTab));
}

/** Column of the terminal group, creating a full-width group at the bottom of the editor area if there is none. */
async function ensureTerminalColumn(): Promise<vscode.ViewColumn> {
  const existing = terminalGroup();
  if (existing) return existing.viewColumn;
  const layout = await vscode.commands.executeCommand<EditorLayout>('vscode.getEditorLayout');
  const groupsBefore = vscode.window.tabGroups.all.length;
  await vscode.commands.executeCommand('vscode.setEditorLayout', withBottomGroup(layout));
  await settle(() => vscode.window.tabGroups.all.length > groupsBefore, 1000);
  return Math.max(...vscode.window.tabGroups.all.map((g) => g.viewColumn));
}

async function newTerminalTab(): Promise<void> {
  const viewColumn = await ensureTerminalColumn();
  const before = terminalTabCount();
  vscode.window.createTerminal({ location: { viewColumn } }).show();
  await settle(() => terminalTabCount() > before, 1000);
}

/**
 * Moves every panel terminal into the terminal group. moveToEditor moves the active panel terminal into the active
 * editor group, so the terminal group is focused first; VS Code applies both steps asynchronously, hence `settle`.
 * Terminals that already are tabs are left alone by moveToEditor.
 */
async function moveAllToTabs(): Promise<void> {
  for (const terminal of [...vscode.window.terminals]) {
    const column = await ensureTerminalColumn();
    const tabsBefore = terminalTabCount();
    terminal.show(true);
    await settle(() => vscode.window.activeTerminal === terminal);
    await focusColumn(column);
    await settle(() => vscode.window.tabGroups.activeTabGroup.viewColumn === column, 500);
    await vscode.commands.executeCommand('workbench.action.terminal.moveToEditor');
    await settle(() => terminalTabCount() > tabsBefore, 500);
    // With a terminal already active in the target group VS Code opens the moved one in another group; regroup it.
    if (terminalGroupOf(terminal) !== column) {
      terminal.show();
      await settle(() => vscode.window.activeTerminal === terminal && activeTabIsTerminal(), 500);
      if (activeTabIsTerminal()) await vscode.commands.executeCommand('workbench.action.moveEditorToLastGroup');
    }
  }
  await vscode.commands.executeCommand('workbench.action.closePanel');
  if (!terminalGroup()?.tabs.some(isTerminalTab)) await newTerminalTab();
}

/**
 * Moves terminal tabs back to the panel: focus the terminal group, move its active tab (moveToTerminalPanel acts on
 * the active terminal editor), repeat until no terminal tabs are left. VS Code closes the emptied group itself.
 */
async function moveAllToPanel(): Promise<void> {
  for (let guard = terminalTabCount() + 5; guard > 0; guard--) {
    const group = terminalGroup();
    if (!group) break;
    const before = terminalTabCount();
    await focusColumn(group.viewColumn);
    await settle(() => activeTabIsTerminal(), 500);
    await vscode.commands.executeCommand('workbench.action.terminal.moveToTerminalPanel');
    await settle(() => terminalTabCount() < before, 1000);
  }
  const empty = vscode.window.tabGroups.all.find((g) => g.tabs.length === 0);
  if (empty && vscode.window.tabGroups.all.length > 1) await vscode.window.tabGroups.close(empty);
}

async function focusColumn(column: vscode.ViewColumn): Promise<void> {
  const commands = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth'];
  const name = commands[column - 1];
  await vscode.commands.executeCommand(name ? `workbench.action.focus${name}EditorGroup` : 'workbench.action.focusLastEditorGroup');
}

/** Opt+F12 while tabs are visible: focus the terminal tabs, creating one if needed. */
/**
 * Whether the terminal tabs are hidden behind a maximized code group. The extension API exposes no "editor group
 * maximized" state, so it is tracked here: every hide / restore goes through hideTabs / restoreTabs, and it is cleared
 * whenever a terminal tab becomes active (the group is visible again however that happened).
 */
let tabsHidden = false;

/** Panel mode: whether the icon last showed the terminal panel (resynced when a panel terminal opens). */
let panelTerminalShown = false;

/** Terminals in the panel: editor-area terminals are tabs, all others live in the panel. */
const panelTerminalCount = (): number => vscode.window.terminals.length - terminalTabCount();

/** The code tab that was in front most recently, so hiding the terminal returns to it. */
let lastCodeTab: { label: string; uri?: string } | undefined;
const tabUri = (t: vscode.Tab): string | undefined => {
  const input = t.input;
  if (input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom || input instanceof vscode.TabInputNotebook) return input.uri.toString();
  if (input instanceof vscode.TabInputTextDiff) return input.modified.toString();
  return undefined;
};
function rememberCodeTab(): void {
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
  if (tab && !isTerminalTab(tab)) lastCodeTab = { label: tab.label, uri: tabUri(tab) };
  else if (tab) tabsHidden = false;
}

async function showTabs(): Promise<void> {
  tabsHidden = false;
  const group = terminalGroup();
  if (!group) {
    await newTerminalTab();
    return;
  }
  await focusColumn(group.viewColumn);
  await settle(() => vscode.window.tabGroups.activeTabGroup.viewColumn === group.viewColumn, 500);
}

/** Opt+F12 from a terminal tab: hand the space back to the code by maximizing the first editor group. */
async function hideTabs(): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.focusFirstEditorGroup');
  await vscode.commands.executeCommand('workbench.action.toggleMaximizeEditorGroup');
  tabsHidden = true;
}

/** Opt+F12 while the code group is maximized: restore the layout and focus the terminal. */
async function restoreTabs(): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.toggleMaximizeEditorGroup');
  await new Promise((r) => setTimeout(r, 50));
  await showTabs();
}

/** Activates the tab at `index` of the group in `column` (openEditorAtIndex acts on the active group). */
async function openTabAt(column: vscode.ViewColumn, index: number): Promise<void> {
  await focusColumn(column);
  await settle(() => vscode.window.tabGroups.activeTabGroup.viewColumn === column, 500);
  await vscode.commands.executeCommand('workbench.action.openEditorAtIndex', index);
}

/**
 * The status bar Terminal button: a show / hide toggle like PhpStorm's Terminal button. Terminal tabs may live in their
 * own group (Tabs Below) or share a group with code; hiding maximizes the code group in the first case and switches
 * the shared group back to a code tab in the second. Without Tabs Below it toggles the panel.
 */
async function toggleTerminal(): Promise<void> {
  if (!config().get<boolean>(MODE_SETTING, false)) {
    // workbench.action.terminal.toggleTerminal only focuses a visible, unfocused terminal (the usual state after a
    // click elsewhere), so the panel is opened / closed directly. Its visibility is not in the API; panelTerminalShown tracks it.
    // terminal.focus opens the panel's Terminal view (workbench.action.terminal.focus would focus the active terminal,
    // which may be an editor-tab terminal that is already in front, so nothing visible happens).
    const show = !panelTerminalShown || panelTerminalCount() === 0;
    await vscode.commands.executeCommand(show ? 'terminal.focus' : 'workbench.action.closePanel');
    panelTerminalShown = show;
    return;
  }
  if (tabsHidden) {
    await restoreTabs();
    return;
  }
  const group = terminalGroup();
  if (!group) {
    await newTerminalTab();
    return;
  }
  const { activeTabGroup, all } = vscode.window.tabGroups;
  const terminalInFront = activeTabGroup === group && isTerminalTab(group.activeTab as vscode.Tab);
  if (!terminalInFront) {
    tabsHidden = false;
    const index = group.activeTab && isTerminalTab(group.activeTab) ? -1 : group.tabs.findIndex(isTerminalTab);
    if (index >= 0) await openTabAt(group.viewColumn, index);
    else await focusColumn(group.viewColumn);
    return;
  }
  const last = lastCodeTab;
  const lastIndex = last ? group.tabs.findIndex((t) => !isTerminalTab(t) && t.label === last.label && tabUri(t) === last.uri) : -1;
  const codeIndex = lastIndex >= 0 ? lastIndex : group.tabs.findIndex((t) => !isTerminalTab(t));
  if (group.viewColumn !== all[0].viewColumn) await hideTabs();
  else if (codeIndex >= 0) await openTabAt(group.viewColumn, codeIndex);
  else await vscode.commands.executeCommand('workbench.action.focusFirstEditorGroup');
}

/**
 * workbench.editor.showTabs is global (no per-group setting), and "single"/"none" collapse the terminal group into one
 * tab plus a dropdown. Tabs Below needs a real strip, so force "multiple" and remember the user's value for later.
 */
async function ensureTabStrip(ctx: vscode.ExtensionContext): Promise<void> {
  const workbench = vscode.workspace.getConfiguration('workbench.editor');
  const current = workbench.get<string>(SHOW_TABS, 'multiple');
  if (current === 'multiple') return;
  await ctx.globalState.update(PREV_SHOW_TABS_KEY, workbench.inspect<string>(SHOW_TABS)?.globalValue ?? null);
  await workbench.update(SHOW_TABS, 'multiple', vscode.ConfigurationTarget.Global);
}

async function restoreTabStrip(ctx: vscode.ExtensionContext): Promise<void> {
  const prev = ctx.globalState.get<string | null>(PREV_SHOW_TABS_KEY);
  if (prev === undefined) return;
  await vscode.workspace.getConfiguration('workbench.editor').update(SHOW_TABS, prev ?? undefined, vscode.ConfigurationTarget.Global);
  await ctx.globalState.update(PREV_SHOW_TABS_KEY, undefined);
}

/**
 * PhpStorm-like terminal. The panel shortcuts are plain keybindings to built-in commands (see contributes.json);
 * this module adds the compact-tabs toggle and the "Terminal Tabs Below" mode, which runs terminals as editor tabs in
 * a full-width group at the bottom so they get a real tab strip like PhpStorm's.
 */
export function activate(ctx: vscode.ExtensionContext): void {
  // Status bar Terminal button, a toggle like PhpStorm's Terminal tool button. A status bar item rather than an
  // Activity Bar icon: those can only open a sidebar view, and switching the sidebar away and back again flickers.
  const button = vscode.window.createStatusBarItem('stormParity.terminal.button', vscode.StatusBarAlignment.Right, 0.1);
  button.name = 'Terminal';
  button.text = '$(terminal)';
  button.tooltip = 'Show / Hide Terminal';
  button.command = 'stormParity.terminal.toggle';
  button.show();
  ctx.subscriptions.push(
    button,
    vscode.window.onDidOpenTerminal((terminal) => {
      // Only a terminal that landed in the panel shows the panel; editor-tab terminals (e.g. an AI CLI) do not.
      // VS Code places the terminal asynchronously, hence the short delay before looking for its tab.
      setTimeout(() => {
        const isTab = vscode.window.tabGroups.all.some((g) => g.tabs.some((t) => isTerminalTab(t) && t.label === terminal.name));
        if (!isTab && !config().get<boolean>(MODE_SETTING, false)) panelTerminalShown = true;
      }, 300);
    }),
    vscode.window.tabGroups.onDidChangeTabGroups(rememberCodeTab),
    vscode.window.tabGroups.onDidChangeTabs(rememberCodeTab),
  );

  ctx.subscriptions.push(
    vscode.commands.registerCommand('stormParity.terminal.toggleCompactTabs', async () => {
      const integrated = vscode.workspace.getConfiguration('terminal.integrated');
      const compact = integrated.get<boolean>(TABS_SETTING, true);
      await integrated.update(TABS_SETTING, !compact, vscode.ConfigurationTarget.Global);
      void vscode.window.setStatusBarMessage(compact ? 'Terminal: compact tabs (dropdown in the panel title)' : 'Terminal: tab list restored', 3000);
    }),
    vscode.commands.registerCommand('stormParity.terminal.toggleTabsBelow', async () => {
      const on = !config().get<boolean>(MODE_SETTING, false);
      await config().update(MODE_SETTING, on, vscode.ConfigurationTarget.Global);
      if (on) {
        await ensureTabStrip(ctx);
        await moveAllToTabs();
      } else {
        await moveAllToPanel();
        await restoreTabStrip(ctx);
      }
      void vscode.window.setStatusBarMessage(on ? 'Terminal: tabs below the editor' : 'Terminal: back in the panel', 3000);
    }),
    vscode.commands.registerCommand('stormParity.terminal.toggle', toggleTerminal),
    vscode.commands.registerCommand('stormParity.terminal.newTab', newTerminalTab),
    vscode.commands.registerCommand('stormParity.terminal.showTabs', showTabs),
    vscode.commands.registerCommand('stormParity.terminal.hideTabs', hideTabs),
    vscode.commands.registerCommand('stormParity.terminal.restoreTabs', restoreTabs),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration(`stormParity.terminal.${MODE_SETTING}`)) return;
      void (config().get<boolean>(MODE_SETTING, false) ? ensureTabStrip(ctx) : restoreTabStrip(ctx));
    }),
  );
  if (config().get<boolean>(MODE_SETTING, false)) void ensureTabStrip(ctx);
}
