# PRD — Sistem POS Multi-Cabang

> Status: **DRAFT v0.2** — owner meminta pengerjaan dilanjutkan; fitur yang sudah ada ditandai ✅ di §3.
> Terakhir diubah: 2026-10-17. **Produk open source untuk segala jenis bisnis retail** (jawaban owner).
> Pertanyaan terbuka yang memblokir keputusan ada di [OPEN_QUESTIONS.md](./OPEN_QUESTIONS.md). Bagian yang bergantung pada jawaban ditandai **[Q-xx]**.

---

## 1. Latar Belakang & Tujuan

Sistem ini **open source dan generik** untuk bisnis apa pun yang menjual lewat toko fisik (beberapa cabang) dan kanal online. Fitur khusus jenis usaha (batch/kedaluwarsa, modifier F&B, nomor seri) dirancang sebagai opsi yang bisa diaktifkan. Saat ini data produk, stok, dan transaksi tersebar sehingga stok sering tidak sinkron dan performa promo sulit diukur.

**Tujuan produk:**
1. Satu sumber kebenaran (single source of truth) untuk produk, varian, stok per cabang, dan transaksi, baik offline maupun online.
2. Kasir bisa menyelesaikan transaksi dalam waktu kurang dari 30 detik untuk 3 item, termasuk scan barcode, voucher, member, dan pembayaran.
3. Tim stok (MD) bisa mengelola stok antar cabang tanpa spreadsheet: penerimaan, transfer, opname, penyesuaian.
4. Owner/manajer bisa melihat performa penjualan, produk, cabang, dan voucher dalam satu dashboard.
5. AI Agent bisa membaca data lewat MCP Server, misalnya "stok kaos hitam L di cabang Bandung berapa?" atau "performa voucher 7 hari terakhir".

**Bukan tujuan (fase 1):** akuntansi lengkap (jurnal, neraca), payroll, e-commerce storefront publik **[Q-03]**, aplikasi mobile native.

## 2. Persona & Role Bawaan

Role bisa dibuat bebas lewat RBAC (lihat §6). Ini role bawaan (seed) yang bisa diubah:

| Role | Siapa | Akses inti |
|---|---|---|
| **Owner / Super Admin** | Pemilik brand | Semua fitur di semua cabang, termasuk RBAC, pengaturan pembayaran, API key. Tidak bisa dihapus. |
| **Admin** | Admin pusat | Produk, kategori, voucher, membership, customer, laporan semua cabang, kelola user (kecuali Owner). Tidak bisa mengubah pengaturan payment gateway & API key. |
| **MD (Merchandiser / Pengelola Stok)** | Tim stok | Produk (read/write), stok semua cabang: penerimaan, transfer, opname, adjustment, supplier, PO. Laporan stok. Tidak bisa melihat laporan keuangan & membuat voucher. |
| **Kepala Toko / Store Manager** | Pimpinan cabang | Semua operasional di **cabangnya sendiri**: approve void/refund, shift, laporan cabang, approve transfer masuk. |
| **Kasir** | Staf toko | Layar POS, buka/tutup shift, lihat stok (read), daftar member baru, cari customer. Void/refund/diskon manual perlu PIN approval Kepala Toko. |
| **Online Admin** | Admin kanal online | Input/kelola order online, update status pengiriman, lihat stok semua cabang. |
| **Viewer / Analyst** | Investor, finance | Read-only dashboard & laporan. |

## 3. Ruang Lingkup Fitur

Prioritas: **P0** = wajib MVP, **P1** = rilis kedua, **P2** = nanti.

### 3.1 Autentikasi & Akun — P0 (✅ login/logout, rate limit, sesi 12 jam, kunci akun setelah 5 gagal, ganti password sendiri, reset oleh admin; ⏳ PIN kasir, 2FA, lupa password via email)
- Login email + password; sesi berbasis cookie httpOnly (detail di ARCHITECTURE.md).
- **PIN 6 digit kasir** untuk switch user cepat di perangkat POS bersama dan untuk approval supervisor.
- 2FA (TOTP) opsional, **wajib untuk Owner & Admin**.
- Lupa password via email **[Q-12]**.
- Kunci akun setelah 5 kali gagal login, rate limit per IP.
- Daftar sesi aktif + "logout dari semua perangkat".
- User bisa di-assign ke satu atau beberapa cabang.

