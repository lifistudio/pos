# Integrasi EDC (ECR) — untuk pengembang & vendor

Dokumen teknis. Panduan pengguna ada di [PANDUAN-PEMBAYARAN.md](./PANDUAN-PEMBAYARAN.md).

**ECR (Electronic Cash Register) integration** = kasir mengirim nominal ke mesin EDC lewat kabel, lalu EDC mengirim balik hasilnya (approved/declined, kode approval, RRN, dll.). POS by lifistudio menjalankannya **di browser** lewat **Web Serial** (Chrome/Edge desktop): EDC dengan kabel USB-serial / RS-232, atau USB yang tampil sebagai port COM.

## Arsitektur

| Lapisan | File | Isi |
|---|---|---|
| Framing (murni, teruji) | `src/lib/ecr-frame.ts` | `STX ‖ data ‖ ETX ‖ LRC`, LRC = XOR (nilai awal & cakupan ETX bisa diatur), `FrameParser` bertahap (noise, potongan acak, ACK/NAK, LRC salah) |
| Protokol (murni) | `src/lib/ecr-protocols.ts` | `EcrProtocol { sale(), parse(), cancel?() }` + registri `ECR_PROTOCOLS` |
| Transport & alur | `src/components/app/payment-terminal/terminal.ts` | Buka port, kirim (ulang ≤ 3× bila NAK/diam), ACK tiap paket, `progress` → teks di layar, batas waktu, batal, simulator |
| Pengaturan per perangkat | `terminal-settings.ts`, `terminal-sheet.tsx` | Mode `manual` (default) / `ecr` / `simulator`, protokol, baud, batas tunggu |
| Kasir | `src/app/(pos)/pos/payment-dialog.tsx` | Tombol **Kirim ke EDC**; hasil → `POST /sales` dengan `payments[].terminal` |
| Server | `routes/sales.ts`, `sale.service.ts`, kolom `sale_payments.terminal` (jsonb) | Validasi ketat: field dikenal saja (`.strict()`), karakter aman, **nomor kartu wajib tersamar** (`^[*X]{0,15}\d{4}$`); `simulator` ditolak bila simulator pembayaran tidak aktif (produksi) |

Pengaman yang wajib dipertahankan bila mengubah alur:
- Dialog bayar **terkunci** selama EDC memproses dan setelah kartu tertagih sampai transaksi tersimpan. Penyimpanan gagal → **Simpan transaksi** memakai hasil EDC yang sama (kunci idempotensi sama), **tidak** menagih ulang.
- Error "tidak pasti" (timeout/putus setelah EDC menerima permintaan) → kasir diminta cek slip, bukan tagih ulang.
- Nomor kartu lengkap, CVV, PIN, dan track data **tidak pernah** dikirim ke server atau disimpan (PCI DSS). `maskPan()` menyamarkan apa pun yang datang dari EDC.

## Menambah protokol bank

Spesifikasi ECR tiap bank (BCA, Mandiri, BRI, BNI, CIMB, dll.) **tidak publik**. Spesifikasi diberikan bank kepada merchant/mitra yang mengajukan integrasi ECR (biasanya lewat account officer merchant/acquiring), sering disertai EDC uji dan sertifikasi. Setelah dokumen didapat:

1. Tambahkan objek `EcrProtocol` di `src/lib/ecr-protocols.ts`: `frame` (nilai awal LRC, ETX ikut LRC atau tidak), `sale(amount, ref)` (format nominal sesuai spesifikasi, mis. 12 digit tanpa desimal), `parse(data)` (kode respons → `approved`/`declined`/`progress`), `cancel` bila ada.
2. Masukkan ke `ECR_PROTOCOLS`. Protokol otomatis muncul di **Pengaturan EDC**.
3. Tambahkan contoh paket asli dari dokumen bank ke `scripts/checks/ecr.check.ts` (permintaan yang dihasilkan harus sama byte-per-byte, jawaban contoh harus terurai benar).
4. Uji dengan EDC uji bank sebelum dipakai di toko. Jangan menebak format dari sumber tidak resmi.

