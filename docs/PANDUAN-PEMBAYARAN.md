# Panduan Pembayaran: Tunai, QRIS, Mesin EDC & Scanner

Panduan ini menjelaskan cara menerima pembayaran di kasir POS by lifistudio: tunai, **QRIS** (QR otomatis lunas atau QR statis), **kartu lewat mesin EDC**, dan transfer. Juga cara memakai **scanner barcode** di kasir.

> **Ringkasan:** semua cara bayar bisa dipakai bersamaan. Pilih yang cocok untuk toko Anda.
>
> **Tersedia sekarang:**
> - **Tunai**, **transfer**, dan **QRIS statis**: langsung bisa dipakai, tanpa pengaturan.
> - **QRIS dinamis otomatis lunas** lewat payment gateway (Midtrans): QR muncul di layar, pelanggan scan, transaksi lunas sendiri.
> - **Mesin EDC, mode manual** (bawaan, semua bank): kartu diproses di EDC, kasir mengetik kode approval.
> - **Mesin EDC tersambung kabel (ECR)**, opsional: nominal terkirim ke EDC dan hasilnya terbaca otomatis. Butuh EDC dan protokol yang didukung (bagian 4b).
> - **Layar pelanggan**, opsional: monitor kedua yang menampilkan belanjaan, total, dan QRIS seperti di minimarket (bagian 6).
> - **Scanner barcode** USB/Bluetooth/kamera untuk memindai produk.
>
> **Belum tersedia:** memindai kode bayar dari aplikasi pelanggan (bagian 8).

---

## 1. Alur bayar di kasir

1. Masukkan barang ke keranjang (scan atau ketuk produk).
2. Tekan **Bayar** (atau tombol **F8**).
3. Pilih metode di atas: **Tunai**, **QRIS**, **EDC** (kartu lewat mesin EDC), atau **Transfer**.
4. Selesaikan sesuai metode (bagian 2–5). Muncul layar **Transaksi berhasil**: cetak struk, unduh PDF, atau **Transaksi baru**.

Stok berkurang, poin member bertambah, dan transaksi tercatat di shift kasir begitu lunas.

## 2. Tunai

1. Ketik **Uang diterima**, atau ketuk tombol nominal cepat (uang pas dan pembulatan ke atas, misalnya 50.000 atau 100.000).
2. **Kembalian** dihitung otomatis. Bila uang kurang, tulisannya berubah menjadi **Kurang** dan transaksi belum bisa disimpan.
3. Tekan **Selesaikan transaksi**. Bila printer diatur membuka laci kas, laci terbuka otomatis (lihat [Panduan printer struk](./PANDUAN-PRINTER.md)).

## 3. QRIS

QRIS bisa dibayar dari **semua** aplikasi bank dan e-wallet (GoPay, OVO, DANA, ShopeePay, LinkAja, m-banking). Ada dua cara.

### 3a. QRIS dinamis: otomatis lunas (disarankan)

Cara ini sama seperti di minimarket modern. QR berisi **nominal pas** dan dibuat khusus untuk satu transaksi, sehingga pelanggan tidak perlu mengetik nominal.

**Cara pakai di kasir:**
1. Pilih **QRIS**, lalu tekan **Tampilkan QR**.
2. Arahkan layar ke pelanggan, atau tampilkan di **layar pelanggan** (bagian 6). Pelanggan memindai QR dengan aplikasi bank/e-wallet dan membayar.
3. Begitu pembayaran masuk, layar kasir **otomatis** berpindah ke **Transaksi berhasil**. Struk tercetak otomatis bila diaktifkan. Kasir **tidak perlu** mengecek HP pelanggan.
4. QR berlaku **15 menit**. Bila pelanggan batal atau QR kedaluwarsa, tekan **Batalkan QR & pilih metode lain**. Stok tidak berkurang untuk transaksi yang batal.

**Persiapan (sekali, oleh owner/admin teknis):**
1. Daftar akun **Midtrans** (midtrans.com) atas nama usaha, lengkapi verifikasi, dan aktifkan kanal pembayaran **QRIS**.
2. Di dashboard Midtrans, buka **Settings › Access Keys** dan salin **Server Key**. Rahasiakan, jangan dikirim lewat chat.
3. Isi variabel lingkungan server (lihat [Panduan deploy](./PANDUAN-DEPLOY.md)):
   - `PAYMENT_PROVIDER=midtrans`
   - `MIDTRANS_SERVER_KEY=` Server Key Anda
   - `MIDTRANS_IS_PRODUCTION=true` untuk uang sungguhan (`false` untuk uji coba/sandbox)
   - `QRIS_EXPIRY_MINUTES=15` (opsional)
