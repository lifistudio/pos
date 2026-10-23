# Panduan Cloudinary (Gambar, Video & Media)

Konten POS menyimpan aset media — saat ini **gambar/thumbnail produk**, dan ke depan video serta file media lain — di **Cloudinary**. Cloudinary menyimpan file, memperkecil & mengubah format otomatis (WebP/AVIF sesuai browser), dan mengirimkannya lewat CDN sehingga gambar cepat tampil di kasir dan daftar produk.

> **Tanpa Cloudinary** aplikasi tetap jalan: gambar disimpan di database (cocok untuk mencoba/demo atau toko kecil). Untuk produksi, **gunakan Cloudinary**.

---

## 1. Ringkasan cara kerja

```
Browser ──(foto diperkecil ≤ 1024 px, WebP)──► PUT /api/v1/products/{id}/thumbnail
                                                    │ cek izin product:update, cek isi file
                                                    ▼
                         Server ──(unggahan BERTANDA TANGAN dengan API secret)──► Cloudinary
                                                    │  public_id: konten-pos/products/{id}
                                                    ▼
          products.image_url = https://res.cloudinary.com/<cloud>/image/upload/c_fill,g_auto,w_480,h_480,f_auto,q_auto/v<versi>/konten-pos/products/{id}
```
- **API secret tidak pernah dikirim ke browser.** Semua unggahan lewat server dan diperiksa hak aksesnya.
- Mengganti gambar = file ditimpa di Cloudinary dengan versi baru, URL ikut berubah sehingga cache tidak basi. Menghapus gambar di aplikasi = file di Cloudinary ikut dihapus.
- Gambar disimpan di folder `CLOUDINARY_FOLDER` (default `konten-pos`), subfolder `products/`.
- Kasir offline tetap bisa menampilkan gambar yang pernah dimuat (disimpan service worker).

---

## 2. Membuat akun & mengambil kredensial API

1. Buka **https://cloudinary.com** → **Sign up** (gratis). Gunakan email bisnis Anda (akun sebaiknya atas nama pemilik usaha, bukan developer).
2. Setelah masuk, Anda berada di **Console**. Akun gratis sudah mencakup satu *product environment* — cukup untuk Konten POS.
3. Ambil **Cloud name**:
   - Terlihat di **Dashboard** Console (bagian atas, "Cloud name"), atau di **Settings (ikon roda gigi) › Product environment**.
   - Contoh: `dxyz123ab` atau nama yang Anda pilih saat daftar.
4. Ambil **API Key** dan **API Secret**:
   - Buka **Settings › API Keys** (di beberapa tampilan: **Settings › Access Keys**).
   - Disarankan klik **Generate New API Key** dan beri nama, misal `konten-pos-production`, agar kunci aplikasi terpisah dari kunci lain dan bisa dicabut sendiri.
   - **API Key** = deretan angka (contoh `123456789012345`).
   - **API Secret** = teks rahasia; klik ikon mata/salin untuk melihat. **Jangan pernah** dibagikan, ditempel di chat/AI, atau di-commit ke Git.
5. (Opsional) Ganti nama folder tujuan dengan `CLOUDINARY_FOLDER` bila satu akun Cloudinary dipakai beberapa aplikasi, misal `toko-bandung-pos`.

> Tampilan Console Cloudinary bisa berubah. Bila menu tidak sama persis, cari "API Keys" di pengaturan atau lihat dokumentasi resmi: https://cloudinary.com/documentation/how_to_integrate_cloudinary

---

## 3. Mengisi `.env`

Tambahkan ke file `.env` di server (atau menu **Environment Variables** di dashboard hosting seperti Vercel/Railway/Coolify):

```env
# Cloudinary — gambar produk, video & media
CLOUDINARY_CLOUD_NAME=dxyz123ab
CLOUDINARY_API_KEY=123456789012345
CLOUDINARY_API_SECRET=isi-api-secret-anda
CLOUDINARY_FOLDER=konten-pos
```

| Variabel | Wajib | Isi | Contoh format |
|---|---|---|---|
| `CLOUDINARY_CLOUD_NAME` | Ya (untuk aktif) | Cloud name dari Dashboard | huruf/angka/`-`/`_` |
| `CLOUDINARY_API_KEY` | Ya | API Key (angka) | `123456789012345` |
| `CLOUDINARY_API_SECRET` | Ya | API Secret (rahasia) | teks acak ± 27 karakter |
| `CLOUDINARY_FOLDER` | Tidak | Folder induk di Media Library | `konten-pos` (default) |

