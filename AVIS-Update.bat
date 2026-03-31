@echo off
title AVIS Updater
echo.
echo   ================================
echo   AVIS Updater
echo   Avel Intelligence Services
echo   ================================
echo.
echo   Checking for latest version...
echo.

:: Kill AVIS if running
taskkill /F /IM "AVIS - Avel Intelligence Services.exe" >nul 2>&1

:: Download latest release using PowerShell — uses %USERPROFILE%\Desktop (reliable on all PCs)
powershell -ExecutionPolicy Bypass -Command ^
  "$ProgressPreference = 'Continue'; " ^
  "try { " ^
  "  $release = Invoke-RestMethod -Uri 'https://api.github.com/repos/anyaji/AVIS-Repo/releases/latest' -Headers @{'User-Agent'='AVIS-Updater'}; " ^
  "  $version = $release.tag_name; " ^
  "  Write-Host '  Latest version:' $version; " ^
  "  $asset = $release.assets | Where-Object { $_.name -like '*.exe' -and $_.name -notlike '*blockmap*' } | Select-Object -First 1; " ^
  "  if (-not $asset) { Write-Host '  No installer found.'; exit 1 }; " ^
  "  $url = $asset.browser_download_url; " ^
  "  $desk = $env:USERPROFILE + '\Desktop'; " ^
  "  if (Test-Path ($env:USERPROFILE + '\OneDrive\Desktop')) { $desk = $env:USERPROFILE + '\OneDrive\Desktop' }; " ^
  "  $dest = $desk + '\AVIS-Setup.exe'; " ^
  "  Write-Host '  Saving to:' $dest; " ^
  "  Write-Host '  Downloading...' $asset.name; " ^
  "  Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing; " ^
  "  Write-Host '  Download complete. Installing...'; " ^
  "  Start-Process -FilePath $dest -ArgumentList '/S' -Wait; " ^
  "  Write-Host '  Done! AVIS updated to' $version; " ^
  "} catch { " ^
  "  Write-Host '  Error:' $_.Exception.Message; " ^
  "  Write-Host '  Manual download: https://github.com/anyaji/AVIS-Repo/releases/latest'; " ^
  "}"

echo.
echo   Update complete. Press any key to close.
pause >nul
