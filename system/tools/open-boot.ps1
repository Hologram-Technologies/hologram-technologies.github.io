# open-boot.ps1 — open the Hologram OS *index boot screen* in a guaranteed-clean browser.
#
# Why this exists: every layer (server, service worker, fhsMap, index.html JS) serves the
# gateway/"Power up" screen at "/". But once you've booted once, the browser keeps showing the
# already-booted DESKTOP instead — because a sticky context (an old tab, the persisted OS session
# per ADR-0104/0106, the registered service worker, session-restore, or an installed PWA whose
# manifest has launch_handler.client_mode=navigate-existing) resumes that context rather than
# cold-loading "/". A throwaway browser profile has none of that state, so it always cold-boots.
#
#   pwsh system/tools/open-boot.ps1            # default: http://localhost:8123/
#   pwsh system/tools/open-boot.ps1 -Url http://localhost:8300/
param(
  [string]$Url = "http://localhost:8123/"
)

$brave = @(
  "$env:ProgramFiles\BraveSoftware\Brave-Browser\Application\brave.exe",
  "${env:ProgramFiles(x86)}\BraveSoftware\Brave-Browser\Application\brave.exe",
  "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\Application\brave.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

# a fresh, disposable profile dir → no service worker, no persisted session, no PWA, no restore
$prof = Join-Path $env:TEMP ("holo-boot-" + [guid]::NewGuid().ToString("N").Substring(0,8))

if ($brave) {
  & $brave --user-data-dir="$prof" --no-first-run --no-default-browser-check --new-window $Url
  "Opened $Url in a clean Brave profile ($prof) — cold boot, guaranteed gateway."
} else {
  Start-Process $Url
  "Brave not found; opened $Url in the default browser (state NOT guaranteed clean)."
}
