# Keputusan Arsitektur (ADR)

Format: ID — judul — status (Diusulkan/Diterima/Diganti) — tanggal. Isi: konteks, keputusan, alasan, konsekuensi.
"Diterima (implementasi)" = dipakai di kode karena owner meminta pengerjaan dilanjutkan; bisa ditinjau ulang.

## ADR-001 — Next.js fullstack (App Router) — Diterima (owner) — 2026-10-17
Backend & frontend dalam satu project Next.js + TypeScript + PostgreSQL + Tailwind. Next 16.4 dengan Cache Components & Partial Prefetching aktif (default `create-next-app`): komponen yang membaca cookie/header wajib di dalam `<Suspense>`.

## ADR-002 — Hono sebagai router API di dalam Next.js — Diterima (implementasi) — 2026-10-17
Satu catch-all `app/api/[[...route]]/route.ts` me-mount Hono (`@hono/zod-openapi`). Middleware berlapis terpusat, OpenAPI otomatis. Server Component memanggil `app.request()` in-process (`apiServer()`), jadi aturan "semua lewat API" terpenuhi tanpa hop jaringan. Better Auth & MCP juga di-mount di Hono (satu pintu `/api`).

## ADR-003 — Drizzle ORM — Diterima (implementasi) — 2026-10-17
SQL-first & eksplisit (N+1 terlihat jelas), migrasi via drizzle-kit, `casing: snake_case`. Relational query (`db.query.*.findFirst({ with })`) dipakai untuk detail; join + subquery agregat untuk list.

## ADR-004 — Better Auth untuk sesi — Diterima (implementasi) — 2026-10-17
Email/password, sesi di Postgres (12 jam), rate limit login 5/menit, `disableSignUp` (akun dibuat admin). Pembuatan user oleh admin memakai `auth.$context.password.hash` + insert di transaksi kita sendiri (agar role & audit atomik). 2FA plugin belum dipasang.

## ADR-005 — Scalar untuk dokumentasi API — Diterima (implementasi) — 2026-10-17
OpenAPI 3.1 dari Zod; Scalar di `/api/v1/reference`. Spesifikasi & UI butuh `api_docs:read`. Bundle CDN dikunci versinya; fitur cloud (toolbar, Ask AI, Generate SDK, telemetry, MCP) dimatikan — spesifikasi tidak boleh keluar dari server.

## ADR-006 — Ledger untuk stok — Diterima (implementasi) — 2026-10-17
Stok hanya berubah lewat `applyStockChanges(tx, actor, changes)`: upsert baris saldo, satu `UPDATE … FROM (VALUES …)` dengan syarat `on_hand + delta >= reserved` (atomik, tidak bisa minus, aman untuk kasir bersamaan), lalu insert `stock_movements` dengan `balance_after`. Poin & kuota voucher akan memakai pola yang sama.

## ADR-007 — MCP read-only lewat API — Diterima (implementasi) — 2026-10-17
MCP stateless di `/api/mcp`; tool memanggil `/api/v1` in-process dengan header auth klien → permission identik dengan UI; setiap pemanggilan diaudit.

## ADR-008 — BoardUI + Remix Icon sebagai satu-satunya sumber UI — Diterima (owner) — 2026-10-17
Komponen vendor di `src/components/base|application|foundations` dibiarkan sedekat mungkin dengan hasil CLI (lint React Compiler dilonggarkan di sana). Komposisi khusus proyek di `src/components/app`.

## ADR-009 — PostgreSQL dev via embedded-postgres — Diterima — 2026-10-17
Docker Desktop di mesin owner gagal boot VM WSL. `embedded-postgres` menjalankan binary PostgreSQL 18 resmi tanpa instalasi; data di `.data/pg`. `docker-compose.yml` (postgres:18) tetap disediakan untuk mesin lain/CI. Produksi memakai PostgreSQL biasa (lihat Q-19).

