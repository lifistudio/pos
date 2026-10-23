# Docs — Konten POS (open source, multi-cabang)

**AI agent / developer baru: baca file ini sampai habis sebelum mengubah apa pun.**

## Status proyek (2026-10-18)
- **Fase 0 (fondasi) selesai**, master data, produk & stok inti, **POS (kasir)**, **voucher & membership**, **transfer stok & stok opname**, **retur & tukar poin**, **order online**, **QRIS dinamis (order online & kasir)**, **laporan (penjualan, retur, stok, pergerakan, shift/selisih kas) + PIN persetujuan**, **integrasi marketplace**, serta **mode offline kasir + PWA (kasir bisa dibuka ulang tanpa internet)** selesai. Lihat [CHANGELOG.md](./CHANGELOG.md) untuk rincian.
- Sudah jalan: login, RBAC per cabang, audit log, API v1 + dokumentasi Scalar, MCP server read-only, dashboard stok, produk (list/detail/tambah/ubah varian, kategori), stok (list, terima/sesuaikan via scan barcode, kartu stok), **Pengaturan**: cabang, pengguna, role (matriks permission), API key & MCP, audit log; **Kasir** (`/pos`: shift, scan, keranjang, tunai/QRIS/EDC/transfer manual, struk 58/80 mm, void, tutup shift), **Transaksi** (`/sales`), ringkasan penjualan di dashboard, **Customer & tier member** (`/customers`), **Voucher** (`/vouchers`, performa), customer + voucher + poin di kasir, **Transfer stok** (`/inventory/transfers`: scan kirim & terima, selisih) **Stok opname** (`/inventory/opnames`: hitung via scan, posting selisih), **Retur** (kasir & `/sales/returns`) dan **tukar poin** di kasir, Pengaturan › Poin & retur, **Order online** (`/orders`: reservasi stok, QRIS dinamis via Midtrans/simulator, kemas–kirim–selesai).
- Marketplace: adapter Shopee & TikTok Shop/Tokopedia (belum diuji dengan akun sungguhan) + simulator.
- Master merek (unik ternormalisasi, gabungkan), kurir & nama variasi seragam, validasi API terbatas di semua input, index FK.
- Produk: SKU & barcode EAN-13 unik otomatis (atau manual tervalidasi), thumbnail via Cloudinary (cadangan database), layout katalog kasir grid 3–6 kolom / daftar.
- Open source MIT: LICENSE, README, CONTRIBUTING, SECURITY, CI GitHub Actions.
- Cetak label barcode (EAN/UPC/Code 128) dari halaman produk.
- Belum: scan kamera di kasir, pembayaran split, notifikasi versi baru PWA, Background Sync, uji akun Shopee/TikTok sungguhan, adapter Lazada, laporan stok untuk peran MD, refund gateway otomatis.
- Keputusan yang belum dijawab owner berjalan dengan **asumsi sementara** — lihat [OPEN_QUESTIONS.md](./OPEN_QUESTIONS.md).

## Peta dokumen
| File | Isi | Kapan dibaca |
|---|---|---|
| [PANDUAN-PENGGUNAAN.md](./PANDUAN-PENGGUNAAN.md) | Cara memakai semua fitur (owner, admin, kasir) | Menjelaskan fitur ke pengguna |
| [PANDUAN-ENV.md](./PANDUAN-ENV.md) | Semua variabel lingkungan: fungsi, wajib/tidak, cara mendapatkan nilainya, contoh dev & produksi | Mengisi `.env` / env hosting |
| [PANDUAN-DEPLOY.md](./PANDUAN-DEPLOY.md) | Env lengkap, deploy VPS/Vercel, cron, backup, checklist keamanan | Sebelum go-live |
| [PANDUAN-CLOUDINARY.md](./PANDUAN-CLOUDINARY.md) | Media (gambar/video) di Cloudinary: akun, API key, env | Menyiapkan penyimpanan gambar |
| [PANDUAN-MARKETPLACE.md](./PANDUAN-MARKETPLACE.md) | Shopee & TikTok Shop/Tokopedia langkah demi langkah | Menghubungkan marketplace |
| [PANDUAN-PEMBAYARAN.md](./PANDUAN-PEMBAYARAN.md) | Tunai, QRIS dinamis/statis, mesin EDC, transfer, scanner barcode | Melatih kasir & menyiapkan QRIS |
| [PANDUAN-PRINTER.md](./PANDUAN-PRINTER.md) | Printer struk USB/Bluetooth/serial/LAN, cetak otomatis, PDF | Menyiapkan printer kasir |
| [PANDUAN-MCP.md](./PANDUAN-MCP.md) | Menghubungkan Claude, ChatGPT/Codex, Cursor, Antigravity, Hermes, dll. | Menyambungkan AI agent |

