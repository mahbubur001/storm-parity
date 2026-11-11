# storm-parity: PhpStorm features for VS Code

A personal VS Code extension that adds the PhpStorm workflow features VS Code lacks.
Published to the VS Code Marketplace as `itemcoder.storm-parity` (tag `vX.Y.Z` → `.github/workflows/release.yml`); also installable locally from the `.vsix`.

## Principles

- One extension, one module per feature under `src/features/<name>/`, each toggleable via a `stormParity.<feature>.enabled` setting.
- Use the public VS Code API only (no patching VS Code internals, no proposed APIs).
- Skip anything a mature extension already does well (PHP language support = Intelephense, `.http` client = REST Client, DB = SQLTools). Fill gaps only.
- Keybindings mirror PhpStorm macOS defaults where they don't clash; the user can rebind.

## Hard limits of the VS Code API (decide up front)

| Want | Reality |
|---|---|
| Replace native File menu items | Not possible. Use commands + keybindings + Command Palette. |
| Prompt when a folder is opened from Finder / `code` CLI | Not possible. Only opens started from our commands. |
| Double-Shift "Search Everywhere" | No double-tap keybindings. Bind to Cmd+Shift+A / Shift+Shift is out. |
| Custom tool windows | Yes: tree views / webviews in sidebar or panel. |
| Editor gutter icons, decorations | Yes. |

## Phases

### Phase 0: scaffold (done 2026-11-08)
- `bun`-based TypeScript extension (yo code layout), esbuild bundle, `@vscode/vsce` packaging.
- Feature registry: each feature exports `activate(ctx)`, gated by its setting.
- Scripts: `build`, `watch`, `package` (→ `.vsix`), `install:local` (`code --install-extension`).
- F5 launch config for the Extension Development Host.
- Done when: an empty "Hello" command runs in the dev host and the `.vsix` installs.

### Phase 1: project/window management (done 2026-11-08)
1. **Open Folder (Ask)**: folder picker → quick pick *This Window / New Window / Attach to workspace*. Bound to Cmd+O.
2. **Open Recent (Ask)**: recent folders/workspaces (`_workbench.getRecentlyOpened`, fallback own MRU in `globalState`) with the same prompt. Bound to Ctrl+R.
3. ~~**Recent Projects tool window**~~: built, then removed in favour of the Project Manager extension; the Storm sidebar went with it (Composer moved to its own Secondary Side Bar container).
4. Setting `stormParity.openFolder.defaultAction` = `ask | thisWindow | newWindow` (+ "remember my choice" checkbox in the prompt).

### Phase 2: navigation (done 2026-11-08)
1. ~~**Bookmarks with mnemonics**~~: built, then removed (not used).
2. **Recent Locations** (Cmd+Shift+E): list of recently viewed/edited code snippets with preview, "changed only" toggle.
3. **Search Everywhere-lite** (Cmd+Shift+A style unified picker): files + symbols + commands + settings in one quick pick with tab-like prefix filters.
4. **Copy Reference** (Cmd+Opt+Shift+C): copy `path/to/file.php:42` or PHP FQN `App\Http\Foo::bar` (via document symbols).

### Phase 3: editing (done 2026-11-08)
1. **Clipboard history / Paste from History** (Cmd+Shift+V): ring of last N copies/cuts made in the editor.
2. **Surround With** (Cmd+Opt+T): language-aware templates (if/else, try/catch, foreach, region, HTML tag) via snippets around the selection.
3. **Toggle Case** (Cmd+Shift+U) and cycle camel/snake/kebab/PASCAL.
4. **Compare with Clipboard**: diff the selection/file against clipboard content.

### Phase 4: tools (done 2026-11-08)
1. **Scratch files** (Cmd+Shift+N): any-language scratch files stored in global storage, Scratches tree view, not part of the project.
2. **Changelists**: group working-tree changes into named lists, commit one list at a time (SCM view contribution + `git` extension API). Biggest effort.
3. ~~**Shelf**~~: built, then removed; VS Code's Source Control Stash covers it.
4. ~~**TODO tool window**~~: built, then removed in favour of the Todo Tree extension (gruntfuggly.todo-tree).
5. **Local History++**: label/put-label + "show history for selection" on top of VS Code's timeline.

### Phase 4b: External Libraries (done 2026-11-08)
- Ported the standalone iExternal Libraries extension (`itemcoder.iextlibraries`) as `src/features/externalLibraries`, reading `iextlibraries.*` settings as a fallback.

### Phase 5: polish (done 2026-11-08)
- Settings UI section, walkthrough, README with keymap table, conflict check against default VS Code bindings.
- Tests: `@vscode/test-electron` integration tests per feature.

### Phase 6: migration gaps (done 2026-11-08)
1. **Run widget**: status bar run configuration selector (launch.json, compounds, all tasks) with Run / Debug / Stop.
2. **Postfix completion (PHP)**: `$x.if`, `.foreach`, `.return`, `Foo.new`, ... via a completion provider on `.`.
3. **Select In** (Opt+F1): Explorer, Finder, terminal, Outline, Timeline, Source Control.
4. **Project Color**: title bar (and optional status bar) tint via workspace `workbench.colorCustomizations`.
5. **Composer**: view with scripts and packages, outdated check, Packagist search, task provider (`storm-composer`).

### Phase 7: terminal toggle (done 2026-11-08, 0.6.1)
- Show / hide the terminal from a status bar button (`stormParity.terminal.toggle`), like PhpStorm's Terminal tool button. First built as an Activity Bar icon (0.6.0), but those can only open a sidebar view, so every click flashed the sidebar; replaced in 0.6.1.
- CI pins Bun via `.bun-version`: unpinned `setup-bun` looks up tags on the GitHub API, which returned 504s.

### Phase 8: title bar toolbar + project tree markers (done 2026-11-10, released 0.7.0 2026-11-11)
- `toolbar` feature: Recent Projects, Checkout Branch, Commit, Run / Debug / Stop, Search Everywhere as `editor/title` actions, shown only with `workbench.editor.editorActionsLocation: titleBar` (no title bar API). Per-button `stormParity.toolbar.show*` settings.
- Terminal status bar button moved to the right, next to Claude Code (priority 0.1).
- 0.7.1: project + branch widgets at the far left of the status bar (no left-hand title bar slot, title is always centred).
- The native macOS title bar can't host icons; the user wants the bare look, so the custom bar runs with `window.commandCenter` and `workbench.layoutControl.enabled` off.

## Backlog (to evaluate)
- Distraction-free / presentation mode presets.

## Order of work
Phase 0 → Phase 1 (ship and use daily) → pick Phase 2/3 items by annoyance, one PR-sized feature at a time.
