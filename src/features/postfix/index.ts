import * as vscode from 'vscode';
import { expand, findPostfix, templatesFor } from './core';

/**
 * PhpStorm-style postfix completion for PHP: type `$user.if`, `$items.foreach`, `$x.return`, `Foo.new`, ... and the
 * expression before the dot is wrapped by the template. Offered only when the dot directly follows an expression
 * (no space), so string concatenation (`$a . $b`) is untouched.
 */
export function activate(ctx: vscode.ExtensionContext): void {
  const provider: vscode.CompletionItemProvider = {
    provideCompletionItems(document, position) {
      const lineBefore = document.lineAt(position.line).text.slice(0, position.character);
      const match = findPostfix(lineBefore);
      if (!match) return undefined;
      const range = new vscode.Range(position.line, match.start, position.line, position.character);
      const items = templatesFor(match).map((t, i) => {
        const item = new vscode.CompletionItem({ label: t.key, description: t.description }, vscode.CompletionItemKind.Snippet);
        item.range = range;
        item.filterText = `${match.expr}.${t.key}`;
        item.insertText = new vscode.SnippetString(expand(t, match.expr));
        item.sortText = `\u0000${String(i).padStart(3, '0')}`;
        item.detail = 'Postfix template';
        return item;
      });
      return new vscode.CompletionList(items, false);
    },
  };
  ctx.subscriptions.push(vscode.languages.registerCompletionItemProvider({ language: 'php' }, provider, '.'));
}