### 3.2 Manajemen Cabang (Multi-Outlet) — P0 (✅ API, pemilih cabang, UI kelola cabang + PPN & struk)
- CRUD cabang: kode, nama, alamat, telepon, jam operasional, zona waktu, NPWP opsional.
- Tipe lokasi: `STORE` (toko fisik), `WAREHOUSE` (gudang, tidak berjualan), `ONLINE` (stok virtual kanal online) **[Q-04]**.
- Pengaturan per cabang: header/footer struk, pajak (PPN aktif/tidak, inclusive/exclusive), metode pembayaran aktif, printer.
- Harga per cabang (override harga default) — P1.
- Perangkat POS / register per cabang (Kasir 1, Kasir 2) dengan shift masing-masing.

### 3.3 Manajemen Produk — P0 (✅ master merek (unik ternormalisasi, gabungkan merek ganda), saran nama variasi seragam; ✅ list, detail, tambah dengan variasi, SKU & EAN-13 otomatis unik global atau manual tervalidasi, ubah informasi & varian, arsip, thumbnail (Cloudinary), cetak label barcode (EAN/UPC/Code 128, gulungan & A4); ✅ kategori; ⏳ foto banyak per produk/varian, import/export)
**Produk induk:**
- Nama, slug, deskripsi (rich text sederhana), brand/koleksi, kategori (bertingkat hingga 3 level), tag.
- Foto banyak (drag untuk urutkan, foto utama), upload ke object storage **[Q-08]**.
- Status: `DRAFT`, `ACTIVE`, `ARCHIVED`. Produk yang pernah bertransaksi tidak bisa dihapus permanen, hanya diarsipkan.
- Atribut tambahan: berat, dimensi (untuk ongkir online), satuan (pcs, box), pajak khusus.

**Varian:**
- Hingga 3 opsi variasi (misal Warna × Ukuran × Bahan); kombinasi digenerate otomatis lalu bisa dinonaktifkan per kombinasi.
- Per varian: **SKU** (unik global, bisa auto-generate dari pola, misal `{KATEGORI}-{PRODUK}-{WARNA}-{UKURAN}`), **barcode** (EAN-13/Code128, unik, bisa auto-generate), harga jual, harga coret (compare-at), harga modal (HPP), berat, foto varian, status aktif.
- Produk tanpa varian tetap disimpan sebagai 1 varian default (konsisten di data model).

**Stok per cabang per varian:**
- Kuantitas on-hand, reserved (sudah dipesan online belum dikirim), available = on-hand − reserved.
- Minimum stok (reorder point) per cabang → notifikasi stok menipis.
- Lokasi rak/bin opsional — P2.

**Operasi massal:**
- Import produk & varian via CSV/XLSX dengan template, preview, validasi per baris, laporan error — P0.
- Export CSV/XLSX — P0.
- Bulk edit harga/status/kategori — P1.
- Cetak label barcode (pilih varian + jumlah, format label 33×15mm / 50×25mm) — P0.

**Lainnya:**
- Bundle/paket produk (1 SKU bundle mengurangi stok beberapa komponen) — P1.
- Batch & tanggal kedaluwarsa — P1 sebagai opsi per produk (sistem generik: kosmetik/F&B membutuhkannya).
- Nomor seri (serial number) — P2.

### 3.4 Manajemen Stok (Inventory) — P0 (✅ ledger, stok per cabang, penerimaan & penyesuaian via scan, kartu stok, batas minimum (API); transfer antar cabang (kirim/terima via scan, selisih), stok opname sebagian/penuh via scan + posting; ⏳ permintaan stok antar cabang, surat jalan, opname per kategori)
Semua perubahan stok **wajib** lewat *stock movement* (ledger) — tidak ada update angka stok tanpa catatan. Ini yang membuat stok bisa diaudit.

