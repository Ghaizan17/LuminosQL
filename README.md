# LuminosQL — Database IDE

> VS Code workflow, purpose-built for database engineering.

LuminosQL is a cross-platform desktop IDE for working with PostgreSQL,
MySQL/MariaDB, and SQLite: connect, browse schema, write SQL with
schema-aware autocomplete, run queries, edit data, manage migrations,
visualize relationships — in one window.

## Features

- **Connections** — multiple pg/MySQL/SQLite connections, OS-keyring secrets, friendly errors
- **Explorer** — lazy schema tree (tables, views, columns, indexes, FKs, functions), context actions
- **SQL editor** — local Monaco build, alias-aware completion, hover, F12 to definition, formatting, diagnostics
- **Results + data grid** — paged reads (1M-row safe), sort/filter, inline edit, JSON viewer, CSV/SQL export
- **Migrations** — versioned `.sql` files with `-- DOWN`, journal, checksums, run/rollback
- **Designer** — SVG ER diagrams (drag/zoom/pan), SQL generation, SVG export
- **DX** — history, snippets, workspaces, settings + safe mode, optional AI (offline rules, Ollama, OpenAI-compatible)

## Installation

### Fedora

```sh
# From a release: download the .rpm or .AppImage from GitHub Releases.
sudo dnf install ./luminosql-0.1.0.rpm
# or
chmod +x LuminosQL-0.1.0.AppImage && ./LuminosQL-0.1.0.AppImage
```

### Windows 10/11

Download `.exe` (NSIS) or `.msi` from GitHub Releases and run it.

## Development setup

```sh
npm install
npm run dev      # frontend only — no Rust needed (http://localhost:1420)
npm test
npm run build

# Full desktop shell (needs Rust + WebKit/GTK on Fedora, WebView2 on Windows):
./scripts/build-linux.sh
.\scripts\build-windows.ps1
```

Ephemeral integration databases (optional, for `cargo test` live paths):

```sh
# PostgreSQL and MariaDB one-liners are in CONTRIBUTING.md
export LUMINOSQL_TEST_PG_URL="postgres://user:pass@127.0.0.1:5433/db"
export LUMINOSQL_TEST_MYSQL_URL="mysql://user:pass@127.0.0.1:3307/db"
cargo test --manifest-path src-core/Cargo.toml
```

## Testing

- `npm test` — 40+ vitest cases (shell, SQL intelligence, explorer, DX, AI)
- `cargo test` (src-core) — adapter, migration, query, and live integration tests
- `cargo clippy --all-targets -- -D warnings` — zero warnings enforced in CI

## Architecture

See `ARCHITECTURE.md` (stack decision, module contracts), `ROADMAP.md`
(phase exit criteria), `SECURITY.md` (credential + destructive-query rules),
`docs/RELEASE.md` (release runbook).

One-line summary: Tauri 2 + Rust (`src-core/` library, `src-tauri/` thin IPC)
+ React/TypeScript/Vite (`src/`, Monaco bundled locally, lazy-loaded).
