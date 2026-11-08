import * as assert from 'assert';
import * as vscode from 'vscode';
import { colorKeys, contrastColor, mergeColors, normalizeHex, PALETTE } from '../features/projectColor/core';

suite('projectColor', () => {
  suiteSetup(async () => {
    await vscode.extensions.getExtension('itemcoder.storm-parity')?.activate();
  });

  test('commands are registered', async () => {
    const all = await vscode.commands.getCommands(true);
    assert.ok(all.includes('stormParity.projectColor.set') && all.includes('stormParity.projectColor.reset'));
  });

  test('normalizeHex accepts #RGB and #RRGGBB', () => {
    assert.strictEqual(normalizeHex('#3574f0'), '#3574F0');
    assert.strictEqual(normalizeHex('abc'), '#AABBCC');
    assert.strictEqual(normalizeHex('#12345'), undefined);
    assert.strictEqual(normalizeHex('blue'), undefined);
  });

  test('text colour contrasts with the background', () => {
    assert.strictEqual(contrastColor('#FFFFFF'), '#000000');
    assert.strictEqual(contrastColor('#000000'), '#FFFFFF');
    assert.strictEqual(contrastColor('#F5D90A'), '#000000');
    for (const c of PALETTE) assert.strictEqual(contrastColor(c.hex), '#FFFFFF', c.name);
  });

  test('colorKeys covers the title bar, and the status bar on request', () => {
    assert.deepStrictEqual(Object.keys(colorKeys('#3574F0', false)).sort(), [
      'titleBar.activeBackground',
      'titleBar.activeForeground',
      'titleBar.inactiveBackground',
      'titleBar.inactiveForeground',
    ]);
    assert.strictEqual(colorKeys('#3574F0', true)['statusBar.background'], '#3574F0');
  });

  test('mergeColors keeps the user keys and replaces only ours', () => {
    const user = { 'editor.background': '#111111', 'titleBar.activeBackground': '#222222', 'statusBar.background': '#333333' };
    const next = mergeColors(user, ['titleBar.activeBackground', 'statusBar.background'], { 'titleBar.activeBackground': '#3574F0' });
    assert.deepStrictEqual(next, { 'editor.background': '#111111', 'titleBar.activeBackground': '#3574F0' });
    assert.strictEqual(mergeColors({ 'titleBar.activeBackground': '#3574F0' }, ['titleBar.activeBackground'], {}), undefined);
  });
});
