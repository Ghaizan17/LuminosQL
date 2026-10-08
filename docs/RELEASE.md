# Release runbook

## Versioning

Single version everywhere: `package.json`, `src-tauri/tauri.conf.json`,
`src-tauri/Cargo.toml`, `src-core/Cargo.toml`. Bump all four, add a
`CHANGELOG.md` entry, tag `vX.Y.Z`, push the tag — CI builds the bundles.

## Cutting a release

```sh
./scripts/release.sh v0.2.0
```

`release.yml` builds on clean runners and attaches to a **draft** GitHub
release:

- Linux: `.AppImage`, `.rpm`, `.deb`
- Windows: `.exe` (NSIS), `.msi` (WiX)

Review the draft, then publish. No auto-updater is bundled yet: users
download the new installer. Update checks are a documented Phase-10
follow-up (see `tauri-plugin-updater`).

## Pre-release checklist

- [ ] `cargo test` (with live pg/mysql URLs) green
- [ ] `cargo clippy --all-targets -- -D warnings` clean
- [ ] `npm test` + `npm run build` green
- [ ] `npm audit` reviewed (no high/critical unaddressed)
- [ ] `CHANGELOG.md` entry written
- [ ] All four version files bumped identically

## Notes

- Fedora WebKit deps and the Windows WebView2 SDK are installed by CI;
  local builds use `scripts/build-linux.sh` / `scripts/build-windows.ps1`.
- The `desktop-bundle` CI job builds (but does not release) every push to
  `main`, so bundle breakage is caught before tagging.
- Screenshots for the README are captured from a release build on Fedora
  before publishing (headless CI cannot render the WebView).
