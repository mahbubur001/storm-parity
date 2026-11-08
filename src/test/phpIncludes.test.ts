import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { candidatePaths, constantsOf, evaluate, findDefines, findIncludeAt } from '../features/phpIncludes/core';

const FILE = '/www/wp-content/plugins/pro/pro.php';
const value = (line: string, constants: Record<string, string> = {}) => {
  const at = findIncludeAt(line, line.indexOf("'"));
  return at && evaluate(at.node, FILE, new Map(Object.entries(constants)));
};

suite('phpIncludes', () => {
  suiteSetup(async () => {
    await vscode.extensions.getExtension('itemcoder.storm-parity')?.activate();
  });

  test('evaluates the include forms WordPress plugins use', () => {
    assert.strictEqual(value("require_once 'app/RtclPro.php';"), 'app/RtclPro.php');
    assert.strictEqual(value("require_once( 'app/x.php' );"), 'app/x.php');
    assert.strictEqual(value("require __DIR__ . '/vendor/autoload.php';"), '/www/wp-content/plugins/pro/vendor/autoload.php');
    assert.strictEqual(value("include dirname(__FILE__) . '/a.php';"), '/www/wp-content/plugins/pro/a.php');
    assert.strictEqual(value("include dirname( __FILE__, 2 ) . '/a.php';"), '/www/wp-content/plugins/a.php');
    assert.strictEqual(value("require_once ABSPATH . 'wp-admin/includes/file.php';", { ABSPATH: '/www/' }), '/www/wp-admin/includes/file.php');
    assert.strictEqual(value("require_once ABSPATH . 'wp-admin/includes/file.php';"), undefined, 'unknown constant');
    assert.strictEqual(value('require "views/$name.php";'), undefined, 'interpolated string');
  });

  test('range covers the path expression and the cursor must be on the statement', () => {
    const line = "  require_once RTCL_PRO_PATH . 'vendor/autoload.php'; // x";
    const at = findIncludeAt(line, line.indexOf('vendor'));
    assert.ok(at);
    assert.strictEqual(line.slice(at.start, at.end), "RTCL_PRO_PATH . 'vendor/autoload.php'");
    assert.deepStrictEqual(constantsOf(at.node), ['RTCL_PRO_PATH']);
    assert.strictEqual(findIncludeAt(line, line.indexOf('// x') + 3), undefined);
    assert.strictEqual(findIncludeAt("// require_once 'a.php';", 5), undefined);
  });

  test('reads define() and const declarations, including chained constants', () => {
    const src = "define( 'PRO_FILE', __FILE__ );\ndefine( 'PRO_PATH', plugin_dir_path( PRO_FILE ) );\nconst LIB = __DIR__ . '/lib';";
    const defines = findDefines(src);
    assert.deepStrictEqual(defines.map((d) => d.name), ['PRO_FILE', 'PRO_PATH', 'LIB']);
    const constants = new Map<string, string>();
    for (const d of defines) constants.set(d.name, evaluate(d.node, FILE, constants)!);
    assert.strictEqual(constants.get('PRO_PATH'), '/www/wp-content/plugins/pro/');
    assert.strictEqual(constants.get('LIB'), '/www/wp-content/plugins/pro/lib');
  });

  test('candidate paths: absolute, ./ relative, then file folder and search dirs', () => {
    assert.deepStrictEqual(candidatePaths('/a/b.php', '/x', ['/r']), [path.normalize('/a/b.php')]);
    assert.deepStrictEqual(candidatePaths('../b.php', '/x/y', ['/r']), [path.resolve('/x/b.php')]);
    assert.deepStrictEqual(candidatePaths('app/b.php', '/x', ['/r', '/x']), [path.resolve('/x/app/b.php'), path.resolve('/r/app/b.php')]);
  });

  test('Go to Definition on an include opens the file', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'storm-includes-'));
    fs.mkdirSync(path.join(dir, 'app'));
    fs.mkdirSync(path.join(dir, 'vendor'));
    fs.writeFileSync(path.join(dir, 'app', 'Pro.php'), '<?php\n');
    fs.writeFileSync(path.join(dir, 'vendor', 'autoload.php'), '<?php\n');
    const main = path.join(dir, 'pro.php');
    const lines = [
      '<?php',
      "define( 'PRO_FILE', __FILE__ );",
      "define( 'PRO_PATH', plugin_dir_path( PRO_FILE ) );",
      "require_once 'app/Pro.php';",
      "require_once PRO_PATH . 'vendor/autoload.php';",
      "require_once 'app/Missing.php';",
    ];
    fs.writeFileSync(main, lines.join('\n'));
    try {
      const doc = await vscode.workspace.openTextDocument(main);
      const target = async (line: number) => {
        const col = lines[line].indexOf("'") + 2;
        const links = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>('vscode.executeDefinitionProvider', doc.uri, new vscode.Position(line, col));
        const link = links?.[0];
        return link && ('targetUri' in link ? link.targetUri : link.uri).fsPath;
      };
      assert.strictEqual(await target(3), path.join(dir, 'app', 'Pro.php'));
      assert.strictEqual(await target(4), path.join(dir, 'vendor', 'autoload.php'));
      assert.strictEqual(await target(5), undefined, 'missing files give no link');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
