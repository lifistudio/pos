# Panduan Pengaturan Server (.env)

POS by lifistudio membaca pengaturan rahasia (database, kunci login, payment gateway, Cloudinary, marketplace) dari **variabel lingkungan**, biasa disebut *env*. Panduan ini menjelaskan setiap variabel: fungsinya, wajib atau tidak, dan cara mendapatkan nilainya.

> **Siapa yang mengisi?** Owner atau admin teknis yang memasang server. Kasir dan staf toko tidak perlu menyentuh env.
>
> **Keamanan:** isi env adalah rahasia. Jangan dikirim lewat chat (termasuk ke AI), email, atau screenshot, dan jangan di-commit ke Git (file `.env` sudah dikecualikan). Bila ada yang bocor, ganti nilainya di sumbernya (Midtrans, Cloudinary, dll.) lalu perbarui env.

---

## 1. Di mana env diisi?

| Tempat aplikasi berjalan | Cara mengisi |
|---|---|
| **Komputer sendiri** (development) | Salin file `.env.example` menjadi `.env` di folder proyek, lalu isi dengan editor teks. |
| **VPS / server sendiri** | Buat file `.env` di folder aplikasi di server (izin file `600`, hanya pemilik yang bisa membaca). |
| **Hosting (Vercel, Railway, Render, dll.)** | Menu pengaturan proyek › **Environment Variables**. Masukkan nama dan nilai satu per satu. Tidak perlu file `.env`. |

Setiap baris berbentuk `NAMA=nilai`, tanpa spasi di sekitar `=` dan tanpa tanda kutip. Baris yang diawali `#` adalah komentar (tidak dibaca). Untuk mengaktifkan variabel yang masih komentar, hapus `# ` di depannya.

**Setelah mengubah env, aplikasi wajib dijalankan ulang** (restart server, atau *redeploy* di hosting).

> Aplikasi memeriksa semua env saat menyala. Bila ada yang kurang atau salah format, aplikasi berhenti dan menyebut **nama** variabelnya (nilainya tidak ditampilkan).

## 2. Variabel wajib

| Variabel | Isi | Cara mendapatkan |
|---|---|---|
| `DATABASE_URL` | Alamat database PostgreSQL | **Development:** biarkan nilai bawaan dan jalankan `pnpm db:start`. **Produksi:** salin *connection string* dari penyedia database (Neon, Supabase, Railway, atau PostgreSQL di VPS). Formatnya `postgres://user:password@host:5432/nama_db`; tambahkan `?sslmode=require` bila penyedia mewajibkan SSL. |
| `BETTER_AUTH_SECRET` | Kunci rahasia login, minimal 32 karakter acak | Jalankan perintah di bawah, lalu salin hasilnya. Buat **berbeda** untuk development dan produksi. Mengganti kunci ini membuat semua pengguna harus login ulang. |
| `BETTER_AUTH_URL` | Alamat aplikasi, tanpa `/` di akhir | Development: `http://localhost:3000`. Produksi: domain Anda, misalnya `https://pos.toko-anda.com`. Harus persis sama dengan alamat yang dibuka di browser. |

Membuat kunci acak:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

`NODE_ENV` biasanya diisi otomatis (`development` saat `pnpm dev`, `production` saat `pnpm build`/`start` dan di hosting). Tidak perlu diisi manual.

### `TRUSTED_PROXY_HOPS` (opsional, penting di produksi)
Jumlah reverse proxy tepercaya di depan aplikasi, dipakai untuk membaca IP asli pengunjung. Bawaan `1` cocok untuk Dokploy/Traefik atau Nginx. Pakai `2` bila ada Cloudflare di depan Nginx, `0` bila aplikasi langsung terbuka ke internet. Nilai yang salah membuat IP di audit log keliru dan rate limit per IP bisa dilewati.

## 3. Akun Owner pertama

Dipakai sekali oleh perintah `pnpm db:seed` untuk membuat akun Owner.

| Variabel | Isi |
|---|---|
| `SEED_OWNER_EMAIL` | Email login Owner. |
| `SEED_OWNER_PASSWORD` | Password Owner. Di produksi **minimal 12 karakter**. Setelah setup selesai dan Anda sudah bisa login, **hapus** variabel ini dari env. |
| `SEED_DEMO` | `true` = buat cabang dan produk contoh (bawaan di development). `false` = hanya role, tier, dan Owner (bawaan di produksi). |

Langkah setup pertama:

```bash
pnpm db:migrate
pnpm db:seed
```