| Operasi | Deskripsi | Approval |
|---|---|---|
| **Penerimaan barang (Goods Receipt)** | Barang masuk dari supplier/produksi, bisa dari PO | — |
| **Transfer antar cabang** | Status: Draft → Dikirim (stok keluar dari asal, masuk "in-transit") → Diterima (stok masuk tujuan, selisih tercatat) | Kepala toko tujuan konfirmasi terima |
| **Stock opname** | Hitung fisik per cabang (penuh atau sebagian per kategori), bisa scan barcode, sistem tampilkan selisih, posting → adjustment otomatis | Kepala Toko / MD |
| **Adjustment** | Rusak, hilang, sampel, koreksi — wajib alasan | Sesuai permission |
| **Penjualan / retur** | Otomatis dari transaksi | — |
| **Reservasi online** | Order online me-reserve stok sampai dikirim/dibatalkan | — |

- Riwayat pergerakan stok per varian per cabang (kartu stok) dengan filter tanggal, tipe, user.
- Supplier & Purchase Order (PO) — P1.
- Valuasi stok (metode **rata-rata tertimbang / moving average**) — P1 **[Q-06]**.
- Pencegahan oversell: stok tidak boleh minus kecuali setting cabang mengizinkan **[Q-07]**. Pengurangan stok memakai row lock / atomic update di database untuk mencegah race condition antar kasir & kanal online.

### 3.5 Point of Sale (Layar Kasir) — P0 (✅ shift buka/tutup + selisih kas, scan/cari, keranjang, tunai/QRIS/EDC/transfer manual, struk 58/80 mm, void, riwayat shift, F2/F8; customer/voucher, tukar poin, retur dari struk (tunai/metode asal, stok kembali bila layak jual); diskon manual + PIN atasan, void/retur dengan PIN; ⏳ split payment di UI, hold, tukar barang/store credit, struk WhatsApp, offline)
Layar paling kritis — optimasi untuk kecepatan, keyboard & barcode scanner.

- Buka shift dengan kas awal; tutup shift dengan hitung kas, sistem tampilkan selisih (expected vs actual) per metode bayar.
- Cari produk: scan barcode (scanner USB = input keyboard), ketik nama/SKU (search instan), grid kategori dengan foto.
- Keranjang: ubah qty, pilih varian, catatan item, diskon item manual (perlu permission/PIN).
- Pilih customer: cari nomor HP/nama, atau daftarkan member baru dalam 1 dialog cepat.
- Terapkan voucher (kode) — sistem validasi aturan & tampilkan alasan jika ditolak ("Minimal belanja Rp200.000, kurang Rp35.000").
- Poin member: lihat saldo, tukar poin sebagai potongan.
- Pembayaran: tunai (dengan kembalian & tombol nominal cepat), QRIS dinamis, kartu debit/kredit via EDC (input manual nomor approval), e-wallet, transfer, **split payment** (beberapa metode dalam 1 transaksi).
- Hold / park transaksi & lanjutkan nanti.
- Pembayaran kartu: EDC manual ✅; EDC tersambung kabel (ECR) ✅ kerangka + protokol terbuka + simulator, protokol bank menyusul (Q-39); layar pelanggan (monitor kedua) ✅.
- Struk: cetak thermal 58/80mm ✅ — printer terpasang (dialog OS), USB/serial/Bluetooth langsung (ESC/POS), PDF, cetak otomatis, laci kas; kirim struk digital via WhatsApp/email **[Q-11]**.
- Void transaksi (hari yang sama, sebelum tutup shift) & retur/refund (dengan referensi struk; stok kembali; refund ke metode asal atau store credit).
- Pintasan keyboard: `F2` cari, `F4` customer, `F8` bayar, `Esc` batal, dll.
- **Mode offline** — P1 **[Q-01]** (✅ katalog & harga bertanda tangan di perangkat, antrean transaksi, sinkron otomatis idempoten, kekurangan stok dicatat, PWA: kasir bisa dipasang & dibuka ulang tanpa internet; ⏳ member/voucher/retur offline, Background Sync).