Aturan:
- Ketiga variabel pertama harus **semuanya** terisi agar Cloudinary aktif. Bila salah satu kosong, aplikasi memakai penyimpanan database.
- Format divalidasi saat aplikasi menyala; nilai yang salah format membuat aplikasi berhenti dengan pesan nama variabelnya (tanpa menampilkan nilainya).
- **Jangan** memberi awalan `NEXT_PUBLIC_` — itu akan membocorkan rahasia ke browser.
- Setelah mengubah `.env`, **restart** aplikasi (`pnpm start` ulang / redeploy).

---

## 4. Memeriksa apakah sudah benar

1. Pemeriksaan tanpa akun (memastikan kode & tanda tangan benar): `pnpm check:media`.
2. Uji sungguhan: login sebagai Owner/Admin → buka sebuah produk → **Informasi produk › Pilih gambar** → pilih foto.
   - Berhasil: gambar tampil; di Console Cloudinary › **Media Library** muncul `konten-pos/products/<id produk>`.
   - Klik kanan gambar › buka di tab baru: alamatnya diawali `https://res.cloudinary.com/<cloud-name>/image/upload/…`.
3. Buka **Kasir**: produk tampil dengan gambar (pastikan **Tampilan › Tampilkan gambar** menyala).

---

## 5. Masalah umum

| Pesan / gejala | Penyebab & solusi |
|---|---|
| "Kredensial Cloudinary ditolak" | API Key/Secret salah, sudah dicabut, atau tidak sepasang → salin ulang dari **Settings › API Keys**, restart |
| "Tidak bisa terhubung ke Cloudinary" | Server tidak bisa mengakses internet / firewall memblokir `api.cloudinary.com` |
| "Cloudinary menolak permintaan" | File rusak atau melebihi batas akun → coba gambar lain; cek kuota di Console |
| Gambar tersimpan di database, bukan Cloudinary | Salah satu dari 3 variabel kosong atau aplikasi belum direstart |
| Gambar tidak tampil, konsol browser menyebut CSP | Proxy/hosting menimpa header keamanan; `img-src` harus mengizinkan `https:` (bawaan aplikasi sudah) |
| Gambar tidak tampil setelah mengaktifkan "Strict transformations" di Cloudinary | Transformasi on-the-fly diblokir → matikan Strict transformations, atau izinkan transformasi `c_fill,g_auto,w_480,h_480,f_auto,q_auto` |

Error detail tercatat di log server dengan awalan `[cloudinary]` (tanpa rahasia).

---

## 6. Biaya & kuota

Paket gratis Cloudinary memakai sistem **kredit bulanan** (gabungan penyimpanan, bandwidth, dan transformasi) — biasanya cukup untuk ribuan produk toko kecil-menengah karena gambar sudah diperkecil sebelum diunggah. Cek kuota & harga terbaru di https://cloudinary.com/pricing dan pantau pemakaian di **Console › Dashboard**. Pasang notifikasi kuota di pengaturan akun.

---

## 7. Keamanan

- API secret hanya di server. Unggahan selalu **bertanda tangan** dan melewati pengecekan izin `product:update` di API Konten; pengguna tanpa izin tidak bisa mengunggah.
- Server memeriksa isi file (bukan sekadar ekstensi): hanya JPG/PNG/WebP, ≤ 1 MB, sisi ≤ 2048 px. Foto diproses ulang di perangkat sehingga metadata lokasi (EXIF) hilang.
- Jangan membuat **upload preset unsigned** untuk aplikasi ini — tidak diperlukan dan membuka celah unggahan tanpa izin.
- Rotasi kunci: buat API key baru di Console → ganti di `.env` → restart → hapus kunci lama.
- Gambar produk bersifat publik di CDN Cloudinary (siapa pun yang tahu URL-nya bisa melihat). Jangan mengunggah dokumen pribadi sebagai gambar produk.

---

## 8. Pindah dari penyimpanan database ke Cloudinary

Gambar lama yang tersimpan di database tetap tampil. Setelah Cloudinary aktif, setiap gambar yang **diganti** otomatis pindah ke Cloudinary. Untuk memindahkan semuanya sekaligus, unggah ulang gambar produk (fitur migrasi massal tercatat di OPEN_QUESTIONS sebagai rencana).

## 9. Video & media lain (untuk developer)

Modul `src/server/media/cloudinary.ts` mendukung `resourceType` `image`, `video`, dan `raw`. Fitur baru yang butuh media (video produk, banner, lampiran) wajib memakai modul ini — bukan menyimpan file di disk server — dengan pola yang sama: unggah lewat route API ber-permission, simpan `public_id` + versi di database, tampilkan lewat URL transformasi Cloudinary.
