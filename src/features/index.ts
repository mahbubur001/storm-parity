import * as vscode from 'vscode';
import * as hello from './hello';

interface Feature {
  id: string;
  activate(ctx: vscode.ExtensionContext): void;
}

// Register new features here. `id` maps to the `stormParity.<id>.enabled` setting.
const features: Feature[] = [{ id: 'hello', activate: hello.activate }];

export function activateFeatures(ctx: vscode.ExtensionContext): void {
  for (const feature of features) {
    const enabled = vscode.workspace.getConfiguration(`stormParity.${feature.id}`).get<boolean>('enabled', true);
    if (!enabled) continue;
    try {
      feature.activate(ctx);
    } catch (err) {
      console.error(`[storm-parity] failed to activate ${feature.id}`, err);
    }
  }
}
