#Requires -Version 5.1
# Build LuminosQL on Windows 10/11. Installs Rust + WebView2 SDK, then bundles.
$ErrorActionPreference = "Stop"
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
  winget install --id Rustlang.Rustup -e
  $env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
}
npm install
npm run tauri build