### Owner kedua (opsional)
`SEED_OWNER2_EMAIL` dan `SEED_OWNER2_PASSWORD` membuat akun Owner kedua saat `pnpm db:seed`. Keduanya harus diisi bersamaan. Akun Owner hanya bisa diatur ulang oleh Owner lain, jadi dua akun melindungi Anda bila satu password lupa.

## 4. Pembayaran QRIS dinamis (opsional)

Tanpa variabel ini, kasir tetap bisa menerima **tunai, QRIS statis (stiker), EDC manual maupun EDC tersambung kabel, dan transfer**. Variabel di bawah hanya untuk **QRIS dinamis yang otomatis lunas**. Langkah lengkapnya ada di [Panduan pembayaran](./PANDUAN-PEMBAYARAN.md).

| Variabel | Isi |
|---|---|
| `PAYMENT_PROVIDER` | `midtrans` untuk QRIS dinamis sungguhan, `none` tanpa QRIS dinamis, atau `mock` untuk simulator latihan (otomatis nonaktif di produksi; juga menampilkan pilihan **EDC simulasi**). |
| `MIDTRANS_SERVER_KEY` | Dashboard Midtrans › **Settings › Access Keys** › **Server Key**. Pakai key **Sandbox** untuk uji coba dan **Production** untuk uang sungguhan. |
| `MIDTRANS_IS_PRODUCTION` | `false` = sandbox (uji coba), `true` = transaksi sungguhan. Harus sesuai dengan jenis Server Key. |
| `PAYMENT_NOTIFICATION_URL` | `https://<domain-anda>/api/payments/webhook/midtrans`. Boleh dikosongkan bila sudah diatur di dashboard Midtrans (**Payment Notification URL**). Wajib HTTPS. |
| `QRIS_EXPIRY_MINUTES` | Masa berlaku QR dalam menit. Bawaan `15`. |

### Xendit & DOKU
`PAYMENT_PROVIDER` juga bisa `xendit` atau `doku`. Variabel dan cara mendapatkannya: [Panduan pembayaran §3c](./PANDUAN-PEMBAYARAN.md).

### Email (SMTP, opsional)
Mengaktifkan **Lupa password** di halaman masuk. Tanpa ini, password diatur ulang oleh admin atau Owner.

| Variabel | Fungsi |
|---|---|
| `SMTP_HOST`, `SMTP_PORT` | Server SMTP. Port 587 (STARTTLS) atau 465 (TLS) |
| `SMTP_SECURE` | `true` untuk port 465 |
| `SMTP_USER`, `SMTP_PASSWORD` | Login SMTP. Gmail memakai App Password |
| `SMTP_FROM` | Alamat pengirim, wajib |

## 5. Gambar & media: Cloudinary (disarankan di produksi)

Bila ketiga variabel pertama kosong, gambar produk disimpan di database. Itu cukup untuk mencoba atau toko kecil. Langkah lengkapnya ada di [Panduan Cloudinary](./PANDUAN-CLOUDINARY.md).

| Variabel | Isi |
|---|---|
| `CLOUDINARY_CLOUD_NAME` | Cloud name dari Dashboard Cloudinary. |
| `CLOUDINARY_API_KEY` | Settings › API Keys › API Key (angka). |
| `CLOUDINARY_API_SECRET` | Settings › API Keys › API Secret. |
| `CLOUDINARY_FOLDER` | Folder di Media Library. Bawaan `pos-lifistudio`. |

## 6. Marketplace (opsional)

Isi hanya bila menghubungkan toko Shopee atau TikTok Shop/Tokopedia. Langkah lengkapnya ada di [Panduan marketplace](./PANDUAN-MARKETPLACE.md).

| Variabel | Isi |
|---|---|
| `SHOPEE_PARTNER_ID` | Partner ID (angka) aplikasi Anda di Shopee Open Platform. |
| `SHOPEE_PARTNER_KEY` | Partner Key aplikasi tersebut (rahasia). |
| `SHOPEE_ENV` | `sandbox` untuk uji coba, `live` untuk toko sungguhan. |
| `TIKTOK_APP_KEY` | App Key dari TikTok Shop Partner Center. |
| `TIKTOK_APP_SECRET` | App Secret (rahasia). |
| `TIKTOK_SERVICE_ID` | Service ID untuk tautan otorisasi toko. |
| `MARKETPLACE_SECRET` | Kunci acak minimal 32 karakter untuk mengenkripsi token toko (buat dengan perintah di bagian 2). Disarankan diisi bila memakai marketplace. Jangan diganti setelah toko terhubung; bila diganti, toko harus dihubungkan ulang. |

