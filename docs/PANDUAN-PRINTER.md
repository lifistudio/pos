# Panduan Printer Struk

POS by lifistudio bisa mencetak struk ke **hampir semua printer struk** — thermal USB, Bluetooth, serial/COM, printer LAN/Wi-Fi, sampai printer kantor biasa — atau menyimpannya sebagai **PDF**. Struk juga bisa **tercetak otomatis** begitu transaksi lunas.

> Pengaturan printer disimpan **per perangkat** (di browser komputer/tablet kasir itu), bukan per akun. Tiap mesin kasir bisa memakai printer berbeda. Bila browser dibersihkan (hapus data situs), atur ulang printernya.

---

## 1. Mulai cepat: printer thermal mini (58 mm) agar struk keluar otomatis

Printer struk kecil yang banyak dijual di marketplace (58 mm, Bluetooth dan/atau USB, sering disebut *printer thermal mini*, *printer kasir portable*, atau *printer nota*) bisa langsung dipakai. Struknya bisa **otomatis keluar** begitu transaksi lunas. Pilih baris yang sesuai perangkat kasir Anda:

| Perangkat kasir | Sambungan printer | Cara cetak di POS by lifistudio | Otomatis tanpa dialog? |
|---|---|---|---|
| **HP/tablet Android** (Chrome) | Bluetooth **BLE** (di deskripsi produk: *BLE*, *Bluetooth 4.0*, atau *dual mode*) | **Bluetooth** | Ya |
| **HP/tablet Android** (Chrome) | Kabel USB (pakai OTG) | **USB langsung** | Ya |
| **HP/tablet Android** | Bluetooth biasa saja (tanpa BLE) | **Printer terpasang di perangkat** + aplikasi layanan cetak (lihat 1c) | Hampir: ketuk Cetak sekali |
| **Laptop/PC Windows** (Chrome/Edge) | Bluetooth | **Serial / COM** | Ya |
| **Laptop/PC Windows** | Kabel USB | **Printer terpasang di perangkat** + mode kiosk Chrome (lihat bagian 5) | Ya |
| **Mac / Chromebook / Linux** (Chrome/Edge) | Kabel USB | **USB langsung** | Ya |
| **iPhone / iPad** | Apa saja | **Unduh PDF**, atau printer AirPrint lewat **Printer terpasang di perangkat** | Tidak (Safari tidak mendukung USB/Bluetooth langsung) |

> **Tips membeli printer:** pilih yang mendukung **ESC/POS** (hampir semua printer thermal mendukungnya), lebar **58 mm** atau **80 mm**, dan bila kasirnya HP Android, pilih yang **BLE/dual mode** atau ada **port USB**.

### 1a. Langkah umum (semua printer)

1. Isi kertas thermal (sisi licin menghadap kepala cetak) dan nyalakan printer.
2. Buka **Kasir**, ketuk **Perangkat** (ikon monitor di kanan atas), lalu **Printer struk**.
3. Pilih **cara cetak** sesuai tabel di atas, lalu ketuk **Hubungkan printer** (untuk USB/Serial/Bluetooth) dan pilih printer Anda di jendela yang muncul.
4. Pilih **lebar kertas** (58 mm untuk printer mini), nyalakan **Cetak otomatis setelah bayar**, dan nyalakan **Potong kertas** bila printer punya pemotong.
5. Ketuk **Cetak tes**. Bila baris rapi dan tidak terpotong, ketuk **Selesai**.
6. Coba satu transaksi: setelah **Bayar** lunas, struk langsung keluar. Tombol **Cetak ulang** dan **PDF** tetap tersedia di layar *Transaksi berhasil*.

### 1b. Printer Bluetooth di HP Android (cara tercepat)

1. Nyalakan **Bluetooth** dan **Lokasi** di HP. Tidak perlu memasangkan (pair) printer di pengaturan Android.
2. Buka POS by lifistudio di **Chrome**, lalu **Kasir › Perangkat › Printer struk › Bluetooth › Hubungkan printer**.
3. Pilih nama printer (contoh: *MPT-II*, *RPP02N*, *PT-210*, *BlueTooth Printer*) lalu **Sambungkan**.
4. Nyalakan **Cetak otomatis setelah bayar**, lalu **Cetak tes**.

> Bila nama printer tidak muncul, kemungkinan printer hanya mendukung Bluetooth biasa (bukan BLE). Pakai cara 1c, atau sambungkan lewat kabel USB OTG dengan cara **USB langsung**.
>
> Setelah Chrome ditutup, Bluetooth kadang perlu **Hubungkan printer** lagi. Ini pembatasan keamanan browser.

### 1c. Printer Bluetooth biasa (tanpa BLE) di Android

1. Pasangkan (pair) printer di **Pengaturan Android › Bluetooth**.
2. Pasang aplikasi **layanan cetak** (*print service*) dari pembuat printer, atau aplikasi layanan cetak ESC/POS yang tepercaya dari Play Store, lalu aktifkan di **Pengaturan › Pencetakan**.
3. Di POS by lifistudio pilih **Printer terpasang di perangkat**. Saat mencetak, pilih printer tersebut di dialog Android. Android mengingat pilihan terakhir.