### 3.6 Penjualan Online (Omnichannel) — P0/P1 **[Q-02]** (✅ input order manual, reservasi stok, status sampai selesai/batal, kedaluwarsa otomatis, lunas → transaksi; integrasi marketplace via adapter (Shopee, TikTok Shop/Tokopedia, simulator): tarik order otomatis (webhook + cron), sinkron stok dengan buffer, pemetaan SKU; ⏳ uji akun Shopee/TikTok sungguhan, Lazada, sinkron harga, label kirim, public API order)
- Kanal penjualan sebagai master data: `POS`, `WEBSITE`, `SHOPEE`, `TOKOPEDIA/TIKTOK SHOP`, `WHATSAPP`, `INSTAGRAM`, dll.
- **P0 — Input order online manual**: admin online membuat order (customer, alamat, ongkir, kanal, nomor order eksternal), pilih cabang/gudang sumber stok → stok di-reserve → status: `PENDING_PAYMENT` → `PAID` → `PACKED` → `SHIPPED` → `COMPLETED` / `CANCELLED` / `RETURNED`.
- **P1 — Integrasi marketplace via API** (sinkron stok & tarik order otomatis) — tergantung akses Open API marketplace **[Q-02]**.
- **P1 — Public API / webhook** agar website toko sendiri bisa membuat order & cek stok.
- Nomor resi & kurir; label pengiriman — P2.

### 3.7 Pembayaran & Integrasi Payment Gateway — P0 (✅ abstraksi `PaymentProvider`, Midtrans QRIS + simulator, webhook bersignature & idempoten, cek status, **QRIS dinamis di kasir** (QR di layar → lunas otomatis); ⏳ VA/e-wallet/kartu, refund gateway, rekonsiliasi, customer display)
- Abstraksi `PaymentProvider` sehingga gateway bisa diganti/ditambah tanpa mengubah logika transaksi.
- Rekomendasi gateway pertama: **Midtrans** atau **Xendit** **[Q-09]** — QRIS dinamis, VA bank, e-wallet (GoPay, OVO, DANA, ShopeePay), kartu.
- Alur QRIS di kasir: buat charge → tampilkan QR di layar → polling/webhook status → otomatis lunas.
- Webhook endpoint dengan verifikasi signature, idempotent (event yang sama diproses sekali).
- Metode manual (tunai, EDC, transfer manual) tetap tersedia tanpa gateway.
- Rekonsiliasi: daftar pembayaran gateway vs transaksi, status settlement — P1.
- Biaya MDR dicatat per metode untuk laporan margin — P1.

### 3.8 Voucher & Promosi — P0 (✅ semua atribut tabel di bawah kecuali kode unik massal & jam/hari tertentu; aturan perhitungan 1–6 terimplementasi di `priceCart`; performa voucher; ⏳ promo otomatis, kode massal, bertumpuk)
**Atribut voucher:**

| Atribut | Detail |
|---|---|
| Kode | Unik, case-insensitive. Bisa generate massal kode unik sekali pakai (misal 500 kode untuk kampanye) |
| Tipe nilai | `NOMINAL` (Rp) atau `PERSEN` (%) |
| Maks. potongan | Wajib diisi bila tipe PERSEN (contoh: 20% maks Rp50.000) |
| Min. belanja | Subtotal minimal setelah diskon lain (dihitung dari item yang eligible) |
| Maks. belanja | Voucher tidak berlaku bila subtotal melebihi nilai ini |
| Periode | Tanggal & jam mulai–berakhir; opsional jam/hari tertentu (happy hour) — P1 |
| Kuota total | Jumlah pemakaian maksimal semua customer |
| Kuota per customer | Maks. pemakaian per customer (butuh customer teridentifikasi) |
| Cakupan produk | Semua produk / kategori tertentu / produk tertentu / **varian tertentu**; dan daftar pengecualian |
| Cakupan customer | Semua / customer tertentu (daftar) / **hanya member** / tier member tertentu |
| Cakupan cabang & kanal | Cabang tertentu, kanal tertentu (POS saja, online saja) |
| Stackable | Bisa digabung dengan voucher lain atau tidak (default: tidak, 1 voucher per transaksi) **[Q-10]** |
| Status | Draft, Aktif, Dijeda, Berakhir |