## ADR-010 — API key buatan sendiri, bukan plugin Better Auth — Diterima — 2026-10-17
Tabel `api_keys` (hash SHA-256, prefix, kedaluwarsa, cabut, last-used). Alasan: plugin terpisah (`@better-auth/api-key`) menambah dependensi dan model permission sendiri; kita butuh API key yang mewarisi RBAC per cabang milik user. API key tidak boleh membuat API key lain.

## ADR-011 — Strategi render per halaman — Diterima — 2026-10-17
- Shell (sesi, role, cabang) dan **detail produk**: SSR via `apiServer()` di dalam Suspense.
- Dashboard, list produk/stok, kartu stok: **CSR** dengan TanStack Query, karena filter cabang aktif adalah preferensi per perangkat (localStorage) dan filter tabel interaktif; state filter disimpan di URL.
- Bila nanti dibutuhkan SSR untuk list, pindahkan cabang aktif ke cookie.

## ADR-012 — Pencarian per kata — Diterima — 2026-10-17
`matchAllTerms()`: setiap kata harus cocok di salah satu kolom (nama produk, judul varian, SKU); barcode dicocokkan persis. Penting untuk pertanyaan bahasa alami dari AI ("hoodie hitam L") dan kasir. Index trigram tersedia; full-text search dipertimbangkan bila katalog > 100 ribu varian.

## ADR-013 — Desain checkout POS — Diterima — 2026-10-17
- **Satu fungsi harga** (`src/lib/pricing.ts`) untuk client & server; server tetap menghitung ulang dari harga DB dan menyimpan `tax_snapshot`.
- **Idempotensi**: client membuat UUID per transaksi (dipertahankan selama dialog bayar terbuka) dan mengirimnya di header `Idempotency-Key`; unique index menjamin retry/klik ganda tidak membuat transaksi ganda; pemenang balapan dikembalikan ke request yang kalah.
- **Penomoran** `INV/{KODE}/{YYMMDD}/{0001}` per cabang per hari (zona waktu cabang) dari tabel `number_sequences` (UPSERT atomik, di transaksi yang sama).
- **Shift wajib** untuk berjualan; satu shift terbuka per kasir per cabang. Kas seharusnya = kas awal + pembayaran tunai transaksi PAID (`amount` = nominal yang diterapkan, kembalian tidak ikut).
- **Void** hanya sebelum shift ditutup (perlu `pos:void`), stok dikembalikan lewat ledger (type RETURN). Transaksi setelah shift ditutup → modul retur (belum dibuat).
- Kasir boleh membuka struk transaksinya sendiri tanpa `sale:read`.

## ADR-014 — Diskon member + voucher — Diterima — 2026-10-18
- Urutan tetap: diskon tier member (semua barang) → voucher (barang eligible, dari harga setelah diskon member) → PPN. Satu voucher per transaksi; diskon member boleh digabung (asumsi Q-10).
- Syarat yang butuh database dicek di `resolveVoucher` (status 422 + pesan Indonesia); syarat keranjang di `priceCart` (fungsi murni, diuji `pnpm check:pricing`).
- Kuota diklaim atomik di transaksi checkout (`UPDATE … WHERE quota_used < quota_total`); kuota per customer dicek setelah baris customer dikunci `FOR UPDATE`. Void mengembalikan kuota & membalik poin lewat ledger (tidak boleh minus).
- Poin = floor(total akhir / 10.000) × poin per Rp10.000 tier. Tier naik otomatis berdasarkan total belanja seumur hidup; tidak turun otomatis (belum diputuskan).
- Diskon dialokasikan per baris (`sale_items.discount`) agar laba per produk & retur parsial nanti akurat.
- `sales.subtotal` = setelah diskon (dasar PPN); harga bruto = `subtotal + discount_total`.
- Data pribadi ke MCP dimasking (UU PDP).

