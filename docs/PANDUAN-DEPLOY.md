# Panduan Deploy (Produksi)

Langkah membawa Konten POS ke internet dengan aman. Untuk menjalankan di komputer sendiri (development), lihat [DEVELOPMENT.md](./DEVELOPMENT.md).

---

## 1. Yang dibutuhkan

| Komponen | Pilihan | Catatan |
|---|---|---|
| Server aplikasi (Node.js ≥ 22, disarankan 24 LTS) | **VPS** (Ubuntu + PM2/systemd + Nginx/Caddy) atau **platform** (Vercel, Railway, Render, Coolify/Dokploy) | Aplikasi Next.js biasa (`pnpm build` + `pnpm start`) |
| Database PostgreSQL **18** | Terkelola (Neon, Supabase, RDS, DigitalOcean) atau di VPS (`docker compose up -d db`) | Wajib backup harian |
| Domain + HTTPS | Domain milik pemilik usaha | HTTPS wajib (cookie aman, webhook, PWA kasir) |
| Media | **Cloudinary** | Lihat [PANDUAN-CLOUDINARY.md](./PANDUAN-CLOUDINARY.md) |
| Opsional | Midtrans (QRIS), Shopee/TikTok Shop | Lihat DEVELOPMENT & [PANDUAN-MARKETPLACE.md](./PANDUAN-MARKETPLACE.md) |
| Penjadwal (cron) | crontab, Vercel Cron, GitHub Actions, cron-job.org | Untuk sinkron marketplace & order kedaluwarsa |

---

## 2. Variabel environment (lengkap)

Penjelasan tiap variabel dan cara mendapatkan nilainya (untuk non-teknis) ada di [Panduan pengaturan server (.env)](./PANDUAN-ENV.md). Templat lengkapnya: `.env.example`.

Isi di `.env` server atau menu **Environment Variables** hosting. **Jangan** commit file `.env`, jangan tempel nilai rahasia di chat/AI. Buat nilai acak dengan:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

| Variabel | Wajib | Keterangan |
|---|---|---|
| `NODE_ENV` | Ya | `production` |
| `DATABASE_URL` | Ya | `postgres://user:password@host:5432/dbname` (tambahkan `?sslmode=require` bila penyedia mewajibkan SSL) |
| `BETTER_AUTH_SECRET` | Ya | Acak ≥ 32 karakter. Mengganti nilai = semua sesi login berakhir |
| `BETTER_AUTH_URL` | Ya | Alamat publik, mis. `https://pos.tokoanda.com` (tanpa `/` di akhir). Dipakai untuk cookie, CSRF, OAuth marketplace |
| `SEED_OWNER_EMAIL` / `SEED_OWNER_PASSWORD` | Saat setup | Akun Owner pertama. Password ≥ 12 karakter. Boleh dihapus dari env setelah setup |
| `SEED_DEMO` | Tidak | `false` (default di produksi) = tanpa cabang/produk contoh |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Disarankan | Penyimpanan gambar/media. Kosong = gambar disimpan di database |
| `CLOUDINARY_FOLDER` | Tidak | Default `konten-pos` |
| `PAYMENT_PROVIDER` | Ya | `midtrans` (QRIS dinamis) atau `none`. **Jangan `mock` di produksi** (simulator dimatikan otomatis) |
| `MIDTRANS_SERVER_KEY` | Bila midtrans | Dari dashboard Midtrans (Settings › Access Keys) |
| `MIDTRANS_IS_PRODUCTION` | Bila midtrans | `true` untuk transaksi sungguhan, `false` untuk sandbox |
| `PAYMENT_NOTIFICATION_URL` | Opsional | `https://<domain>/api/payments/webhook/midtrans` (atau atur di dashboard Midtrans) |
| `QRIS_EXPIRY_MINUTES` | Tidak | Default 15 |
| `SHOPEE_PARTNER_ID`, `SHOPEE_PARTNER_KEY`, `SHOPEE_ENV` | Opsional | Lihat PANDUAN-MARKETPLACE |
| `TIKTOK_APP_KEY`, `TIKTOK_APP_SECRET`, `TIKTOK_SERVICE_ID` | Opsional | Lihat PANDUAN-MARKETPLACE |
| `MARKETPLACE_SECRET` | Disarankan bila pakai marketplace | Acak ≥ 32 karakter (enkripsi token toko) |
| `BOARDUI_TELEMETRY_DISABLED` | Tidak | `1` (mematikan telemetry CLI BoardUI saat build) |

Aplikasi memvalidasi env saat menyala; bila ada yang kurang/salah format, aplikasi berhenti dengan nama variabelnya.

---

## 3. Deploy di VPS (contoh Ubuntu)

```bash
# 1. Siapkan Node 24 & pnpm
corepack enable

# 2. Ambil kode
git clone https://github.com/<akun>/<repo>.git konten-pos && cd konten-pos
pnpm install --frozen-lockfile

# 3. Database: terkelola, atau lokal lewat Docker
#    (ganti POSTGRES_PASSWORD dengan nilai acak kuat; port hanya terbuka di 127.0.0.1)
POSTGRES_PASSWORD=<acak-kuat> docker compose up -d db

# 4. Isi .env (lihat §2), lalu:
pnpm db:migrate
NODE_ENV=production pnpm db:seed      # role, tier, Owner (tanpa data contoh)
pnpm build

# 5. Jalankan sebagai service (PM2 contoh)
npx pm2 start "pnpm start" --name konten-pos && npx pm2 save
```
Reverse proxy **Caddy** (HTTPS otomatis):
```
pos.tokoanda.com {
  reverse_proxy 127.0.0.1:3000
}
```
Pastikan proxy meneruskan header `X-Forwarded-For` (dipakai rate limit & audit log). Port database jangan dibuka ke internet.

