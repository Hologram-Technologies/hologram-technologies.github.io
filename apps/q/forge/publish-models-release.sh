#!/usr/bin/env bash
# publish-models-release.sh — host the big Q model .holo weights as GitHub RELEASE assets (2GB/file), since
# they exceed GitHub Pages' 100MB/file limit. The browser fetches them by URL and L5-verifies every block
# (the κ is the identity; the URL is just where the bytes live). Run once per weight change:
#     gh auth login              # if not already
#     REPO=Hologram-Technologies/hologram-apps TAG=models-v1 bash publish-models-release.sh
# The default RELEASE_BASE in holo-voice-holo-brain.mjs already points at this REPO/TAG.
set -euo pipefail
REPO="${REPO:-Hologram-Technologies/hologram-apps}"
TAG="${TAG:-models-v1}"
DIR="$(cd "$(dirname "$0")/.models" && pwd)"

# Release ALL faculty weights (the loaders resolve path → Release → κ-route uniformly, so the repos stay lean
# — no big binaries in git). The brain weights MUST be here (>100MB Pages limit); the small ones ride along.
# Set LEAN=0 to release only the big brain weights (commit the small ones to the repo instead).
FILES=(qwen2.5-0.5b-instruct.holo qwen2.5-1.5b-instruct.holo qwen2.5-coder-3b-instruct.holo)
[ "${LEAN:-1}" = "1" ] && FILES+=(moonshine-tiny-int8.holo moonshine-tiny-f16.holo kokoro-82m.holo qwen2.5-0.5b-onnx.holo whisper-tiny-onnx.holo)

command -v gh >/dev/null || { echo "ERROR: GitHub CLI (gh) not found — install + 'gh auth login'"; exit 1; }
gh release view "$TAG" -R "$REPO" >/dev/null 2>&1 \
  || gh release create "$TAG" -R "$REPO" -t "Q model weights ($TAG)" \
       -n "κ-addressable .holo model weights (forged; per-block SHA-256 L5-verified on fetch). Hosted here because they exceed the GitHub Pages 100MB/file limit. See .models/holo-ipfs-pins.json for the κ↔CID map (IPFS fallback)."

for f in "${FILES[@]}"; do
  [ -f "$DIR/$f" ] || { echo "skip (missing): $f"; continue; }
  echo "↑ uploading $f ($(du -h "$DIR/$f" | cut -f1)) …"
  gh release upload "$TAG" -R "$REPO" "$DIR/$f" --clobber
  echo "   → https://github.com/$REPO/releases/download/$TAG/$f"
done
echo ""
echo "✓ Done. RELEASE_BASE = https://github.com/$REPO/releases/download/$TAG/  (matches the default in holo-voice-holo-brain.mjs)"
echo "  Verify (κ holds): curl -sL <url> | sha256sum  → must equal the .holo footer κ in holo-ipfs-pins.json"
