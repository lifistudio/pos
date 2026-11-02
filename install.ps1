# Pemasang POS by lifistudio untuk Windows (PowerShell):
#   irm https://raw.githubusercontent.com/NurlChl/pos/main/install.ps1 | iex
# Pakai Docker Desktop bila berjalan; tanpa itu memakai Node.js + PostgreSQL bawaan.
# Opsi lewat env: POS_DIR, POS_URL, POS_OWNER_EMAIL, POS_OWNER_PASSWORD, POS_MODE=docker|local, POS_BRANCH.
$ErrorActionPreference = "Stop"

$Repo = "https://github.com/NurlChl/pos"
$Branch = if ($env:POS_BRANCH) { $env:POS_BRANCH } else { "main" }
$Dir = if ($env:POS_DIR) { $env:POS_DIR } else { Join-Path $HOME "pos-lifistudio" }

function Say($text) { Write-Host "`n==> $text" -ForegroundColor Cyan }
function Has($name) { $null -ne (Get-Command $name -ErrorAction SilentlyContinue) }
function Refresh-Path { $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User") }

function Get-Code {
  if ((Test-Path ".\docker-compose.prod.yml") -and (Test-Path ".\scripts\setup.mjs")) {
    $script:Dir = (Get-Location).Path
    return
  }
  if (Test-Path (Join-Path $Dir ".git")) {
    Say "Memperbarui kode di $Dir"
    git -C $Dir pull --ff-only origin $Branch
  } elseif (Test-Path (Join-Path $Dir "scripts\setup.mjs")) {
    Say "Memakai kode yang sudah ada di $Dir"
  } elseif (Has git) {
    Say "Mengunduh kode ke $Dir"
    git clone --depth 1 --branch $Branch "$Repo.git" $Dir
  } else {
    Say "Mengunduh kode ke $Dir"
    $zip = Join-Path $env:TEMP "pos-lifistudio.zip"
    $tmp = Join-Path $env:TEMP "pos-lifistudio-src"
    Invoke-WebRequest "$Repo/archive/refs/heads/$Branch.zip" -OutFile $zip
    if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
    Expand-Archive $zip -DestinationPath $tmp
    Move-Item (Get-ChildItem $tmp | Select-Object -First 1).FullName $Dir
    Remove-Item $zip
  }
  Set-Location $Dir
}

function Ensure-Node {
  $ok = $false
  if (Has node) { $ok = [int](node -p "process.versions.node.split('.')[0]") -ge 22 }
  if ($ok) { return }
  if (Has winget) {
    Say "Memasang Node.js LTS"
    winget install --id OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements
    Refresh-Path
  }
  if (-not (Has node)) { throw "Node.js 22+ belum terpasang. Pasang dari https://nodejs.org lalu jalankan ulang." }
}

function Docker-Ready {
  if (-not (Has docker)) { return $false }
  docker info *> $null
  return $LASTEXITCODE -eq 0
}

Get-Code
Ensure-Node
corepack enable 2>$null
$env:COREPACK_ENABLE_DOWNLOAD_PROMPT = "0"

$mode = if ($env:POS_MODE) { $env:POS_MODE } elseif (Docker-Ready) { "docker" } else { "local" }
if ($mode -eq "docker") {
  Say "Menyiapkan konfigurasi"
  node scripts/setup.mjs --docker
  if ($LASTEXITCODE -ne 0) { throw "Penyiapan gagal." }
  Say "Membangun & menjalankan (beberapa menit pada pemasangan pertama)"
  docker compose -f docker-compose.prod.yml up -d --build
  if ($LASTEXITCODE -ne 0) { throw "docker compose gagal." }
  # Akun Owner sudah dibuat: password awal tidak perlu tertinggal di disk.
  (Get-Content .env) | Where-Object { $_ -notmatch "^SEED_OWNER_PASSWORD=" } | Set-Content .env
  Say "Selesai. Log: docker compose -f $Dir\docker-compose.prod.yml logs -f app"
} else {
  Say "Memasang tanpa Docker"
  node scripts/setup.mjs --local
  if ($LASTEXITCODE -ne 0) { throw "Pemasangan gagal." }
}
