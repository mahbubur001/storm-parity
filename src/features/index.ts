import * as vscode from 'vscode';
import * as openFolder from './openFolder';
import * as recentLocations from './recentLocations';
import * as searchEverywhere from './searchEverywhere';
import * as copyReference from './copyReference';
import * as clipboardHistory from './clipboardHistory';
import * as surroundWith from './surroundWith';
import * as toggleCase from './toggleCase';
import * as compareClipboard from './compareClipboard';
import * as scratches from './scratches';
import * as changelists from './changelists';
import * as localHistory from './localHistory';
import * as externalLibraries from './externalLibraries';
import * as terminal from './terminal';
import * as run from './run';
import * as postfix from './postfix';
import * as selectIn from './selectIn';
import * as projectColor from './projectColor';
import * as composer from './composer';
import * as phpIncludes from './phpIncludes';
import * as projectTree from './projectTree';
import * as toolbar from './toolbar';

interface Feature {
  id: string;
  activate(ctx: vscode.ExtensionContext): void | Promise<void>;
}

// `id` maps to the `stormParity.<id>.enabled` setting and the src/features/<id> folder.
const features: Feature[] = [
  { id: 'openFolder', activate: openFolder.activate },
  { id: 'recentLocations', activate: recentLocations.activate },
  { id: 'searchEverywhere', activate: searchEverywhere.activate },
  { id: 'copyReference', activate: copyReference.activate },
  { id: 'clipboardHistory', activate: clipboardHistory.activate },
  { id: 'surroundWith', activate: surroundWith.activate },
  { id: 'toggleCase', activate: toggleCase.activate },
  { id: 'compareClipboard', activate: compareClipboard.activate },
  { id: 'scratches', activate: scratches.activate },
  { id: 'changelists', activate: changelists.activate },
  { id: 'localHistory', activate: localHistory.activate },
  { id: 'externalLibraries', activate: externalLibraries.activate },
  { id: 'terminal', activate: terminal.activate },
  { id: 'run', activate: run.activate },
  { id: 'postfix', activate: postfix.activate },
  { id: 'selectIn', activate: selectIn.activate },
  { id: 'projectColor', activate: projectColor.activate },
  { id: 'composer', activate: composer.activate },
  { id: 'phpIncludes', activate: phpIncludes.activate },
  { id: 'projectTree', activate: projectTree.activate },
  { id: 'toolbar', activate: toolbar.activate },
];

export async function activateFeatures(ctx: vscode.ExtensionContext): Promise<void> {
  for (const feature of features) {
    const enabled = vscode.workspace.getConfiguration(`stormParity.${feature.id}`).get<boolean>('enabled', true);
    if (!enabled) continue;
    try {
      await feature.activate(ctx);
    } catch (err) {
      console.error(`[storm-parity] failed to activate ${feature.id}`, err);
    }
  }

  ctx.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (!features.some((f) => e.affectsConfiguration(`stormParity.${f.id}.enabled`))) return;
      const choice = await vscode.window.showInformationMessage('Storm Parity: reload the window to apply the feature toggle.', 'Reload');
      if (choice === 'Reload') await vscode.commands.executeCommand('workbench.action.reloadWindow');
    }),
  );
}