### 1d. Printer Bluetooth di laptop Windows

1. Pasangkan printer di **Pengaturan Windows › Bluetooth & perangkat › Tambah perangkat** (PIN biasanya `0000` atau `1234`).
2. Di POS by lifistudio pilih **Serial / COM › Hubungkan printer**, lalu pilih port Bluetooth printer (contoh: *Standard Serial over Bluetooth link (COM5)*).
3. Kecepatan (baud rate) biarkan **9600**. Bila hasil cetak berupa huruf acak, coba **115200**.
4. Nyalakan **Cetak otomatis setelah bayar**, lalu **Cetak tes**.

### 1e. Printer USB di laptop Windows

Windows biasanya memasang driver printer sendiri, jadi cara termudah:
1. Pasang driver dari pembuat printer (biasanya ada di CD atau situs penjual) sampai printer muncul di **Pengaturan › Printer & pemindai**. Atur ukuran kertas **58 mm** di properti printer.
2. Jadikan printer struk sebagai **printer default**.
3. Di POS by lifistudio pilih **Printer terpasang di perangkat**, nyalakan **Cetak otomatis setelah bayar**, lalu **Cetak tes**. Di dialog cetak, pilih printer struk, margin **tidak ada**, dan matikan **header & footer**.
4. Agar tanpa dialog sama sekali, buka kasir lewat shortcut Chrome **mode kiosk** (bagian 5).

---

## 2. Membuka pengaturan printer

1. Buka **Kasir**.
2. Ketuk **Perangkat** (ikon monitor di kanan atas layar kasir), lalu **Printer struk**.
3. Pilih **cara cetak**, **lebar kertas**, **jumlah salinan**, lalu nyalakan **Cetak otomatis setelah bayar** bila diinginkan.
4. Ketuk **Cetak tes**. Bila baris struk rapi dan tidak terpotong, printer siap dipakai.

## 3. Pilih cara cetak

| Cara cetak | Cocok untuk | Browser | Dialog cetak? |
|---|---|---|---|
| **Printer terpasang di perangkat** (disarankan) | Semua printer yang sudah terpasang di Windows/macOS/Android: thermal USB dengan driver pabrik, printer LAN/Wi-Fi, printer kantor | Semua browser | Ya (bisa dihilangkan, lihat bagian 5) |
| **USB langsung** | Printer thermal USB tanpa driver (umum di Android, macOS, Linux, Chromebook) | Chrome / Edge | Tidak |
| **Serial / COM** | Printer serial (RS-232), USB-serial, atau Bluetooth yang terpasang sebagai port COM di Windows | Chrome / Edge komputer | Tidak |
| **Bluetooth** | Printer thermal portable 58/80 mm (BLE) | Chrome Android / komputer | Tidak |
| **Unduh PDF** | Kirim struk lewat WhatsApp/email, arsip, atau cetak nanti | Semua browser | Tidak |

Pilihan yang tidak didukung browser yang sedang dipakai otomatis abu-abu. Struk selalu memakai perintah **ESC/POS** standar, yang dipakai hampir semua merek printer struk: Epson, Xprinter, Zjiang, Rongta, HPRT, Panda, Bixolon, Sunmi, Goojprt, MTP, dan printer generik 58/80 mm.

### Lebar kertas

- **58 mm**: 32 karakter per baris. Printer kecil atau portable.
- **80 mm**: 48 karakter per baris. Printer kasir meja.

Pilih sesuai gulungan kertas. Bila teks terpotong atau terlalu sempit, ubah lebar kertas lalu **Cetak tes** lagi.

## 4. Menghubungkan printer

### Printer terpasang di perangkat (USB berdriver, LAN/Wi-Fi)

1. Pasang printer di sistem operasi seperti biasa (driver dari pabrik, atau **Tambah printer** di Windows/macOS).
2. Pastikan ukuran kertas di driver sesuai, misalnya **58 mm × Receipt** atau **80 mm × 3276 mm**.
3. Di POS by lifistudio pilih **Printer terpasang di perangkat**, lalu **Cetak tes**. Pada dialog cetak, pilih printer struk, set **margin: tidak ada**, dan **matikan header & footer**. Chrome mengingat pilihan ini.

Printer **LAN/Wi-Fi** juga lewat cara ini: tambahkan printer jaringan di sistem operasi (berdasarkan IP printer), lalu cetak dari dialog.

### USB langsung

1. Colokkan printer dan nyalakan.
2. Pilih **USB langsung**, lalu **Hubungkan printer**. Pilih printer dari daftar yang muncul, lalu **Sambungkan**.
3. **Cetak tes**.

> **Windows:** bila printer sudah memakai driver pabrik, Windows "mengunci" printer sehingga USB langsung gagal (muncul pesan *Gagal mengirim ke printer USB*). Ada dua pilihan:
> - **Paling mudah:** pakai cara **Printer terpasang di perangkat**.
> - **Tanpa dialog:** ganti driver printer tersebut ke **WinUSB** memakai aplikasi **Zadig** (zadig.akeo.ie). Setelah itu printer hanya bisa dipakai lewat browser, tidak lewat aplikasi lain. Lakukan hanya bila paham risikonya.
>
> **Android/macOS/Linux/Chromebook** umumnya langsung bisa tanpa langkah tambahan.

