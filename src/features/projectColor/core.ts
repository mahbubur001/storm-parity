// Pure colour helpers for Project Color (no vscode import, unit tested).

/** PhpStorm-like project colours. */
export const PALETTE: { name: string; hex: string }[] = [
  { name: 'Red', hex: '#B5443E' },
  { name: 'Orange', hex: '#A85A24' },
  { name: 'Yellow', hex: '#7D6A12' },
  { name: 'Green', hex: '#3A7F45' },
  { name: 'Teal', hex: '#25797A' },
  { name: 'Blue', hex: '#2F66D0' },
  { name: 'Indigo', hex: '#5E5AC9' },
  { name: 'Purple', hex: '#8E4EC6' },
  { name: 'Pink', hex: '#C2477E' },
  { name: 'Gray', hex: '#5F6368' },
];

export const normalizeHex = (input: string): string | undefined => {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(input.trim());
  if (!m) return undefined;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return `#${h.toUpperCase()}`;
};

/** Black or white text, whichever reads better on `hex` (WCAG relative luminance). */
export function contrastColor(hex: string): '#000000' | '#FFFFFF' {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return (1.05 / (l + 0.05)) >= ((l + 0.05) / 0.05) ? '#FFFFFF' : '#000000';
}

/** Title bar colours (and optionally the status bar) for a project colour. */
export function colorKeys(hex: string, statusBar: boolean): Record<string, string> {
  const fg = contrastColor(hex);
  return {
    'titleBar.activeBackground': hex,
    'titleBar.activeForeground': fg,
    'titleBar.inactiveBackground': `${hex}CC`,
    'titleBar.inactiveForeground': `${fg}99`,
    ...(statusBar ? { 'statusBar.background': hex, 'statusBar.foreground': fg } : {}),
  };
}

/** The user's colour customizations with ours replaced: previous keys of ours are dropped, then `ours` is applied. */
export function mergeColors(existing: Record<string, unknown> | undefined, previousKeys: string[], ours: Record<string, string>): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = { ...(existing ?? {}) };
  for (const k of previousKeys) delete out[k];
  Object.assign(out, ours);
  return Object.keys(out).length ? out : undefined;
}