## ADR-015 — Transfer & opname lewat ledger — Diterima — 2026-10-18
- Transfer tidak memakai stok "in-transit" terpisah: saat dikirim stok asal berkurang (TRANSFER_OUT), saat diterima stok tujuan bertambah (TRANSFER_IN) sejumlah yang benar-benar diterima. Selisih kirim − terima tetap terlihat di dokumen transfer (bukan movement), sehingga barang hilang di jalan tidak menambah stok mana pun. Batal setelah kirim = TRANSFER_IN kembali ke asal.
- Saat menerima, baris yang tidak diisi dianggap diterima penuh agar penerimaan normal cukup satu klik; kekurangan wajib catatan di UI.
- Opname menyimpan hitungan, bukan selisih: `counted_qty` di-upsert atomik per scan, sehingga beberapa orang bisa menghitung bersamaan tanpa saling menimpa. Selisih dihitung terhadap stok sistem **saat posting** (bukan saat mulai), lalu dibekukan di `system_qty`/`difference`. Penjualan selama opname ikut terhitung di stok sistem — karena itu UI menyarankan menghentikan penjualan barang yang sedang dihitung (pembekuan otomatis belum ada).
- Satu opname COUNTING per cabang (unique index parsial) mencegah dua posting saling bertabrakan. Mode FULL: barang berstok yang tidak dihitung menjadi 0 saat posting.
- Hak: membuat/kirim transfer dan mulai/hitung opname dipisah dari menerima transfer (`stock_transfer:approve`) dan posting opname (`stock_opname:approve`), sesuai PRD §3.4.

## ADR-016 — Tukar poin & retur — Diterima — 2026-10-18
- **Tukar poin = potongan harga**, bukan metode bayar: dihitung setelah diskon member & voucher, sebelum PPN, dialokasikan per baris. Dengan begitu DPP/PPN, laba per produk, dan nilai retur per barang tetap akurat. Porsi maksimal dibatasi 90% agar setiap transaksi tetap punya baris pembayaran (`sale_payments.amount > 0`). Poin yang didapat dihitung dari total setelah tukar poin.
- Kebijakan toko (nilai poin, minimal tukar, porsi maksimal, batas hari retur) disimpan di `app_settings` (berlaku semua cabang) dan divalidasi Zod di service; default memakai asumsi Q-24 (1 poin = Rp100, min 10, maks 50%, retur 7 hari).
- **Nilai retur kumulatif & proporsional** terhadap yang benar-benar dibayar: nilai untuk a unit pertama yang diretur = floor(nilai × a / qty); uang kembali = floor(total × dasar_retur / subtotal) − yang sudah dikembalikan. Retur bertahap selalu berjumlah tepat total transaksi (PPN eksklusif ikut). Poin ditarik/dikembalikan dengan rumus sama; penarikan dibatasi saldo (tidak minus).
- Refund tunai wajib dari shift kasir yang terbuka di cabang struk dan mengurangi kas seharusnya shift itu; refund non-tunai hanya ke metode bayar asal. Retur hanya di cabang tempat membeli (stok kembali ke cabang itu).
- Barang rusak tidak menambah stok (sudah keluar saat dijual); tercatat di `sale_return_items.restock = false` untuk laporan.
- Retur penuh mengembalikan kuota voucher (PRD §3.8 aturan 5); retur sebagian tidak, dan potongan voucher tetap melekat pada barang yang diretur (uang kembali = harga setelah diskon).
- Void ditolak setelah ada retur (mencegah stok/uang kembali dua kali). Omzet di dashboard = total − refund, dihitung ke tanggal transaksi asal.

