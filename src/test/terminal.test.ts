import * as assert from 'assert';
import * as vscode from 'vscode';
import { withBottomGroup } from '../features/terminal/layout';

suite('terminal: layout', () => {
  test('side-by-side groups are nested in a top row above a full-width bottom group', () => {
    const next = withBottomGroup({ orientation: 0, groups: [{ size: 0.5 }, { size: 0.5 }] });
    assert.deepStrictEqual(next, { orientation: 1, groups: [{ size: 0.7, groups: [{ size: 0.5 }, { size: 0.5 }] }, { size: 0.3 }] });
  });

  test('stacked groups keep their sizes and get a bottom group worth 30% of the area', () => {
    const next = withBottomGroup({ orientation: 1, groups: [{ size: 400 }, { size: 300 }] });
    assert.strictEqual(next.orientation, 1);
    assert.deepStrictEqual(next.groups.slice(0, 2), [{ size: 400 }, { size: 300 }]);
    const bottom = next.groups[2].size ?? 0;
    assert.ok(Math.abs(bottom / (700 + bottom) - 0.3) < 1e-9);
  });

  test('a single group becomes a two-row layout', () => {
    assert.deepStrictEqual(withBottomGroup({ orientation: 0, groups: [{}] }), { orientation: 1, groups: [{ size: 0.7, groups: [{}] }, { size: 0.3 }] });
  });
});

suite('terminal: commands', () => {
  suiteSetup(async () => {
    await vscode.extensions.getExtension('itemcoder.storm-parity')?.activate();
  });

  test('the Terminal button brings up a terminal', async function () {
    this.timeout(10000);
    vscode.window.terminals.forEach((t) => t.dispose());
    await vscode.commands.executeCommand('stormParity.terminal.toggle');
    const end = Date.now() + 5000;
    while (!vscode.window.activeTerminal && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
    assert.ok(vscode.window.activeTerminal, 'a terminal is shown');
    vscode.window.terminals.forEach((t) => t.dispose());
  });

  test('the Terminal button toggles between a terminal tab and code in a shared group', async function () {
    this.timeout(20000);
    const terminalCfg = () => vscode.workspace.getConfiguration('stormParity.terminal');
    const editorCfg = () => vscode.workspace.getConfiguration('workbench.editor');
    await terminalCfg().update('tabsBelow', true, vscode.ConfigurationTarget.Global);
    const doc = await vscode.workspace.openTextDocument({ content: 'code', language: 'plaintext' });
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
    const term = vscode.window.createTerminal({ name: 'storm-icon', location: { viewColumn: vscode.ViewColumn.One } });
    term.show();
    const front = () => vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    const waitFor = async (check: () => boolean) => {
      const end = Date.now() + 5000;
      while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
      return check();
    };
    try {
      assert.ok(await waitFor(() => front() instanceof vscode.TabInputTerminal), 'terminal tab in front');
      assert.strictEqual(vscode.window.tabGroups.all.length, 1, 'one shared group');
      await vscode.commands.executeCommand('stormParity.terminal.toggle');
      assert.ok(await waitFor(() => front() instanceof vscode.TabInputText), 'click hides the terminal: code tab in front');
      await vscode.commands.executeCommand('stormParity.terminal.toggle');
      assert.ok(await waitFor(() => front() instanceof vscode.TabInputTerminal), 'click again shows the terminal');
    } finally {
      term.dispose();
      await terminalCfg().update('tabsBelow', undefined, vscode.ConfigurationTarget.Global);
      await editorCfg().update('showTabs', undefined, vscode.ConfigurationTarget.Global);
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    }
  });

  test('toggleCompactTabs flips terminal.integrated.tabs.enabled', async () => {
    const config = () => vscode.workspace.getConfiguration('terminal.integrated');
    const before = config().get<boolean>('tabs.enabled', true);
    try {
      await vscode.commands.executeCommand('stormParity.terminal.toggleCompactTabs');
      assert.strictEqual(config().get<boolean>('tabs.enabled'), !before);
      await vscode.commands.executeCommand('stormParity.terminal.toggleCompactTabs');
      assert.strictEqual(config().get<boolean>('tabs.enabled'), before);
    } finally {
      await config().update('tabs.enabled', undefined, vscode.ConfigurationTarget.Global);
    }
  });

  test('tabs below moves panel terminals into a bottom group and back', async function () {
    this.timeout(30000);
    const terminalTabs = () => vscode.window.tabGroups.all.flatMap((g) => g.tabs.filter((t) => t.input instanceof vscode.TabInputTerminal).map(() => g.viewColumn));
    const doc = await vscode.workspace.openTextDocument({ content: 'code', language: 'plaintext' });
    await vscode.window.showTextDocument(doc);
    const a = vscode.window.createTerminal({ name: 'storm-a' });
    const b = vscode.window.createTerminal({ name: 'storm-b' });
    a.show();
    b.show();
    const editor = () => vscode.workspace.getConfiguration('workbench.editor');
    await editor().update('showTabs', 'single', vscode.ConfigurationTarget.Global);
    try {
      await vscode.commands.executeCommand('stormParity.terminal.toggleTabsBelow');
      assert.strictEqual(vscode.workspace.getConfiguration('stormParity.terminal').get('tabsBelow'), true);
      assert.strictEqual(editor().get('showTabs'), 'multiple', 'single-tab mode would hide terminal tabs in a dropdown');
      const columns = terminalTabs();
      assert.strictEqual(columns.length, 2, 'both terminals became tabs');
      assert.strictEqual(new Set(columns).size, 1, 'in one group: ' + JSON.stringify({ columns, groups: vscode.window.tabGroups.all.map((g) => [g.viewColumn, g.tabs.map((t) => t.label)]) }));
      assert.ok(vscode.window.tabGroups.all[0].tabs.some((t) => t.input instanceof vscode.TabInputText), 'code stays in the top group');
      assert.strictEqual(columns[0], Math.max(...vscode.window.tabGroups.all.map((g) => g.viewColumn)), 'the last (bottom) group');

      await vscode.commands.executeCommand('stormParity.terminal.newTab');
      assert.strictEqual(terminalTabs().length, 3, 'new tabs open in the same group');

      await vscode.commands.executeCommand('stormParity.terminal.hideTabs');
      await vscode.commands.executeCommand('stormParity.terminal.restoreTabs');
      assert.strictEqual(terminalTabs().length, 3, 'hide and restore keep the terminal tabs');
      assert.strictEqual(vscode.window.tabGroups.activeTabGroup.viewColumn, columns[0], 'restore focuses the terminal group');

      await vscode.commands.executeCommand('stormParity.terminal.toggleTabsBelow');
      assert.strictEqual(terminalTabs().length, 0, 'all terminals back in the panel');
      assert.strictEqual(vscode.window.tabGroups.all.length, 1, 'the bottom group is gone');
      assert.ok(vscode.window.tabGroups.all[0].tabs.some((t) => t.input instanceof vscode.TabInputText), 'the code editor stayed');
      assert.strictEqual(editor().get('showTabs'), 'single', 'the previous tab mode is restored');
    } finally {
      await editor().update('showTabs', undefined, vscode.ConfigurationTarget.Global);
      await vscode.workspace.getConfiguration('stormParity.terminal').update('tabsBelow', undefined, vscode.ConfigurationTarget.Global);
      vscode.window.terminals.forEach((t) => t.dispose());
      await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    }
  });
});
