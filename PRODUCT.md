# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
- **Owner / Admin** — memantau omzet, stok, dan promo semua cabang; mengatur produk, voucher, pengguna, dan role. Sering membuka dari HP maupun laptop.
- **MD (pengelola stok)** — menerima barang, transfer antar cabang, stok opname. Bekerja di gudang/toko dengan laptop atau tablet, sering sambil memegang barang dan scanner.
- **Kepala toko** — operasional satu cabang: approve void/refund, terima transfer, cek stok.
- **Kasir** — menjual di layar POS (tablet/laptop/HP), scan barcode, terima pembayaran, layani member & voucher.

Semua perangkat sama pentingnya: laptop, tablet, dan HP harus nyaman dipakai (responsif penuh), termasuk layar POS.

## Product Purpose
Sistem POS open source untuk segala jenis bisnis retail multi-cabang: satu sumber kebenaran untuk produk, varian, stok per cabang, transaksi offline & online, voucher, dan membership. Berhasil bila stok selalu bisa dipercaya, kasir bertransaksi cepat, dan pemilik bisa membaca performa tanpa rekap manual.

## Positioning
Open source dan self-hosted; generik untuk berbagai jenis usaha (fashion, F&B, kosmetik, retail umum). Setiap perubahan stok tercatat di ledger, semua data lewat satu API yang terdokumentasi (OpenAPI/Scalar), dan tersedia MCP server sehingga AI agent bisa membaca stok & performa voucher dengan hak akses yang sama dengan penggunanya.

## Operating Context
- Toko fisik dengan barcode scanner USB/Bluetooth dan kamera perangkat; scan barcode dipakai di kasir dan untuk **audit stok per produk** (opname).
- Gudang & beberapa cabang toko, plus kanal online (marketplace, website, WhatsApp) yang ordernya diinput ke sistem.
- Bahasa Indonesia, mata uang Rupiah, zona waktu WIB/WITA/WIT.

## Capabilities and Constraints
- Lihat `docs/PRD.md` untuk fitur lengkap, `docs/ARCHITECTURE.md` untuk aturan teknis.
- Stack: Next.js 16 (App Router) fullstack, TypeScript, PostgreSQL, Drizzle, Hono API, Better Auth, Tailwind v4.
- UI wajib memakai komponen BoardUI dan ikon Remix Icon (diminta owner).
- RBAC kustom: role & permission per cabang dapat ditambah.
- Karena generik untuk segala usaha: fitur khusus jenis usaha (batch/kedaluwarsa, modifier F&B, nomor seri) dirancang sebagai opsi yang bisa diaktifkan, bukan bawaan wajib. **Belum diputuskan:** urutan prioritasnya.

## Brand Commitments
- Nama sementara: **Konten** (logo menyusul).
- Gaya diminta owner: minimalis, modern, premium seperti boardui.com; semua elemen dari BoardUI; motion lewat Motion/GSAP secukupnya.

## Evidence on Hand
Belum ada data penjualan, pelanggan, atau testimoni nyata. Data di aplikasi saat ini hanya seed development (`scripts/seed.ts`); jangan menampilkannya sebagai bukti.

## Product Principles
1. Stok bisa dipercaya: setiap angka bisa ditelusuri ke pergerakan di ledger.
2. Kecepatan di lantai toko mengalahkan kelengkapan di layar: scan, cari, selesai.
3. Satu jalur data: UI, integrasi, dan AI agent memakai API & aturan akses yang sama.
4. Generik tanpa membingungkan: opsi khusus usaha tersembunyi sampai diaktifkan.
5. Jelas untuk orang awam: istilah toko sehari-hari, bukan istilah teknis.

## Accessibility & Inclusion
WCAG 2.2 AA; navigasi keyboard penuh (kasir & scanner); target sentuh ≥ 44px di POS dan perangkat sentuh; hormati `prefers-reduced-motion`.
