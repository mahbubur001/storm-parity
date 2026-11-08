# CLAUDE.md

Guidance for Claude Code in this repository.

## What this is

`storm-parity`: a personal VS Code extension that adds PhpStorm workflow features VS Code lacks
(open-folder prompt, recent projects, bookmarks with mnemonics, clipboard history, scratch files,
changelists, ...). **Roadmap and resume point: `PLAN.md`.** Installed locally as a `.vsix`; never published.

## Stack

- TypeScript, VS Code Extension API (public API only, no proposed APIs).
- `bun` for installs/scripts, `esbuild` bundles `src/extension.ts` → `dist/extension.js`.
- `@vscode/vsce` packages the `.vsix`; `@vscode/test-electron` for integration tests.
- Use Context7 for VS Code API docs (`/microsoft/vscode-docs` or similar) before using an unfamiliar API.

## Commands (after Phase 0 scaffold)

```bash
bun install
bun run watch            # rebuild on change; press F5 in VS Code for the Extension Development Host
bun run build
bun run package          # → storm-parity-<version>.vsix
bun run install:local    # code --install-extension <vsix> --force
bun run test
```

## Layout & conventions

- `src/extension.ts`: activates the feature registry only.
- `src/features/<feature>/index.ts`: exports `activate(ctx: vscode.ExtensionContext)`; everything the feature registers goes into `ctx.subscriptions`.
- Every feature has a `stormParity.<feature>.enabled` setting (default true) checked at activation.
- Command IDs: `stormParity.<feature>.<action>`; titles prefixed with category `Storm`.
- Keybindings mirror PhpStorm macOS defaults; when a default VS Code binding clashes, note it in README's keymap table.
- Persist state in `ctx.globalState` / `ctx.workspaceState` / `ctx.globalStorageUri`, never in the user's project.
- Lazy activation: prefer `onCommand:` / `onView:` / `onStartupFinished` over `*`.
- No em-dashes in code, comments or docs.

## Known API limits

Can't replace native menu items, can't intercept folder opens from Finder/CLI, no double-tap (Shift Shift) keybindings. Don't promise these; work around with commands + keybindings.
