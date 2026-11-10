import * as assert from 'assert';
import { classify } from '../features/projectTree/core';
import { rootLabel } from '../features/projectTree/rootPath';

suite('projectTree', () => {
  const libs = ['node_modules', 'vendor'];
  const excluded = ['.next', 'storage/framework'];

  test('plain names match at any depth', () => {
    assert.strictEqual(classify('node_modules', libs, excluded), 'library');
    assert.strictEqual(classify('packages/app/node_modules', libs, excluded), 'library');
    assert.strictEqual(classify('.next', libs, excluded), 'excluded');
    assert.strictEqual(classify('src', libs, excluded), undefined);
    assert.strictEqual(classify('', libs, excluded), undefined);
  });

  test('paths with a slash match from the workspace root', () => {
    assert.strictEqual(classify('storage/framework', libs, excluded), 'excluded');
    assert.strictEqual(classify('app/storage/framework', libs, excluded), undefined);
  });

  test('folders inside a marked folder are not marked again', () => {
    assert.strictEqual(classify('node_modules/foo/vendor', libs, excluded), undefined);
    assert.strictEqual(classify('.next/node_modules', libs, excluded), undefined);
  });

  test('library roots win over excluded', () => {
    assert.strictEqual(classify('vendor', libs, ['vendor']), 'library');
  });

  test('root label is the folder name plus its ~ path', () => {
    assert.strictEqual(rootLabel('/Users/me/dev/app', '/Users/me'), 'app ~/dev/app');
    assert.strictEqual(rootLabel('/srv/app', '/Users/me'), 'app /srv/app');
  });
});
