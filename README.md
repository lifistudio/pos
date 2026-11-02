<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/brand/logo-lockup-light.svg">
    <img src="public/brand/logo-lockup.svg" alt="POS by lifistudio" width="300">
  </picture>
</p>

<h1 align="center">POS by lifistudio</h1>

<p align="center">
  Aplikasi kasir &amp; back-office open source untuk toko multi-cabang di Indonesia.<br>
  Tetap jualan saat internet putus, stok selalu akurat, tersambung ke marketplace.
</p>

<p align="center">
  <a href="https://lifistudio.com">Website</a> ·
  <a href="https://instagram.com/lifistudio">Instagram</a> ·
  <a href="https://tiktok.com/@lifistudio">TikTok</a>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/lisensi-MIT-informational" alt="Lisensi MIT"></a>
</p>

---

## Untuk apa?

POS by lifistudio menyatukan semua yang dibutuhkan toko dalam satu aplikasi: kasir, stok per cabang, member & voucher, order online, marketplace, dan laporan. Satu sumber data untuk semua kanal, jadi stok di toko dan di marketplace tidak lagi berbeda, dan pemilik bisa membaca performa tanpa rekap manual.

Cocok untuk toko retail apa pun, dari satu kasir sampai banyak cabang dan gudang. Bisa dipakai di laptop, tablet, maupun HP.

## Pasang dengan satu perintah

**Linux & macOS**

```bash
curl -fsSL https://raw.githubusercontent.com/NurlChl/pos/main/install.sh | bash
```

**Windows** (PowerShell)

```powershell
irm https://raw.githubusercontent.com/NurlChl/pos/main/install.ps1 | iex
```

Installer mengunduh kode, membuat kunci rahasia, menanyakan email & password Owner, lalu menjalankan aplikasi di `http://localhost:3000`. Docker dipakai bila tersedia. Tanpa Docker, installer memakai Node.js dengan PostgreSQL bawaan. Jalankan perintah yang sama lagi untuk memperbarui.

| Mau pasang di | Lihat |
|---|---|
| Laptop/PC Windows, macOS, Linux | [Instalasi lokal](docs/INSTALL.md#instalasi-lokal) |
| VPS dengan domain & HTTPS | [Instalasi VPS](docs/INSTALL.md#instalasi-di-vps) |
| Dokploy | [Instalasi Dokploy](docs/INSTALL.md#instalasi-di-dokploy) |
| Pasang manual, langkah demi langkah | [Instalasi manual](docs/INSTALL.md#instalasi-manual) |

## Fitur

| Area | Isi |
|---|---|
| **Kasir** | Scan barcode, katalog gambar, member, voucher, tukar poin, diskon manual dengan PIN atasan, void, retur, shift & selisih kas, struk thermal, layar pelanggan |
| **Mode offline** | Tetap berjualan saat internet putus, transaksi tersinkron otomatis tanpa ganda |
| **Pembayaran** | Tunai, QRIS dinamis (Midtrans, Xendit, DOKU), QRIS statis, mesin EDC manual atau kabel, transfer |
| **Produk** | Variasi, SKU & barcode EAN-13 otomatis, merek, kategori, gambar, cetak label barcode |
| **Stok** | Per cabang dengan kartu stok, penerimaan, transfer antar cabang, stok opname via scan, stok tidak bisa minus |
| **Pelanggan** | Customer, tier member, poin, voucher dengan target & kuota, performa voucher |
| **Order online** | WhatsApp, Instagram, website, reservasi stok, status sampai selesai |
| **Marketplace** | Shopee & TikTok Shop/Tokopedia: order masuk otomatis, stok tersinkron dalam hitungan detik |
| **Laporan** | Penjualan per hari/cabang/kasir/produk, retur, valuasi & umur stok, shift, ekspor CSV |
| **Keamanan** | Role & hak akses per cabang, PIN persetujuan, audit log, penguncian login, lupa password via email |
| **Integrasi** | REST API terdokumentasi, API key, MCP server untuk asisten AI (Claude, ChatGPT, Cursor) |

Integrasi Shopee, TikTok Shop, Xendit, dan DOKU sudah lulus uji otomatis tetapi belum diuji dengan akun sungguhan. Uji di mode sandbox dulu: [marketplace](docs/PANDUAN-MARKETPLACE.md#7-menguji-integrasi), [pembayaran](docs/PANDUAN-PEMBAYARAN.md).

## Dokumentasi

| Untuk | Dokumen |
|---|---|
| Pemasangan | [INSTALL](docs/INSTALL.md) |
| Pemilik, admin, kasir | [Panduan penggunaan](docs/PANDUAN-PENGGUNAAN.md) |
| Semua pengaturan `.env` | [Panduan env](docs/PANDUAN-ENV.md) |
| QRIS, EDC, payment gateway | [Panduan pembayaran](docs/PANDUAN-PEMBAYARAN.md) |
| Shopee, TikTok Shop, Tokopedia | [Panduan marketplace](docs/PANDUAN-MARKETPLACE.md) |
| Printer struk | [Panduan printer](docs/PANDUAN-PRINTER.md) |
| Gambar produk | [Panduan Cloudinary](docs/PANDUAN-CLOUDINARY.md) |
| Asisten AI | [Panduan MCP](docs/PANDUAN-MCP.md) |
| Developer | [docs/README.md](docs/README.md), [Arsitektur](docs/ARCHITECTURE.md), [Database](docs/DATABASE.md) |

## Teknologi

Next.js · React · TypeScript · PostgreSQL · Drizzle ORM · Hono · Better Auth · Tailwind CSS. Tampilan memakai komponen dari [BoardUI](https://www.boardui.com) dan ikon [Remix Icon](https://remixicon.com).

## Kontribusi

Kontribusi sangat diterima, baik laporan bug, perbaikan, fitur, maupun dokumentasi. Baca [CONTRIBUTING.md](CONTRIBUTING.md). Celah keamanan dilaporkan lewat [SECURITY.md](SECURITY.md), jangan lewat issue publik.

## Lisensi

Kode berlisensi [MIT](LICENSE) © lifistudio: bebas dipakai, diubah, dan dijual, selama pemberitahuan lisensi tetap disertakan. Nama dan logo POS by lifistudio tidak termasuk dalam lisensi kode, lihat [TRADEMARK.md](TRADEMARK.md). Komponen pihak ketiga tercantum di [NOTICE.md](NOTICE.md).
