// Rebuilds package.json `contributes` from src/contributes.base.json plus every
// src/features/<id>/contributes.json fragment. Run via `bun run sync`.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const pkg = read('package.json');
const base = read('src/contributes.base.json');
const featureIds = readdirSync(join(root, 'src/features'), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

const out = {
  commands: [...(base.commands ?? [])],
  keybindings: [...(base.keybindings ?? [])],
  menus: structuredClone(base.menus ?? {}),
  viewsContainers: structuredClone(base.viewsContainers ?? {}),
  views: structuredClone(base.views ?? {}),
  viewsWelcome: [...(base.viewsWelcome ?? [])],
  colors: [...(base.colors ?? [])],
  configuration: [...(base.configuration ?? [])],
  walkthroughs: [...(base.walkthroughs ?? [])],
  taskDefinitions: [...(base.taskDefinitions ?? [])],
};

const mergeMap = (target, src) => {
  for (const [k, v] of Object.entries(src ?? {})) target[k] = [...(target[k] ?? []), ...v];
};

let order = 10;
for (const id of featureIds) {
  const file = `src/features/${id}/contributes.json`;
  if (!existsSync(join(root, file))) continue;
  const f = read(file);
  out.commands.push(...(f.commands ?? []));
  // A feature's keys only apply while the feature is enabled.
  const gate = `config.stormParity.${id}.enabled`;
  out.keybindings.push(...(f.keybindings ?? []).map((kb) => ({ ...kb, when: kb.when ? `${gate} && (${kb.when})` : gate })));
  out.viewsWelcome.push(...(f.viewsWelcome ?? []));
  out.colors.push(...(f.colors ?? []));
  out.taskDefinitions.push(...(f.taskDefinitions ?? []));
  mergeMap(out.menus, f.menus);
  mergeMap(out.views, f.views);
  mergeMap(out.viewsContainers, f.viewsContainers);
  const cfg = f.configuration ?? {};
  out.configuration.push({
    title: cfg.title ?? id,
    order: order++,
    properties: {
      [`stormParity.${id}.enabled`]: {
        type: 'boolean',
        default: true,
        order: 0,
        description: `Enable the ${cfg.title ?? id} feature (reload required).`,
      },
      ...(cfg.properties ?? {}),
    },
  });
}

// Every keybinding can be switched off at once with stormParity.keymap.enabled.
for (const kb of out.keybindings) {
  const gate = 'config.stormParity.keymap.enabled';
  kb.when = kb.when ? `${gate} && (${kb.when})` : gate;
}

// Views may carry an `order` hint (lower first) so containers don't just follow feature names; it is not a manifest key.
for (const views of Object.values(out.views)) {
  views.sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
  for (const v of views) delete v.order;
}

for (const k of Object.keys(out)) {
  const v = out[k];
  if ((Array.isArray(v) && v.length === 0) || (!Array.isArray(v) && Object.keys(v).length === 0)) delete out[k];
}
pkg.contributes = out;
writeFileSync(join(root, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
console.log(`synced ${featureIds.length} features into package.json`);
