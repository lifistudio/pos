# Panduan Penggunaan POS by lifistudio

Panduan untuk pemilik, admin, kepala toko, staf stok, dan kasir. Bahasa sederhana, langkah demi langkah.
Semua panduan juga bisa dibuka di aplikasi lewat menu **Panduan**. Panduan lain: [Pembayaran: QRIS, EDC & layar pelanggan](./PANDUAN-PEMBAYARAN.md) · [Printer struk](./PANDUAN-PRINTER.md) · [AI agent (MCP)](./PANDUAN-MCP.md) · [Marketplace](./PANDUAN-MARKETPLACE.md) · [Cloudinary (gambar & media)](./PANDUAN-CLOUDINARY.md) · [Pengaturan server (.env)](./PANDUAN-ENV.md) · [Deploy ke server](./PANDUAN-DEPLOY.md) · [Development](./DEVELOPMENT.md).

---

## 1. Mengenal POS by lifistudio

POS by lifistudio adalah aplikasi kasir dan back-office untuk usaha dengan **satu atau banyak cabang/gudang**:
- **Kasir (POS)** di toko: scan barcode, member & poin, voucher, tunai/QRIS/EDC/transfer, struk otomatis ke printer thermal, mesin EDC tersambung kabel, layar pelanggan, retur, dan **tetap jalan saat internet putus**.
- **Back-office** di laptop/HP: produk, stok per cabang, transfer, stok opname, customer, voucher, order online, marketplace, laporan, pengguna & hak akses.
- **API & MCP** untuk integrasi dan asisten AI (lihat [Panduan AI agent (MCP)](./PANDUAN-MCP.md)).

Semua layar bisa dipakai di **laptop, tablet, dan HP**.

### Peran (role) bawaan
| Role | Untuk siapa | Garis besar akses |
|---|---|---|
| **Owner** | Pemilik | Semua, termasuk pengaturan & API key |
| **Admin** | Admin pusat | Produk, customer, voucher, laporan semua cabang, pengguna |
| **MD** | Tim stok | Produk & stok semua cabang: terima, transfer, opname, penyesuaian |
| **Kepala Toko** | Pimpinan cabang | Operasional cabangnya, menyetujui void/retur/diskon (PIN), laporan cabang |
| **Kasir** | Kasir | Layar kasir di cabangnya |
| **Online Admin** | Admin toko online | Order online & marketplace |
| **Viewer** | Investor/finance | Lihat dashboard & laporan |

Role bisa diubah atau dibuat baru di **Pengaturan › Role** (centang hak akses per menu). Setiap pengguna bisa dibatasi ke cabang tertentu.

---

## 2. Masuk & navigasi

1. Buka alamat aplikasi, masukkan **email & password** dari admin. Lupa password → minta Owner/Admin mengatur ulang di **Pengaturan › Pengguna**.
2. **Pemilih cabang** (kiri atas): pilih cabang aktif atau "Semua cabang" (bila Anda punya akses lebih dari satu). Data stok, kasir, dan laporan mengikuti pilihan ini.
3. Menu kiri hanya menampilkan menu yang boleh Anda buka. Di HP, menu ada di tombol ☰.
4. **Panduan** (menu kiri bawah) berisi semua panduan ini, termasuk cara menyambungkan printer, mesin EDC, dan aplikasi AI.
5. **Tema terang/gelap** dan **keluar** ada di bagian bawah menu.

### Dashboard
Halaman pertama setelah masuk (mengikuti cabang yang dipilih):
- **Penjualan**: omzet hari ini, jumlah transaksi, rata-rata transaksi, tren 14 hari, metode bayar, dan produk terlaris.
- **Stok**: produk aktif, total stok, nilai stok (harga jual & modal; modal hanya bagi yang berhak melihat HPP), stok per cabang, pergerakan masuk/keluar, dan daftar **Perlu restock** (di bawah stok minimum). Klik untuk membuka daftar stok yang menipis. Menu akun juga berisi **Atur PIN persetujuan** (untuk kepala toko/owner).

---

## 3. Produk

