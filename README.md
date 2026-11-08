# Storm Parity

PhpStorm workflow features for VS Code: the things you miss after switching, built on the public VS Code API.

Language support, the HTTP client and database tools are left to dedicated extensions (Intelephense, REST Client, SQLTools). Storm Parity fills the workflow gaps.

## Features

### Projects
- **Open Folder (Ask Where)**: pick a folder or `.code-workspace`, then choose *This Window*, *New Window* or *Attach to Current Workspace*. Tick "remember my choice" or set `stormParity.openFolder.defaultAction`.
- **Open Recent (Ask Where)**: recent folders and workspaces with the same prompt.
- **Recent Projects view**: groups, aliases, open in new window, reveal in Finder, remove.

### External Libraries
- **PhpStorm Include Paths**: add folders outside the project (WordPress core, shared plugins, SDKs, stubs), browse them in an *External Libraries* view in the Explorer, and have Intelephense index them for completion and Go to Definition. Nothing is written into the project tree.
- **Import from PhpStorm**: reads include paths from `.idea/php.xml`.
- Formerly the standalone *iExternal Libraries* extension. Existing `iextlibraries.*` settings keep working until you change the list here.

### Terminal
- **PhpStorm terminal keys**: Opt+F12 toggles the terminal, Cmd+T / Cmd+W open and close a session, Shift+F6 renames it, Cmd+Shift+] / [ switch sessions.
- **Terminal Tabs Below (PhpStorm style)**: *Toggle Terminal Tabs Below* moves your terminals into a full-width editor group under the code, so they get a real tab strip with close buttons. Opt+F12 focuses the tabs, hides them (the code group is maximized) and brings them back; Cmd+T opens a new tab there; Cmd+Shift+] / [ switch tabs. While on, `workbench.editor.showTabs` is set to `multiple` (it is global, and `single` would collapse the terminal tabs into a dropdown); your previous value comes back when you turn the mode off. Run the command again to move everything back to the panel.
- **Toggle Compact Terminal Tabs**: hides VS Code's side list of terminals and switches through a dropdown in the panel title, so the terminal uses the full width (closest to PhpStorm's tab row; the extension API can't add real tabs to the panel).

### Navigation
- **Bookmarks with mnemonics**: anonymous or 0-9 / A-Z bookmarks, gutter icons, a Bookmarks view, and positions that follow your edits.
- **Recent Locations**: recently viewed or edited spots with a code preview. Press the shortcut again to switch to *changed only*.
- **Search Everywhere**: files, symbols, actions and settings in one picker. Prefixes: `f ` files, `#` symbols, `>` actions, `@set ` settings.
- **Copy Reference**: copies a PHP FQN (`App\Http\Foo::bar`), a symbol path (`Class.method`) or `path/to/file:42`. *Copy Reference As...* offers every form.

### Editing
- **Clipboard history**: records editor copies and cuts plus outside copies. *Paste from History* inserts at every cursor.
- **Surround With**: language-aware templates (if, foreach, try/catch, function, region, HTML tag, ...) with PhpStorm-style number keys.
- **Toggle Case / Cycle Case**: lower and UPPER, or cycle camelCase, snake_case, kebab-case, PascalCase, SCREAMING_SNAKE.
- **Compare with Clipboard**: diffs the selection or the whole file against the clipboard.

### Tools
- **Scratch files**: files in any language, stored outside the project, with a Scratches view in the Explorer, under External Libraries (like PhpStorm's Scratches and Consoles).
- **Changelists**: group working-tree changes into named lists in the Source Control view and commit one list at a time.
- **Shelf**: shelve a changelist or chosen files as a patch and unshelve it later, independent of `git stash`.
- **TODO view**: TODO/FIXME/HACK/XXX across the workspace, with filters for the current file and by tag.
- **Local History**: a snapshot on every save, *Put Label*, *Show History*, *Show History for Selection* and restore.

## Keymap

The keys follow PhpStorm on macOS. On Windows and Linux they are the closest Ctrl/Alt equivalents.

| Command | macOS | Win/Linux | Overrides VS Code default |
|---|---|---|---|
| Open Folder (Ask Where) | Cmd+O | Ctrl+K Ctrl+O | Open File/Folder (mac), Open Folder (win/linux) |
| Open Recent (Ask Where) | Ctrl+R | Ctrl+R | Open Recent |
| Toggle Bookmark | F3 | F11 | Find Next (mac), Toggle Full Screen (win/linux) |
| Toggle Bookmark with Mnemonic | Opt+F3 | Ctrl+F11 | - |
| Show All Bookmarks | Cmd+F3 | Shift+F11 | Find Next Selection (mac), Debug Step Out (win/linux) |
| Go to Mnemonic Bookmark 0-9 | Ctrl+0..9 | Ctrl+0..9 | Open Editor at Index (mac), Focus Editor Group (win/linux) |
| Toggle Numeric Mnemonic 0-9 | Ctrl+Shift+0..9 | Ctrl+Shift+0..9 | - |
| Recent Locations | Cmd+Shift+E | Ctrl+Shift+E | Show Explorer |
| Search Everywhere | Cmd+Shift+A | Ctrl+Shift+A | Toggle Block Comment (linux) |
| Copy Reference | Cmd+Opt+Shift+C | Ctrl+Alt+Shift+C | Copy Relative Path |
| Copy / Cut (records history) | Cmd+C / Cmd+X | Ctrl+C / Ctrl+X | none: calls the native copy/cut |
| Paste from History | Cmd+Shift+V | Ctrl+Shift+V | Markdown: Open Preview |
| Surround With | Cmd+Opt+T | Ctrl+Alt+T | Close Other Editors (mac) |
| Toggle Case | Cmd+Shift+U | Ctrl+Shift+U | Toggle Output |
| Cycle Case | Ctrl+Opt+U | Ctrl+Alt+U | - |
| New Scratch File | Cmd+Shift+N | Ctrl+Shift+N | New Window |
| Move to Another Changelist | Opt+Shift+M | Alt+Shift+M | - |
| Toggle Terminal (Tabs Below: focus / hide / show) | Opt+F12 | Alt+F12 | Peek Definition |
| New Terminal (terminal focused) | Cmd+T | Ctrl+Shift+T | Go to Symbol in Workspace (only while the terminal is focused) |
| Close Terminal (terminal focused) | Cmd+W | Ctrl+F4 | - |
| Rename Terminal (terminal focused) | Shift+F6 | Shift+F6 | - |
| Next / Previous Terminal (terminal focused) | Cmd+Shift+] / [ | Alt+Right / Alt+Left | - |

Turn off `stormParity.keymap.enabled` to keep every command but drop all of these shortcuts. Each feature can also be switched off with `stormParity.<feature>.enabled`, which also drops that feature's shortcuts.

## Known limits

VS Code's public API can't do some PhpStorm things:
- It can't replace items in the native File menu. Use the commands and shortcuts instead.
- It can't show the open prompt for folders opened from Finder or the `code` CLI.
- It has no double-tap shortcuts, so Search Everywhere is on Cmd+Shift+A instead of Shift Shift.
- Changelists appear as a second source control provider next to Git.

## Development

```bash
bun install
bun run watch          # F5 launches the Extension Development Host
bun run build
bun run test
bun run package        # storm-parity-<version>.vsix
bun run install:local
```

Each feature lives in `src/features/<feature>/` with its own `contributes.json`. `bun run sync` merges them into `package.json`.

## License

MIT