## 7. Variabel pengembangan

Tidak dipakai di produksi.

| Variabel | Isi |
|---|---|
| `BOARDUI_TELEMETRY_DISABLED` | `1` = matikan telemetry CLI BoardUI saat build. |
| `DB_LOG_QUERIES` | `1` = tampilkan query SQL di log server (untuk mencari query lambat). |
| `TEST_KASIR_EMAIL`, `TEST_KASIR_PASSWORD` | Akun kasir uji untuk menguji alur kasir dan PIN. Akunnya dibuat dulu di **Pengaturan › Pengguna**. |

## 8. Yang tidak memakai env

- **Printer struk, mesin EDC, dan layar pelanggan** diatur per perangkat kasir di aplikasi: **Kasir › Perangkat**. Lihat [Panduan printer struk](./PANDUAN-PRINTER.md) dan [Panduan pembayaran](./PANDUAN-PEMBAYARAN.md).
- **Login aplikasi AI (OAuth)** untuk Claude dan ChatGPT memakai `BETTER_AUTH_URL`. **API key** dibuat di **Pengaturan › API key & MCP**. Lihat [Panduan AI agent (MCP)](./PANDUAN-MCP.md).
- **Header dan footer struk, PPN, serta data cabang** diatur di **Pengaturan › Cabang**.
- **Kebijakan poin dan retur** diatur di **Pengaturan › Kebijakan toko**.

## 9. Contoh lengkap

**Development (komputer sendiri):**

```env
DATABASE_URL=postgres://pos:pos_dev_password@127.0.0.1:5433/pos
BETTER_AUTH_SECRET=hasil-perintah-acak-minimal-32-karakter
BETTER_AUTH_URL=http://localhost:3000
SEED_OWNER_EMAIL=owner@pos.test
SEED_OWNER_PASSWORD=password-lokal-anda
PAYMENT_PROVIDER=mock
BOARDUI_TELEMETRY_DISABLED=1
```

**Produksi (contoh; ganti semua nilai):**

```env
NODE_ENV=production
DATABASE_URL=postgres://user:password@host:5432/pos?sslmode=require
BETTER_AUTH_SECRET=kunci-acak-berbeda-dari-development
BETTER_AUTH_URL=https://pos.toko-anda.com
PAYMENT_PROVIDER=midtrans
MIDTRANS_SERVER_KEY=server-key-production-dari-midtrans
MIDTRANS_IS_PRODUCTION=true
PAYMENT_NOTIFICATION_URL=https://pos.toko-anda.com/api/payments/webhook/midtrans
CLOUDINARY_CLOUD_NAME=nama-cloud-anda
CLOUDINARY_API_KEY=123456789012345
CLOUDINARY_API_SECRET=api-secret-dari-cloudinary
MARKETPLACE_SECRET=kunci-acak-lain-minimal-32-karakter
```

Setelah aplikasi online, lanjutkan dengan [Panduan deploy](./PANDUAN-DEPLOY.md) (cron, backup, checklist keamanan).

## 10. Masalah umum

| Gejala | Penyebab & solusi |
|---|---|
| Aplikasi berhenti saat menyala dan menyebut nama variabel | Variabel wajib kosong atau formatnya salah. Cek nama dan nilainya, lalu jalankan ulang. |
| Tidak bisa login / langsung keluar lagi | `BETTER_AUTH_URL` tidak sama dengan alamat di browser (http vs https, ada `/` di akhir, beda subdomain). |
| Semua pengguna tiba-tiba keluar | `BETTER_AUTH_SECRET` diganti. Itu memang akibatnya. |
| Tombol **Tampilkan QR** tidak muncul di kasir | `PAYMENT_PROVIDER` bukan `midtrans`/`mock`, atau aplikasi belum dijalankan ulang. |
| QRIS tidak lunas otomatis | Notification URL Midtrans belum diatur atau bukan HTTPS; Server Key tidak sesuai `MIDTRANS_IS_PRODUCTION`. |
| Gambar produk tidak terunggah ke Cloudinary | Salah satu dari tiga variabel Cloudinary kosong atau salah. Cek pesan di layar, lalu salin ulang dari Settings › API Keys. |
| Toko marketplace minta dihubungkan ulang | `MARKETPLACE_SECRET` atau `BETTER_AUTH_SECRET` (bila `MARKETPLACE_SECRET` kosong) sudah diganti. |
| Perubahan env tidak berpengaruh | Aplikasi belum di-restart/redeploy. Di hosting, pastikan variabel disimpan untuk lingkungan *Production*. |