## ADR-017 — Order online, reservasi, dan payment gateway — Diterima — 2026-10-18
- **Tabel order terpisah** (`online_orders`) untuk alur pemenuhan, tetapi saat lunas dibuat baris `sales` (channel = kanal, nomor = nomor order). Satu sumber omzet/struk/retur untuk semua kanal; logika kasir tidak berubah.
- **Reservasi**: `reserved` naik saat order dibuat (atomik, hanya bila tersedia), stok fisik (`on_hand`) baru turun saat **dikirim** (lepas reservasi lalu movement SALE dalam satu transaksi). Batal/kedaluwarsa hanya melepas reservasi. Reservasi tidak dicatat di ledger karena on_hand tidak berubah; jejaknya ada di order & audit log. Kasir sudah memakai `available = on_hand − reserved`, jadi barang yang dipesan online tidak bisa terjual dua kali.
- **Batas bayar** (default 24 jam) disimpan per order; kedaluwarsa dijalankan oportunistik + endpoint cron (belum ada job scheduler).
- **PaymentProvider**: Midtrans Core API untuk QRIS (rekomendasi PRD Q-09) + simulator lokal agar alur bisa diuji tanpa akun. `gateway_order_id` = nomor order tanpa "/" + urutan percobaan (QR bisa dibuat ulang). Satu QR aktif per order.
- **Webhook**: signature diverifikasi (SHA512 Midtrans / HMAC simulator, perbandingan timing-safe), event disimpan dengan `event_key` unik dan diterapkan dalam transaksi yang sama — notifikasi ganda diproses sekali; bila gagal, event tidak tersimpan sehingga retry gateway diproses ulang. Nominal harus sama dengan intent; selisih atau bayar setelah order batal dicatat di audit (`payment_attention`) untuk ditindaklanjuti manual.
- Status juga disinkronkan dengan `GET status` saat halaman order menunggu (fallback bila webhook tidak sampai).
- Pembatalan setelah lunas menandai transaksi VOIDED dan meminta refund manual (refund API gateway belum dibuat). Setelah dikirim, pembatalan diganti retur; ongkir tidak ikut dikembalikan.
- Order online belum memberi poin member (hanya menambah total belanja & kunjungan) — diputuskan nanti bersama Q-24.

## ADR-018 — QRIS dinamis di kasir: transaksi PENDING — Diterima — 2026-10-18
- Saat QR dibuat, transaksi langsung dibuat berstatus **PENDING** dengan semua efek yang perlu dikunci: stok dipotong, kuota voucher diklaim, poin tukar didebit. Alasannya: nominal di QR harus pasti dan barang tidak boleh terjual ke pelanggan lain selama pelanggan memindai. Konfirmasi lunas hanya menambah baris pembayaran, mengubah status ke PAID, dan memberi poin/statistik customer.
- Bila tidak dibayar (kasir batal, dialog ditutup, kedaluwarsa, gagal), transaksi dibalik lewat helper yang sama dengan void (`reverseSaleEffects`) tanpa menarik poin didapat (belum pernah diberikan). Riwayat SALE→RETURN di kartu stok diterima sebagai jejak audit.
- Satu jalur pembayaran untuk order online dan kasir (`payment.service`), dibedakan `reference_type`; dispatcher memanggil konfirmasi/batal milik masing-masing modul (tanpa import melingkar: modul tidak mengimpor dispatcher).
- Kedaluwarsa ditentukan server (cek status gateway, jeda 1 menit untuk notifikasi terlambat, lalu `cancel` ke gateway). Pembayaran yang tetap masuk setelah dibatalkan tidak menghidupkan transaksi lagi, melainkan dicatat `payment_attention` untuk refund manual.
- Tutup shift diblokir selama ada QRIS menunggu, agar kas & laporan shift tidak menggantung.

