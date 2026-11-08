# Changelog

## Unreleased

- **PHP include navigation**: Cmd+click on a `require` / `include` path opens the file, like PhpStorm. Handles plain relative paths, `__DIR__` / `dirname(__FILE__)`, `define()` constants (e.g. `RTCL_PRO_PATH . 'vendor/autoload.php'`) and WordPress `ABSPATH`.

## 0.6.2

- **Select In** (Opt+F1): *Warp* entry on macOS when Warp is installed; opens the file's folder in the Warp app.

## 0.6.1

- The Terminal toggle moved from the Activity Bar to a **status bar button** (`$(terminal)`, bottom left), also *Storm: Show / Hide Terminal*. An Activity Bar icon can only open a sidebar view, so every click flashed the sidebar and reflowed the window.

## 0.6.0

- **Requires VS Code 1.106 or later** (right Secondary Side Bar contributions).
- **Terminal icon in the Activity Bar**: a toggle like PhpStorm's Terminal tool button. Each click shows or hides the terminal (the Tabs Below group, or the terminal panel); the sidebar stays on the Explorer.
- External Libraries: the *Include Paths* setting now has an **Add Folder...** link that opens the folder browser (the Settings editor has no browse button for lists).
- Removed the **Recent Projects** view: use the [Project Manager](https://marketplace.visualstudio.com/items?itemName=alefragnani.project-manager) extension. Cmd+O / Ctrl+R keep the where-to-open prompt. The Storm sidebar is gone with it: **Composer** now has its own icon in the right Secondary Side Bar (shown only in projects with a `composer.json`), like PhpStorm's right-hand tool strip.
- New extension icon in the same style as iRemote (dark navy, purple-to-teal lightning bolt); Marketplace banner colour to match.
- README: *Where to find things* and *Companion extensions* sections; walkthrough updated for Select In, PHP postfix, the Run widget, Composer, Project Color and global Scratches.

## 0.5.0

- Removed **Bookmarks** (F3, Opt+F3, Ctrl+0..9, Cmd+F3 are back to VS Code's defaults) and **Shelf** (use Source Control → Stash, or GitLens). Their `stormParity.bookmarks.*` / `stormParity.shelf.*` settings no longer have any effect.

- Removed the TODO view: use the [Todo Tree](https://marketplace.visualstudio.com/items?itemName=Gruntfuggly.todo-tree) extension, which does it better (editor highlights, ripgrep, custom tags). The `stormParity.todo.*` settings no longer have any effect.

## 0.4.0

- **Run widget**: status bar selector of run configurations (launch.json, compounds, tasks, npm and composer scripts) with Run, Debug and Stop buttons; *Run...* Ctrl+Opt+R, *Debug...* Ctrl+Opt+D, Stop Cmd+F2 while running.
- **Postfix completion for PHP**: `$x.if`, `.foreach`, `.forek`, `.return`, `.echo`, `.var`, `.isset`, `.notnull`, `.inst`, `User.new` and more.
- **Select In** (Opt+F1): reveal the current file in the Explorer, Finder, a terminal, Outline, Timeline or Source Control.
- **Project Color**: tint the window title bar (optionally the status bar) per project.
- **Composer view**: scripts and packages with installed versions, update check, Packagist search for *Require*, install / update / remove as tasks; composer scripts appear in the Run widget.

- Scratches is now a **Scratches** folder at the end of the External Libraries tree (files indented under it, no second "Scratches" header), like PhpStorm's project tree. The folder has inline **New Scratch File**; rename / delete / reveal work as before. The standalone Scratches view only appears when External Libraries is turned off.

## 0.3.1

- Scratches moved from the Storm sidebar to the Explorer, right under External Libraries, with the files under a collapsible "Scratches" folder (like PhpStorm's Scratches and Consoles).

## 0.3.0

- Terminal Tabs Below: terminals as real tabs in a full-width group under the code (PhpStorm-style tab strip), with Opt+F12 to focus, hide and restore them. Forces `workbench.editor.showTabs: multiple` while on so terminal tabs are not hidden in a dropdown.
- Terminal: PhpStorm keys (Opt+F12 toggle, Cmd+T new, Cmd+W close, Shift+F6 rename, Cmd+Shift+] / [ switch) and *Toggle Compact Terminal Tabs*, which swaps the side tab list for the title-bar dropdown.
- Disabling a feature now also removes its keyboard shortcuts.

## 0.2.0

- External Libraries (PhpStorm Include Paths): the iExternal Libraries extension is now a Storm Parity feature. `iextlibraries.includePaths` and `iextlibraries.intelephense.sync` are read as fallbacks, and Intelephense entries added by the old extension are cleaned up correctly. While the old extension is installed, this feature stays off and offers to uninstall it.

## 0.1.0

First release.

- Projects: Open Folder / Open Recent with a where-to-open prompt, Recent Projects view with groups and aliases.
- Navigation: mnemonic bookmarks, Recent Locations, Search Everywhere, Copy Reference.
- Editing: clipboard history, Surround With, Toggle/Cycle Case, Compare with Clipboard.
- Tools: scratch files, changelists, shelf, TODO view, local history with labels.
- Global keymap toggle (`stormParity.keymap.enabled`), per-feature toggles, Getting Started walkthrough.
