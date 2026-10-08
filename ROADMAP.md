# ROADMAP — Database IDE

Each phase has an exit criterion. Do not start the next phase until the current
one is green.

## Phase 0 — Research & Architecture ✅ (this commit)

- [x] Inspect environment, choose stack, record decision.
- [x] Write `ARCHITECTURE.md`, `ROADMAP.md`, `SECURITY.md`, `CONTRIBUTING.md`.
- [x] Scaffold skeleton (`src/`, `src-tauri/`, `scripts/`).
- Exit: docs committed, `npm run build` green without Rust installed.

## Phase 1 — Desktop Shell ✅

- [x] App window + VS Code-like grid: activity bar, sidebar, editor tabs (+ split),
      bottom panel, status bar, command palette (`Ctrl+Shift+P`, `Ctrl+P`).
- [x] Dark default + light theme, settings + keyboard-shortcut scaffolding.
- [x] Unit tests: command registry, shortcut map, SQL keyword completer.
- Exit: `npm run build` + `npm test` green; shell usable with no backend. ✅

## Phase 2 — Database Connections ✅

- [x] PostgreSQL, MySQL/MariaDB, SQLite via `DatabaseAdapter` trait (`src-core/`).
- [x] Create/connect/disconnect/reconnect/delete + friendly errors (causes, no secrets).
- [x] OS keyring via `keyring` crate, session-memory fallback (never disk).
- [x] Connection manager UI: sidebar panel, dialog, status-bar info.
- [x] 11 Rust tests (incl. live pg 18 + MariaDB 11 integration) + 4 new UI tests, clippy clean.
- Exit: `cargo test` + `npm test` + `npm run build` green. ✅

## Phase 3 — Database Explorer ✅

- [x] Schemas, tables (+views), columns, indexes, FKs, functions on all engines.
- [x] Lazy loading + per-node cache; 1,000-table schema lists in ~16 ms (measured live).
- [x] Context menu: refresh / copy name / copy SELECT / view definition / new / rename / drop (modal-gated).
- [x] 14 Rust tests + 17 UI tests green, clippy clean.
- Exit: 1k-table schema browses without UI jank (lazy + cached). ✅

## Phase 4 — SQL Editor ✅

- [x] Monaco (local bundle, lazy chunk) + themes, syntax highlight.
- [x] Schema-aware autocomplete (`alias.` columns, FROM tables, keywords) from live schema.
- [x] Hover, F12 go-to-definition (DDL tab), document formatting, Ctrl+Enter run.
- [x] Query execution: capped streaming pages, JSON value decoding, DML affected counts.
- [x] Diagnostics: client unknown-table squiggles + server EXPLAIN errors → Problems.
- [x] 16 Rust + 28 UI tests green, clippy clean.
- Exit: `SELECT u. FROM users u` suggests real columns from live schema. ✅

## Phase 5 — Result / Data Viewer ✅

- [x] Paged reads (sort/filter/COUNT), never full-table; 1M-row page+count in ~41 ms (measured live).
- [x] Inline edit, insert, delete, duplicate (PK-guarded), NULL + JSON viewer, page CSV export.
- [x] Open-data tabs from explorer; read-only without PK.
- [x] 19 Rust + 28 UI tests green, clippy clean.
- Exit: million-row table browsable, never fully loaded into memory. ✅

## Phase 6 — Migration System ✅

- [x] `NNN_name.sql` files with `-- DOWN` sections; version parsing + checksums.
- [x] Journal table (dialect-aware), up/down runner, checksum + irreversible guards.
- [x] Panel: dir picker, status list, run-all, rollback-last, create migration.
- [x] 23 Rust (incl. live pg + mysql cycles) + 28 UI tests green, clippy clean.
- Exit: up/down cycle tested on pg + mysql + sqlite. ✅

## Phase 7 — Database Designer ✅

- [x] SVG canvas: grid auto-layout, drag, zoom/pan, FK edges with tooltips.
- [x] Position persistence, SQL generation tab, SVG export, add-relationship dialog.
- [x] Show-diagram from schema context menu; sqlite honest about ADD CONSTRAINT.
- [x] 30 UI tests green (layout + edge geometry covered).
- Exit: import existing schema → diagram → generated SQL round-trips. ✅

## Phase 8 — Advanced DX ✅

- [x] Query history (search, favorites, reopen, clear) persisted locally.
- [x] Snippets in completion; settings UI (page size, EXPLAIN toggle, safe mode).
- [x] Safe mode enforced on run + grid mutations; EXPLAIN toggle honored.
- [x] Workspace save/open (`.database/config.json`); cold restore keeps keyring secrets (proven).
- [x] Full CSV/SQL export, CSV import, page export; dead palette entries pruned.
- [x] 24 Rust + 36 UI tests green, clippy clean.
- Exit: cold-start project open restores tabs + connections (sans secrets). ✅

## Phase 9 — Optional AI ✅

- [x] `AiProvider` seam (generate/explain/explain-error); offline rule-based provider.
- [x] Ollama + OpenAI-compatible HTTP provider; key in OS keyring, never disk.
- [x] Assistant dialog (palette), key management in Settings; off by default.
- [x] 25 Rust + 41 UI tests green, clippy clean.
- Exit: works with no key configured (features disabled, app untouched). ✅

## Phase 10 — Production Release ✅

- [x] Local-first logging (redacted, capped) + crash plumbing + log download.
- [x] CI (frontend ×2 OS, backend test+clippy, bundle build) + tag release workflow.
- [x] Release runbook, finished README, CHANGELOG, aligned 0.1.0 versions.
- [x] `npm audit`: 2 low (transitive dompurify via monaco, no safe fix) — recorded.
- Exit: tagged release builds on both platforms from clean runners. ✅ (CI-owned; runbook documents)
