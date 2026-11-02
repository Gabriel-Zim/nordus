# Nordus installer for Windows.
#
#   irm https://raw.githubusercontent.com/Gabriel-Zim/nordus/main/install.ps1 | iex
#
# Downloads the latest Nordus installer from GitHub Releases, installs it for the current user and opens the app.
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$repo = "Gabriel-Zim/nordus"
$asset = "Nordus-setup.exe"
$url = "https://github.com/$repo/releases/latest/download/$asset"
$target = Join-Path $env:TEMP $asset

Write-Host "> Downloading Nordus for Windows" -ForegroundColor Cyan
try {
  Invoke-WebRequest -Uri $url -OutFile $target -UseBasicParsing
} catch {
  Write-Host "x Could not download $url. See https://github.com/$repo/releases" -ForegroundColor Red
  exit 1
}

# The open source build is not signed with a paid certificate, so Windows marks the download as coming from the internet.
Unblock-File -Path $target

Write-Host "> Installing (this takes a minute)" -ForegroundColor Cyan
$process = Start-Process -FilePath $target -ArgumentList "/S" -PassThru -Wait
if ($process.ExitCode -ne 0) {
  Write-Host "x The installer stopped with code $($process.ExitCode). Run $target by hand to see why." -ForegroundColor Red
  exit $process.ExitCode
}
Remove-Item $target -ErrorAction SilentlyContinue

$exe = @(
  (Join-Path $env:LOCALAPPDATA "Programs\Nordus\Nordus.exe"),
  (Join-Path $env:ProgramFiles "Nordus\Nordus.exe")
) | Where-Object { Test-Path $_ } | Select-Object -First 1

Write-Host "+ Nordus installed" -ForegroundColor Green
if ($exe) { Start-Process -FilePath $exe }

Write-Host ""
Write-Host "Next:"
Write-Host "  1. Install and sign in to at least one engine you already pay for:"
Write-Host "       Claude Code:  npm install -g @anthropic-ai/claude-code; claude"
Write-Host "       Codex:        npm install -g @openai/codex; codex login"
Write-Host "  2. Create your first bot in the app. Your data stays in $env:USERPROFILE\.nordus"
Write-Host "  3. Open it from anywhere at your-name.nordus.ai, with Sign in with Google:"
Write-Host "       Settings > Account > 'Conectar com a conta Nordus'"
Write-Host "  4. To use a Nordus server on a VPS: Server menu > 'Add Server from Copied Pairing Link...'"
Write-Host ""
Write-Host "Full guide: https://github.com/$repo/blob/main/INSTALL.md"
