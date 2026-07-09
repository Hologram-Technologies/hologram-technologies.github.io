# upload-q-pack.ps1 — push the unified pack (sharded) to the hologram-apps models-v1 release.
# Prereq (yours, interactive, once):  gh auth login   →  GitHub.com → HTTPS → login with a browser
# Then:  powershell -ExecutionPolicy Bypass -File holo-apps/apps/q/forge/tools/upload-q-pack.ps1
$ErrorActionPreference = "Stop"
$gh   = "C:\Program Files\GitHub CLI\gh.exe"
$repo = "Hologram-Technologies/hologram-apps"
$tag  = "models-v1"
$M    = "holo-apps/apps/q/forge/.models"

# the assets that constitute the one logical pack (the monolithic q-models.holo is >2 GiB and is NOT uploaded —
# the shards + manifest ARE the delivery; the spanning reader reconstitutes the single file).
$assets = @(
  "$M/q-models.holo.part00",
  "$M/q-models.holo.part01",
  "$M/q-models.holo.part02",
  "$M/q-models.holo.parts.json",
  "$M/q-models.holo.kappa"
)

& $gh auth status 1>$null 2>$null
if ($LASTEXITCODE -ne 0) { Write-Error "Not authed. Run: gh auth login"; exit 1 }

# create the release if it doesn't exist yet (idempotent)
& $gh release view $tag --repo $repo 1>$null 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Host "creating release $tag…"
  & $gh release create $tag --repo $repo --title "Q models v1" --notes "Unified Q model pack (q-models.holo) delivered in <2 GiB shards + per-model standalone .holo. packKappa is the one address."
}

Write-Host "uploading $($assets.Count) assets to $repo @ $tag (clobber)…"
& $gh release upload $tag @assets --repo $repo --clobber
if ($LASTEXITCODE -ne 0) { Write-Error "upload failed"; exit 1 }
Write-Host "`nDONE. Release assets:"
& $gh release view $tag --repo $repo --json assets --jq ".assets[].name"
