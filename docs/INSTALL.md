# Instalasi POS by lifistudio

Cara tercepat: satu perintah. Installer mengunduh kode, membuat kunci rahasia, menanyakan akun Owner, lalu menjalankan aplikasi.

| Sistem | Perintah |
|---|---|
| Linux, macOS | `curl -fsSL https://raw.githubusercontent.com/lifistudio/pos/main/install.sh \| bash` |
| Windows (PowerShell) | `irm https://raw.githubusercontent.com/lifistudio/pos/main/install.ps1 \| iex` |

Installer memilih cara terbaik sendiri: Docker bila berjalan, selain itu Node.js dengan PostgreSQL bawaan. Mengulang perintah yang sama akan memperbarui aplikasi; `.env` dan data tidak ditimpa.

Opsi lewat variabel, untuk pemasangan tanpa pertanyaan:

| Variabel | Fungsi | Bawaan |
|---|---|---|
| `POS_URL` | Alamat aplikasi | `http://localhost:3000` |
| `POS_OWNER_EMAIL`, `POS_OWNER_PASSWORD` | Akun Owner (password ≥ 12 karakter) | Ditanyakan |
| `POS_DEMO` | `true` = isi data contoh | `true` lokal, `false` Docker |
| `POS_DIR` | Folder pemasangan | `~/pos-lifistudio` |
| `POS_MODE` | `docker` atau `local` | Otomatis |
| `POS_PORT` | Port aplikasi (Docker) | `3000` |

---

## Instalasi lokal

### Windows
1. Buka **PowerShell**, jalankan:
   ```powershell
   irm https://raw.githubusercontent.com/lifistudio/pos/main/install.ps1 | iex
   ```
2. Node.js dipasang otomatis lewat `winget` bila belum ada. Tutup dan buka lagi PowerShell bila diminta.
3. Jawab pertanyaan, lalu buka `http://localhost:3000`.

Menjalankan lagi setelah komputer dinyalakan ulang:
```powershell
cd $HOME\pos-lifistudio
corepack pnpm local
```
Docker Desktop opsional. Bila Docker bermasalah di komputer Anda, pasang tanpa Docker: `$env:POS_MODE="local"` sebelum perintah pemasangan.

