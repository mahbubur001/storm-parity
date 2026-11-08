// Pure editor-layout math for the "Terminal Tabs Below" mode. Shapes match vscode.getEditorLayout / setEditorLayout.

export interface GroupLayout {
  size?: number;
  groups?: GroupLayout[];
}

export interface EditorLayout {
  /** 0 = groups side by side, 1 = groups stacked. */
  orientation: 0 | 1;
  groups: GroupLayout[];
}

/** Share of the editor area the terminal group gets when it is created. */
export const TERMINAL_SHARE = 0.3;

const total = (groups: GroupLayout[]) => groups.reduce((sum, g) => sum + (g.size ?? 1), 0);

/**
 * The current layout with one extra, full-width group at the bottom. Existing groups keep their order (and with it
 * their editors); a side-by-side layout is nested into a top row so the new group spans the full width.
 */
export function withBottomGroup(layout: EditorLayout, share = TERMINAL_SHARE): EditorLayout {
  if (layout.orientation === 1) {
    const sum = total(layout.groups);
    return { orientation: 1, groups: [...layout.groups.map((g) => ({ ...g, size: g.size ?? 1 })), { size: (sum * share) / (1 - share) }] };
  }
  return { orientation: 1, groups: [{ size: 1 - share, groups: layout.groups }, { size: share }] };
}
