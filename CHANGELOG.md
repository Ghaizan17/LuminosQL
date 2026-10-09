# Changelog

All notable changes, newest first. Versions are aligned across `package.json`,
`src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and `src-core/Cargo.toml`.

## Unreleased — Phase 11

Fixes the release-blocking defect where the desktop app could not reach its own
backend, and adds a real integrated terminal.

- **IPC bridge (critical):** the frontend invoked the Tauri v1 `window.__TAURI__`
  global, which Tauri v2 never injects unless `app.withGlobalTauri` is set. Every
  backend call — connections, explorer, editor, data grid, migrations, designer,
  AI — failed with "Desktop backend unavailable" in the real app, while the test
  suite stayed green against a hand-stubbed global. Now routed through
  `@tauri-apps/api` v2; tests mock that module instead.
- **Integrated terminal:** real pty via `portable-pty` (forkpty on Unix, ConPTY on
  Windows) rendered with xterm.js, with resize, scrollback and exit propagation.
  Spawned only when the Terminal tab is opened; no credentials are injected.
- **Release build:** Tauri icon set committed; `tauri.conf.json` declares its icon
  paths; `src-tauri/Cargo.lock` tracked; `workspace_save` command registered.
- `FriendlyError`/`ServerInfo` are imported from `db::`, their public home.
- App state uses `tokio::sync::Mutex` (the core crate's `SharedManager`), so command
  futures are `Send` and no longer block a runtime worker while a query runs.

## 0.1.0 — 2026-10-09

First end-to-end build: all ten phases implemented behind one shell.

- Phase 0/1: Tauri 2 + React + TS stack decision; VS Code-like shell (tabs,
  split, palette, themes, bottom panel, status bar).
- Phase 2: pg/MySQL/SQLite adapters, connection manager, keyring credentials,
  friendly errors.
- Phase 3: lazy schema explorer, DDL generation, table create/rename/drop.
- Phase 4: local Monaco, schema-aware completion, hover, F12, formatting,
  EXPLAIN + unknown-table diagnostics, query execution.
- Phase 5: paged data grid (sort/filter/inline edit/JSON/CSV), open-data tabs.
- Phase 6: file migrations with DOWN sections, journal, checksums, panel.
- Phase 7: SVG ER designer (drag/zoom/pan), SQL generation, SVG export.
- Phase 8: history, snippets, settings + safe mode, workspaces, import/export.
- Phase 9: optional AI (offline rules, Ollama, OpenAI-compatible), keyring key.
- Phase 10: local-first logging, crash plumbing, CI + release workflows,
  release runbook.
