# Pertanyaan Terbuka untuk Owner

Jawab langsung di bawah tiap pertanyaan (atau di chat). Bertanda ⭐ = memblokir mulainya pengerjaan.

## Bisnis & Operasional
- **Q-01 ⭐ Mode offline kasir.** Apakah toko sering mengalami internet putus? Kalau ya, kasir harus tetap bisa berjualan offline (P1, menambah ±30–40% effort POS, ada risiko stok selisih saat sinkron). Kalau koneksi stabil + ada backup hotspot, cukup online-only.
- **Q-02 ⭐ Kanal online yang dipakai.** Shopee / TikTok Shop-Tokopedia / Lazada / website sendiri / WhatsApp / Instagram? Fase awal saya usulkan *input order manual* dulu. Apakah sinkron stok otomatis ke marketplace dibutuhkan di rilis pertama? (Butuh akun seller terverifikasi + pengajuan akses Open API.)
- **Q-03 Website toko sendiri.** Apakah brand sudah punya / akan punya toko online sendiri yang perlu terhubung ke POS ini (via Public API)? Atau POS ini juga perlu storefront?
- **Q-04 Gudang.** Ada gudang pusat terpisah dari toko? Stok online diambil dari gudang, dari toko tertentu, atau dari gabungan?
- **Q-05 Jenis produk.** Apa yang dijual (fashion, F&B, kosmetik, elektronik)? Menentukan perlu tidaknya batch/expired, nomor seri, atau modifier (F&B: topping, level gula).
- **Q-06 Harga modal (HPP).** Perlu laporan laba kotor berdasarkan HPP? Metode rata-rata tertimbang oke?
- **Q-07 Stok minus.** Boleh menjual saat stok sistem 0 (barang fisik ada tapi belum diinput)? Saya sarankan *tidak boleh*, kecuali dengan PIN kepala toko.
- **Q-10 Voucher bertumpuk.** Satu transaksi boleh lebih dari 1 voucher? Bagaimana dengan diskon tier member + voucher sekaligus?
- **Q-11 Struk.** Printer thermal yang dipakai (merek/tipe, 58 atau 80mm, USB/Bluetooth/LAN)? Perlu kirim struk via WhatsApp (butuh WhatsApp Business API berbayar) atau cukup email/link struk?
- **Q-13 Membership.** Gratis otomatis saat daftar atau berbayar? Sudah ada aturan tier & poin yang berjalan sekarang?
- **Q-14 Pajak.** Brand sudah PKP (wajib PPN)? Harga yang ditampilkan sudah termasuk pajak atau belum?
- **Q-16 Skala.** Berapa cabang saat ini & target 2 tahun? Kira-kira jumlah SKU/varian dan transaksi per hari?
- **Q-20 Data lama.** Ada data produk/stok/customer di sistem lain (Excel, Moka, Olsera, Pawoon, dll.) yang perlu dimigrasi?
- **Q-21 Perangkat kasir.** Laptop/PC, tablet Android, atau iPad? Pakai barcode scanner USB/Bluetooth atau kamera?

## Pembayaran
- **Q-09 ⭐ Payment gateway.** Sudah punya akun Midtrans, Xendit, atau lainnya? Kalau belum, saya rekomendasikan salah satu berdasarkan biaya QRIS & kemudahan onboarding. Untuk kartu, apakah memakai mesin EDC bank terpisah (input manual) cukup?

## Teknis & Desain
- **Q-12 Email.** Ada layanan email (Resend, SMTP domain sendiri) untuk reset password & laporan?
- **Q-15 Akses dokumentasi API.** Docs API hanya untuk user login (saran saya), atau publik untuk partner?
- **Q-17 ⭐ Lisensi BoardUI Pro.** Data table, chart (19 chart), command menu, dan blok dashboard di boardui.com adalah komponen **Pro** (lisensi sekali bayar). Apakah sudah/akan beli? Tanpa Pro, komponen itu harus saya bangun sendiri dengan gaya mirip BoardUI (lebih lama, hasil tidak identik). Kalau beli, lisensi diaktifkan lewat MCP BoardUI (`activate_license`) — **berikan key-nya lewat file `.env` lokal, jangan ditempel di chat**.
- **Q-18 Identitas brand.** Ada logo, warna brand, dan font brand? BoardUI default memakai biru + Inter. Catatan: Impeccable menandai Inter sebagai font yang terlalu umum; kita bisa tetap Inter demi konsistensi dengan BoardUI, atau pakai font lain (misal Geist, Satoshi, General Sans) dengan token yang sama.
- **Q-19 ⭐ Hosting.** VPS sendiri (lebih murah, perlu maintenance) atau layanan terkelola (Vercel + Neon/Supabase, lebih mudah)? Ada budget bulanan?
- **Q-22 PostgreSQL lokal.** PostgreSQL belum terpasang di laptop ini. Boleh saya siapkan via Docker Desktop, atau Anda lebih suka install PostgreSQL langsung / pakai database cloud (Neon) untuk development?
- **Q-23 SkillSpector.** SkillSpector butuh Python 3 + virtualenv dan didesain untuk memindai *agent skill/MCP*, bukan package npm. Rencana saya: SkillSpector untuk skill & MCP (Impeccable, BoardUI MCP), ditambah `npm audit` + OSV.dev untuk package npm. Setuju? Analisis LLM-nya opsional dan butuh API key (NVIDIA build/OpenAI-compatible) — perlu diaktifkan?