### 3.1 Menambah produk
**Produk › Tambah produk**
1. **Gambar produk** (opsional, disarankan): klik **Pilih gambar** → pilih foto. Foto otomatis diperkecil di perangkat Anda, lalu tampil di kasir dan daftar produk.
2. Isi **nama**, **kategori**, **merek**, **berat** (untuk ongkir online), **deskripsi**. **Merek** dipilih dari daftar: ketik sebagian nama — merek yang sudah ada (termasuk ejaan mirip) muncul lebih dulu. Bila belum ada, pilih **Tambah merek “…”**.
3. **Variasi**: nyalakan **Produk punya variasi** bila ada pilihan warna/ukuran/rasa (maks 3 jenis). Ketik nilai dipisah koma lalu Enter, misal `Hitam, Putih`. Semua kombinasi varian dibuat otomatis.
4. **Harga & stok** per varian: harga jual (wajib), harga coret, harga modal (HPP — hanya terlihat oleh yang berhak), stok awal per cabang.
5. **SKU & barcode**:
   - **Default: otomatis.** Saat disimpan, setiap varian mendapat SKU (contoh `KSEC-00042-HTM-L`) dan barcode **EAN-13** (awalan 20, khusus pemakaian internal toko) yang **dijamin tidak sama dengan produk lain**.
   - **Isi sendiri**: matikan **SKU & barcode otomatis**, lalu ketik kodenya (misal barcode pabrik di kemasan — bisa di-scan langsung ke kolom). Kode yang sudah dipakai produk lain langsung ditandai merah beserta nama produknya. Kolom yang dikosongkan tetap dibuat otomatis.
6. Pilih status **Aktif** (langsung bisa dijual) atau **Draf**, lalu **Simpan produk**.

**Aturan kode** (dicek di server, tidak bisa dilewati):
- SKU dan barcode **unik di seluruh katalog**, termasuk silang: barcode satu produk tidak boleh sama dengan SKU produk lain (karena keduanya bisa di-scan).
- SKU tidak membedakan huruf besar/kecil (`ab-1` = `AB-1`), disimpan huruf kapital; boleh huruf, angka, titik, `-`, `_` (2–64 karakter).
- Barcode 4–32 huruf/angka tanpa spasi. Barcode angka 8/12/13/14 digit (EAN/UPC) dicek **digit terakhirnya** untuk menangkap salah ketik.

### 3.2 Mengubah produk
Buka produk dari daftar:
- **Informasi produk › Ubah informasi**: nama, kategori, merek, berat, deskripsi.
- **Gambar**: **Ganti gambar** / **Hapus**.
- **Varian**: ikon pensil pada baris varian → ubah harga, status aktif, SKU, barcode. Tombol **Buat SKU otomatis** / **Buat barcode otomatis** mengganti dengan kode baru yang unik. Barcode boleh dikosongkan (produk tanpa barcode).
- **Aktifkan / Arsipkan**: produk arsip tidak tampil di kasir tetapi riwayat transaksinya tetap ada.

### 3.3 Cetak label barcode
Di halaman produk klik **Cetak label**:
1. Pilih **ukuran label** (33×15, 38×25, 50×25, 58×40 mm) dan **kertas**: printer label gulungan (satu label per halaman) atau kertas stiker A4.
2. Pilih isi label: nama produk, harga, atau pakai SKU sebagai barcode (untuk produk tanpa barcode).
3. Isi **jumlah label per varian** (default 1), periksa pratinjau, lalu **Cetak**.
4. Di dialog cetak browser: pilih printer label, ukuran kertas sama dengan label, skala 100%, matikan header/footer.
Barcode angka valid dicetak sebagai EAN-13/UPC/EAN-8; kode lain (SKU huruf) sebagai Code 128 — keduanya bisa dibaca scanner umum.

### 3.4 Kategori
**Produk › Kategori**: buat kategori dan sub-kategori. Kategori dipakai untuk filter di kasir dan laporan.

### 3.5 Merek
**Produk › Merek**: daftar semua merek beserta jumlah produknya. Satu merek bisa dipakai di kategori mana pun (misal *Samsung* untuk HP dan Elektronik).
- Nama yang hanya beda huruf besar/kecil, spasi, atau tanda baca dianggap **sama** dan tidak bisa dibuat dua kali ("Coca-Cola" = "coca cola").
- Saat menambah, merek dengan nama mirip ditampilkan agar tidak terjadi salah ketik.
- Sudah terlanjur ganda/typo? Pilih ikon **Gabungkan** pada merek yang salah → pilih merek yang benar: semua produknya dipindah, merek yang salah dihapus.
- Merek yang masih dipakai produk tidak bisa dihapus (gabungkan dulu).
- Klik jumlah produk untuk melihat daftar produk merek itu.

**Nama variasi** (Warna, Ukuran, …) juga disarankan dari yang sudah dipakai agar seragam; "WARNA" otomatis disimpan sebagai "Warna" bila itu ejaan yang sudah ada.

---

## 4. Stok

