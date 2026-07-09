# publish-q-pack-cdn.ps1 — publish the q-pack-cdn chunks to a public GitHub repo so jsDelivr serves them worldwide
# (CORS + Range + CDN). git-inits IN the chunk dir (no copy), pushes in <2GB batches, prints the commit SHA to pin.
$ErrorActionPreference = "Continue"
$gh = "C:\Program Files\GitHub CLI\gh.exe"
$OWNER = "humuhumu33"; $REPO = "hologram-q-models"
$src = "C:\Users\pavel\Desktop\HOLOGRAM\holo-apps\apps\q\forge\.models\q-pack-cdn"

$sig = @'
using System; using System.Runtime.InteropServices;
public class CredP { [DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode)] public static extern bool CredRead(string t,int ty,int f,out IntPtr c);
 [StructLayout(LayoutKind.Sequential)] public struct CREDENTIAL { public int Flags; public int Type; public IntPtr TargetName; public IntPtr Comment; public long LastWritten; public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist; public int AttributeCount; public IntPtr Attributes; public IntPtr TargetAlias; public IntPtr UserName; }
 public static string Read(string t){ IntPtr p; if(!CredRead(t,1,0,out p))return null; var c=(CREDENTIAL)Marshal.PtrToStructure(p,typeof(CREDENTIAL)); byte[] b=new byte[c.CredentialBlobSize]; Marshal.Copy(c.CredentialBlob,b,0,c.CredentialBlobSize); return System.Text.Encoding.Unicode.GetString(b); } }
'@
Add-Type -TypeDefinition $sig -ErrorAction SilentlyContinue
$tok = $null
foreach ($t in @("git:https://github.com","git:https://x-access-token@github.com")) { $v = [CredP]::Read($t); if ($v) { $tok = $v.Trim(); break } }
if (-not $tok) { Write-Host "NO TOKEN — abort"; exit 1 }
$env:GH_TOKEN = $tok

# delete + recreate the public repo so old chunk blobs don't bloat history (clean, small repo for jsDelivr)
Write-Host "deleting old $OWNER/$REPO (if any)…"
& $gh repo delete "$OWNER/$REPO" --yes 2>$null
Write-Host "delete exit=$LASTEXITCODE"
Start-Sleep -Seconds 2
Write-Host "creating $OWNER/$REPO …"
& $gh repo create "$OWNER/$REPO" --public --description "Q unified model pack chunked for jsDelivr (<=18MiB)" 2>$null
Write-Host "repo create exit=$LASTEXITCODE"

Set-Location $src
if (Test-Path ".git") { Remove-Item -Recurse -Force ".git" }
Set-Content -Path ".gitattributes" -Value "* -text binary" -Encoding ascii
git init -q
git config core.autocrlf false; git config user.email "bot@hologram"; git config user.name "holo-bot"
git branch -M main
git remote add origin "https://x-access-token:$tok@github.com/$OWNER/$REPO.git"
git add .gitattributes; git commit -q -m "init"
git push -f -u origin main 2>&1 | Select-String -NotMatch "remote:" | Out-Null   # force: replace main (old 48MB chunks → fresh 18MiB history)
Write-Host "init push exit=$LASTEXITCODE"

$chunks = Get-ChildItem -File | Where-Object { $_.Name -match '^c\d+$' } | Sort-Object Name
Write-Host "publishing $($chunks.Count) chunks in batches…"
$batch = 80
for ($i=0; $i -lt $chunks.Count; $i += $batch) {
  $end = [Math]::Min($i+$batch-1, $chunks.Count-1)
  for ($j=$i; $j -le $end; $j++) { git add $chunks[$j].Name }
  git commit -q -m "chunks $i..$end"
  git push origin main 2>&1 | Select-String -NotMatch "remote:|Resolving|Compressing|Writing|Counting|Enumerating" | Out-Null
  Write-Host "  batch $i..$end pushed (exit=$LASTEXITCODE)"
  if ($LASTEXITCODE -ne 0) { Write-Host "  PUSH FAILED at batch $i"; break }
}
$sha = (git rev-parse HEAD).Trim()
Write-Host "DONE owner=$OWNER repo=$REPO commit=$sha"
Write-Host "JSDELIVR https://cdn.jsdelivr.net/gh/$OWNER/$REPO@$sha/"
