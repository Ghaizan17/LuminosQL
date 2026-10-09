# Contributing

## Setup (Fedora)

```sh
# frontend-only (Phase 1 needs nothing else)
npm install
npm run dev      # Vite, no Rust required
npm test         # vitest
npm run build    # typecheck + production bundle

# full desktop build (Phase 2+)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
sudo dnf install -y webkit2gtk4.1-devel gtk3-devel libayatana-appindicator-gtk3-devel \
  librsvg2-devel openssl-devel
npm run tauri build
```

Windows: install Rust via `rustup-init.exe`, WebView2 SDK, then `npm run tauri build`.
See `scripts/build-windows.ps1`.

## Commit hook

Optional pre-commit guard that refuses to commit Rust or TypeScript that does
not build (`cargo check` + `tsc --noEmit`). It exists because a single
mangled source file is cheap to catch locally and expensive to catch in CI.

```sh
git config core.hooksPath .githooks   # once per clone
```

Disable with `git config --unset core.hooksPath`, or bypass a single commit
with `git commit --no-verify`.

Do **not** add `cargo fmt --check`: this codebase is hand-formatted and
rustfmt would rewrite ~140 hunks across `src-core` and `src-tauri`.

## Git workflow

Conventional commits, one logical change each:

- `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`
- NEVER `fix stuff` / `update` / `changes`.

## Quality bar

Readable, modular, typed, tested, cross-platform. No giant files/components,
no duplicated DB logic, no hardcoded credentials/paths, no blocking UI I/O.
