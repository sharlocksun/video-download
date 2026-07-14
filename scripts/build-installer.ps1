$ErrorActionPreference = 'Stop'
$candidates = @(
  (Get-Command ISCC.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue),
  "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe",
  "$env:ProgramFiles(x86)\Inno Setup 6\ISCC.exe",
  "$env:ProgramFiles\Inno Setup 6\ISCC.exe"
) | Where-Object { $_ -and (Test-Path $_) }
if (-not $candidates) { throw 'Inno Setup 6 was not found.' }
$compiler = @($candidates)[0]
& $compiler '.\installer\muxin-video-downloader.iss'
if ($LASTEXITCODE -ne 0) { throw "Inno Setup failed: $LASTEXITCODE" }
$setup = Get-ChildItem '.\release' -Filter '*Setup-x64.exe' | Select-Object -First 1
if (-not $setup) { throw 'Setup output was not found.' }
$hash = Get-FileHash $setup.FullName -Algorithm SHA256
$hash | Format-List
Set-Content -LiteralPath '.\release\INSTALLER-SHA256.txt' -Value $hash.Hash -Encoding ASCII