#!/usr/bin/env bash
# Runs what CI runs, but from a fresh clone of the COMMITTED state (not your working folder), so a file that is
# ignored, untracked or only present on your machine fails here instead of on GitHub.
#   scripts/ci-local.sh          check HEAD
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
git clone -q "$here" "$tmp/repo"
cd "$tmp/repo"
if [ -n "$(git -C "$here" status --porcelain)" ]; then echo "note: uncommitted changes in $here are NOT part of this check"; fi
export CI=true
pnpm install --ignore-scripts
pnpm --filter @obs-config-loader/core typecheck
pnpm --filter @obs-config-loader/core test
pnpm --filter @obs-config-loader/desktop typecheck
pnpm --filter @obs-config-loader/desktop test
pnpm --filter @obs-config-loader/desktop build
# packaging (electron-builder) is checked by CI itself: it needs to download Electron
echo "ci-local: all green"
