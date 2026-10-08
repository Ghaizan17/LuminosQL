#!/usr/bin/env bash
# Build LuminosQL on Fedora. Installs Rust + WebKit deps, then bundles.
set -euo pipefail
if ! command -v cargo >/dev/null; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  # shellcheck disable=SC1090
  source "$HOME/.cargo/env"
fi
sudo dnf install -y webkit2gtk4.1-devel gtk3-devel \
  libayatana-appindicator-gtk3-devel librsvg2-devel openssl-devel
npm install
npm run tauri build
