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

## Git workflow

Conventional commits, one logical change each:

- `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`
- NEVER `fix stuff` / `update` / `changes`.

## Quality bar

Readable, modular, typed, tested, cross-platform. No giant files/components,
no duplicated DB logic, no hardcoded credentials/paths, no blocking UI I/O.