**Aturan perhitungan (penting, harus konsisten di POS, online, dan API):**
1. Potongan dihitung hanya dari **item yang eligible** sesuai cakupan.
2. Potongan PERSEN = `min(persen × subtotal_eligible, maks_potongan)`.
3. Potongan tidak melebihi subtotal eligible.
4. Potongan dialokasikan proporsional ke tiap item eligible (dibutuhkan untuk retur parsial & laporan margin per produk).
5. Kuota diklaim secara atomik saat transaksi lunas; transaksi void/refund penuh mengembalikan kuota.
6. Pajak dihitung setelah diskon.

**Performa voucher:** jumlah pemakaian, total diskon, omzet yang dihasilkan, rata-rata nilai transaksi, customer baru vs lama, sisa kuota — per periode.

**Promo otomatis (tanpa kode)** — P1: diskon produk/kategori periode tertentu, Beli X Gratis Y, harga grosir bertingkat.

### 3.9 Customer & Membership — P0 (✅ data customer + persetujuan, tier otomatis + diskon, poin earn + ledger, no. member, tukar poin (nilai/minimal/porsi maks di Pengaturan); ⏳ masa berlaku poin, kartu QR, voucher ulang tahun, hapus/anonimkan data)
- Data customer: nama, nomor HP (unik, kunci utama identifikasi), email, tanggal lahir, gender opsional, alamat (banyak, untuk online), catatan, tag.
- Riwayat transaksi, total belanja, frekuensi, terakhir belanja.
- **Persetujuan data pribadi** (UU PDP): checkbox persetujuan saat daftar, opsi hapus/anonimkan data.

**Membership:**
- Tier (misal Silver, Gold, Platinum) dengan syarat naik tier (total belanja dalam N bulan) dan benefit (diskon % otomatis, multiplier poin).
- Poin: earn (contoh Rp10.000 = 1 poin), redeem (1 poin = Rp100), masa berlaku poin, ledger poin (sama seperti stok: setiap perubahan tercatat).
- Kartu member digital (nomor member + QR) yang bisa discan di kasir.
- Voucher ulang tahun otomatis — P1.
- Program membership: gratis otomatis saat daftar atau berbayar? **[Q-13]**

### 3.10 Laporan & Dashboard Analitik — P0 (✅ dashboard; laporan penjualan bersih per hari/cabang/kasir/kanal/kategori/produk/metode bayar, laporan retur per alasan/produk/pemroses/cabang, valuasi persediaan, umur stok & barang lambat laku, pergerakan stok (saldo awal–akhir, perputaran), shift & selisih kas per kasir, export CSV; ⏳ grafik tren, valuasi historis, laporan terjadwal)
Dashboard bergaya BoardUI (lihat DESIGN_SYSTEM.md), filter global: rentang tanggal, cabang, kanal.

- **Ringkasan**: omzet, jumlah transaksi, rata-rata nilai transaksi (AOV), laba kotor, item terjual — dengan pembanding periode sebelumnya.
- **Grafik**: tren penjualan (harian/mingguan/bulanan), penjualan per jam (heatmap jam × hari), per cabang, per kanal, per metode bayar.
- **Produk**: terlaris, paling lambat (slow moving), dead stock (tidak terjual N hari), margin per produk/kategori.
- **Stok**: nilai stok per cabang, stok menipis, stok habis, rekomendasi restock berdasarkan kecepatan jual — P1.
- **Voucher**: performa per voucher (§3.8).
- **Customer**: member baru, repeat rate, top customer, distribusi tier.
- **Kasir/Shift**: penjualan per kasir, selisih kas, void/refund per kasir (deteksi fraud).
- Export semua laporan ke XLSX/PDF.
- Laporan berat (> 90 hari) diproses di background job, hasil dikirim/diunduh setelah selesai — P1.

### 3.11 RBAC (Role-Based Access Control) — P0 (✅ API, penegakan, UI matriks role, penugasan role per cabang)
Detail di §6.

### 3.12 Audit Log — P0 (✅ pencatatan, API, halaman)
- Setiap aksi tulis (create/update/delete, login, ubah harga, ubah permission, void, refund, adjustment stok) tercatat: siapa, kapan, IP, user agent, entitas, nilai sebelum & sesudah.
- Halaman audit log dengan filter; read-only, tidak bisa dihapus dari UI.

