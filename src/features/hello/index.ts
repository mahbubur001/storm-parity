import * as vscode from 'vscode';

export function activate(ctx: vscode.ExtensionContext): void {
  ctx.subscriptions.push(
    vscode.commands.registerCommand('stormParity.hello.sayHello', () => {
      vscode.window.showInformationMessage('Hello from Storm Parity');
      return 'hello';
    }),
  );
}
