# Changelog

All notable changes, newest first. Versions are aligned across `package.json`,
`src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and `src-core/Cargo.toml`.

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