## ADR-019 — PIN persetujuan & laporan — Diterima — 2026-10-18
- **Izin, bukan login ulang**: atasan mengetik PIN di perangkat kasir; server membuat `approval_grant` sekali pakai (10 menit) yang terikat ke permission, cabang, dan kasir peminta. Aksi memakai izin di dalam transaksinya sendiri (`used_at`), jadi satu PIN = satu aksi, tidak bisa dipakai untuk aksi/cabang lain. Penyetuju dicatat di baris data (void/retur/diskon) dan audit log.
- PIN 6 angka disimpan hash scrypt + salt di tabel terpisah dari Better Auth. Calon penyetuju dicari dari penugasan role (global/cabang) yang memuat permission tsb.; ruang PIN kecil sehingga dibatasi 5 percobaan/10 menit per peminta (dari audit log, tanpa state di memori → aman multi-instance). Pemilik PIN tidak bisa menyetujui dirinya sendiri.
- Route void/retur memindahkan otorisasi ke service (perlu cabang transaksi + izin). Kasir cabang boleh membuka struk cabangnya agar retur dengan PIN mungkin.
- **Diskon manual** setelah voucher dan sebelum tukar poin (voucher dinilai dari harga normal; poin membayar sisa), dibatasi kebijakan toko (default 30%, maks 90%) agar total tidak nol.
- **Alasan retur terstruktur** (enum + keterangan bebas) supaya laporan per alasan bermakna.
- **Laporan** dihitung langsung dari tabel transaksi dengan satu query agregat per permintaan (rentang maks 1 tahun). Dimensi barang memakai `sale_items` (unit bersih = qty − diretur, retur proporsional per baris); dimensi transaksi memakai header `sales` (ongkir dikeluarkan). Bila data membesar, tambahkan tabel ringkasan harian (`daily_sales_summary`, DATABASE.md) tanpa mengubah API.
- Export CSV dengan BOM (Excel) dan prefiks `'` untuk sel teks yang diawali `= + - @` (formula injection).

## ADR-020 — Integrasi marketplace lewat adapter — Diterima — 2026-10-18
- **Adapter per marketplace**, logika sinkron bersama (`marketplace.service`): pemetaan SKU, reservasi, transisi status order, push stok, log. Menambah marketplace = satu file adapter yang memenuhi `MarketplaceAdapter`.
- **Shopee dipilih pertama** (pangsa terbesar di Indonesia, API v2 terdokumentasi; jawaban Q-02 belum ada). Implementasi mengikuti dokumentasi resmi tetapi **belum diuji di sandbox**; simulator lokal memakai jalur webhook & sinkron yang sama agar seluruh alur Konten teruji.
- **Order marketplace = order online biasa** (`online_orders.connection_id`), sehingga reservasi, transaksi, laporan, dan retur memakai jalur yang sudah ada. Status marketplace hanya dimajukan (tidak mundur); batal setelah kirim tidak diotomatiskan (retur manual).
- **Harga dari marketplace** (bisa beda dengan harga toko) dan dianggap sudah termasuk pajak. Pembayaran dicatat metode `MARKETPLACE` (dana dicairkan marketplace).
- **Stok yang dikirim** = tersedia di cabang sumber − buffer, hanya yang berubah sejak push terakhir (hemat kuota API). Satu cabang sumber per toko.
- **Idempotensi & ketahanan**: upsert per kanal + nomor order (unique index), tarik ulang dengan jendela tumpang, order yang gagal (belum dipetakan/stok kurang) disimpan di `retry_order_nos` dan dicoba setiap sinkron; webhook diverifikasi HMAC; error auth menandai koneksi `ERROR`.
- **Kredensial** dienkripsi AES-256-GCM di DB, tidak pernah dikirim ke client/MCP; state OAuth bertanda tangan + kedaluwarsa 15 menit + terikat ke user.
- Melepas pemetaan manual mengembalikan listing ke pemetaan otomatis SKU pada sinkron katalog berikutnya.

