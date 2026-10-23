# Panduan Integrasi Marketplace

Hubungkan toko **Shopee** dan **TikTok Shop / Tokopedia** agar:
- **Order masuk otomatis** ke menu **Order online** (stok langsung di-reserve, status ikut berubah: dibayar → dikirim → selesai/batal).
- **Stok marketplace mengikuti stok POS**: setiap penjualan di kasir, retur, transfer, atau opname mengirim stok terbaru ke marketplace.

Satu toko marketplace terhubung ke **satu cabang sumber stok**. Lazada direncanakan (adapter belum tersedia).

> **Status:** adapter Shopee dan TikTok Shop/Tokopedia sudah diuji dengan pemeriksaan otomatis (`pnpm check:marketplace`) dan simulator, **belum dengan akun marketplace sungguhan**. Uji di sandbox/toko uji sebelum dipakai untuk toko utama.

---

## 1. Cara kerja singkat

```
Marketplace ──(webhook: order berubah)──► /api/marketplace/webhook/{shopee|tiktok}
     ▲                                          │ verifikasi tanda tangan
     │                                          ▼
     │                          Konten: tarik detail order → cocokkan SKU → reservasi stok
     │                                          │
     └──────(update stok per SKU)◄──── stok cabang sumber − buffer
Cadangan: cron POST /api/v1/marketplace/sync tiap 5 menit (menarik order yang terlewat & mengirim stok).
```

**Pemetaan SKU**: produk marketplace dicocokkan ke varian Konten berdasarkan **SKU** (`seller_sku` di marketplace = SKU di Konten). Yang tidak cocok tampil di **Pemetaan produk** untuk dipetakan manual. Karena SKU di Konten dijamin unik, pemetaan otomatis aman.

> Tips: bila memakai SKU otomatis Konten, salin SKU tersebut ke kolom SKU penjual di marketplace — pemetaan langsung terjadi.

---

## 2. Persiapan umum (sekali)

1. Aplikasi harus bisa diakses dari internet dengan **HTTPS** dan domain tetap (lihat [PANDUAN-DEPLOY.md](./PANDUAN-DEPLOY.md)). Webhook marketplace tidak bisa menjangkau `localhost`.
2. `BETTER_AUTH_URL` di `.env` = alamat publik aplikasi, misal `https://pos.tokoanda.com`.
3. (Disarankan) isi `MARKETPLACE_SECRET` = string acak ≥ 32 karakter untuk mengenkripsi token toko:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
   ```
   Mengganti nilai ini kelak = semua toko harus dihubungkan ulang.
4. Pastikan SKU produk di marketplace sama dengan SKU di Konten (bisa disusulkan lewat Pemetaan produk).
5. Jadwalkan cron (lihat §6).

> **Keamanan:** semua kunci (partner key, app secret) hanya diisi di `.env` server atau dashboard hosting. Jangan ditempel di chat/AI, jangan di-commit ke Git.

---

## 3. Shopee (Shopee Open Platform)

### 3.1 Mendapatkan kredensial
1. Daftar sebagai developer di **Shopee Open Platform** (open.shopee.com) memakai akun yang terkait dengan toko/perusahaan Anda.
2. Buat **App** (jenis yang sesuai untuk penjual sendiri / *Seller In House System* atau sesuai arahan Shopee). Proses persetujuan bisa memakan beberapa hari.
3. Di halaman App, catat:
   - **Partner ID** (angka) → `SHOPEE_PARTNER_ID`
   - **Partner Key** (rahasia) → `SHOPEE_PARTNER_KEY`
   Gunakan kredensial **Test/Sandbox** dulu, lalu **Live** setelah lulus uji.
4. Atur di App:
   - **Redirect URL domain**: domain aplikasi Anda (sama dengan `BETTER_AUTH_URL`).
   - **Push / Webhook URL**: `https://<domain-anda>/api/marketplace/webhook/shopee`, aktifkan push **perubahan status order**.

### 3.2 Mengisi `.env`
```env
SHOPEE_PARTNER_ID=1234567
SHOPEE_PARTNER_KEY=isi-partner-key-dari-console
SHOPEE_ENV=sandbox        # ganti ke live untuk toko sungguhan
```
Restart aplikasi setelah mengubah `.env`.

### 3.3 Menghubungkan toko
1. **Pengaturan › Marketplace › Hubungkan toko** → pilih **Shopee** → pilih **cabang sumber stok** → **Lanjut ke halaman izin**.
2. Login sebagai penjual di halaman Shopee dan **izinkan** aplikasi.
3. Anda kembali ke Konten; toko tampil dengan status **Aktif**.

---

## 4. TikTok Shop / Tokopedia (TikTok Shop Partner Center)

Toko Tokopedia yang sudah bergabung dengan TikTok Shop dikelola lewat API yang sama.

