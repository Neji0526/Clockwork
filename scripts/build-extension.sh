#!/usr/bin/env bash
# Re-zip extension/ into public/clockwork-extension.zip.
#
# Run after editing anything in extension/ (manifest.json, popup.*,
# background.js, recorder.js, options.*, icons/). Then bump
# EXTENSION_VERSION in src/lib/extension-version.ts so VAs see the
# update prompt.
#
# Usage:  bash scripts/build-extension.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/extension"
OUT="$ROOT/public/clockwork-extension.zip"

if [ ! -f "$SRC/manifest.json" ]; then
  echo "error: $SRC/manifest.json not found" >&2
  exit 1
fi

# Keep manifest version and EXTENSION_VERSION in sync (warn only).
MANIFEST_VER=$(grep -oE '"version"[[:space:]]*:[[:space:]]*"[^"]+"' "$SRC/manifest.json" | head -1 | sed -E 's/.*"([^"]+)"$/\1/')
CONST_VER=$(grep -oE 'const EXTENSION_VERSION[[:space:]]*=[[:space:]]*"[^"]+"' "$ROOT/src/lib/extension-version.ts" | sed -E 's/.*"([^"]+)"$/\1/')
if [ "$MANIFEST_VER" != "$CONST_VER" ]; then
  echo "warning: manifest.json version ($MANIFEST_VER) != EXTENSION_VERSION ($CONST_VER)" >&2
fi

rm -f "$OUT"
# Exclude repo-only files (README.md) so the archive matches what Chrome loads.
( cd "$SRC" && nix run nixpkgs#zip -- -qr "$OUT" . -x "README.md" )

echo "built $OUT (extension v$MANIFEST_VER)"