## ADR-021 — Mode offline kasir — Diterima — 2026-10-18
- **Lingkup**: kasir tetap bisa menjual selama tab kasir terbuka ketika internet putus (kasus paling umum). Memuat ulang halaman saat offline butuh service worker/PWA — ditunda.
- **Harga tepercaya tanpa server**: paket offline berisi harga yang ditandatangani HMAC server (kunci turunan `BETTER_AUTH_SECRET`), berlaku 48 jam; server hanya menerima harga yang tanda tangannya cocok. Perangkat yang diretas tidak bisa menurunkan harga tanpa ketahuan.
- **Antrean di IndexedDB** dengan Idempotency-Key per transaksi; sinkron berurutan, idempoten, dan aman bila koneksi putus di tengah pembayaran online (kunci yang sama dipakai ulang → tidak dobel).
- **Transaksi tetap dicatat walau stok kurang** saat sinkron (barang sudah diserahkan); stok dipotong sebanyak yang ada, kekurangannya disimpan di `offline_shortfall` dan diberitahukan agar dicek/opname. Ini satu-satunya jalur yang boleh "melewati" pengecekan stok, dan tercatat di audit.
- **Waktu transaksi = waktu perangkat** (laporan harian benar), dibatasi: tidak di masa depan, maks 7 hari, harus dalam masa berlaku paket. Shift harus masih buka; tutup shift diblokir di client selama ada antrean.
- Fitur yang butuh keputusan server (member/poin, voucher & kuota, diskon manual + PIN, QRIS dinamis, retur/void) dinonaktifkan saat offline agar tidak ada konflik saat sinkron.

## ADR-022 — PWA kasir dengan service worker buatan sendiri — Diterima — 2026-10-18
- **Tanpa library** (next-pwa/serwist): kebutuhan sempit (satu halaman kasir), menghindari dependensi build tambahan, dan strategi mudah diaudit di satu file `public/sw.js`.
- **Hanya `/pos` yang dapat dibuka offline**; back-office tetap butuh koneksi (data harus segar) dan mendapat halaman `offline.html`.
- **API tidak pernah di-cache oleh SW** — data offline dikelola aplikasi (IndexedDB: paket bertanda tangan, sesi kasir, antrean), sehingga tidak ada data basi yang tampil sebagai data "live".
- Shell kasir berisi identitas pengguna → disimpan hanya bila halaman benar-benar tampil (bukan redirect stream `NEXT_REDIRECT`), dihapus saat keluar; keluar ditolak bila antrean offline belum kosong (antrean terikat ke kasir & shift).
- SW didaftarkan hanya di production; di development dilepas otomatis agar Turbopack tidak terganggu cache lama.

## ADR-023 — Adapter TikTok Shop / Tokopedia — Diterima — 2026-10-18
- **Satu adapter untuk TikTok Shop dan Tokopedia**: toko Tokopedia kini dikelola lewat TikTok Shop Partner API; kanal `TIKTOK`, label "TikTok Shop / Tokopedia".
- **API versi 202309** (signature mencakup body). Kontrak `MarketplaceAdapter` tidak berubah; data tambahan per toko (`shop_cipher`, gudang default) disimpan di `Credentials.extra` sehingga ikut terenkripsi dan dipertahankan saat refresh token.
- **Satu gudang** (gudang penjualan default) untuk push stok, konsisten dengan model satu cabang sumber per toko. Multi-gudang ditunda.
- **Belum ada akun uji** → kebenaran format diverifikasi dengan pemeriksaan fetch tiruan (`pnpm check:marketplace`) yang juga memvalidasi signature tiap panggilan; uji akun sungguhan wajib sebelum produksi (Q-32).

## ADR-024 — Laporan stok & shift dihitung dari ledger, tanpa tabel snapshot — Diterima — 2026-10-18
- **Pergerakan & saldo** dihitung mundur dari stok sekarang (`inventory_levels`) dikurangi mutasi `stock_movements` setelah akhir periode. Ledger adalah satu-satunya sumber; tidak ada tabel snapshot harian yang bisa tidak sinkron. Konsekuensi: periode panjang membaca lebih banyak mutasi — dibatasi 1 tahun, index `(branch_id, created_at)` sudah ada.
- **Valuasi memakai HPP varian saat ini**, bukan HPP historis/rata-rata bergerak (belum dicatat per penerimaan). Valuasi historis per tanggal ditunda sampai HPP per penerimaan tersedia.
- **SKU tanpa HPP tidak membuat nilai modal kosong**: nilai modal menjumlah SKU ber-HPP dan jumlah SKU tanpa HPP ditampilkan terpisah; margin potensial hanya dari SKU ber-HPP. Nilai modal disembunyikan tanpa `product:view_cost`.
- **Umur stok** = hari sejak barang terakhir masuk (stok awal/penerimaan/transfer masuk), bukan FIFO per lot — tidak ada data lot. Cukup untuk mendeteksi barang lambat laku.
- **Kas seharusnya** memakai nilai yang disimpan saat shift ditutup; untuk shift yang masih buka dihitung dari kas awal + tunai masuk − refund tunai.
- Semua laporan stok/shift memakai permission `report:read`/`report:export` yang sama dengan laporan penjualan; pemisahan untuk peran MD menunggu keputusan (Q-34).