### Serial / COM

1. Untuk Bluetooth Classic di Windows: pasangkan (pair) printer di **Pengaturan › Bluetooth** dulu. Windows membuat port **COM** keluar.
2. Pilih **Serial / COM**, lalu **Hubungkan printer**, dan pilih port printernya.
3. Atur **kecepatan (baud rate)** sesuai printer. Paling umum **9600**; sebagian memakai 19200 atau 115200 (lihat buku manual atau cetakan *self-test* printer).
4. **Cetak tes**. Bila keluar huruf acak, baud rate belum cocok.

### Bluetooth (printer portable)

1. Nyalakan printer dan Bluetooth perangkat. **Tidak perlu** pair di pengaturan Android lebih dulu.
2. Pilih **Bluetooth**, lalu **Hubungkan printer**, dan pilih nama printer (misalnya *MPT-II*, *RPP02N*, *BlueTooth Printer*).
3. **Cetak tes**.

> Setelah browser ditutup, Bluetooth kadang perlu **Hubungkan printer** lagi (pembatasan keamanan browser). Bila printer hanya mendukung Bluetooth Classic (bukan BLE), pakai cara **Serial / COM** di komputer, atau aplikasi driver printer di Android dengan cara **Printer terpasang di perangkat**.

## 5. Cetak otomatis tanpa dialog

- **USB langsung / Serial / Bluetooth:** struk langsung keluar begitu transaksi lunas bila **Cetak otomatis setelah bayar** menyala.
- **Printer terpasang di perangkat:** browser selalu menampilkan dialog cetak. Agar langsung tercetak:
  1. Jadikan printer struk sebagai **printer default** di Windows.
  2. Buat shortcut Chrome khusus kasir dengan tambahan `--kiosk-printing`, misalnya target:
     `"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk-printing --app=https://alamat-pos-anda/pos`
  3. Tutup semua jendela Chrome, lalu buka lewat shortcut itu. Struk dicetak langsung ke printer default.
- **Unduh PDF:** file PDF langsung terunduh.

## 6. Laci kas & pemotong kertas

- **Potong kertas otomatis**: untuk printer dengan auto-cutter. Printer tanpa pemotong mengabaikan perintah ini.
- **Buka laci kas**: untuk laci yang dicolok ke port *cash drawer* printer (RJ-11). Laci terbuka saat **transaksi tunai**, tidak saat cetak ulang.
- Keduanya hanya berlaku untuk **USB langsung / Serial / Bluetooth**. Pada cara **Printer terpasang di perangkat**, atur laci dan pemotong di pengaturan driver printer.

## 7. Mencetak & cetak ulang

- **Setelah bayar**: tombol **Cetak struk** (atau **Cetak ulang** bila cetak otomatis menyala) dan **PDF** di layar *Transaksi berhasil*.
- **Transaksi offline**: **Cetak struk sementara** memakai printer yang sama. Nomor resmi terbit saat sinkron.
- **Di shift berjalan**: Kasir › **Transaksi shift** › **Struk**.
- **Transaksi lama**: menu **Transaksi** › buka transaksi › **Struk**. Halaman struk punya tombol **Cetak** dan **Unduh PDF**.

## 8. Mengubah isi struk

Kepala/alamat dan catatan bawah struk diatur per cabang di **Pengaturan › Cabang** (kolom *Kepala struk* & *Kaki struk*). Kosongkan header untuk memakai alamat dan telepon cabang.

## 9. Masalah umum

| Gejala | Solusi |
|---|---|
| Pilihan USB/Serial/Bluetooth abu-abu | Browser tidak mendukung. Pakai **Chrome** atau **Edge** (bukan Safari/Firefox). iPhone/iPad: pakai **Printer terpasang di perangkat** (AirPrint) atau **PDF**. |
| *Printer USB tidak ditemukan* | Cek kabel & daya, lalu **Hubungkan printer** lagi. |
| *Gagal mengirim ke printer USB* (Windows) | Driver pabrik mengunci printer. Lihat catatan Windows di bagian 4. |
| Huruf acak / simbol aneh | Serial: baud rate salah. Lainnya: printer bukan ESC/POS. Pakai **Printer terpasang di perangkat**. |
| Struk terpotong di kanan atau terlalu kecil | Lebar kertas salah (58 vs 80 mm). Di dialog cetak: margin **tidak ada**, skala **100%**. |
| Ada tanggal/URL di atas & bawah struk | Di dialog cetak matikan **Header dan footer**. |
| Kertas keluar kosong | Gulungan thermal terbalik (sisi licin harus menghadap kepala cetak). |
| Bluetooth tidak muncul di daftar | Nyalakan lokasi & Bluetooth (Android), dekatkan printer, pastikan tidak sedang tersambung ke HP lain. |