### 4.1 Mendapatkan kredensial
1. Daftar di **TikTok Shop Partner Center** (partner.tiktokshop.com) sebagai developer/penjual.
2. Buat **App** (custom/in-house untuk toko sendiri). Aktifkan scope yang dibutuhkan: **Order** (baca), **Product** (baca & update stok), **Logistics** (gudang), **Authorization** (daftar toko).
3. Catat dari halaman App:
   - **App Key** → `TIKTOK_APP_KEY`
   - **App Secret** → `TIKTOK_APP_SECRET`
   - **Service ID** (untuk URL otorisasi) → `TIKTOK_SERVICE_ID`
4. Atur:
   - **Redirect URL**: `https://<domain-anda>/api/v1/marketplace/oauth/tiktok/callback`
   - **Webhook URL**: `https://<domain-anda>/api/marketplace/webhook/tiktok`, aktifkan event **Order Status Change**.
5. Di Seller Center, pastikan toko punya **gudang penjualan default** — stok dikirim ke gudang ini.

### 4.2 Mengisi `.env`
```env
TIKTOK_APP_KEY=isi-app-key
TIKTOK_APP_SECRET=isi-app-secret
TIKTOK_SERVICE_ID=isi-service-id
```
Restart aplikasi.

### 4.3 Menghubungkan toko
Sama seperti Shopee: **Hubungkan toko** → **TikTok Shop / Tokopedia** → cabang sumber → izinkan di halaman TikTok Shop. Bila akun penjual punya beberapa toko, toko wilayah Indonesia dipilih otomatis.

---

## 5. Setelah terhubung (halaman toko)

| Bagian | Fungsi |
|---|---|
| **Pengaturan** | **Sumber stok** (cabang), **Buffer stok** (unit yang ditahan agar tidak oversell, misal 2), **Tarik order otomatis**, **Kirim stok ke marketplace** |
| **Pemetaan produk** | Daftar produk marketplace; yang **Belum dipetakan** dicocokkan manual dengan mencari varian Konten |
| **Sinkron sekarang** | Tarik order & kirim stok segera (tanpa menunggu cron) |
| **Order tertunda** | Order yang gagal diproses (misal SKU belum dipetakan) — dicoba ulang otomatis setelah dipetakan |
| **Riwayat sinkron** | Log setiap sinkron/webhook: berhasil, sebagian, gagal + pesannya |
| **Putuskan** | Memutus koneksi; order yang sudah masuk tetap tersimpan |

Stok yang dikirim ke marketplace = **stok tersedia di cabang sumber − buffer** (tidak pernah minus). Barang yang sedang di-reserve order lain tidak ikut dihitung tersedia.

---

## 6. Cron (wajib di produksi)

Webhook bisa terlambat atau hilang, jadi jadwalkan dua panggilan ini tiap **5 menit** memakai **API key** (buat di **Pengaturan › API key & MCP** dengan role yang punya `marketplace:manage` dan `online_order:update`):

```bash
curl -X POST https://<domain-anda>/api/v1/marketplace/sync -H "x-api-key: <API_KEY>"
curl -X POST https://<domain-anda>/api/v1/online-orders/expire -H "x-api-key: <API_KEY>"
```
Pilihan penjadwal: cron di VPS (`crontab -e`), Vercel Cron, GitHub Actions `schedule`, cron-job.org, atau penjadwal hosting Anda. Simpan API key sebagai secret di penjadwal, bukan di skrip publik.

---

## 7. Mencoba tanpa akun marketplace

Di development (`NODE_ENV` bukan production): **Hubungkan toko › Toko simulasi (dev)**. Panel **Simulator (development)** di halaman toko membuat order seolah dari marketplace lewat jalur webhook yang sama — cocok untuk melatih staf. Simulator tidak tersedia di production.

Pemeriksaan otomatis adapter (tanpa akun): `pnpm check:marketplace`.

---

## 8. Masalah umum

| Gejala | Penyebab & solusi |
|---|---|
| Status toko **Perlu dihubungkan ulang** | Token kedaluwarsa/dicabut di marketplace, atau `MARKETPLACE_SECRET` diganti → **Hubungkan** ulang |
| Order tidak masuk | Webhook URL salah/tidak HTTPS, atau cron belum jalan → cek **Riwayat sinkron**, klik **Sinkron sekarang** |
| Order masuk di **Order tertunda** | SKU belum dipetakan → petakan di **Pemetaan produk**; order dicoba ulang otomatis |
| Stok marketplace tidak berubah | **Kirim stok ke marketplace** mati, produk belum dipetakan, atau gudang default TikTok belum diatur |
| Stok marketplace lebih kecil dari POS | Buffer stok & stok yang di-reserve order lain dikurangkan — perilaku normal |
| Error tanda tangan webhook di log | Partner key/app secret di `.env` tidak sama dengan di console marketplace |
| Adapter tidak muncul di pilihan | Variabel `.env` belum lengkap → isi semua, restart aplikasi |