**Stok** menampilkan stok per cabang (Habis = merah, Menipis = kuning).
- **Terima / sesuaikan stok**: scan barcode (scanner atau kamera HP) atau cari produk, isi jumlah, alasan (misal "Barang masuk dari supplier", "Rusak"). Semua perubahan tercatat di **Kartu stok**.
- **Kartu stok (pergerakan)**: riwayat setiap perubahan stok: siapa, kapan, alasan, sebelum/sesudah.
- **Transfer stok** (antarcabang): buat transfer → scan barang yang dikirim → kirim. Cabang tujuan **scan saat menerima**; selisih (kurang/lebih) tercatat otomatis.
- **Stok opname** (hitung fisik): buat sesi opname per cabang → scan/hitung barang → **posting** untuk menyesuaikan stok sistem dengan hasil hitung. Selisih tercatat sebagai pergerakan "Stok opname".

Stok tidak pernah bisa minus. Barang yang dipesan online tetapi belum dibayar **di-reserve** (tidak bisa dijual di kasir).

---

## 5. Kasir (POS)

Buka menu **Kasir**. Layar kasir tampil penuh tanpa menu samping.

### 5.1 Buka shift
Isi **kas awal** (uang di laci) lalu **Buka shift**. Satu kasir punya satu shift aktif per cabang.

### 5.2 Menambah barang ke keranjang
- **Scan barcode** dengan scanner USB/Bluetooth (kursor otomatis di kolom scan; tekan **F2** untuk kembali ke kolom scan). Barcode yang cocok persis langsung masuk keranjang.
- Atau ketik nama/SKU, lalu klik produknya. Filter **kategori** ada di bawah kolom scan.

### 5.3 Mengatur tampilan katalog
Tombol **Tampilan** (ikon kotak/daftar di samping kolom scan):
- **Grid (kotak)**: pilih **Otomatis, 3, 4, 5, atau 6 kolom**. Di HP selalu 2 kolom agar nama & harga tetap terbaca; jumlah penuh berlaku di layar lebar.
- **Daftar (per baris)**: satu produk per baris dengan SKU, stok, dan harga — cocok untuk katalog besar.
- **Tampilkan gambar**: nyalakan agar foto produk tampil (menarik saat layar diperlihatkan ke pelanggan); matikan untuk katalog lebih padat.
Pilihan disimpan di perangkat itu saja (tiap mesin kasir bisa berbeda).

### 5.4 Customer, member, voucher, poin
- **Customer**: cari dengan nomor HP atau daftarkan cepat. Member mendapat harga/diskon sesuai tier dan mengumpulkan poin.
- **Voucher**: ketik kode voucher; bila tidak memenuhi syarat, alasannya ditampilkan.
- **Tukar poin**: gunakan poin member sebagai potongan sesuai kebijakan di **Pengaturan › Kebijakan**.
- **Diskon manual**: bila Anda tidak berhak memberi diskon manual, sistem meminta **PIN kepala toko**.

### 5.5 Pembayaran
Tekan **Bayar** (atau **F8**) → pilih metode:
- **Tunai**: ketik nominal atau tombol nominal cepat; kembalian ditampilkan besar.
- **QRIS**: dengan payment gateway aktif, tekan **Tampilkan QR** — pelanggan scan, transaksi **otomatis lunas** saat pembayaran masuk. Tanpa gateway: QRIS statis dengan nomor referensi.
- **EDC**: cara bawaan, kasir mengetik kode approval dari slip EDC. Bila mesin EDC **tersambung kabel**, tekan **Kirim ke EDC** dan hasilnya tercatat otomatis.
- **Transfer**: pastikan dana masuk, isi bank/catatan.
- Langkah lengkap QRIS, mesin EDC, layar pelanggan, dan scanner ada di [Panduan pembayaran](./PANDUAN-PEMBAYARAN.md).
- Satu transaksi dibayar dengan satu metode (pembayaran terpisah/split belum tersedia).
Setelah lunas: cetak **struk** 58/80 mm (atau **PDF**), atau lanjut transaksi berikutnya. Struk bisa **tercetak otomatis** ke printer thermal (termasuk printer mini 58 mm Bluetooth/USB). Atur lewat **Perangkat › Printer struk** (lihat §5.9).

### 5.6 Void & retur
- **Void** (membatalkan transaksi hari itu) dan **retur** (barang dikembalikan) membutuhkan hak akses atau **PIN kepala toko**. Pilih alasan, kondisi barang (rusak tidak kembali ke stok), dan metode pengembalian uang.
- Riwayat retur: **Transaksi › Retur**.

