# Panduan Development

## Prasyarat
- Node.js ≥ 22 (dipakai: 24), pnpm 11 (`corepack enable`).
- PostgreSQL 18 — **tidak perlu install manual**: `pnpm db:start` menjalankan binary PostgreSQL resmi via `embedded-postgres` (data di `.data/pg`). Alternatif: `docker compose up -d` (port & kredensial sama).
- Python 3.12+ hanya bila ingin menjalankan SkillSpector.

## Setup pertama kali
```bash
pnpm install
cp .env.example .env          # isi BETTER_AUTH_SECRET & SEED_OWNER_PASSWORD (lihat komentar di file)
pnpm db:start                 # biarkan berjalan di terminal terpisah
pnpm db:migrate               # terapkan migrasi
pnpm db:seed                  # role bawaan, 3 cabang contoh, akun Owner, 4 produk contoh (SEED_DEMO=false: tanpa contoh)
pnpm dev                      # http://localhost:3000
```
Login memakai `SEED_OWNER_EMAIL` / `SEED_OWNER_PASSWORD` dari `.env` (jangan di-commit, jangan ditulis di docs/chat).

## Perintah
| Perintah | Fungsi |
|---|---|
| `pnpm dev` | Dev server (Turbopack) |
| `pnpm build` / `pnpm start` | Build & jalankan produksi |
| `pnpm typecheck` | Generate tipe route Next lalu `tsc --noEmit` |
| `pnpm lint` | ESLint (termasuk aturan "UI tidak boleh import database/service") |
| `pnpm db:start` | PostgreSQL lokal tanpa Docker |
| `pnpm db:generate` | Buat migrasi dari perubahan schema (`src/server/db/schema`) |
| `pnpm db:migrate` | Terapkan migrasi |
| `pnpm db:studio` | Drizzle Studio (lihat isi DB) |
| `pnpm db:seed` | Seed data development (idempoten) |
| `pnpm audit:deps` | Audit kerentanan dependensi produksi |
| `pnpm check:pricing` | Pemeriksaan otomatis mesin harga (member, voucher, PPN) |
| `pnpm check:marketplace` | Pemeriksaan adapter TikTok Shop dengan fetch tiruan |
| `pnpm check:media` | Pemeriksaan modul Cloudinary (tanda tangan, endpoint) dengan fetch tiruan |
| `pnpm check:barcode` | Pemeriksaan encoder barcode label (EAN/UPC/Code 128) |

## URL penting (dev)
| URL | Isi |
|---|---|
| `/login` | Masuk |
| `/dashboard`, `/sales`, `/products`, `/customers`, `/vouchers`, `/inventory`, `/settings` | Back-office |
| `/api/v1/pos/offline-pack`, `/api/v1/pos/offline-sales` | Paket offline & sinkron transaksi offline kasir |
| `/settings/marketplace` | Koneksi marketplace, pemetaan produk, simulator |
| `/api/marketplace/webhook/{provider}` | Push marketplace (publik, bersignature) |
| `/reports` | Laporan penjualan & retur + export CSV |
| `/orders`, `/orders/new` | Order online (reservasi stok, QRIS) |
| `/api/payments/webhook/{provider}` | Webhook payment gateway (publik, bersignature) |
| `/sales/returns`, `/settings/policy` | Daftar retur; kebijakan tukar poin & retur |
| `/inventory/transfers`, `/inventory/opnames` | Transfer stok & stok opname (scan barcode) |
| `/labels/{productId}` | Cetak label barcode varian produk |
| `/pos` | Layar kasir (butuh `pos:access`); struk: `/pos/receipt/{id}?w=58&print=1` |
| `/api/v1/*` | REST API (semua data) |
| `/api/v1/reference` | Dokumentasi API (Scalar) — butuh login + `api_docs:read` |
| `/api/v1/openapi.json` | Spesifikasi OpenAPI 3.1 — butuh `api_docs:read` |
| `/api/mcp` | MCP server untuk AI agent — lihat [MCP.md](./MCP.md) |
| `/api/auth/*` | Endpoint Better Auth (login/logout) |

## Menambah fitur (alur standar)
1. Schema: ubah `src/server/db/schema/*.ts` → `pnpm db:generate` → periksa SQL → `pnpm db:migrate`. Perbarui DATABASE.md.
2. Permission baru (bila perlu): tambahkan di `src/server/rbac/permissions.ts` (+ role bawaan bila relevan).
3. Service: `src/server/services/<modul>.service.ts` — logika bisnis, cek cakupan cabang, audit log, transaksi DB, tanpa N+1.
4. Route: `src/server/api/routes/<modul>.ts` dengan `createRoute` + schema Zod + `requirePermission(...)`; daftarkan di `src/server/api/app.ts`. Otomatis muncul di Scalar.
5. UI: halaman di `src/app/(app)/<modul>`; data lewat `api()` (client) atau `apiServer()` (SSR). Komponen dari `src/components/base|application` (BoardUI) + `src/components/app` (komposisi proyek).
6. Tool MCP (bila berguna untuk AI): tambah di `src/server/mcp/server.ts`, panggil API — bukan service.
7. Cek: `pnpm typecheck && pnpm lint`, detector Impeccable untuk UI, perbarui `docs/CHANGELOG.md`.

## Komponen BoardUI
```bash
BOARDUI_TELEMETRY_DISABLED=1 npx boardui@0.5.8 add <nama>   # lihat daftar: npx boardui@0.5.8 list
```
Atau lewat MCP BoardUI (sudah dikonfigurasi di `.mcp.json`). Komponen Pro butuh lisensi (lihat OPEN_QUESTIONS Q-17).