### macOS
1. Pasang [Node.js 22+](https://nodejs.org) atau [Docker Desktop](https://www.docker.com/products/docker-desktop/).
2. Buka **Terminal**, jalankan:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/lifistudio/pos/main/install.sh | bash
   ```

### Linux
Sama seperti macOS. Bila menjalankan sebagai `root` dan Docker belum ada, installer menawarkan pemasangan Docker.

### Menjalankan lagi
- Mode Docker: `docker compose -f docker-compose.prod.yml up -d`
- Mode tanpa Docker: `corepack pnpm local`

---

## Instalasi lewat Docker

Untuk yang ingin menjalankan sendiri tanpa skrip installer. Butuh Docker dengan Docker Compose. Aplikasi, PostgreSQL, dan migrasi berjalan otomatis di dalam container.

1. Ambil kode:
   ```bash
   git clone https://github.com/lifistudio/pos.git && cd pos
   ```
2. Buat berkas `.env` berisi:
   ```env
   BETTER_AUTH_URL=http://localhost:3000
   BETTER_AUTH_SECRET=hasil-perintah-acak
   MARKETPLACE_SECRET=hasil-perintah-acak-lain
   POSTGRES_PASSWORD=hasil-perintah-acak-lain
   SEED_OWNER_EMAIL=owner@toko-anda.com
   SEED_OWNER_PASSWORD=password-minimal-12-karakter
   PAYMENT_PROVIDER=none
   ```
   Buat tiap nilai acak dengan `openssl rand -hex 32`. Semua opsi lain ada di `.env.example`.
3. Jalankan:
   ```bash
   docker compose -f docker-compose.prod.yml up -d --build
   ```
4. Buka `http://localhost:3000`, lalu hapus `SEED_OWNER_PASSWORD` dari `.env`.

Perintah berguna:

```bash
docker compose -f docker-compose.prod.yml logs -f app
```

Memperbarui: `git pull`, lalu ulangi langkah 3. Data tersimpan di volume `pgdata`. Jangan menjalankan `docker compose down -v`, karena itu menghapus database.

---

## Instalasi di VPS

Disarankan Ubuntu 24.04 ke atas, RAM minimal 2 GB (build butuh memori), dengan domain yang sudah mengarah ke IP server.

1. Masuk ke server sebagai `root`, lalu jalankan dengan alamat domain Anda:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/lifistudio/pos/main/install.sh | POS_URL=https://pos.toko-anda.com bash
   ```
2. Pasang HTTPS. Paling mudah dengan [Caddy](https://caddyserver.com/docs/install), isi `/etc/caddy/Caddyfile`:
   ```
   pos.toko-anda.com {
     reverse_proxy 127.0.0.1:3000
   }
   ```
   lalu `systemctl reload caddy`. Sertifikat dibuat otomatis.
3. Tutup port 3000 dari internet:
   ```bash
   ufw allow OpenSSH && ufw allow 80,443/tcp && ufw enable
   ```
   Docker bisa melewati UFW, jadi lebih aman mengikat port ke lokal: tambahkan `POS_PORT=127.0.0.1:3000` di `.env`, lalu jalankan ulang compose.
4. Lanjutkan ke [setelah pemasangan](#setelah-pemasangan).

---

## Instalasi di Dokploy

Ada dua cara. **Cara A disarankan** karena migrasi database berjalan otomatis setiap deploy.

### Cara A: Docker Compose (aplikasi + database sekaligus)
1. Di Dokploy: **Create Service › Compose**.
2. Provider GitHub, repositori Anda, branch `main`, **Compose Path** `./docker-compose.prod.yml`.
3. Tab **Environment**, isi:
   ```env
   BETTER_AUTH_URL=https://pos.toko-anda.com
   BETTER_AUTH_SECRET=hasil-perintah-acak
   MARKETPLACE_SECRET=hasil-perintah-acak-lain
   POSTGRES_PASSWORD=hasil-perintah-acak-lain
   SEED_OWNER_EMAIL=owner@toko-anda.com
   SEED_OWNER_PASSWORD=password-minimal-12-karakter
   SEED_DEMO=false
   PAYMENT_PROVIDER=none
   ```
   Buat nilai acak dengan `openssl rand -hex 32`. Jangan memakai `-base64`: karakter `+ / =` merusak alamat database.
4. Tab **Domains**: tambahkan domain, service `app`, port `3000`, aktifkan HTTPS.
5. **Deploy**. Layanan `migrate` menerapkan migrasi dan membuat Owner, lalu `app` menyala.
6. Setelah bisa masuk, hapus `SEED_OWNER_PASSWORD` dari Environment.

### Cara B: Application + database terpisah (yang sudah Anda pakai)
1. Buat **PostgreSQL 18** di Dokploy, salin *Internal Connection URL*.
2. **Create Service › Application**, provider GitHub, **Build Type: Dockerfile**.
3. Tab **Environment**: `DATABASE_URL` (URL internal tadi), `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, `MARKETPLACE_SECRET`, `PAYMENT_PROVIDER`.
4. Tab **Domains**: domain, port `3000`, HTTPS.
5. **Deploy**.
6. Migrasi **wajib dijalankan sebelum** setiap deploy yang berisi migrasi baru, dari komputer yang bisa menjangkau database:
   ```bash
   DATABASE_URL="<url-produksi>" pnpm db:migrate
   ```

> Env dibaca saat container berjalan. Image tidak lagi berisi `.env`, jadi semua variabel harus ada di tab Environment.

---

## Instalasi manual

Butuh Node.js 22+, pnpm (`corepack enable`), dan PostgreSQL 18 (bisa lewat `pnpm db:start`).

```bash
git clone https://github.com/lifistudio/pos.git && cd pos
pnpm install
cp .env.example .env      # isi BETTER_AUTH_SECRET dan SEED_OWNER_PASSWORD
pnpm db:start             # biarkan berjalan, lalu buka terminal baru
pnpm db:migrate
pnpm db:seed
pnpm dev                  # development di http://localhost:3000
```

Produksi tanpa Docker: `pnpm build`, lalu `pnpm start`.

---

## Setelah pemasangan

1. Masuk sebagai Owner, buat **cabang** di Pengaturan › Cabang.
2. Buat akun **Owner kedua**, atau isi `SEED_OWNER2_EMAIL` & `SEED_OWNER2_PASSWORD` sebelum seed, atau aktifkan SMTP. Tanpa salah satunya, password Owner yang terlupa tidak bisa dipulihkan dari aplikasi.
3. Isi `SMTP_*` di `.env` agar tautan **Lupa password** tampil.
4. Pilih payment gateway: [Panduan pembayaran](./PANDUAN-PEMBAYARAN.md).
5. Di server: isi `TRUSTED_PROXY_HOPS` sesuai jumlah proxy, atur [cron & backup](./PANDUAN-DEPLOY.md).

## Memperbarui

| Cara pasang | Perintah |
|---|---|
| Installer | Jalankan ulang perintah pemasangan |
| Docker | `git pull`, lalu `docker compose -f docker-compose.prod.yml up -d --build` |
| Dokploy cara A | Klik **Deploy** |
| Dokploy cara B | `pnpm db:migrate` ke database produksi, lalu **Deploy** |

Selalu backup database sebelum memperbarui.

## Masalah umum

| Gejala | Solusi |
|---|---|
| `Docker belum berjalan` | Nyalakan Docker Desktop, atau pasang tanpa Docker dengan `POS_MODE=local` |
| Build berhenti di VPS kecil | RAM kurang. Tambah swap 2 GB, atau pakai VPS lebih besar |
| Aplikasi berhenti menyebut nama variabel saat menyala | Variabel itu belum diisi atau formatnya salah. Lihat [Panduan env](./PANDUAN-ENV.md) |
| Port 3000 terpakai | Isi `POS_PORT=3001` di `.env` |
| `PostgreSQL tidak menyala`, `.data-db.log` berisi `spawn ... initdb ENOENT` (Windows) | Path folder terlalu panjang (batas 260 karakter). Pasang di folder pendek, misal `$env:POS_DIR="C:\pos"` |
| Login gagal terus | Akun terkunci 15 menit setelah 5 kali salah |
