import * as vscode from 'vscode';
import { activateFeatures } from './features';

export async function activate(ctx: vscode.ExtensionContext): Promise<void> {
  await activateFeatures(ctx);
}

export function deactivate(): void {}
