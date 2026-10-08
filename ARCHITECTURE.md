# ARCHITECTURE — Database IDE (working title: LuminosQL)

Status: Phase 0 decision record. This document is binding for Phase 1+ unless
explicitly amended.

## 0. Environment (observed 2026-10-08)

- OS: Fedora x86_64 (`7.2.8-200.fc44`), empty workdir, fresh `git init`.
- Node v24.18.0 + npm 11.16.0. No `pnpm`/`yarn`, no Rust/`cargo` yet.
- Network available (npm registry reachable).

## 1. Stack decision

**Chosen: Tauri 2 + Rust backend + React + TypeScript + Vite frontend.**

| Concern | Tauri 2 + Rust + React | Electron + TS + React | Verdict |
|---|---|---|---|
| Bundle size | ~5–15 MB, native WebView | ~80–150 MB bundled Chromium | Tauri wins, matters for distro |
| Memory / perf | One native WebView, Rust async backend | Full Chromium per app | Tauri |
| Distribution | `tauri build` → `.rpm`, `.AppImage`, `.exe`, `.msi` from one config | electron-builder, larger artifacts, native-module rebuild pain | Tauri |
| DB drivers | `sqlx` / `tokio-postgres` / `mysql_async` / `rusqlite`, async + pooling in Rust | `pg` / `mysql2` / `better-sqlite3`, native rebuilds per platform | Tauri (Rust pooling + single binary) |
| Secure credentials | Rust `keyring` crate → Secret Service (Linux) / Credential Manager (Windows) | Node `keytar`, heavier native deps | Tauri |
| Editor | Monaco runs in WebView either way | Same | Tie |
| Dev cost | Requires Rust toolchain; UI still hackable via `vite dev` without Rust | Pure TS, zero Rust | Electron easier Day 1, Tauri cheaper long-term |

**Why not alternatives:** Wails/Neutralino (smaller ecosystem, weaker updater/bundler
story), Qt/C++ (slow UI iteration, no Monaco), Flutter desktop (Dart, no credible
VS Code-grade SQL editor path). They were rejected for ecosystem + editor reasons,
not popularity.

**Consequence:** Rust toolchain (`rustup`, stable) is a documented build prerequisite.
Frontend-only work (`npm run dev`, `npm run build`, `npm test`) MUST NOT require Rust.

## 2. Process model

```text
WebView (React+TS)  ◄── IPC (Tauri commands, allowlisted) ──►  Rust core
       │                                                        │
  shell state,                                              connection pool,
  editor tabs,                                              query execution
  result grid (virtualized),                                (cancellable, paged),
  diagram (SVG)                                             migration runner,
                                                            credential store
```

- Frontend NEVER opens TCP sockets to databases directly. All DB I/O is a Tauri
  command → Rust adapter → pooled connection.
- Long queries are cancellable (`CancellationToken` per execution id) and chunked;
  the UI thread never blocks (virtualized grid + pagination, default page 500).
- Local metadata (connections list sans secrets, query history, settings) lives in
  SQLite via Rust (`rusqlite`), one file under the OS data dir. Secrets live ONLY
  in the OS keyring.

## 3. Rust core layout (`src-tauri/src/`)

```text
main.rs            — entry, window, updater
lib.rs             — command registration
db/                — DatabaseAdapter trait + rows/pages/errors
  adapter.rs         trait: connect, ping, list_schemas, list_tables,
                     describe_table, run_query(page), cancel
  postgres.rs · mysql.rs · sqlite.rs   (Phase 2; Phase 1: trait + mock only)
pool/              — per-connection pool, execution registry
migrations/        — ordered .sql runner + journal table (Phase 6)
security/          — CredentialStore trait + Linux/Windows impls,
                     destructive-query classifier, secret redaction
meta/              — local SQLite store (history, settings, favorites)
```

`DatabaseAdapter` is `async`, object-safe, returns paged `RecordBatch`-style rows
(`columns + Vec<JsonValue> + total_hint`). Engine-specific SQL stays inside the
adapter; shared logic (pagination, cancel, error mapping) stays in `db/`.

## 4. Frontend layout (`src/`)

```text
main.tsx                 — mount, theme bootstrap
App.tsx                  — shell grid composition
shell/                   — ActivityBar, Sidebar, EditorArea, BottomPanel,
                           StatusBar, CommandPalette (Phase 1: all real, no mocks)
state/                   — store.tsx (context+reducer), commands.ts (palette registry),
                           shortcuts.ts, settings.ts
editor/                  — EditorPane interface + PlainEditor (Phase 1).
                           MonacoEditor plugs the same interface in Phase 4.
theme/                   — theme.css with [data-theme=dark|light] variables
```

No global store library in Phase 1 (context+reducer is enough; re-evaluate at
Phase 5 if render profiling says otherwise).

## 5. SQL intelligence seam (Phases 1→4)

Phase 1 ships the seam, not the engine:

```text
lexer → parser → AST → context resolver → schema provider → completion provider
```

- Phase 1: `src/sql/` exposes the TypeScript interfaces + a keyword-only fallback
  completer so the editor already suggests keywords offline.
- Phase 4: real parser + schema-aware provider implement the same interfaces;
  Monaco registers them as `CompletionItemProvider` / `HoverProvider`.
- No network, no AI key required at any point. AI (Phase 9) is a separate optional
  provider behind the same completion interface.

## 6. Cross-platform strategy

- One `tauri.conf.json` produces: Linux `.AppImage` + `.rpm`, Windows `.exe` (NSIS)
  + `.msi` (WiX). No platform-only code paths in the shell.
- `scripts/build-linux.sh` installs WebKit deps + Rust, runs `tauri build`.
- `scripts/build-windows.ps1` installs Rust + WebView2 SDK, runs `tauri build`.
- CI builds both on every tag (Phase 10); Phase 1 only asserts `vite build` passes.

## 7. What Phase 1 deliberately omits

Real DB connections, explorer data, query execution, migrations, designer, AI.
The shell shows deterministic placeholder content and each panel documents which
Phase fills it. No dead buttons: every command either works (shell scope) or says
which phase it belongs to.
