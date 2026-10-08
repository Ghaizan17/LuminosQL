# LuminosQL — Database IDE

> VS Code workflow, purpose-built for database engineering. (Phase 1 shell.)

![stack](https://img.shields.io/badge/tauri-2-rust) ![phase](https://img.shields.io/badge/phase-1%20shell-green)

## What works now (Phase 1)

VS Code-like shell: activity bar, sidebar, tabbed editor with split, bottom panel
(Problems/Output/Terminal), status bar, fuzzy command palette (`Ctrl+Shift+P` /
`Ctrl+P`), dark/light themes, configurable shortcut map. No backend yet — every
future command labels the phase that implements it.

## Quick start (frontend only, no Rust needed)

```sh
npm install
npm run dev      # http://localhost:1420
npm test
npm run build
```

## Full desktop build

```sh
./scripts/build-linux.sh        # Fedora → .AppImage + .rpm
.\scripts\build-windows.ps1     # Windows → .exe + .msi
```

Requires the Rust toolchain; see `CONTRIBUTING.md`.

## Docs

- `ARCHITECTURE.md` — stack decision + module contracts
- `ROADMAP.md` — phases with exit criteria
- `SECURITY.md` — credential + destructive-query rules