### 5.7 Saat internet putus
- Kasir **tetap bisa berjualan** memakai katalog & harga yang terakhir diunduh (berlaku 48 jam). Penanda **Offline** dan jumlah antrean tampil di bagian atas.
- Transaksi offline disimpan aman di perangkat dan **otomatis tersinkron** saat internet kembali. Bila stok ternyata kurang, transaksi tetap tercatat dan selisihnya ditandai untuk ditinjau.
- Halaman kasir bisa dibuka ulang tanpa internet (setelah pernah dibuka online sekali di perangkat itu).
- QRIS dinamis, voucher baru, dan pendaftaran member butuh koneksi.
- Jangan **keluar akun** saat masih ada antrean offline (sistem akan menolak).

### 5.8 Tutup shift
**Tutup shift** → hitung uang di laci → isi **kas dihitung**. Sistem menghitung **kas seharusnya** (kas awal + tunai masuk − refund tunai) dan **selisih**. Tambahkan catatan bila ada selisih.


### 5.9 Perangkat kasir: printer, mesin EDC, layar pelanggan
Ketuk **Perangkat** (ikon monitor, kanan atas layar kasir). Semua pengaturan berlaku **untuk perangkat kasir itu saja**, sehingga tiap meja kasir bisa memakai alat berbeda.

| Menu | Fungsi | Panduan |
|---|---|---|
| **Printer struk** | Sambungkan printer thermal (Bluetooth, USB, serial, LAN) atau PDF; cetak otomatis setelah bayar, jumlah salinan, potong kertas, buka laci kas, **Cetak tes** | [Panduan printer struk](./PANDUAN-PRINTER.md) |
| **Mesin EDC** | Manual (bawaan, semua bank), tersambung kabel (ECR: nominal dikirim dan hasil terbaca otomatis), atau simulasi untuk latihan | [Panduan pembayaran §4](./PANDUAN-PEMBAYARAN.md) |
| **Buka layar pelanggan** | Jendela untuk monitor kedua yang menghadap pelanggan: belanjaan, total, QRIS, kembalian | [Panduan pembayaran §6](./PANDUAN-PEMBAYARAN.md) |

---

## 6. Transaksi
**Transaksi** menampilkan semua penjualan (filter cabang, tanggal, status, kanal). Klik transaksi untuk rincian, cetak ulang struk, void, atau retur (sesuai hak akses).

---

## 7. Customer & member
- **Customer**: daftar pelanggan, riwayat belanja, poin. Nomor HP unik per customer.
- **Tier member**: atur nama tier, syarat total belanja, diskon otomatis (%), dan poin per Rp10.000.
- Data pribadi customer dilindungi: hanya peran berhak yang bisa melihat/mengekspor, dan nomor HP disamarkan untuk asisten AI.

---

## 8. Voucher
**Voucher › Tambah voucher**: kode, jenis potongan (nominal/persen + maksimal), minimum belanja, target (semua produk/kategori/produk/varian/customer/tier/cabang), periode, kuota total & per customer. Halaman voucher menampilkan **performa**: dipakai berapa kali, total potongan, omzet yang dihasilkan, sisa kuota.

---

## 9. Order online
Untuk pesanan dari website, WhatsApp, Instagram, atau marketplace.
1. **Order online › Buat order**: pilih customer, barang (stok langsung **di-reserve**), ongkir, alamat.
2. Pembayaran: **QRIS dinamis** (link/QR untuk pelanggan, lunas otomatis) atau tandai lunas manual.
3. Proses: **Kemas → Kirim** (pilih kurir dari daftar — JNE, J&T, SiCepat, dll. — atau ketik sendiri, lalu isi resi) **→ Selesai**. Ejaan kurir dirapikan otomatis ("jnt ez" → "J&T Express EZ"). Order belum dibayar sampai batas waktu dibatalkan otomatis dan reservasi stok dilepas.
4. Order dari marketplace masuk otomatis — lihat [PANDUAN-MARKETPLACE.md](./PANDUAN-MARKETPLACE.md).

---

## 10. Laporan
**Laporan** (filter periode & cabang, semua bisa **Export CSV** untuk Excel):
| Tab | Isi |
|---|---|
| Penjualan | Per hari, cabang, kasir, kanal, kategori, produk, metode bayar; penjualan bersih setelah retur; laba kotor (bila boleh melihat HPP) |
| Retur | Per alasan, produk, pemroses, cabang; unit rusak |
| Stok | Valuasi persediaan (nilai jual & modal), umur stok, barang lambat laku |
| Pergerakan | Mutasi per jenis, atau saldo awal–masuk–keluar–terjual–saldo akhir & perputaran |
| Shift kasir | Kas seharusnya vs dihitung & selisih, per shift atau per kasir |