## ADR-025 — Media di Cloudinary dengan cadangan database — Diterima — 2026-10-20
- **Cloudinary** dipilih owner untuk aset gambar/video: CDN, transformasi on-the-fly (`f_auto,q_auto`, potong kotak), tanpa server file sendiri — cocok untuk hosting serverless.
- **Tanpa SDK**: REST API resmi dengan tanda tangan SHA-1 dibuat di server (`src/server/media/cloudinary.ts`); API secret tidak pernah ke browser; tidak ada upload preset unsigned. Mengurangi dependensi & permukaan supply-chain.
- **Unggahan lewat API Konten** (izin `product:update`, cek isi file) — bukan langsung dari browser ke Cloudinary — agar RBAC & audit log berlaku sama. Gambar diperkecil di perangkat dulu (hemat kuota pengguna & kredit Cloudinary).
- **Cadangan database** (bytea) bila env Cloudinary kosong: proyek open source tetap jalan tanpa akun pihak ketiga; tidak untuk produksi besar.
- public_id tetap per produk + versi di URL → ganti gambar tidak meninggalkan cache basi; aset lama dihapus saat dihapus/diganti URL manual.

## ADR-026 — Header keamanan halaman & rate limit — Diterima — 2026-10-20
- Halaman sebelumnya tanpa header keamanan (hanya API). Kini CSP dkk. untuk semua halaman.
- CSP skrip memakai `'unsafe-inline'`: Next menyisipkan skrip inline; nonce memaksa semua halaman dinamis (bertentangan dengan Cache Components/PPR). Dikompensasi tanpa skrip pihak ketiga, `object-src 'none'`, `base-uri`/`form-action 'self'`, `frame-ancestors 'none'`, escaping React, sanitasi input.
- Rate limit in-memory per instance (sederhana, tanpa Redis). Untuk multi-instance, rate limit tambahan di reverse proxy/CDN.

## ADR-027 — SKU & barcode unik global dengan counter — Diterima — 2026-10-20
- SKU & barcode satu ruang nama (scan mencocokkan keduanya) → unik silang, SKU tanpa beda kapital.
- Kode otomatis dari counter global (`number_sequences`) + pengecekan ulang ke database (kode manual bisa kebetulan sama) di bawah advisory lock transaksi — bukan acak, sehingga tidak ada peluang tabrakan.
- Barcode otomatis EAN-13 awalan `20` (rentang GS1 untuk pemakaian internal toko) agar tidak bentrok dengan barcode pabrik dan bisa dicetak printer label standar. Barcode manual angka 8/12/13/14 digit divalidasi digit ceknya.

## ADR-028 — Master data & normalisasi nama — Diterima — 2026-10-20
- Nilai yang dipakai untuk filter/laporan tidak boleh teks bebas: **merek** menjadi tabel master (seperti kategori), satu merek lintas kategori.
- Keunikan memakai **kunci normal** (`nameKey`: huruf kecil, tanpa aksen, tanpa spasi & tanda baca) — menangkap beda kapital/spasi/tanda baca; ejaan mirip (typo) ditangani dengan saran trigram + fitur **gabungkan**, bukan ditolak otomatis (nama berbeda bisa sah).
- Kapitalisasi tampilan mengikuti input (merek seperti "iPhone"); spasi dirapikan.
- Field yang tidak layak tabel master tetapi rawan beda ejaan dirapikan di server: kurir (daftar + alias, layanan dipertahankan), nama variasi (ikut ejaan terbanyak yang sudah ada). UI memakai `SearchSelect` yang menampilkan yang ada dulu sebelum opsi tambah.