### 3.13 Notifikasi — P1
- In-app (lonceng): stok menipis, transfer menunggu diterima, voucher hampir habis kuota, selisih kas besar, pembayaran gagal.
- Email/WhatsApp untuk ringkasan harian ke owner — P2.

### 3.14 Pengaturan — P0
- Profil bisnis (nama, logo, NPWP), mata uang IDR, format angka Indonesia.
- Pajak: PPN 11%/12% inclusive/exclusive **[Q-14]**, service charge opsional.
- Pola penomoran (invoice `INV/{CABANG}/{YYYYMMDD}/{SEQ}`, transfer, PO).
- Pengaturan payment gateway (kredensial terenkripsi).
- API key untuk integrasi & MCP (lihat §3.15), dengan scope permission.

### 3.15 MCP Server untuk AI Agent — P0 (✅ 19 tool stok/transfer/opname/produk/penjualan/retur/order online/voucher/customer, lihat docs/MCP.md)
- Endpoint MCP (Streamable HTTP) di `/api/mcp`, autentikasi via **API key personal** yang terikat ke user → **permission AI = permission user pemilik key** (AI tidak bisa melihat data cabang yang user itu tidak boleh lihat).
- Fase 1 **read-only** (aman). Tools write (misal buat transfer stok) — P2 dengan konfirmasi.
- Tools awal:

| Tool | Contoh pertanyaan |
|---|---|
| `check_stock` | "Stok SKU KAOS-HTM-L di semua cabang?" |
| `search_products` | "Cari produk dengan nama 'hoodie'" |
| `low_stock_report` | "Produk apa saja yang hampir habis di cabang Bandung?" |
| `sales_summary` | "Omzet minggu ini vs minggu lalu per cabang" |
| `top_products` | "10 produk terlaris bulan ini" |
| `voucher_performance` | "Performa voucher 7 hari terakhir" |
| `voucher_detail` | "Detail & sisa kuota voucher PAYDAY50" |
| `customer_lookup` | "Riwayat belanja customer 0812xxx" (data pribadi dimasking sebagian) |
| `stock_movements` | "Kenapa stok produk X berkurang 20 kemarin?" |
| `shift_summary` | "Ringkasan shift kasir hari ini di cabang Jakarta" |

- Semua tool memanggil service layer yang sama dengan REST API (satu jalur logika & permission).
- Setiap pemanggilan tool tercatat di audit log dan dibatasi rate limit.

### 3.16 Dokumentasi API — P0 (✅ Scalar di `/api/v1/reference`)
- Spesifikasi **OpenAPI 3.1** digenerate otomatis dari schema Zod (tidak ditulis manual → tidak basi).
- UI dokumentasi interaktif memakai **Scalar** (lebih modern dari Swagger UI: try-it, contoh kode multi bahasa, dark mode) di `/docs/api`, hanya bisa diakses user login dengan permission `api_docs:read` **[Q-15]**.
- Dokumentasi MCP tools juga ditampilkan.

## 4. Kebutuhan Non-Fungsional

| Area | Target |
|---|---|
| Performa | Layar POS interaktif < 2 detik pada koneksi 4G; pencarian produk < 200 ms (p95); API list p95 < 500 ms |
| Skala awal | Hingga 20 cabang, 50.000 varian, 5.000 transaksi/hari **[Q-16]** |
| Ketersediaan | 99,5% bulanan; backup DB harian otomatis, retensi 30 hari, uji restore berkala |
| Keamanan | OWASP Top 10, detail di ARCHITECTURE.md §Keamanan |
| Konsistensi data | Uang disimpan sebagai integer (rupiah, tanpa float); stok & poin via ledger; operasi transaksi dalam DB transaction |
| Aksesibilitas | Navigasi keyboard penuh, kontras WCAG AA, target sentuh ≥ 44px di layar POS (tablet) |
| Perangkat | Laptop, tablet, dan HP **sama pentingnya** — semua layar responsif, termasuk POS. Scan barcode via scanner USB/Bluetooth dan kamera |
| Bahasa | UI Bahasa Indonesia; struktur siap i18n (Inggris) — P2 |
| Zona waktu | Disimpan UTC, ditampilkan sesuai zona waktu cabang (WIB/WITA/WIT) |

