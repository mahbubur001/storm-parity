import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');
const tests = process.argv.includes('--tests');

const shared = {
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node22',
  external: ['vscode'],
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
};

const configs = [
  { ...shared, entryPoints: ['src/extension.ts'], outfile: 'dist/extension.js' },
];
if (tests) {
  configs.push({ ...shared, entryPoints: ['src/test/**/*.test.ts'], outdir: 'out/test', external: ['vscode', 'mocha'] });
}

if (watch) {
  for (const c of configs) await (await esbuild.context(c)).watch();
} else {
  await Promise.all(configs.map((c) => esbuild.build(c)));
}
