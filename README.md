<p align="center"><img src="media/icon.png" width="128" alt="Storm Parity"></p>

# Storm Parity

PhpStorm workflow features for VS Code: the things you miss after switching, built on the public VS Code API with PhpStorm's macOS shortcuts.

Language support, debugging, the HTTP client and database tools are left to dedicated extensions (see [Companion extensions](#companion-extensions)). Storm Parity fills the workflow gaps.

## Where to find things

| Place | What |
|---|---|
| **Explorer** | External Libraries, with the global **Scratches** folder at the end |
| **Secondary Side Bar** (right, Cmd+Opt+B) | Composer (in projects with a `composer.json`) |
| **Source Control** | Changelists |
| **Status bar** | Terminal button, Run widget (run configuration, Run, Debug, Stop), active changelist |
| **Command Palette** | every command, under the *Storm* category |
| *Help > Get Started* | the Storm Parity walkthrough |

## Features

### Projects
- **Open Folder (Ask Where)**: pick a folder or `.code-workspace`, then choose *This Window*, *New Window* or *Attach to Current Workspace*. Tick "remember my choice" or set `stormParity.openFolder.defaultAction`.
- **Open Recent (Ask Where)**: recent folders and workspaces with the same prompt.
- **Project Color**: *Set Project Color* tints this window's title bar (optionally the status bar with `stormParity.projectColor.statusBar`) so project windows are told apart at a glance. It is saved in the workspace settings (`workbench.colorCustomizations`, the only way VS Code applies colours); only its own keys are written and *Reset Project Color* removes them.

### External Libraries
- **PhpStorm Include Paths**: add folders outside the project (WordPress core, shared plugins, SDKs, stubs), browse them in an *External Libraries* view in the Explorer, and have Intelephense index them for completion and Go to Definition. Nothing is written into the project tree.
- **Import from PhpStorm**: reads include paths from `.idea/php.xml`.
- Formerly the standalone *iExternal Libraries* extension. Existing `iextlibraries.*` settings keep working until you change the list here.

### Terminal
- **PhpStorm terminal keys**: Opt+F12 toggles the terminal, Cmd+T / Cmd+W open and close a session, Shift+F6 renames it, Cmd+Shift+] / [ switch sessions.
- **Terminal Tabs Below (PhpStorm style)**: *Toggle Terminal Tabs Below* moves your terminals into a full-width editor group under the code, so they get a real tab strip with close buttons. Opt+F12 focuses the tabs, hides them (the code group is maximized) and brings them back; Cmd+T opens a new tab there; Cmd+Shift+] / [ switch tabs. While on, `workbench.editor.showTabs` is set to `multiple` (it is global, and `single` would collapse the terminal tabs into a dropdown); your previous value comes back when you turn the mode off. Run the command again to move everything back to the panel.
- **Terminal button in the status bar**: each click shows or hides the terminal (the Tabs Below group, or the panel), like PhpStorm's Terminal tool button. Also *Storm: Show / Hide Terminal*.
- **Toggle Compact Terminal Tabs**: hides VS Code's side list of terminals and switches through a dropdown in the panel title, so the terminal uses the full width (closest to PhpStorm's tab row; the extension API can't add real tabs to the panel).

### Navigation
- **Recent Locations**: recently viewed or edited spots with a code preview. Press the shortcut again to switch to *changed only*.
- **Search Everywhere**: files, symbols, actions and settings in one picker. Prefixes: `f ` files, `#` symbols, `>` actions, `@set ` settings.
- **Select In** (Opt+F1): reveal the current file in the Explorer, Finder, a new terminal at its folder, Warp (macOS, when installed; it can't run inside VS Code, so its folder opens in the Warp app), Outline, Timeline or Source Control.
- **PHP include navigation**: Cmd+click (Go to Definition) on a `require` / `include` path opens the file: `'app/Foo.php'` (file folder, then workspace roots and include paths), `__DIR__ . '/x.php'`, `dirname(__FILE__) . '/x.php'`, constants from `define()` / `const` such as `MY_PLUGIN_PATH . 'x.php'`, and WordPress `ABSPATH` / `WPINC` (WordPress found above the project or among the External Libraries include paths).
- **Copy Reference**: copies a PHP FQN (`App\Http\Foo::bar`), a symbol path (`Class.method`) or `path/to/file:42`. *Copy Reference As...* offers every form.

### Editing
- **Clipboard history**: records editor copies and cuts plus outside copies. *Paste from History* inserts at every cursor.
- **Surround With**: language-aware templates (if, foreach, try/catch, function, region, HTML tag, ...) with PhpStorm-style number keys.
- **Toggle Case / Cycle Case**: lower and UPPER, or cycle camelCase, snake_case, kebab-case, PascalCase, SCREAMING_SNAKE.
- **Compare with Clipboard**: diffs the selection or the whole file against the clipboard.
- **Postfix completion (PHP)**: type a dot right after an expression: `$user.if`, `$items.foreach` / `.forek`, `$x.return`, `.echo`, `.var`, `.isset`, `.empty`, `.notnull`, `.null`, `.not`, `.inst`, `.par`, `.throw`, `.unset`, `.count`, `.vd`, `.dd`, `User.new`. Concatenation with spaces (`$a . $b`), strings and comments are left alone.

### Run
- **Run widget**: the selected run configuration sits in the status bar with Run, Debug and Stop buttons, like PhpStorm's toolbar. Configurations are your launch.json configurations and compounds plus every task VS Code knows (tasks.json, npm scripts, composer scripts). *Run...* (Ctrl+Opt+R) and *Debug...* (Ctrl+Opt+D) pick and start one; Stop is Cmd+F2 while something runs.
- **Composer**: a Composer view with its own icon in the right Secondary Side Bar (shown in projects with a `composer.json`) with each project's scripts and direct `require` / `require-dev` packages, the installed version from composer.lock, *Check for Package Updates* (`composer outdated`), *Require Package* with live Packagist search, Install, Update, per-package Update / Remove / Open on Packagist. Commands run as tasks; scripts also appear in the Run widget. Set `stormParity.composer.executable` for a custom composer (e.g. `php composer.phar`).

### Tools
- **Scratch files**: files in any language, stored outside the project, listed in a **Scratches** folder at the end of the External Libraries view, like PhpStorm's Scratches and Consoles (a standalone Scratches view takes over when External Libraries is off).
- **Changelists**: group working-tree changes into named lists in the Source Control view and commit one list at a time.
- **Local History**: a snapshot on every save, *Put Label*, *Show History*, *Show History for Selection* and restore.

## Companion extensions

Storm Parity leaves these PhpStorm areas to extensions that already do them well:

| PhpStorm | Extension |
|---|---|
| PHP code intelligence, refactoring | [PHP Intelephense](https://marketplace.visualstudio.com/items?itemName=bmewburn.vscode-intelephense-client) or [PHP Tools](https://marketplace.visualstudio.com/items?itemName=DEVSENSE.phptools-vscode) |
| Deployment, Remote Host, SSH sessions | [iRemote](https://marketplace.visualstudio.com/items?itemName=itemcoder.iremote) |
| Xdebug | [PHP Debug](https://marketplace.visualstudio.com/items?itemName=xdebug.php-debug) |
| TODO tool window | [Todo Tree](https://marketplace.visualstudio.com/items?itemName=Gruntfuggly.todo-tree) |
| Git annotate, log, stash browser | [GitLens](https://marketplace.visualstudio.com/items?itemName=eamodio.gitlens) |
| HTTP Client | [REST Client](https://marketplace.visualstudio.com/items?itemName=humao.rest-client) |
| Saved projects, tags, project list sidebar | [Project Manager](https://marketplace.visualstudio.com/items?itemName=alefragnani.project-manager) |
| Database tools | [SQLTools](https://marketplace.visualstudio.com/items?itemName=mtxr.vscode-sqltools) |
| Laravel support | [Laravel](https://marketplace.visualstudio.com/items?itemName=laravel.vscode-laravel) |

## Keymap

The keys follow PhpStorm on macOS. On Windows and Linux they are the closest Ctrl/Alt equivalents.

| Command | macOS | Win/Linux | Overrides VS Code default |
|---|---|---|---|
| Open Folder (Ask Where) | Cmd+O | Ctrl+K Ctrl+O | Open File/Folder (mac), Open Folder (win/linux) |
| Open Recent (Ask Where) | Ctrl+R | Ctrl+R | Open Recent |
| Recent Locations | Cmd+Shift+E | Ctrl+Shift+E | Show Explorer |
| Search Everywhere | Cmd+Shift+A | Ctrl+Shift+A | Toggle Block Comment (linux) |
| Select In | Opt+F1 | Alt+F1 | Accessibility Help (only outside screen reader mode) |
| Run... (pick and run) | Ctrl+Opt+R | Alt+Shift+F10 | - |
| Debug... (pick and debug) | Ctrl+Opt+D | Alt+Shift+F9 | - |
| Stop (while something runs) | Cmd+F2 | Ctrl+F2 | Change All Occurrences (only while running) |
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