## 5. Alur Utama (User Flow)

**Penjualan di kasir:** Login PIN → (buka shift bila belum) → scan item → pilih/daftar customer → input voucher → bayar (QRIS/tunai/split) → struk → stok terpotong, poin bertambah, kuota voucher terpakai, audit tercatat.

**Transfer stok:** MD buat transfer (asal, tujuan, item) → kirim (stok asal berkurang, status in-transit) → Kepala Toko tujuan scan & konfirmasi terima → selisih tercatat → stok tujuan bertambah.

**Order online:** Admin online input order → stok di-reserve di cabang sumber → pembayaran dikonfirmasi (manual/webhook) → packing → kirim (stok on-hand berkurang, reserve dilepas) → selesai.

**Voucher:** Admin buat voucher + aturan → aktif → dipakai di POS/online → dashboard performa → AI bisa bertanya via MCP.

## 6. RBAC — Spesifikasi

**Model:** `Permission = resource × action`, `Role = kumpulan permission`, `User ↔ Role` per **cakupan cabang**.

- **Action:** `read`, `create`, `update`, `delete`, `export`, `approve` (+ action khusus bila perlu, misal `pos:void`, `pos:discount_manual`, `pos:refund`, `product:view_cost` untuk melihat HPP).
- **Resource (awal):** `dashboard`, `product`, `category`, `inventory`, `stock_transfer`, `stock_opname`, `supplier`, `purchase_order`, `pos`, `shift`, `sale`, `online_order`, `customer`, `membership`, `voucher`, `payment`, `report`, `branch`, `user`, `role`, `setting`, `audit_log`, `api_key`, `api_docs`.
- **Cakupan data:** assignment role bisa `ALL_BRANCHES` atau cabang tertentu. Contoh: Budi = Kepala Toko di Bandung, Kasir di Jakarta.
- **UI pengelola role:** matriks resource × action dengan checkbox, preset dari role yang ada (duplikat role), hitung jumlah user per role.
- Role `Owner` terkunci (tidak bisa dihapus/dikurangi). User tidak bisa memberi permission yang tidak ia miliki sendiri (mencegah eskalasi hak akses).
- Field sensitif disaring per permission (contoh: tanpa `product:view_cost`, HPP & margin tidak dikirim dari API, bukan sekadar disembunyikan di UI).
- Penegakan di **server** (API & service layer) — UI hanya menyembunyikan tombol untuk kenyamanan.

## 7. Metrik Keberhasilan
- 100% transaksi offline & online tercatat di sistem dalam 1 bulan setelah go-live.
- Selisih stok opname turun ≥ 50% dalam 3 bulan.
- Waktu checkout rata-rata kasir < 30 detik.
- Laporan harian tersedia tanpa rekap manual.

## 8. Rencana Rilis (usulan)

| Fase | Isi | Estimasi relatif |
|---|---|---|
| **0. Fondasi** | Setup project, design system & komponen BoardUI, auth, RBAC, cabang, user, audit log, kerangka API + OpenAPI/Scalar | M |
| **1. Produk & Stok** | Produk/varian/kategori, import/export, label barcode, stok per cabang, ledger, transfer, opname, adjustment | L |
| **2. POS** | Layar kasir, shift, customer cepat, pembayaran manual + QRIS gateway, struk, void/retur | L |
| **3. Promo & Member** | Voucher lengkap, membership tier & poin | M |
| **4. Online & Laporan** | Order online manual, dashboard & laporan, MCP server | L |
| **5. Lanjutan (P1)** | Offline mode, PO/supplier, promo otomatis, integrasi marketplace, notifikasi, background report | L |

## 9. Risiko
- **Mode offline** bisa menggandakan kompleksitas POS (konflik stok, sinkronisasi). Diputuskan di [Q-01].
- **Integrasi marketplace** bergantung persetujuan akses Open API dari Shopee/TikTok Shop.
- **BoardUI Pro**: data table, chart, dan dashboard block adalah komponen Pro. Tanpa lisensi, komponen tersebut harus dibangun sendiri dengan gaya yang meniru BoardUI [Q-17].
- Race condition stok antara POS dan online → mitigasi: update atomik + row lock + reservasi.