## Asumsi sementara (dipakai sampai owner menjawab) — 2026-10-17
Owner meminta pengerjaan dilanjutkan sebelum menjawab. Asumsi berikut dipakai dan **mudah diubah**:

| Q | Asumsi |
|---|---|
| Q-01 | Mode offline selama tab kasir terbuka (paket harga bertanda tangan + antrean IndexedDB + sinkron idempoten). PWA untuk muat ulang saat offline belum. |
| Q-02 | Order online manual + integrasi marketplace via adapter; Shopee pertama (belum diuji sandbox), simulator untuk dev. |
| Q-04 | Sumber stok order online dipilih per order (default gudang bila ada). |
| Q-05 | Retail umum (fashion-like): varian warna/ukuran, tanpa batch/expired. |
| Q-07 | Stok tidak boleh minus. |
| Q-09 | Abstraksi `PaymentProvider` + adapter **Midtrans** (QRIS Core API) + simulator lokal untuk dev. Butuh server key sandbox untuk uji sungguhan. |
| Q-10 | Maks. 1 voucher per transaksi; diskon tier member boleh digabung dengan voucher (terimplementasi, ADR-014). |
| Q-14 | PPN bisa diatur per cabang, default nonaktif. |
| Q-17 | Pakai komponen BoardUI **gratis**; komponen Pro (data table, chart) dibangun sendiri dengan token & gaya BoardUI di `src/components/ui/` dan dicatat di DESIGN_SYSTEM §9. Bisa diganti versi Pro bila lisensi dibeli. |
| Q-18 | Default BoardUI: Inter + JetBrains Mono, accent biru. |
| Q-19/Q-22 | Development: PostgreSQL via Docker Compose. Hosting diputuskan nanti. |
| Q-23 | SkillSpector untuk skill/MCP + `npm audit` untuk package npm. Analisis LLM SkillSpector tidak diaktifkan. |

## Terjawab
- **Q-37 Lisensi BoardUI** (2026-11-02): komponen gratis berlisensi MIT, boleh di repo MIT. Disebut di README & NOTICE. Komponen Pro tidak boleh masuk repo.
- **Q-12 Email** (2026-11-02): SMTP opsional lewat env, dipakai lupa password.
- **Q-09 Payment gateway** (2026-11-02): Midtrans, Xendit, DOKU, dipilih lewat env.
- **Q-18 Identitas brand** (2026-11-02): **POS by lifistudio**, logo gulungan struk. Warna antarmuka tetap accent biru BoardUI. → ADR-033.
- **Q-38 Pemegang hak cipta** (2026-11-02): lifistudio. → LICENSE.
- **Q-08 Penyimpanan file** (2026-10-20): **Cloudinary** untuk gambar, video, dan media lain. → ADR-025, PANDUAN-CLOUDINARY.md.
- **Lisensi proyek** (2026-10-20): open source **MIT** di GitHub. → LICENSE, README, CONTRIBUTING, SECURITY.
- **Q-05 Jenis produk** (2026-10-17): open source untuk **segala jenis bisnis**. → Fitur khusus usaha dibuat opsional (PRD §1, PRODUCT.md).
- **Perangkat** (2026-10-17): laptop, tablet, HP sama pentingnya; semua harus responsif termasuk layar POS; scan barcode juga untuk audit per produk. → DataTable kartu di HP, ScanInput (scanner + kamera).
- **Q-18 sebagian** (2026-10-17): nama sementara **"POS"**; logo & warna brand belum ada (default BoardUI dipakai).

