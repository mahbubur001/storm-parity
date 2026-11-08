// Pure composer.json / composer.lock / `composer outdated` parsing (no vscode import, unit tested).

export interface ComposerPackage {
  name: string;
  constraint: string;
  dev: boolean;
}

export interface ComposerManifest {
  scripts: string[];
  packages: ComposerPackage[];
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** php, ext-*, lib-*, composer-* are platform requirements, not installable packages. */
export const isPlatform = (name: string): boolean => /^(php(-64bit|-ipv6|-zts|-debug)?|hhvm|ext-.+|lib-.+|composer(-plugin|-runtime)?-api|composer)$/i.test(name);

export const isPackageName = (name: string): boolean => /^[a-z0-9]([_.-]?[a-z0-9]+)*\/[a-z0-9](([_.]?|-{0,2})[a-z0-9]+)*$/.test(name);

export function parseManifest(text: string): ComposerManifest {
  const json = obj(JSON.parse(text));
  const pkgs = (section: unknown, dev: boolean): ComposerPackage[] =>
    Object.entries(obj(section))
      .filter(([, c]) => typeof c === 'string')
      .map(([name, c]) => ({ name, constraint: c as string, dev }));
  return {
    // Keys starting with "pre-"/"post-" are event hooks, still runnable with run-script.
    scripts: Object.keys(obj(json.scripts)),
    packages: [...pkgs(json.require, false), ...pkgs(json['require-dev'], true)],
  };
}

/** name → installed version from composer.lock. */
export function parseLock(text: string): Map<string, string> {
  const json = obj(JSON.parse(text));
  const out = new Map<string, string>();
  for (const list of [json.packages, json['packages-dev']]) {
    if (!Array.isArray(list)) continue;
    for (const p of list) {
      const { name, version } = obj(p);
      if (typeof name === 'string' && typeof version === 'string') out.set(name.toLowerCase(), version);
    }
  }
  return out;
}

export interface Outdated {
  latest: string;
  /** semver-safe-update: within the constraint; update-possible: needs a constraint change. */
  status: 'semver-safe-update' | 'update-possible' | string;
}

/** Output of `composer outdated --direct --format=json`. */
export function parseOutdated(text: string): Map<string, Outdated> {
  const json = obj(JSON.parse(text));
  const out = new Map<string, Outdated>();
  for (const p of Array.isArray(json.installed) ? json.installed : []) {
    const { name, latest, 'latest-status': status } = obj(p);
    if (typeof name === 'string' && typeof latest === 'string' && status !== 'up-to-date') out.set(name.toLowerCase(), { latest, status: String(status) });
  }
  return out;
}

/** "vendor/pkg", "vendor/pkg:^2.0" or "vendor/pkg ^2.0" → composer require argument, or undefined. */
export function parseRequireInput(input: string): string | undefined {
  const m = /^\s*([^\s:]+)(?:[\s:]+(\S.*?))?\s*$/.exec(input);
  if (!m || !isPackageName(m[1].toLowerCase())) return undefined;
  return m[2] ? `${m[1].toLowerCase()}:${m[2]}` : m[1].toLowerCase();
}
