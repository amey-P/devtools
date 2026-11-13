# herdr-app devtools for Windows: install every Herdr mod, layout and integration in this repo.
# The work happens in install.mjs (Node 18+); this clones the repo first when run on its own.
#
#   .\install.ps1 [command] [target] [agent]     same commands and targets as install.sh:
#     install | status | watch | uninstall        all | git | minimal | sidebar | usage | review | agents
#
# Without a clone (PowerShell):
#   irm https://raw.githubusercontent.com/amey-P/devtools/main/install.ps1 | iex
#   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/amey-P/devtools/main/install.ps1))) install git
#
# Environment: HERDR_APP_HOME (Herdr's home), HERDR_DEVTOOLS_REPO (git URL),
#              HERDR_DEVTOOLS_DIR (clone folder, default %LOCALAPPDATA%\herdr-devtools)
$ErrorActionPreference = 'Stop'

function Test-Node {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) { return $false }
  $major = [int]((& node -p 'process.versions.node.split(".")[0]') 2>$null)
  return $major -ge 18
}

function Invoke-Main([string[]]$Rest) {
  $here = if ($PSCommandPath) { Split-Path -Parent $PSCommandPath } else { $null }
  if (-not $here -or -not (Test-Path (Join-Path $here 'install.mjs'))) {
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'git is required to bootstrap (winget install Git.Git)' }
    $url = if ($env:HERDR_DEVTOOLS_REPO) { $env:HERDR_DEVTOOLS_REPO } else { 'https://github.com/amey-P/devtools.git' }
    $dir = if ($env:HERDR_DEVTOOLS_DIR) { $env:HERDR_DEVTOOLS_DIR } else { Join-Path $env:LOCALAPPDATA 'herdr-devtools' }
    if (Test-Path (Join-Path $dir '.git')) { Write-Host "updating $dir"; git -C $dir pull --ff-only --quiet }
    else { Write-Host "cloning $url -> $dir"; git clone --quiet $url $dir }
    if ($LASTEXITCODE -ne 0) { throw 'git failed' }
    $here = $dir
  }
  if (-not (Test-Node)) { throw 'Node.js 18+ not found. Install it: winget install OpenJS.NodeJS.LTS' }
  & node (Join-Path $here 'install.mjs') @Rest
  exit $LASTEXITCODE
}

Invoke-Main $args
