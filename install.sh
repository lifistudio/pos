#!/usr/bin/env bash
# Pemasang POS by lifistudio untuk Linux & macOS:
#   curl -fsSL https://raw.githubusercontent.com/NurlChl/pos/main/install.sh | bash
# Pakai Docker bila ada (disarankan untuk server); tanpa Docker memakai Node.js + PostgreSQL bawaan.
# Opsi lewat env: POS_DIR, POS_URL, POS_OWNER_EMAIL, POS_OWNER_PASSWORD, POS_MODE=docker|local, POS_BRANCH.
set -euo pipefail

REPO="https://github.com/NurlChl/pos"
BRANCH="${POS_BRANCH:-main}"
DIR="${POS_DIR:-$HOME/pos-lifistudio}"

say() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
die() { printf '\nGagal: %s\n' "$1" >&2; exit 1; }
has() { command -v "$1" >/dev/null 2>&1; }
# Saat lewat `curl | bash` stdin berisi skrip: pertanyaan dibaca dari terminal. Tanpa terminal (otomasi), pakai POS_*.
with_tty() { if [ -r /dev/tty ] && : </dev/tty; then "$@" </dev/tty; else "$@" </dev/null; fi; }

get_code() {
  # Skrip dijalankan dari dalam repo: pakai salinan ini, jangan unduh lagi.
  if [ -f "./docker-compose.prod.yml" ] && [ -f "./scripts/setup.mjs" ]; then
    DIR="$(pwd)"
    return
  fi
  if [ -d "$DIR/.git" ]; then
    say "Memperbarui kode di $DIR"
    git -C "$DIR" pull --ff-only origin "$BRANCH"
  elif [ -f "$DIR/scripts/setup.mjs" ]; then
    say "Memakai kode yang sudah ada di $DIR"
  elif has git; then
    say "Mengunduh kode ke $DIR"
    git clone --depth 1 --branch "$BRANCH" "$REPO.git" "$DIR"
  else
    has curl || die "Butuh git atau curl."
    say "Mengunduh kode ke $DIR"
    mkdir -p "$DIR"
    curl -fsSL "$REPO/archive/refs/heads/$BRANCH.tar.gz" | tar -xz --strip-components=1 -C "$DIR"
  fi
  cd "$DIR"
}

docker_ready() { has docker && docker info >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; }

maybe_install_docker() {
  docker_ready && return 0
  [ "$(uname -s)" = "Linux" ] && [ "$(id -u)" = "0" ] || return 1
  [ -r /dev/tty ] || return 1
  printf 'Docker belum ada. Pasang sekarang lewat get.docker.com? [Y/n] '
  read -r answer </dev/tty || return 1
  case "$answer" in n* | N*) return 1 ;; esac
  curl -fsSL https://get.docker.com | sh
  docker_ready
}

run_setup() {
  # Docker tanpa Node.js di host: skrip penyiapan dijalankan di dalam container.
  if has node && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ]; then
    with_tty node scripts/setup.mjs --docker
  else
    local flags="-i"
    [ -r /dev/tty ] && flags="-it"
    with_tty docker run --rm "$flags" -v "$PWD":/app -w /app -u "$(id -u):$(id -g)" \
      -e POS_URL -e POS_OWNER_EMAIL -e POS_OWNER_PASSWORD -e POS_DEMO node:24-slim node scripts/setup.mjs --docker
  fi
}

install_docker_mode() {
  say "Menyiapkan konfigurasi"
  run_setup
  say "Membangun & menjalankan (beberapa menit pada pemasangan pertama)"
  docker compose -f docker-compose.prod.yml up -d --build
  # Akun Owner sudah dibuat: password awal tidak perlu tertinggal di disk.
  sed -i.bak '/^SEED_OWNER_PASSWORD=/d' .env && rm -f .env.bak
  say "Selesai. Perintah berguna:"
  printf '  docker compose -f %s/docker-compose.prod.yml logs -f app\n' "$DIR"
  printf '  Perbarui: jalankan ulang perintah pemasangan ini\n'
}

install_local_mode() {
  has node || die "Node.js belum terpasang. Pasang Node.js 22+ dari https://nodejs.org lalu ulangi, atau pasang Docker."
  has corepack || die "corepack tidak ditemukan. Pasang Node.js resmi dari https://nodejs.org."
  corepack enable >/dev/null 2>&1 || true
  export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
  say "Memasang tanpa Docker"
  with_tty node scripts/setup.mjs --local
}

main() {
  get_code
  case "${POS_MODE:-auto}" in
    docker) docker_ready || die "Docker belum berjalan."; install_docker_mode ;;
    local) install_local_mode ;;
    *) if maybe_install_docker; then install_docker_mode; else install_local_mode; fi ;;
  esac
}

main "$@"
