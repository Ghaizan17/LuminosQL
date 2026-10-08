# ROADMAP — Database IDE

Each phase has an exit criterion. Do not start the next phase until the current
one is green.

## Phase 0 — Research & Architecture ✅ (this commit)

- [x] Inspect environment, choose stack, record decision.
- [x] Write `ARCHITECTURE.md`, `ROADMAP.md`, `SECURITY.md`, `CONTRIBUTING.md`.
- [x] Scaffold skeleton (`src/`, `src-tauri/`, `scripts/`).
- Exit: docs committed, `npm run build` green without Rust installed.

## Phase 1 — Desktop Shell (in progress)

- [ ] App window + VS Code-like grid: activity bar, sidebar, editor tabs (+ split),
      bottom panel, status bar, command palette (`Ctrl+Shift+P`, `Ctrl+P`).
- [ ] Dark default + light theme, settings + keyboard-shortcut scaffolding.
- [ ] Unit tests: command registry, shortcut map, SQL keyword completer.
- Exit: `npm run build` + `npm test` green; shell usable with no backend.

## Phase 2 — Database Connections

- PostgreSQL, MySQL/MariaDB, SQLite via `DatabaseAdapter` trait.
- Create/connect/disconnect/reconnect/delete; friendly connection errors.
- Exit: integration tests against all three engines (containers for pg/mysql).

## Phase 3 — Database Explorer

- Schemas, tables, columns, indexes, FKs, views, functions; lazy loading.
- Context menu: create/rename/delete/refresh/inspect/copy-SQL/open-data.
- Exit: 1k-table schema browses without UI jank (lazy + cached metadata).

## Phase 4 — SQL Editor

- Monaco + syntax highlight, schema-aware autocomplete, diagnostics, formatting,
  hover, go-to-definition. `EditorPane` interface already exists from Phase 1.
- Exit: `SELECT u. FROM users u` suggests real columns from live schema.

## Phase 5 — Result / Data Viewer

- Virtualized grid, pagination, sort/filter, inline edit, NULL/JSON handling.
- Exit: million-row table browsable, never fully loaded into memory.

## Phase 6 — Migration System

- Ordered `.sql` files, run/rollback/refresh, journal table, DB-aware dialect.
- Exit: up/down cycle tested on pg + mysql + sqlite.

## Phase 7 — Database Designer

- ER diagram (SVG): drag, zoom, pan, relationships, SQL generation.
- Exit: import existing schema → diagram → generated SQL round-trips.

## Phase 8 — Advanced DX

- Query history, snippets, workspace `.database/` project files, settings UI,
  import/export.
- Exit: cold-start project open restores tabs + connections (sans secrets).

## Phase 9 — Optional AI

- Behind an `AiProvider` interface; offline-first stays fully functional.
- Exit: works with no key configured (features disabled, app untouched).

## Phase 10 — Production Release

- Installers (`.rpm`, `.AppImage`, `.exe`, `.msi`), auto-updater, logging,
  crash-reporting architecture, CI for Fedora + Windows.
- Exit: tagged release builds on both platforms from clean runners.
