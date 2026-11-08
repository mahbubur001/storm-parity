import * as vscode from 'vscode';
import { activateFeatures } from './features';

export function activate(ctx: vscode.ExtensionContext): void {
  activateFeatures(ctx);
}

export function deactivate(): void {}
