#!/usr/bin/env bash
# Tag + build both platforms via CI. Local use: ./scripts/release.sh v0.2.0
set -euo pipefail
TAG="${1:?usage: release.sh vX.Y.Z}"
git tag "$TAG" && git push origin "$TAG"
echo "Release $TAG pushed — CI builds .rpm/.AppImage (linux) + .exe/.msi (windows)."