## Catatan Windows
- Turbopack kadang tetap memakai bundle server lama setelah beberapa file diedit beruntun (gejala: hydration mismatch / menu baru tidak muncul). Hentikan lalu jalankan ulang `pnpm dev`.
- Docker Desktop di mesin owner gagal menyalakan VM WSL (per 2026-10-17), karena itu dipakai `embedded-postgres`.
- Shell heredoc dengan karakter `\` dan backtick rawan rusak — gunakan editor/tool tulis file.

## Gambar produk (Cloudinary)
- Tanpa env Cloudinary, gambar disimpan di database (cukup untuk dev). Untuk menguji Cloudinary: isi `CLOUDINARY_*` di `.env` lokal (jangan di chat) — langkah lengkap di [PANDUAN-CLOUDINARY.md](./PANDUAN-CLOUDINARY.md).
- Media baru (video, banner) wajib lewat `src/server/media/cloudinary.ts`.

## Payment gateway (QRIS dinamis)
- Default dev: `PAYMENT_PROVIDER=mock` → QR berisi teks penanda; di halaman order ada tombol **Simulasikan pembeli membayar (dev)** yang mengirim notifikasi bertanda tangan ke jalur webhook yang sama. Simulator tidak pernah aktif bila `NODE_ENV=production`.
- Midtrans sandbox: isi di `.env` lokal (jangan ditempel di chat) `PAYMENT_PROVIDER=midtrans`, `MIDTRANS_SERVER_KEY=…`, `MIDTRANS_IS_PRODUCTION=false`, lalu atur Payment Notification URL di dashboard Midtrans (atau `PAYMENT_NOTIFICATION_URL`) ke `https://<domain-publik>/api/payments/webhook/midtrans`. Tanpa URL publik, status tetap tersinkron karena halaman order mengecek `GET /v2/{order_id}/status` saat menunggu.
- `PAYMENT_PROVIDER=none` mematikan QRIS dinamis; kasir kembali ke QRIS statis dengan nomor referensi.
- Kasir: tab QRIS → **Tampilkan QR** → (dev) **Simulasikan pelanggan membayar** → layar sukses otomatis.
- Order belum bayar dibatalkan otomatis saat daftar/buat order dibuka; untuk produksi jadwalkan cron `POST /api/v1/online-orders/expire` (API key dengan `online_order:update`) tiap 5 menit.

## PIN persetujuan (dev)
- Kepala toko/owner mengatur PIN dari menu akun (kiri bawah) › **Atur PIN persetujuan**. Kasir tanpa hak void/retur/diskon manual akan dimintai PIN saat aksi tsb.
- Akun kasir uji (`TEST_KASIR_*` di `.env`) hanya punya `pos:access` di BDG — cocok untuk menguji alur PIN.
- PIN salah 5× dalam 10 menit mengunci permintaan persetujuan akun itu (dihitung dari audit log `approval_failed`).

## Marketplace
- Tanpa akun marketplace: Pengaturan › Marketplace › **Hubungkan toko** › "Toko simulasi (dev)". Panel Simulator di halaman toko membuat order seolah dari marketplace (lewat webhook).
- Shopee: isi `SHOPEE_PARTNER_ID`, `SHOPEE_PARTNER_KEY`, `SHOPEE_ENV=sandbox` di `.env` lokal (jangan di chat). Di Shopee Console daftarkan redirect domain = `BETTER_AUTH_URL` dan Push URL `https://<domain-publik>/api/marketplace/webhook/shopee` (event perubahan status order). Lokal tanpa URL publik: pakai **Sinkron sekarang** atau cron.
- TikTok Shop / Tokopedia: isi `TIKTOK_APP_KEY`, `TIKTOK_APP_SECRET`, `TIKTOK_SERVICE_ID` di `.env`. Di Partner Center daftarkan Redirect URL `https://<domain>/api/v1/marketplace/oauth/tiktok/callback` dan Webhook URL `https://<domain-publik>/api/marketplace/webhook/tiktok` (event Order Status Change). Toko butuh gudang penjualan default.
- `pnpm check:marketplace` memeriksa adapter TikTok dengan fetch tiruan (tanpa akun).
- Produksi: jadwalkan `POST /api/v1/marketplace/sync` (API key dengan `marketplace:manage`) tiap 5 menit, selain `POST /api/v1/online-orders/expire`.
- Token marketplace terenkripsi dengan `MARKETPLACE_SECRET` (atau turunan `BETTER_AUTH_SECRET`); mengganti kunci = hubungkan ulang semua toko.

## Mode offline kasir (dev)
- Buka `/pos` saat online sekali (paket offline terunduh ke IndexedDB `konten-pos`). Simulasi putus koneksi: DevTools › Network › Offline, atau di konsol: ganti `window.fetch` agar menolak `/api/` lalu `window.dispatchEvent(new Event("offline"))`.
- Antrean bisa dilihat di DevTools › Application › IndexedDB › `konten-pos` › `outbox`. Jangan hapus manual kecuali transaksi sudah dicatat admin.
- Service worker hanya aktif di build produksi. Uji: `pnpm build` lalu jalankan `pnpm start` (preview `pos-prod` di `.claude/launch.json`), login, buka `/pos` sekali, matikan server, muat ulang `/pos`. Kembali ke `pos-dev` setelahnya (SW otomatis dilepas di development).
- Cache SW bisa dilihat di DevTools › Application › Cache Storage (`konten-pos-shell-v2`, `konten-pos-static-v2`). Naikkan `VERSION` di `public/sw.js` bila strategi cache berubah.
