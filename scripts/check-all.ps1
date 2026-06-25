$ErrorActionPreference = "Stop"
$files = Get-ChildItem -Path .\src, .\scripts -Filter *.mjs -Recurse
foreach ($file in $files) {
  node --check $file.FullName
}
