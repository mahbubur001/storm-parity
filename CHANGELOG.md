# Changelog

## 0.3.0

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