4. Di dashboard Midtrans, atur **Payment Notification URL** ke `https://<domain-anda>/api/payments/webhook/midtrans`. Wajib HTTPS. Tanpa ini, transaksi tidak bisa lunas otomatis.
5. Restart aplikasi, lalu uji satu transaksi QRIS kecil (misalnya Rp1.000) dan pastikan layar kasir berubah sendiri menjadi lunas.

> Dana QRIS masuk ke saldo Midtrans, lalu dicairkan ke rekening usaha sesuai jadwal dan biaya MDR Midtrans.

### 3b. QRIS statis (tanpa payment gateway)

Bila belum memakai Midtrans, pilihan **QRIS** memakai QR **cetak/stiker** milik toko dari bank atau penyedia QRIS Anda.
1. Pilih **QRIS**. Pelanggan memindai QR stiker toko dan **mengetik nominal sendiri**.
2. Kasir **wajib memastikan dana masuk** di aplikasi merchant atau notifikasi bank (nominal dan nama toko benar).
3. Isi **No. referensi** dari notifikasi (opsional, memudahkan pencocokan), lalu tekan **Konfirmasi QRIS diterima**.

> QRIS statis rawan salah nominal dan bukti transfer palsu. Untuk toko yang ramai, gunakan **QRIS dinamis**.

### 3c. Memilih payment gateway QRIS dinamis

Pilih satu lewat `PAYMENT_PROVIDER`. Semuanya memberi alur kasir yang sama: QR tampil di layar, lalu lunas otomatis. Bisa diganti kapan saja. QR lama tetap diproses selama kredensial gateway lamanya masih diisi.

| Gateway | `PAYMENT_PROVIDER` | Env | Webhook |
|---|---|---|---|
| Midtrans | `midtrans` | `MIDTRANS_SERVER_KEY`, `MIDTRANS_IS_PRODUCTION` | `/api/payments/webhook/midtrans` |
| Xendit | `xendit` | `XENDIT_SECRET_KEY`, `XENDIT_WEBHOOK_TOKEN` | `/api/payments/webhook/xendit` |
| DOKU | `doku` | `DOKU_CLIENT_ID`, `DOKU_SECRET_KEY`, `DOKU_PRIVATE_KEY`, `DOKU_MERCHANT_ID`, `DOKU_TERMINAL_ID`, `DOKU_POSTAL_CODE`, `DOKU_IS_PRODUCTION` | `/api/payments/webhook/doku` |

