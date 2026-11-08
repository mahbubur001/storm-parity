import * as vscode from 'vscode';
import { buildBlockSnippet, buildInlineSnippet, mnemonic, SurroundTemplate, templatesFor } from './templates';

interface TemplatePick extends vscode.QuickPickItem {
  template: SurroundTemplate;
  key?: string;
}

export function activate(ctx: vscode.ExtensionContext): void {
  ctx.subscriptions.push(
    vscode.commands.registerTextEditorCommand('stormParity.surroundWith.surround', async (editor) => {
      const template = await pickTemplate(templatesFor(editor.document.languageId));
      if (template) await applyTemplate(editor, template);
    }),
  );
}

async function pickTemplate(templates: SurroundTemplate[]): Promise<SurroundTemplate | undefined> {
  const items: TemplatePick[] = templates.map((template, i) => {
    const key = mnemonic(i);
    return { label: key ? `${key}. ${template.label}` : template.label, template, key };
  });
  const qp = vscode.window.createQuickPick<TemplatePick>();
  qp.title = 'Surround With';
  qp.placeholder = 'Type a number (or capital letter) to pick, or filter by name';
  qp.items = items;
  return new Promise((resolve) => {
    let result: SurroundTemplate | undefined;
    const accept = (pick: TemplatePick | undefined): void => {
      result = pick?.template;
      qp.hide();
    };
    qp.onDidChangeValue((value) => {
      // Mnemonics: a single digit or capital letter picks immediately, like PhpStorm.
      if (/^[0-9A-Z]$/.test(value)) accept(items.find((i) => i.key === value));
    });
    qp.onDidAccept(() => accept(qp.selectedItems[0]));
    qp.onDidHide(() => {
      qp.dispose();
      resolve(result);
    });
    qp.show();
  });
}

async function applyTemplate(editor: vscode.TextEditor, template: SurroundTemplate): Promise<void> {
  const doc = editor.document;
  const sel = editor.selection;

  if (template.wrap && !sel.isEmpty && sel.isSingleLine) {
    await editor.insertSnippet(new vscode.SnippetString(buildInlineSnippet(template, doc.getText(sel))), sel);
    return;
  }

  const startLine = sel.start.line;
  // A selection ending at column 0 of a later line (e.g. full-line selection) does not include that line.
  const endLine = !sel.isSingleLine && sel.end.character === 0 ? sel.end.line - 1 : sel.end.line;
  const lines: string[] = [];
  for (let l = startLine; l <= endLine; l++) lines.push(doc.lineAt(l).text);

  const first = doc.lineAt(startLine);
  const start = first.isEmptyOrWhitespace ? first.range.end : new vscode.Position(startLine, first.firstNonWhitespaceCharacterIndex);
  const range = new vscode.Range(start, doc.lineAt(endLine).range.end);
  await editor.insertSnippet(new vscode.SnippetString(buildBlockSnippet(template, lines)), range);
}