---

## 11. Pengaturan
| Menu | Fungsi |
|---|---|
| Cabang | Tambah/ubah cabang & gudang (kode, alamat, zona waktu, pajak) |
| Pengguna | Tambah pengguna (dengan password awal), atur role & cabang yang boleh diakses, nonaktifkan, atur ulang password |
| Role | Matriks hak akses per role |
| Kebijakan | Aturan tukar poin & retur |
| Marketplace | Hubungkan toko Shopee / TikTok Shop & Tokopedia, pemetaan produk, log sinkron |
| API key & MCP | Kunci akses untuk integrasi & asisten AI (ditampilkan sekali, bisa dicabut), panduan koneksi per aplikasi AI, dan **Aplikasi terhubung** (aplikasi AI yang login lewat OAuth, bisa diputus) |
| Audit log | Siapa mengubah apa dan kapan (termasuk lewat API key dan aplikasi AI) |

**Dokumentasi API** (menu kiri, bagi yang berhak) berisi daftar lengkap endpoint API untuk pengembang/integrasi, bisa dicoba langsung dengan sesi login.

### PIN persetujuan
Kepala toko/owner mengatur PIN di **menu akun › Atur PIN persetujuan**. Saat kasir tanpa hak melakukan void, retur, atau diskon manual, atasan memasukkan PIN di perangkat kasir. Izin hanya berlaku sekali selama 10 menit; 5× PIN salah dalam 10 menit mengunci sementara.

---

## 12. Asisten AI (MCP)
Owner bisa menghubungkan Claude/ChatGPT/agent lain ke data toko (hanya membaca), lalu bertanya misalnya "Omzet minggu ini di Bandung?", "Barang apa yang 90 hari tidak laku?", "Kasir mana yang paling sering kurang kas?". Claude (web/Desktop) dan ChatGPT cukup diberi URL MCP lalu **login dan klik Izinkan**; aplikasi lain memakai API key. Caranya di [Panduan AI agent (MCP)](./PANDUAN-MCP.md). Setiap pertanyaan AI tercatat di audit log, mengikuti hak akses akun, dan **tidak bisa mengubah data**.

---

## 13. Pengaturan server
Database, kunci login, QRIS Midtrans, Cloudinary, dan marketplace diatur lewat **variabel lingkungan (.env)** oleh admin teknis. Daftar lengkap dan cara mendapatkan tiap nilai ada di [Panduan pengaturan server (.env)](./PANDUAN-ENV.md).

---

## 14. Tanya-jawab
**Barcode produk pabrik sudah ada, apa harus pakai barcode otomatis?** Tidak. Matikan "SKU & barcode otomatis" lalu scan barcode pabrik ke kolom Barcode.

**Bagaimana mencetak label barcode untuk kode otomatis?** Buka produk › **Cetak label** (lihat §3.3). Barcode otomatis berformat EAN-13 standar.

**Gambar produk tidak muncul saat offline?** Gambar yang pernah tampil saat online disimpan di perangkat; produk yang belum pernah tampil akan memakai inisial nama sampai online kembali.

**Kasir salah memasukkan kas awal?** Tutup shift dengan catatan, lalu buka shift baru. Riwayat shift tercatat di laporan Shift kasir.

**Struk tidak keluar otomatis setelah bayar?** Buka **Perangkat › Printer struk**: pastikan **Cetak otomatis setelah bayar** menyala, printer sudah **terhubung**, lalu coba **Cetak tes**. Detailnya di [Panduan printer struk](./PANDUAN-PRINTER.md).

**Mesin EDC tidak menerima nominal dari kasir?** Mode kabel butuh EDC yang mendukung ECR dan protokolnya. Sementara itu pakai **Isi manual** (ketik kode approval). Lihat [Panduan pembayaran §4](./PANDUAN-PEMBAYARAN.md).

**Data aman bila laptop kasir rusak?** Data ada di server. Hanya transaksi offline yang belum tersinkron yang tersimpan di perangkat — pastikan antrean kosong sebelum mengganti perangkat.

## Ganti password

Klik nama Anda di kiri bawah › **Ganti password**. Sesi di perangkat lain otomatis keluar. Lupa password: minta Owner atau admin mengaturnya ulang di **Pengaturan › Pengguna**; akun Owner hanya bisa diatur oleh Owner lain, jadi sebaiknya punya dua akun Owner.

Setelah 5 kali salah password, akun dikunci 15 menit lalu terbuka sendiri.