**Xendit** ([dokumentasi](https://docs.xendit.co/apidocs/create-payment-request))
1. Dashboard › Settings › API Keys: buat secret key dengan izin Money-In. Mode test atau live mengikuti jenis key.
2. Dashboard › Settings › Webhooks: salin **Webhook verification token** ke `XENDIT_WEBHOOK_TOKEN`, lalu arahkan event pembayaran ke URL webhook di atas.
3. Xendit tidak menyediakan pembatalan QR yang belum dibayar. Setelah kasir membatalkan, QR masih bisa dibayar sampai kedaluwarsa. Bila itu terjadi, dana masuk tetapi transaksi tetap batal, dan tercatat di Audit log sebagai `payment_attention` untuk direfund manual. Masa berlaku QR yang pendek (`QRIS_EXPIRY_MINUTES`) mengurangi risikonya.

**DOKU** ([dokumentasi](https://developers.doku.com/accept-payments/direct-api/snap/integration-guide/qris))
1. Daftarkan QRIS di DOKU Back Office sampai disetujui. Dari sana didapat Client ID, Secret Key, Merchant ID, dan Terminal ID.
2. Buat pasangan kunci RSA lalu daftarkan public key ke DOKU:
   ```bash
   openssl genrsa -out doku-private.pem 2048
   openssl rsa -in doku-private.pem -pubout -out doku-public.pem
   ```
3. Isi `DOKU_PRIVATE_KEY` dengan isi `doku-private.pem` dalam satu baris, ganti baris baru dengan `\n`.
4. Atur Notification URL ke URL webhook di atas. Isi notifikasi tidak dipercaya: aplikasi selalu menanyakan status langsung ke DOKU.

> **Status:** adapter Xendit dan DOKU lulus `pnpm check:payments` dengan server tiruan sesuai dokumentasi resmi, **belum diuji dengan akun sungguhan**. Uji di sandbox dulu: buat QR, bayar, batalkan, biarkan kedaluwarsa. Khusus DOKU, dokumentasinya berbeda soal format tanda tangan, jadi perhatikan bila sandbox menolak dengan error signature.

**Pembayaran ganda.** Satu dokumen hanya punya satu QR aktif, dan pembuatan QR yang bersamaan hanya menagih sekali. Bila pelanggan tetap membayar dua QR, dokumen lunas sekali dan pembayaran kedua tercatat di Audit log (`DUPLICATE_PAYMENT`) untuk direfund.

## 4. Mesin EDC (kartu debit/kredit)

Ada dua cara memakai mesin EDC. Atur di kasir: **Perangkat › Mesin EDC**. Pengaturan berlaku untuk perangkat kasir itu saja.

| Cara | Cocok untuk | Yang dilakukan kasir |
|---|---|---|
| **Manual** (bawaan) | Semua mesin EDC dari bank mana pun | Ketik nominal di EDC, lalu ketik kode approval di kasir |
| **Tersambung kabel (ECR)** | EDC dengan kabel ECR dan protokol yang didukung POS by lifistudio | Tekan **Kirim ke EDC**. Nominal dan hasilnya otomatis |

### 4a. EDC manual (semua bank)

Mesin EDC dari bank mana pun (BCA, Mandiri, BRI, BNI, dan lainnya) dipakai berdampingan dengan POS by lifistudio:

1. Di kasir pilih **EDC**. Total belanja tampil besar di layar.
2. Di **mesin EDC**, ketik **nominal yang sama persis** dengan total di layar. Gesek/celup/tempel kartu, pelanggan memasukkan PIN, lalu tunggu slip keluar.
3. **Pastikan slip berstatus APPROVED/BERHASIL.** Bila *DECLINED/GAGAL*, pilih metode lain.
4. Ketik **kode approval** (atau nomor *trace/ref*) dari slip ke kolom **No. referensi**, lalu tekan **Konfirmasi Kartu debit diterima**.
5. Simpan slip EDC bersama struk, atau sesuai SOP toko.

**Tips agar tidak salah catat:**
- Cocokkan **nominal di slip** dengan **total di layar** sebelum menekan tombol konfirmasi.
- Saat tutup shift, cocokkan jumlah transaksi **Kartu debit** (EDC) di laporan shift dengan **settlement** mesin EDC hari itu. Di mesin EDC biasanya menu *Settlement* atau *Summary Report*.
- Mesin EDC yang juga menampilkan **QRIS** bisa dipakai seperti QRIS statis (bagian 3b): pilih **QRIS** di kasir dan isi referensinya.

### 4b. EDC tersambung kabel (ECR): otomatis terdeteksi

Kasir tidak perlu mengetik nominal di EDC maupun mengetik kode approval. Semuanya terkirim dan terbaca otomatis.

**Syarat:**
- Mesin EDC mendukung **ECR (integrasi kasir)** dan punya kabel **USB/serial**. Tanyakan ke bank pemberi EDC: *"Apakah EDC ini bisa integrasi ECR dengan aplikasi kasir?"*
- **Protokol** EDC tersedia di POS by lifistudio. Saat ini tersedia **POS ECR v1**, protokol terbuka untuk EDC/aplikasi perantara dari vendor. Protokol khusus bank (BCA, Mandiri, BRI, BNI, …) ditambahkan setelah bank memberikan dokumen spesifikasi ECR-nya kepada toko. Berikan dokumen itu ke tim pengembang Anda; petunjuk teknisnya ada di dokumen ECR di folder docs repo.
- Komputer kasir memakai **Chrome** atau **Edge**.

**Menyambungkan (sekali per komputer kasir):**
1. Colokkan kabel ECR dari EDC ke komputer kasir. Di EDC, aktifkan mode **ECR/integrasi kasir** (menu merchant/teknisi, tanyakan ke bank).
2. Di kasir buka **Perangkat › Mesin EDC**, lalu pilih **Tersambung kabel (ECR)**.
3. Ketuk **Hubungkan EDC** dan pilih port EDC di jendela yang muncul.
4. Pilih **Protokol EDC**, lalu atur **kecepatan (baud rate)** sesuai petunjuk bank (umumnya 9600 atau 115200) dan **batas tunggu** (default 2 menit).

**Cara pakai saat bayar:**
1. Pilih **EDC**, lalu tekan **Kirim Rp… ke EDC**. Nominal langsung muncul di mesin EDC.
2. Pelanggan menempel/mencelup kartu dan memasukkan PIN. Layar kasir menampilkan status dari EDC (misalnya *Masukkan PIN*).
3. Bila **disetujui**, transaksi lunas otomatis. Kode approval, RRN, TID, dan jenis kartu (hanya 4 digit terakhir nomor kartu) tercatat di transaksi dan struk.
4. Bila **ditolak**, muncul alasannya. Tekan **Coba kirim lagi ke EDC** atau pilih metode lain.

**Pengaman:**
- Selama EDC memproses, dialog bayar **tidak bisa ditutup**, supaya transaksi tidak hilang.
- Bila kartu sudah tertagih tetapi transaksi gagal disimpan (misalnya internet putus), tombol berubah menjadi **Simpan transaksi**, dan **kartu tidak ditagih lagi**. Bila transaksi memang tidak bisa dilanjutkan, lakukan **void** di mesin EDC, lalu tekan **Sudah di-void di mesin EDC**.
- Bila EDC tidak menjawab sampai batas waktu, **cek slip/layar EDC dulu**. Bila tertulis APPROVED, tekan **Isi manual** lalu ketik kode approval-nya. **Jangan tagih ulang.**
- Tombol **Isi manual** selalu tersedia. Bila kabel atau EDC bermasalah, kasir tetap bisa memakai cara 4a.
- Nomor kartu lengkap, PIN, dan CVV **tidak pernah** disimpan POS by lifistudio.

> **Latihan tanpa EDC sungguhan:** di server uji coba (simulator pembayaran aktif), pilih **Simulasi (latihan)** di Pengaturan EDC. Transaksi disetujui otomatis setelah beberapa detik; nominal berakhiran *13* selalu ditolak untuk latihan penolakan. Pilihan ini tidak muncul di server produksi.

## 5. Transfer bank

1. Pilih **Transfer** dan beri tahu pelanggan nomor rekening toko.
2. **Pastikan dana sudah masuk** (m-banking atau notifikasi bank) sebelum menyelesaikan transaksi.
3. Isi **Bank / catatan** (misalnya `BCA a.n. Sari`), lalu tekan **Konfirmasi Transfer diterima**.

## 6. Layar pelanggan (monitor kedua)

Seperti di Alfamart/Indomaret, pelanggan bisa melihat **daftar belanja, total, QR QRIS, dan kembalian** di layar yang menghadap ke mereka.

**Yang dibutuhkan:** satu komputer kasir dengan **dua monitor** (monitor kedua menghadap pelanggan), memakai Chrome atau Edge.

**Cara memasang:**
1. Di kasir buka **Perangkat › Buka layar pelanggan**. Jendela baru terbuka.
2. Geser jendela itu ke monitor kedua, lalu tekan **Layar penuh**.
3. Selesai. Layar pelanggan otomatis mengikuti kasir:
   - **Keranjang**: barang, jumlah, dan total, berubah setiap kali kasir menambah atau mengurangi barang.
   - **QRIS**: QR yang sama dengan di kasir tampil besar, lengkap dengan nominal dan sisa waktu. Pelanggan langsung scan dari tempatnya.
   - **Terima kasih**: total dan kembalian tunai, lalu kembali ke *Selamat datang*.

> Layar pelanggan harus dibuka **di browser dan komputer yang sama** dengan kasir. Tablet atau HP terpisah belum didukung. Data tidak dikirim ke internet, hanya antar-jendela di komputer itu.

## 7. Scanner barcode di kasir

Scanner dipakai untuk **memindai barcode produk** ke keranjang (dan di menu stok untuk transfer/opname).

| Jenis scanner | Cara menyambungkan |
|---|---|
| **USB** (kabel) | Colokkan saja. Scanner bekerja seperti keyboard, tidak perlu driver. Klik kolom **cari/scan** di kasir, lalu scan. |
| **Bluetooth / wireless 2.4 GHz** | Pasangkan seperti keyboard Bluetooth (atau colok dongle-nya), lalu pakai seperti scanner USB. |
| **Kamera HP/tablet** | Tekan tombol **Scan dengan kamera** di kolom scan, lalu arahkan ke barcode. Browser meminta izin kamera sekali. |

Pengaturan scanner yang disarankan (lihat buku manual scanner, biasanya dengan memindai barcode pengaturan):
- Mode **keyboard (HID)**, akhiran **Enter (CR)** setelah setiap scan.
- Bahasa keyboard **US**, agar angka dan huruf tidak tertukar.

Bila hasil scan tidak ditemukan, cek bahwa barcode/SKU produk sudah terisi di **Produk** (lihat [Panduan penggunaan](./PANDUAN-PENGGUNAAN.md)).

> **Memindai QR pembayaran dari aplikasi pelanggan** (pelanggan menunjukkan kode bayar GoPay/OVO/DANA/ShopeePay lalu kasir memindainya) **belum didukung**. Scanner yang Anda pindai ke QR pelanggan hanya akan mengetik teks ke kolom pencarian, dan tidak ada uang yang ditarik. Gunakan **QRIS dinamis** (bagian 3a) dan tampilkan QR-nya di **layar pelanggan** (bagian 6): hasilnya sama-sama otomatis lunas.

## 8. Yang belum tersedia

- **Memindai kode bayar dari aplikasi pelanggan (QRIS CPM)**: pelanggan menunjukkan kode bayar di GoPay/OVO/DANA/ShopeePay, lalu kasir memindainya. Fitur ini membutuhkan payment gateway yang mendukung *Customer Presented Mode* (Midtrans belum menyediakannya untuk umum). Sebagai gantinya, pakai QRIS dinamis di layar pelanggan.
- **Protokol EDC khusus bank** (BCA, Mandiri, BRI, BNI, …) untuk mode kabel: ditambahkan per bank setelah toko mendapat dokumen spesifikasi ECR dari bank. Sementara itu, pakai EDC manual (4a).
- **Layar pelanggan di tablet/HP terpisah**: saat ini harus monitor kedua di komputer kasir yang sama.

## 9. Masalah umum

| Gejala | Solusi |
|---|---|
| Tombol **Tampilkan QR** tidak ada, hanya kolom referensi | Payment gateway belum diatur (`PAYMENT_PROVIDER`). Pakai QRIS statis atau atur Midtrans (bagian 3a). |
| Pelanggan sudah bayar QRIS tapi layar tidak berubah | Cek internet kasir. Pastikan **Payment Notification URL** di Midtrans benar dan HTTPS. Tunggu sebentar dan cek menu **Transaksi** sebelum membuat QR baru, agar pelanggan tidak membayar dua kali. |
| QR kedaluwarsa | Tekan **Batalkan QR & pilih metode lain**, lalu tampilkan QR baru. |
| Nominal di slip EDC berbeda dengan layar | Batalkan (void) transaksi di mesin EDC sesuai prosedur bank, lalu ulangi dengan nominal yang benar. |
| Kasir offline (internet putus) | Tunai, EDC (bila mesin EDC memakai jaringan sendiri), dan transfer tetap bisa. QRIS dinamis butuh internet. |
| Scanner mengetik huruf aneh | Atur bahasa keyboard scanner ke **US** dan akhiran **Enter**. |
| **Tersambung kabel** abu-abu di Pengaturan EDC | Browser tidak mendukung port serial. Pakai Chrome/Edge di komputer (bukan HP/iPad). |
| *EDC tidak merespons* | EDC belum di menu utama, mode ECR belum aktif, kabel salah port, atau baud rate tidak cocok. Cek lalu **Hubungkan EDC** ulang. |
| *Port EDC tidak bisa dibuka* | Port sedang dipakai aplikasi lain (mis. aplikasi bawaan bank). Tutup aplikasi itu. |
| Layar pelanggan tetap *Menunggu layar kasir…* | Buka layar pelanggan dari menu **Perangkat** di kasir, di browser yang sama. Jangan pakai jendela penyamaran (incognito). |
