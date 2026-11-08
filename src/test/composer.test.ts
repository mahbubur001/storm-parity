import * as assert from 'assert';
import * as vscode from 'vscode';
import { isPackageName, isPlatform, parseLock, parseManifest, parseOutdated, parseRequireInput } from '../features/composer/core';

suite('composer', () => {
  suiteSetup(async () => {
    await vscode.extensions.getExtension('itemcoder.storm-parity')?.activate();
  });

  test('commands are registered', async () => {
    const all = await vscode.commands.getCommands(true);
    for (const id of ['refresh', 'install', 'update', 'require', 'checkOutdated', 'runScript', 'updatePackage', 'removePackage', 'openPackagist', 'openManifest']) {
      assert.ok(all.includes(`stormParity.composer.${id}`), id);
    }
  });

  test('parseManifest reads scripts and both require sections', () => {
    const m = parseManifest(
      JSON.stringify({
        require: { php: '^8.2', 'laravel/framework': '^11.0', 'ext-json': '*' },
        'require-dev': { 'phpunit/phpunit': '^11' },
        scripts: { test: 'phpunit', 'post-install-cmd': ['@php artisan optimize'] },
      }),
    );
    assert.deepStrictEqual(m.scripts, ['test', 'post-install-cmd']);
    assert.deepStrictEqual(
      m.packages.map((p) => [p.name, p.constraint, p.dev]),
      [
        ['php', '^8.2', false],
        ['laravel/framework', '^11.0', false],
        ['ext-json', '*', false],
        ['phpunit/phpunit', '^11', true],
      ],
    );
    assert.deepStrictEqual(parseManifest('{}'), { scripts: [], packages: [] });
  });

  test('parseLock maps lower-cased names to installed versions', () => {
    const lock = parseLock(JSON.stringify({ packages: [{ name: 'Laravel/Framework', version: 'v11.9.2' }], 'packages-dev': [{ name: 'phpunit/phpunit', version: '11.2.1' }, { name: 1 }] }));
    assert.strictEqual(lock.get('laravel/framework'), 'v11.9.2');
    assert.strictEqual(lock.get('phpunit/phpunit'), '11.2.1');
    assert.strictEqual(lock.size, 2);
  });

  test('parseOutdated keeps only packages with an update', () => {
    const out = parseOutdated(
      JSON.stringify({
        installed: [
          { name: 'a/b', version: '1.0.0', latest: '1.2.0', 'latest-status': 'semver-safe-update' },
          { name: 'c/d', version: '1.0.0', latest: '2.0.0', 'latest-status': 'update-possible' },
          { name: 'e/f', version: '1.0.0', latest: '1.0.0', 'latest-status': 'up-to-date' },
        ],
      }),
    );
    assert.deepStrictEqual([...out.keys()], ['a/b', 'c/d']);
    assert.strictEqual(out.get('c/d')?.status, 'update-possible');
  });

  test('platform requirements and package names', () => {
    for (const n of ['php', 'php-64bit', 'ext-mbstring', 'lib-curl', 'composer-plugin-api']) assert.ok(isPlatform(n), n);
    assert.ok(!isPlatform('phpunit/phpunit'));
    assert.ok(isPackageName('laravel/framework') && isPackageName('symfony/http-foundation') && isPackageName('vendor/pkg.name'));
    assert.ok(!isPackageName('laravel') && !isPackageName('Bad/Name') && !isPackageName('a//b'));
  });

  test('parseRequireInput accepts name, name:constraint and name constraint', () => {
    assert.strictEqual(parseRequireInput('guzzlehttp/guzzle'), 'guzzlehttp/guzzle');
    assert.strictEqual(parseRequireInput(' guzzlehttp/guzzle:^7.8 '), 'guzzlehttp/guzzle:^7.8');
    assert.strictEqual(parseRequireInput('Monolog/Monolog ^3'), 'monolog/monolog:^3');
    assert.strictEqual(parseRequireInput('guzzle'), undefined);
    assert.strictEqual(parseRequireInput(''), undefined);
  });
});