**Update versi baru:** `git pull && pnpm install --frozen-lockfile && pnpm db:migrate && pnpm build && npx pm2 restart konten-pos`. Backup database sebelum migrasi.

---

## 4. Deploy di Vercel + Neon (tanpa server sendiri)

1. Buat database PostgreSQL di Neon (atau Supabase); salin connection string ke `DATABASE_URL`.
2. Import repositori di Vercel → isi Environment Variables (§2) → Deploy.
3. Jalankan migrasi & seed dari komputer Anda yang terhubung ke database produksi (sekali, dan setiap ada migrasi baru):
   ```bash
   DATABASE_URL="<url produksi>" pnpm db:migrate
   DATABASE_URL="<url produksi>" NODE_ENV=production SEED_OWNER_EMAIL=... SEED_OWNER_PASSWORD=... pnpm db:seed
   ```
   (Isi nilai di terminal Anda sendiri, bukan di chat.)
4. Tambahkan domain di Vercel; HTTPS otomatis.
5. Cron: gunakan **Vercel Cron** atau penjadwal lain (§6).
6. Gunakan **Cloudinary** — sistem file serverless tidak permanen.

---

## 5. Setelah online (wajib)

1. Login sebagai Owner → **ganti password** bila perlu, atur **PIN persetujuan** (menu akun).
2. **Pengaturan › Cabang**: buat cabang/gudang (kode, alamat, zona waktu, pajak).
3. **Pengaturan › Pengguna**: buat akun staf, beri role & cabang. Satu orang satu akun.
4. **Pengaturan › Kebijakan**: atur aturan poin & retur.
5. **Produk**: tambah produk (SKU & barcode otomatis), unggah gambar.
6. Uji kasir di perangkat toko: buka shift, scan, bayar, cetak struk, tutup shift. Buka `/pos` sekali saat online agar mode offline siap.
7. Payment gateway: uji satu transaksi QRIS kecil, pastikan status lunas otomatis.
8. Marketplace (bila dipakai): ikuti PANDUAN-MARKETPLACE.
9. Hapus `SEED_OWNER_PASSWORD` dari environment hosting.

---

## 6. Tugas terjadwal (cron)

Buat **API key** di **Pengaturan › API key & MCP** untuk akun teknis dengan role yang punya `online_order:update` (dan `marketplace:manage` bila pakai marketplace). Jalankan tiap 5 menit:
```bash
curl -fsS -X POST https://<domain>/api/v1/online-orders/expire -H "x-api-key: <API_KEY>"
curl -fsS -X POST https://<domain>/api/v1/marketplace/sync     -H "x-api-key: <API_KEY>"   # bila pakai marketplace
```
Simpan API key sebagai secret penjadwal.

---

## 7. Backup & pemulihan

- Backup otomatis harian (fitur penyedia DB, atau `pg_dump` + simpan di luar server):
  ```bash
  pg_dump "$DATABASE_URL" -Fc -f konten-$(date +%F).dump
  ```
- **Uji pemulihan** minimal sebulan sekali ke database terpisah: `pg_restore -d <db-uji> konten-YYYY-MM-DD.dump`.
- Gambar di Cloudinary dikelola Cloudinary; ekspor berkala bila diperlukan.

---

## 8. Checklist keamanan produksi

- [ ] HTTPS aktif; `BETTER_AUTH_URL` memakai `https://`.
- [ ] `NODE_ENV=production` (cookie `Secure`, header HSTS, simulator payment/marketplace mati).
- [ ] Secret acak & unik per lingkungan; `.env` tidak ada di Git.
- [ ] `PAYMENT_PROVIDER` bukan `mock`.
- [ ] Port database tidak terbuka ke internet; password DB kuat.
- [ ] Owner & admin memakai password kuat; akun uji (`TEST_*`) tidak dibuat di produksi.
- [ ] Backup harian aktif dan pernah diuji pulih.
- [ ] `pnpm audit:deps` bersih atau risikonya tercatat di SECURITY_LOG.
- [ ] Cek header di https://securityheaders.com (CSP, HSTS, X-Frame-Options sudah dikirim aplikasi).
- [ ] Pantau log error & uptime (mis. UptimeRobot ke `/login`).

---

## 9. Masalah umum

| Gejala | Solusi |
|---|---|
| Aplikasi berhenti saat start dengan nama variabel | Env kurang/salah format (§2) |
| Login berhasil tapi langsung keluar / CSRF ditolak | `BETTER_AUTH_URL` tidak sama dengan alamat yang dibuka (http vs https, www vs non-www) |
| Kasir tidak bisa dibuka saat offline | Harus HTTPS & `/pos` pernah dibuka online di perangkat itu |
| Gambar tidak tersimpan permanen di Vercel | Isi variabel Cloudinary |
| Order QRIS tidak lunas otomatis | Notification URL Midtrans belum diatur / bukan HTTPS |