## Pertanyaan baru (2026-10-18)
- **Q-24 Tukar poin.** Berapa nilai 1 poin saat ditukar dan apakah ada minimal penukaran? Poin kedaluwarsa setelah berapa bulan? *(Sementara: Rp100/poin, min 10 poin, maks 50% tagihan — bisa diubah di Pengaturan › Poin & retur; kedaluwarsa belum ada.)*
- **Q-25 Turun tier.** Apakah member bisa turun tier bila belanjanya menurun (misal dihitung per 12 bulan berjalan), atau tier hanya naik?
- **Q-26 Voucher massal.** Perlu kode unik sekali pakai dalam jumlah besar (misal 500 kode untuk influencer/kampanye)?
- **Q-27 Permintaan stok.** Perlu alur cabang meminta barang (request) yang disetujui gudang sebelum dikirim, atau cukup gudang/cabang asal yang membuat transfer?
- **Q-28 Pembekuan saat opname.** Saat opname berjalan, apakah penjualan barang di cabang itu harus diblokir otomatis, atau cukup peringatan?
- **Q-36 Fitur kasir lanjutan.** Cetak label barcode sudah ada (33×15, 38×25, 50×25, 58×40 mm; gulungan/A4) — ukuran label & printer apa yang dipakai toko, perlu ditambah? Perlu juga (b) **scan dengan kamera HP** di layar kasir dan (c) **pembayaran split** (sebagian tunai, sebagian QRIS)? Keduanya belum ada.
- **Q-35 Migrasi gambar.** Bila ada gambar tersimpan di database sebelum Cloudinary aktif, perlu tombol migrasi massal ke Cloudinary?
- **Q-34 Laporan stok untuk MD.** PRD menyebut MD boleh melihat laporan stok tetapi tidak laporan keuangan. Saat ini laporan stok/pergerakan memakai `report:read` (yang juga membuka laporan penjualan), sehingga MD belum bisa melihatnya. Perlu permission terpisah (mis. `report:stock`)? Apakah MD boleh melihat nilai jual/nilai modal di valuasi, atau hanya unit?
- **Q-33 Offline.** Seberapa lama biasanya internet putus? PWA sudah ada (kasir bisa dibuka ulang offline setelah pernah dibuka online). Perlu member/voucher tetap jalan offline? Satu cabang memakai lebih dari satu perangkat kasir?
- **Q-32 Marketplace.** Toko di marketplace mana saja (Shopee, TikTok Shop/Tokopedia, Lazada)? Sudah punya akun Shopee Open Platform (partner_id/partner_key) atau aplikasi TikTok Shop Partner (app key/secret/service ID)? Stok marketplace diambil dari gudang atau toko tertentu, dan berapa buffer aman?
- **Q-31 Persetujuan.** Selain void, retur, dan diskon manual, aksi apa lagi yang butuh PIN kepala toko (buka laci kas, ubah harga di kasir, jual saat stok 0)? Batas diskon manual 30% sudah sesuai?
- **Q-29 Retur.** Berapa hari batas retur (sementara 7 hari, bisa diubah)? Perlu tukar barang (exchange) dan store credit, atau cukup uang kembali? Apakah kasir boleh meretur dengan PIN kepala toko?
- **Q-30 Order online.** Berapa lama batas bayar standar (sementara 24 jam)? Order online dapat poin member seperti di kasir? Masa berlaku QR di kasir cukup 15 menit (`QRIS_EXPIRY_MINUTES`)? Perlu layar kedua (customer display) untuk menampilkan QR?
- **Q-39 EDC & QRIS otomatis.** Kerangka ECR, simulator, protokol terbuka POS ECR v1, dan layar pelanggan sudah ada (ADR-031). Tersisa: bank/EDC apa yang dipakai di toko (BCA, Mandiri, BRI, BNI, lainnya)? Sudah punya dokumen spesifikasi ECR dari bank (untuk ditambahkan sebagai protokol)? Payment gateway QRIS yang dipakai/diinginkan (Midtrans sudah ada; Xendit, DOKU, lainnya)? Perlu kasir memindai QR dari aplikasi pelanggan (GoPay/OVO/DANA/ShopeePay)?
- **Q-40 Akun marketplace uji.** Kapan akun sandbox Shopee dan toko uji TikTok Shop tersedia untuk menjalankan PANDUAN-MARKETPLACE §7?
- **Q-41 Merek dagang.** Apakah nama POS by lifistudio akan didaftarkan? "POS" generik sehingga sulit dilindungi dan sulit dicari.
- **Q-42 Akun sosial.** README menautkan `instagram.com/lifistudio` dan `tiktok.com/@lifistudio`. Pastikan nama akunnya benar.
