import * as vscode from 'vscode';
import * as openFolder from './openFolder';
import * as recentProjects from './recentProjects';
import * as bookmarks from './bookmarks';
import * as recentLocations from './recentLocations';
import * as searchEverywhere from './searchEverywhere';
import * as copyReference from './copyReference';
import * as clipboardHistory from './clipboardHistory';
import * as surroundWith from './surroundWith';
import * as toggleCase from './toggleCase';
import * as compareClipboard from './compareClipboard';
import * as scratches from './scratches';
import * as changelists from './changelists';
import * as shelf from './shelf';
import * as todo from './todo';
import * as localHistory from './localHistory';
import * as externalLibraries from './externalLibraries';
import * as terminal from './terminal';

interface Feature {
  id: string;
  activate(ctx: vscode.ExtensionContext): void | Promise<void>;
}

// `id` maps to the `stormParity.<id>.enabled` setting and the src/features/<id> folder.
const features: Feature[] = [
  { id: 'openFolder', activate: openFolder.activate },
  { id: 'recentProjects', activate: recentProjects.activate },
  { id: 'bookmarks', activate: bookmarks.activate },
  { id: 'recentLocations', activate: recentLocations.activate },
  { id: 'searchEverywhere', activate: searchEverywhere.activate },
  { id: 'copyReference', activate: copyReference.activate },
  { id: 'clipboardHistory', activate: clipboardHistory.activate },
  { id: 'surroundWith', activate: surroundWith.activate },
  { id: 'toggleCase', activate: toggleCase.activate },
  { id: 'compareClipboard', activate: compareClipboard.activate },
  { id: 'scratches', activate: scratches.activate },
  { id: 'changelists', activate: changelists.activate },
  { id: 'shelf', activate: shelf.activate },
  { id: 'todo', activate: todo.activate },
  { id: 'localHistory', activate: localHistory.activate },
  { id: 'externalLibraries', activate: externalLibraries.activate },
  { id: 'terminal', activate: terminal.activate },
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