Bila protokol bank tidak memakai framing STX/ETX/LRC (mis. TCP/IP di LAN atau JSON di EDC Android), pakai **jembatan** yang menerjemahkan ke POS ECR v1 di bawah. Browser tidak bisa membuka koneksi TCP mentah.

## Protokol terbuka: POS ECR v1

Untuk vendor EDC, aplikasi di EDC Android, atau jembatan (mis. aplikasi kecil yang meneruskan ke protokol bank). Dipilih di **Pengaturan EDC › Protokol: POS ECR v1**.

**Transport:** serial 8N1, baud sesuai pengaturan (default 9600). **Paket:** `STX(0x02) ‖ JSON UTF-8 ‖ ETX(0x03) ‖ LRC`, LRC = XOR semua byte JSON **dan** ETX, nilai awal `0x00`. Penerima membalas `ACK(0x06)` untuk paket valid dan `NAK(0x15)` untuk LRC salah. Kasir mengirim ulang permintaan maksimal 3× bila tidak ada ACK dalam 3 detik.

**Kasir → EDC**

```json
{ "v": 1, "cmd": "SALE", "amount": 155000, "currency": "IDR", "ref": "3f2a9c1b7d4e4a0f8b21" }
{ "v": 1, "cmd": "CANCEL", "ref": "3f2a9c1b7d4e4a0f8b21" }
```

`amount` dalam rupiah (bilangan bulat). `ref` adalah ID unik transaksi kasir (≤ 20 karakter); kirimkan lagi permintaan dengan `ref` yang sama untuk mendapatkan hasil yang sama (idempoten).

**EDC → Kasir** (boleh beberapa `PROGRESS` sebelum hasil akhir)

```json
{ "v": 1, "status": "PROGRESS", "message": "Masukkan PIN" }
{ "v": 1, "status": "APPROVED", "approvalCode": "645182", "rrn": "000123456789", "terminalId": "12345678", "merchantId": "000885000123", "traceNo": "000123", "batchNo": "000045", "cardType": "DEBIT BCA", "maskedPan": "************4242" }
{ "v": 1, "status": "DECLINED", "message": "Saldo tidak cukup" }
{ "v": 1, "status": "CANCELLED", "message": "Dibatalkan di EDC" }
```

Aturan:
- `APPROVED` **wajib** berisi `approvalCode`. Tanpa itu dianggap gagal.
- `maskedPan` hanya boleh berisi 4 digit terakhir. Nomor lengkap disamarkan di kasir dan ditolak server.
- Field teks dibatasi panjangnya (approval 20, RRN 20, TID 20, MID 30, trace/batch 12, cardType 40) dan hanya `huruf angka spasi . - /`.
- Versi selain `v: 1` diabaikan.

## Simulator

Mode **Simulasi** (hanya muncul bila simulator pembayaran aktif, `PAYMENT_PROVIDER=mock` di non-produksi): menyetujui setelah ±3 detik dengan data tiruan (`provider: "simulator"`). Nominal berakhiran `13` selalu ditolak, untuk menguji alur penolakan. Server menolak data `simulator` bila simulator pembayaran tidak aktif.

## Layar pelanggan

`/pos/display` adalah jendela kedua di browser yang sama (monitor menghadap pelanggan). Kasir mengirim keadaan lewat `BroadcastChannel("konten-pos-display")` (`src/app/(pos)/pos/customer-display.ts`): `cart`, `qris` (QR dinamis yang sama dengan di kasir), `paid`, `idle`. Tidak lewat server. Karena itu tablet atau perangkat terpisah tidak didukung; untuk itu dibutuhkan kanal realtime server (rencana).

## QRIS CPM (scan QR pelanggan)

Belum didukung. CPM butuh API acquirer/gateway yang mendukung *Customer Presented Mode* (pemindaian kode bayar dari aplikasi pelanggan). Midtrans hanya menyediakan QRIS MPM (QR dinamis dari toko), yang sudah dipakai. Bila kelak memakai gateway yang mendukung CPM, tambahkan provider di `src/server/payments/` dan input "scan kode bayar pelanggan" di dialog bayar.