## ADR-029 — Validasi di API sebagai sumber kebenaran — Diterima — 2026-10-20
- Semua aturan (format, batas, keunikan, aturan bisnis) ada di API/service; UI hanya umpan balik cepat. Klien API luar (integrasi, AI/MCP) mendapat validasi identik.
- Setiap input dibatasi (string `maxLength`, angka `maximum`, array `maxItems`) — diperiksa otomatis dari spesifikasi OpenAPI.
- Field tak dikenal: default Zod membuang (aman dari mass assignment); untuk input produk dipakai `.strict()` agar salah nama field terlihat. Perluasan ke semua route ditunda (risiko memutus klien yang mengirim field ekstra).

## ADR-030 — Cetak struk di browser, per perangkat — Diterima — 2026-10-21
- Struk dicetak dari browser tanpa aplikasi/agen tambahan: dialog cetak OS (kompatibilitas terluas) atau byte ESC/POS langsung lewat WebUSB/Web Serial/Web Bluetooth (Chrome/Edge) untuk cetak tanpa dialog. PDF dibuat di klien.
- Pengaturan printer disimpan per perangkat (localStorage), bukan di server: printer melekat pada mesin kasir, dan izin perangkat browser memang per origin+perangkat.
- Satu tata letak teks lebar tetap untuk semua keluaran → isi struk identik di thermal, PDF, dan pratinjau.
- Ditolak: agen cetak lokal (QZ Tray/print server) — perlu instalasi & sertifikat; bisa ditambah kelak sebagai cara cetak baru tanpa mengubah tata letak.

## ADR-031 — EDC terintegrasi (ECR) di browser + layar pelanggan — Diterima — 2026-10-21
- EDC tetap **manual** sebagai bawaan (semua bank). Mode **tersambung kabel (ECR)** opsional lewat Web Serial: lapisan framing STX/ETX/LRC + registri protokol; protokol bank ditambahkan hanya dari spesifikasi resmi bank (tidak menebak). Disediakan protokol terbuka **Konten ECR v1** untuk vendor/jembatan dan **simulator** (hanya bila simulator pembayaran aktif).
- Keamanan uang: dialog terkunci saat EDC memproses; hasil EDC disimpan di layar sehingga "Simpan ulang" tidak menagih ulang; error tidak pasti → cek slip. PCI: hanya PAN tersamar (4 digit terakhir) yang boleh sampai ke server.
- Layar pelanggan = jendela kedua di browser yang sama via BroadcastChannel (tanpa server). Tablet terpisah butuh kanal realtime (ditunda).
- QRIS CPM (scan kode bayar pelanggan) ditunda: butuh gateway yang mendukung; Midtrans hanya MPM.

## ADR-032 — OAuth 2.1 sendiri untuk MCP — Diterima — 2026-10-21
- Claude web/Desktop Connectors dan ChatGPT memakai login OAuth (spesifikasi otorisasi MCP). Dibangun sendiri (±400 baris) alih-alih menambah dependensi: Better Auth 1.7 yang terpasang tidak menyertakan OAuth provider, dan paket baru wajib dipindai.
- PKCE S256 wajib, DCR terbuka dengan validasi `redirect_uri` ketat, refresh token dirotasi + deteksi pemakaian ulang, token di-hash, access 1 jam / refresh 30 hari.
- Token OAuth **hanya-baca** di middleware (GET + MCP), terlepas dari role pemilik — AI agent tidak bisa mengubah data. API key tetap tersedia untuk klien berbasis header.