Semua `PANDUAN-*.md` yang terdaftar di `src/app/(app)/panduan/guides.ts` juga tampil di aplikasi (menu **Panduan**).
| [DEVELOPMENT.md](./DEVELOPMENT.md) | Setup, perintah, URL, alur menambah fitur | Pertama kali menjalankan proyek |
| [PRD.md](./PRD.md) | Fitur, role, aturan bisnis (voucher, stok, RBAC), prioritas | Sebelum membuat fitur apa pun |
| [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md) | Aturan UI, token BoardUI, komponen, motion, wording | Sebelum menyentuh UI |
| [../PRODUCT.md](../PRODUCT.md) | Konteks produk untuk skill Impeccable | Sebelum kerja desain |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Stack, struktur folder, konvensi API, keamanan, performa | Sebelum menulis kode server/data |
| [DATABASE.md](./DATABASE.md) | Tabel (sudah dibuat vs rencana) & index | Sebelum mengubah schema |
| [MCP.md](./MCP.md) | MCP server untuk AI agent: auth (API key & OAuth), tool, cara konek | Sebelum menambah tool AI |
| [ECR.md](./ECR.md) | Integrasi mesin EDC (ECR): arsitektur, menambah protokol bank, protokol terbuka Konten ECR v1, layar pelanggan | Menyambungkan EDC / menambah protokol bank |
| [SECURITY_LOG.md](./SECURITY_LOG.md) | Hasil scan package/skill/MCP | Sebelum memasang package/skill baru |
| [DECISIONS.md](./DECISIONS.md) | Keputusan arsitektur (ADR) beserta alasannya | Sebelum mengusulkan mengganti sesuatu |
| [OPEN_QUESTIONS.md](./OPEN_QUESTIONS.md) | Pertanyaan untuk owner + asumsi sementara | Sebelum mengasumsikan sesuatu |
| [CHANGELOG.md](./CHANGELOG.md) | Riwayat perubahan per sesi | Untuk tahu apa yang terakhir dikerjakan |

## Aturan wajib (ringkas)
1. **Semua data lewat API** (`/api/v1`, Hono). UI tidak boleh import `db`/service — ditegakkan ESLint. SSR memanggil API in-process via `apiServer()`.
2. **Otorisasi di server** (middleware Hono `requirePermission` + cek cakupan cabang di service). `proxy.ts` hanya cek cookie ringan.
3. **Tidak ada N+1**: tidak ada query di dalam loop; pakai join/`with`/`IN`/`UPDATE … FROM (VALUES …)`. Agregasi di SQL.
4. **Pagination** wajib untuk semua list (offset untuk tabel admin, cursor untuk riwayat).
5. **Uang integer rupiah**; stok hanya berubah lewat `applyStockChanges()` (ledger + update atomik, stok tidak bisa minus).
6. **Media (gambar/video) lewat modul `src/server/media`** (Cloudinary; cadangan database) — jangan simpan file di disk server. **SKU/barcode lewat `resolveVariantCodes()`** (unik global).
7. **UI hanya dari BoardUI** + Remix Icon. Komposisi proyek di `src/components/app`; komponen kustom dicatat di DESIGN_SYSTEM §9.
8. **Cek Context7 / docs di `node_modules/next/dist/docs`** sebelum memakai API library (Next 16 berbeda dari versi lama); **scan SkillSpector/pnpm audit** sebelum memasang skill/package baru; **detector Impeccable** sebelum fitur UI dianggap selesai.
9. Teks UI Bahasa Indonesia sesuai DESIGN_SYSTEM §7. Responsif penuh (HP, tablet, laptop).

## Wajib setelah setiap sesi kerja
- Tambahkan entri di [CHANGELOG.md](./CHANGELOG.md) (tanggal, apa yang berubah, file utama, yang belum selesai).
- Keputusan baru/berubah → ADR di [DECISIONS.md](./DECISIONS.md).
- Schema berubah → DATABASE.md. Fitur/aturan berubah → PRD.md. Package/skill baru → SECURITY_LOG.md.
- Pertanyaan terjawab → pindahkan ke bagian "Terjawab" di OPEN_QUESTIONS dan terapkan ke dokumen terkait.
