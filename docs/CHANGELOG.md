# Changelog

Entri terbaru di atas. Format: tanggal — ringkasan — file — belum selesai.

## 2026-11-03 — Sesi 24: repo pindah ke lifistudio, instalasi Docker
- Repositori pindah ke `github.com/lifistudio/pos`: URL di `install.sh`, `install.ps1`, README, INSTALL, dan `package.json` diperbarui.
- README: baris instalasi manual dihapus (panduannya tetap di INSTALL.md), ditambah instalasi lewat Docker.

## 2026-11-02 — Sesi 23: Xendit & DOKU, idempotensi menyeluruh, SMTP, installer, dependensi terbaru
**Keamanan dependensi.** Semua package ke versi terbaru: React 19.3.1 (advisory kritis 14 Oktober yang tidak dilaporkan `pnpm audit`), Next 16.4.4, better-auth, hono, postgres 4, motion 14, ESLint 10, embedded-postgres, pnpm 12. Pengecualian: TypeScript 6.0.3, bukan 7, karena typescript-eslint belum mendukung TS 7. `@tanstack/react-table` dihapus (tidak dipakai). `pnpm audit`: 0 kerentanan, prod maupun dev.

**Payment gateway** (ADR-036): Xendit (Payments API v3) dan DOKU (SNAP QRIS), dipilih lewat `PAYMENT_PROVIDER`. `src/server/payments/{types,xendit,doku}.ts`. Notifikasi DOKU hanya pemicu: status selalu ditanyakan ke DOKU. `providerByName` tidak terbatas pada gateway aktif, jadi QR lama tetap diproses setelah pindah gateway. `pnpm check:payments`.

**Idempotensi & balapan** (ADR-037), semua teruji di `check:flows` (47 skenario):
- Middleware `idempotent` + tabel `idempotency_keys` (migrasi 0020) untuk order online, penyesuaian stok, transfer, retur, produk. Sebelumnya klik ganda bisa menggandakan order, stok, atau refund.
- Satu QR aktif per dokumen (indeks unik parsial + advisory lock). Klik ganda QRIS tidak lagi menagih dua kali.
- Pembayaran ganda ditandai `DUPLICATE_PAYMENT`, sebelumnya tidak tercatat.
- Membatalkan QR mengecek dulu ke gateway apakah sudah dibayar.
- Kunci sama untuk keranjang berbeda ditolak, bukan mengembalikan transaksi lama. Bayar tunai dengan kunci QRIS yang belum lunas tidak lagi dianggap lunas.
- Shift: transaksi memegang kunci bersama, tutup shift memegang kunci eksklusif, jadi angka kas tidak bisa bergeser. Berlaku untuk checkout, void, retur tunai, dan sinkron offline.
- Opname mengunci stok sebelum menghitung selisih. Push stok marketplace berurutan per toko.

**Akun**: lupa password lewat SMTP opsional (`nodemailer`, halaman `/forgot-password`, `/reset-password`, tautan 1 jam sekali pakai, sesi diputus). Owner kedua lewat `SEED_OWNER2_*`.

**Pemasangan** (diuji dari nol di Windows tanpa Docker: pasang, jalankan, login berhasil): `install.sh`, `install.ps1`, `scripts/setup.mjs`, `scripts/start-local.mjs` (`pnpm local`), `docker-compose.prod.yml` dengan migrasi otomatis, `docs/INSTALL.md`, README baru.

**Docker**: `.env` tidak lagi masuk image. `next build` memakai nilai sementara, env sungguhan diberikan saat container berjalan (ADR-038).

**Merek**: `TRADEMARK.md`. Tidak ada pengaturan untuk mengganti logo.

**Belum**: uji Xendit/DOKU/Shopee/TikTok dengan akun sungguhan; uji jalur Docker (Docker tidak berjalan di mesin pengembang); format tanda tangan DOKU perlu dikonfirmasi di sandbox; pendaftaran service worker gagal di browser pane aplikasi (server menjawab benar), perlu dipastikan di Chrome biasa bahwa mode offline tetap aktif pada build produksi.

## 2026-11-02 — Sesi 22: audit menyeluruh, rebrand POS by lifistudio, siap open source
**Uji alur baru** `pnpm check:flows` (`scripts/checks/flows.check.mts`): 35 skenario terhadap PostgreSQL sungguhan (kasir, retur, voucher, QRIS, offline, transfer, opname, order online, marketplace, RBAC). Hanya mau berjalan di database lokal bernama `*check*`. Sebelum perbaikan 23 lulus, 8 gagal; sesudahnya 35 lulus. CI menjalankannya dengan service Postgres. `pnpm check:marketplace` kini juga menguji adapter Shopee (`shopee.check.mts`), yang sebelumnya tanpa uji.

**Marketplace, bug diperbaiki:**
- Shopee: respons 5xx/non-JSON terbaca "tidak ada order" sehingga jendela sinkron maju dan order terlewat selamanya. Sekarang gagal dan diulang.
- Webhook Shopee: tanda tangan dihitung dari URL internal di balik reverse proxy, jadi semua push akan ditolak di produksi. Kini memakai `BETTER_AUTH_URL`.
- Refresh token dipakai bersamaan oleh webhook & cron membuat koneksi putus (token sekali pakai). Kini baris dikunci.
- TikTok: gangguan server otorisasi salah dianggap token dicabut.
- Order yang sudah dikirim sebelum toko dihubungkan memotong stok dua kali. Kini dilewati.
- Order marketplace bisa dibatalkan/dilunasi lewat API lokal. Kini ditolak selama toko terhubung (`ORDER_FROM_MARKETPLACE`).
- Hubungkan ulang mengabaikan cabang yang dipilih. Antrean order tertunda bisa tertimpa webhook bersamaan. Total order bisa bergeser karena pembulatan harga rata-rata. Tanda tangan multi-byte membuat error 500.
- Nomor resi Shopee kini diambil dari `logistics/get_tracking_number`.
- **Stok dikirim beberapa detik setelah berubah** (`marketplace/stock-sync.ts`, ADR-035), bukan menunggu cron.

**Keamanan** (ADR-034):
- Admin bisa mereset password Owner lalu mengambil alih akun: akun Owner kini hanya bisa diubah Owner.
- Penugasan role diperketat: hak pengelolaan (role, user, api_key, setting, branch, marketplace) wajib dimiliki pemberi, cakupan cabang dicek, role sendiri tidak bisa diubah.
- Reset password memutus sesi aktif.
- Penguncian akun setelah 5 gagal login dalam 15 menit (PRD §3.1), audit `login`, `login_failed`, `change_password`.
- IP dari `X-Forwarded-For` kini dihitung dari kanan (`TRUSTED_PROXY_HOPS`): rate limit bisa dilewati dan IP audit bisa dipalsukan sebelumnya. Limit 20/menit per IP untuk login.
- Percobaan PIN lama saat ganti PIN ikut dihitung penguncian. Header Basic OAuth rusak tidak lagi error 500.
- Dependensi: `body-parser` (high) dan `fast-uri` diperbaiki lewat override; `pnpm audit --prod` bersih.

**Flow**: pengguna kini bisa **ganti password sendiri** (menu akun, `change-password-sheet.tsx`). Kolom input di Sheet tidak terlihat di mode gelap, diperbaiki lewat token di `app.css`.

**Merek** (ADR-033): nama **POS by lifistudio**, logo baru (gulungan struk membentuk huruf "p") di `public/brand`, `src/lib/brand.ts`, favicon, ikon PWA. Dibuat dari geometri oleh `scripts/brand/build-logo.mjs`. Logo lama (ikon Remix) melanggar Remix Icon License yang melarang ikon sebagai logo.

SVG logo seluruhnya berupa bentuk (tanpa stroke dan font, satu path), jadi aman diperbesar di Figma, Canva, atau percetakan. Tersedia lockup, tanda, dan ikon berkotak dalam versi gelap & terang, plus `social-preview.svg`. `logo-tile.svg` kini dipakai sebagai favicon.

**Open source**: LICENSE MIT atas nama lifistudio, `NOTICE.md` untuk pihak ketiga, salinan lisensi Apache-2.0 Impeccable, metadata `package.json`, logo & badge di README. Riwayat git diperiksa: tidak ada `.env` atau secret.

**Belum**: uji dengan akun Shopee/TikTok sungguhan (langkahnya di PANDUAN-MARKETPLACE §7). Endpoint yang tidak bisa dikonfirmasi ke dokumentasi resmi: `get_tracking_number`, format `ids` TikTok. Teks hak cipta BoardUI untuk NOTICE (Q-37). Lupa password lewat email (Q-12), 2FA.

## 2026-10-21 — Sesi 21: env lengkap & panduan semua fitur
- `.env.example` ditulis ulang lengkap per kelompok (wajib, akun Owner, QRIS Midtrans, Cloudinary, marketplace, pengembangan) dengan penjelasan dan sumber nilai; dicatat juga yang **tidak** memakai env (printer, EDC, layar pelanggan, OAuth). `DB_LOG_QUERIES` dan `TEST_KASIR_*` kini terdokumentasi. `.env` lokal ditambah kunci yang belum ada (sebagai komentar; nilai lama tidak diubah; `PAYMENT_PROVIDER=mock` ditulis eksplisit = perilaku sama).
- Panduan baru `PANDUAN-ENV.md` (juga di menu **Panduan › Pengaturan server**): di mana env diisi (lokal, VPS, hosting), tabel tiap variabel + cara mendapatkannya, contoh dev & produksi, masalah umum.
- `PANDUAN-PRINTER.md`: bagian **Mulai cepat printer thermal mini 58 mm** — tabel per perangkat (Android/Windows/Mac/iPhone × Bluetooth BLE/klasik/USB), langkah agar struk keluar otomatis, tips membeli printer; referensi tombol lama "Printer" diganti **Perangkat › Printer struk**.
- `PANDUAN-PENGGUNAAN.md`: Dashboard, menu Panduan, §5.9 Perangkat kasir (printer, EDC, layar pelanggan), EDC kabel, Aplikasi terhubung/OAuth, Dokumentasi API, pengaturan server, FAQ struk/EDC.

## 2026-10-21 — Sesi 20: EDC terhubung (ECR), layar pelanggan, OAuth untuk MCP, tampilan Panduan
Semua cara bayar lama (tunai, QRIS dinamis Midtrans, QRIS statis, EDC manual, transfer) **tetap**; fitur di bawah opsi tambahan.

**Mesin EDC tersambung kabel (ECR)** (ADR-031, `docs/ECR.md`): framing `src/lib/ecr-frame.ts` (STX/ETX/LRC, ACK/NAK, pengurai bertahap), registri protokol `src/lib/ecr-protocols.ts` dengan **Konten ECR v1** (protokol terbuka JSON untuk vendor/jembatan), transport Web Serial + simulator `src/components/app/payment-terminal/terminal.ts`, pengaturan per perangkat (**Perangkat › Mesin EDC**: manual/ECR/simulasi, hubungkan EDC, protokol, baud, batas tunggu). Dialog bayar: **Kirim Rp… ke EDC** → status dari EDC → lunas otomatis dengan approval/RRN/TID/kartu tersamar; ditolak → coba lagi; **Isi manual** selalu ada. Pengaman: dialog terkunci selama proses & setelah kartu tertagih; gagal simpan → **Simpan transaksi** tanpa tagih ulang; **Sudah di-void di mesin EDC** untuk keluar; timeout → cek slip. Server: `sale_payments.terminal` (migrasi `0018_payment_terminal`), validasi `.strict()` + karakter aman + **PAN wajib tersamar**, data EDC ditolak untuk tunai/transfer, `simulator` ditolak bila simulator pembayaran tidak aktif. Struk & halaman struk menampilkan kartu (4 digit), approval, RRN, TID. `pnpm check:ecr`.

**Layar pelanggan** (`/pos/display`, **Perangkat › Buka layar pelanggan**): monitor kedua di browser yang sama (BroadcastChannel, tanpa server) — keranjang real-time, QRIS dinamis yang sama dengan kasir (nominal + sisa waktu), terima kasih + kembalian, tombol layar penuh. Menu **Perangkat** di kepala kasir menggabungkan printer, EDC, dan layar pelanggan (kepala kasir tidak sesak di HP).

**OAuth 2.1 untuk MCP** (ADR-032): Claude web/Desktop (Connectors) & ChatGPT cukup URL MCP lalu login. Metadata `/.well-known/oauth-authorization-server` & `/.well-known/oauth-protected-resource[/api/mcp]` (rewrite → API), `401` + `WWW-Authenticate resource_metadata` di `/api/mcp`, DCR `POST /api/oauth/register` (validasi redirect_uri: https/loopback/skema aplikasi; javascript/data/file ditolak), layar persetujuan `/oauth/authorize` (login wajib, nama + alamat tujuan aplikasi), `POST /api/oauth/token` (PKCE S256 wajib, refresh dirotasi, pemakaian ulang refresh/kode → token dicabut), `POST /api/oauth/revoke`. Token **hanya-baca** (actor `OAUTH`: GET + MCP; mutasi → 403 `READ_ONLY_TOKEN`; tidak bisa membuat API key). **Pengaturan › API key & MCP › Aplikasi terhubung** (putuskan). Migrasi `0019_oauth`. Audit "Aplikasi AI". `pnpm check:oauth` (redirect_uri, vektor PKCE RFC 7636); e2e lulus: register, izin, PKCE salah/tanpa PKCE/redirect asing ditolak, token → MCP `tools/list` (21 tool) & `tools/call`, mutasi 403, rotasi refresh, refresh lama dipakai ulang → keluarga dicabut, kode dipakai ulang → token dicabut, putuskan dari UI.

**Halaman Panduan** dirapikan mengikuti BoardUI & DESIGN_SYSTEM: pola modul lain (`PageHeader` + `SubNav` tab per panduan), daftar panduan seperti daftar di Pengaturan (tanpa grid kartu), tabel `bui-table`, callout tanpa garis samping, blok kode dengan tombol salin, tautan accent, daftar isi sticky dengan penanda bagian aktif, judul tab per panduan, emoji dihapus dari dokumen. Panduan pembayaran ditulis ulang (EDC manual vs kabel, layar pelanggan, pengaman, masalah umum); panduan MCP: login OAuth untuk Claude & ChatGPT.

**Perbaikan**: halaman `/panduan/[slug]` memicu error prerender "`new Date()`" (validasi instant navigation) → `apiServer` menandai `await connection()` sebelum membaca sesi; `generateStaticParams` dihapus (isi tetap di-cache `use cache`). CI menjalankan `check:receipt`, `check:ecr`, `check:oauth`.

**Belum**: protokol ECR khusus bank (menunggu spesifikasi resmi, Q-39); uji dengan EDC & printer fisik; QRIS CPM; layar pelanggan di tablet terpisah; pembersihan otomatis klien OAuth yang tak terpakai.

## 2026-10-21 — Sesi 19: Cetak struk ke semua jenis printer, halaman Panduan, panduan MCP per klien AI, scroll ganda
**Cetak struk** (`src/lib/receipt/*`, `src/components/app/printing/*`, ADR-030):
- Satu sumber isi struk (`saleToReceipt`/`offlineToReceipt` → `layoutReceipt`, lebar tetap 32/48 karakter, ASCII aman) untuk semua cara cetak: **printer terpasang di perangkat** (dialog browser/OS via iframe tersembunyi — semua printer USB berdriver, LAN/Wi-Fi, Bluetooth via driver; tanpa dialog dengan Chrome `--kiosk-printing`), **USB langsung** (WebUSB), **Serial/COM** (Web Serial, termasuk Bluetooth Classic sebagai COM), **Bluetooth BLE** (Web Bluetooth, layanan printer thermal umum), dan **unduh PDF** (penulis PDF tanpa dependensi, ukuran halaman = lebar kertas). Printer langsung menerima **ESC/POS** standar (init, rata, tebal, ukuran ganda, potong, laci).
- **Pengaturan printer per perangkat** (tombol **Printer** di kasir; localStorage `konten:printer`): cara cetak, hubungkan printer (perangkat disimpan per jenis), baud rate, kertas 58/80 mm, 1–3 salinan, **cetak otomatis setelah bayar**, potong kertas, buka laci kas (hanya transaksi tunai baru), **Cetak tes**.
- Terintegrasi: layar transaksi berhasil (cetak otomatis/ulang + **PDF**), struk sementara offline (menggantikan `pos/offline/receipt.ts` yang membuka pop-up), riwayat shift, halaman struk (`Cetak` ke printer yang diatur + `Unduh PDF`; `?print=1` tetap mencetak sekali).
- `Permissions-Policy` sebelumnya `usb=()` (memblokir WebUSB) → `usb=(self), serial=(self), bluetooth=(self)`.
- `pnpm check:receipt`: lebar baris ≤ kolom & ASCII (58/80), byte ESC/POS (init per salinan, cut, laci sekali), PDF (xref, panjang stream, ukuran halaman).

**Halaman Panduan di aplikasi** (`/panduan`, menu **Panduan** untuk semua pengguna): daftar panduan + halaman per panduan dengan navigasi antarpanduan & daftar isi. Isi dibaca dari `docs/PANDUAN-*.md` (satu sumber dengan repo; dirender saat build dengan `use cache`, `outputFileTracingIncludes`). Renderer Markdown kecil `src/components/app/markdown.tsx` menghasilkan elemen React (tanpa HTML mentah); tautan antarpanduan → `/panduan/<slug>`, hanya `http(s)` yang menjadi tautan luar.

**Panduan baru**: `PANDUAN-PEMBAYARAN.md` (tunai, QRIS dinamis otomatis lunas + persiapan Midtrans, QRIS statis, mesin EDC berdampingan + rekonsiliasi settlement, transfer, scanner USB/Bluetooth/kamera; status jujur: EDC terintegrasi (ECR) & scan QR pelanggan (CPM) belum tersedia), `PANDUAN-PRINTER.md` (jenis printer & browser, menghubungkan USB/serial/Bluetooth/LAN, catatan driver Windows & Zadig, cetak otomatis tanpa dialog, laci & pemotong, masalah umum) dan `PANDUAN-MCP.md` (Claude Code, Claude web & Desktop via Connectors + Request headers, Claude Desktop via `mcp-remote`, ChatGPT Developer mode, Codex, Cursor, Antigravity, Hermes Agent, VS Code, Gemini CLI, klien lain; keamanan key; masalah umum). **Pengaturan › API key & MCP**: pemilih **Aplikasi AI** dengan langkah & konfigurasi siap salin (`src/lib/mcp-clients.ts`), terisi key asli tepat setelah key dibuat; peringatan bila klien cloud diarahkan ke localhost.

**Scroll ganda** (laporan di Role & akses): input tersembunyi react-aria (`position:absolute`) di dalam kontainer `overflow-y-auto` tanpa `position` memanjangkan dokumen → muncul scrollbar kedua dan sidebar ikut tergulung. Kontainer scroll kini `relative` (`<main>` app shell, panel kasir, sheet, multi-picker, label, dialog bayar, sidebar). Dicek: tinggi dokumen = tinggi layar di Role, Produk, Pengguna, Kasir.

**Belum** (saat sesi 19): uji dengan printer fisik (USB/serial/Bluetooth — butuh perangkat). OAuth MCP dan EDC terhubung diselesaikan di sesi 20.

## 2026-10-21 — Sesi 18: Bersih-bersih aset demo
- Dihapus (tidak dipakai aplikasi, dicek dengan analisis keterjangkauan import): aset demo BoardUI `public/avatars`, `public/carousel`, `public/ai-chat`, `public/templates`, `public/brand`; SVG bawaan create-next-app (`file`, `globe`, `next`, `vercel`, `window`); 15 komponen demo `src/components/application/{auth,data-table,settings}/*` dan `dashboard/{dashboard-sidebar,dashboard-team-menu,dashboard-user-menu,orders-chart-card,revenue-chart-card}`. Komponen dasar BoardUI yang belum dipakai (badge, slider, tabs, …) dipertahankan sebagai pustaka.
- Halaman `/labels/[id]`: `params` tidak lagi dibaca di luar Suspense (aturan instant navigation Next 16) — id dibaca dengan `useParams` di client.
- Diverifikasi: typecheck, lint (peringatan turun 12 → 6, sisanya dari kode lama), build produksi tanpa database, halaman utama 200, label tanpa error.

## 2026-10-20 — Sesi 17: Master merek, normalisasi nama, audit validasi API, struktur DB, responsif
**Merek = master data** (migrasi `0014_brands`, `0015_drop_product_brand_text`):
- Tabel `brands` (nama + `name_key` unik: huruf kecil, tanpa aksen/spasi/tanda baca → "Coca-Cola" = "coca cola" = "COCA.COLA"), `products.brand_id` (FK restrict). Data lama dipindah otomatis (ejaan terbanyak dijadikan nama resmi), kolom teks `products.brand` dihapus. Permission baru `brand:read|create|update|delete` (diberikan ke role yang punya hak kategori setara).
- API `/brands` (cari sebagian & ejaan mirip via trigram, `exact` = sama setelah normalisasi), `POST` (409 `BRAND_EXISTS` + merek yang ada), `PATCH`, `DELETE` (409 `BRAND_IN_USE`), `POST /brands/{id}/merge` (pindahkan produk lalu hapus — merapikan merek ganda/typo). `GET /products?brandId=`.
- UI: halaman **Produk › Merek** (cari, tambah dengan peringatan nama mirip, ubah, gabungkan, hapus); pemilih merek bisa-cari di form tambah produk & ubah informasi produk — merek yang ada/mirip tampil dulu, "Tambah merek" hanya bila belum ada; bila ternyata sudah ada dengan ejaan lain, merek yang ada dipakai.
- Komponen baru `SearchSelect` (react-aria ComboBox bergaya Select BoardUI, pencarian ke server + opsi tambah) dipakai ulang untuk merek, kurir, nama variasi.

**Field teks bebas lain yang rawan ganda/typo**:
- **Kurir** (order online & marketplace): daftar kurir Indonesia + alias (`src/lib/couriers.ts`); server merapikan bagian kurir dan mempertahankan layanan ("jne reg" → "JNE REG", "jnt ez" → "J&T Express EZ", "shopee express" → "SPX Express"); UI `CourierPicker` bisa-cari, kurir lokal tetap boleh.
- **Nama variasi**: saran dari nama yang sudah dipakai (`GET /products/option-names`), server memakai ejaan yang sudah ada ("WARNA" → "Warna").
- **Role & tier member**: unik tanpa beda huruf besar/kecil (migrasi `0016_case_insensitive_names`).

**Audit validasi API** (berlaku juga untuk klien API luar):
- Pemindaian otomatis spesifikasi OpenAPI (130 endpoint): semua input string kini punya batas panjang, angka punya batas atas, array punya batas jumlah (sebelumnya 27 celah: `page` tanpa batas, `cursor`/`actorId`, `permissions[]`, `assignments[]`, `optionValues[]`, `initialStock[]`, nilai voucher, `groupBy`, `provider`).
- Produk: duplikat nama variasi/nilai (tanpa beda kapital/spasi) ditolak; kategori/merek yang tidak ada → 400 jelas (bukan error FK); harga coret wajib > harga jual (buat & ubah varian); nama dirapikan spasinya; **field tak dikenal ditolak** (`.strict()`) agar klien luar tahu salah nama field (mis. `brand` → `brandId`).
- Semua akses data UI lewat API — ditegakkan ESLint (`no-restricted-imports`), tidak ada pelanggaran.

**Struktur database**: 12 index baru untuk foreign key yang dipakai join/filter/hapus (migrasi `0017_fk_indexes`: customer & connection di order online, varian di item order/retur/opname, voucher di sales, option value, voucher usage per customer, cabang di assignment/koneksi/izin, actor di kartu stok). FK audit ke `user` (created_by dll.) sengaja tanpa index (tidak difilter; user dinonaktifkan, bukan dihapus).

**Perbaikan dari pengecekan visual** (sesi 16 → 17): form produk — harga & SKU/barcode dipisah baris (tidak sesak di 1280 px); detail produk — panel informasi ganda dihapus, urutan varian stabil setelah diedit (tie-breaker id); label — nama varian selalu utuh; kasir — tile 4:3, gambar otomatis disembunyikan bila tak ada produk bergambar, mode daftar satu kolom & harga/stok bertumpuk di HP, grid HP selalu 2 kolom.

**Diverifikasi**: e2e merek (buat, 3 variasi ejaan ditolak, nama kosong/simbol/terlalu panjang ditolak, cari typo, rename bentrok, brandId palsu, field `brand` ditolak, hapus dipakai ditolak, merge memindah produk, filter brandId, kasir 403), kanonisasi variasi & kurir, OpenAPI audit 0 temuan, migrasi data merek (4/4 produk terhubung); browser: pemilih merek (saran typo, pilih, simpan, tambah baru dirapikan); **responsif semua 36 halaman** di 375 px dan halaman terlebar di 768 px — tidak ada overflow horizontal; typecheck, lint, build.

## 2026-10-20 — Sesi 16: SKU/barcode unik otomatis, thumbnail Cloudinary, layout kasir, panduan, audit & persiapan open source
**SKU & barcode** (`src/server/services/product-codes.ts`, migrasi `0012_product_codes_images`):
- Default **otomatis**: SKU `KODE-NNNNN[-OPSI]` (nomor dari counter global `number_sequences.SKU`) dan barcode **EAN-13 in-store** awalan `20` (counter `EAN13`) — keduanya dicek ulang ke database sehingga dijamin unik antarproduk. Sebelumnya SKU dari potongan nama bisa bentrok (produk bernama mirip) dan barcode acak.
- **Manual**: divalidasi unik di seluruh katalog **termasuk silang SKU↔barcode** (scan mencocokkan keduanya), SKU tanpa beda kapital (index unik baru `upper(sku)`, disimpan kapital), format, dan **digit cek EAN/UPC**. Pesan error menyebut produk pemilik kode. Penulisan diserialkan dengan advisory lock transaksi.
- API: `PATCH /variants/{id}` + `generateSku`/`generateBarcode`, `barcode: null` = hapus; `GET /variants/code-check` (validasi langsung di form).
- UI: form tambah produk — switch **SKU & barcode otomatis** (default nyala); mati → `CodeField` per varian dengan cek bentrok langsung & duplikat di form. Detail produk — editor varian dengan **Buat SKU/barcode otomatis**.

**Thumbnail produk & media** (`src/server/media/cloudinary.ts`, `product-image.service.ts`, migrasi `0013_media_provider`):
- Gambar diperkecil di perangkat (≤ 1024 px, WebP/JPEG, EXIF hilang) → `PUT /products/{id}/thumbnail` (cek isi file: JPG/PNG/WebP, ≤ 1 MB, ≤ 2048 px; `product:update`) → **Cloudinary** (unggahan bertanda tangan dari server, public_id `konten-pos/products/{id}`, URL transformasi `c_fill,g_auto,w_480,h_480,f_auto,q_auto`) atau **database** bila Cloudinary belum dikonfigurasi (`GET /products/{id}/thumbnail`, boleh untuk `product:read`/`pos:access`, cache immutable ber-versi). `DELETE` menghapus juga aset Cloudinary.
- Env baru: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `CLOUDINARY_FOLDER`. `pnpm check:media` memeriksa tanda tangan (contoh resmi Cloudinary), endpoint, parameter, dan error dengan fetch tiruan.
- `imageUrl` manual kini wajib `https://`. Service worker: thumbnail ber-versi & gambar Cloudinary cache-first (`konten-pos-images-v1`, maks 400) agar katalog kasir tetap bergambar offline.
- Detail produk: panel **Informasi produk** baru — ubah nama/kategori/merek/berat/deskripsi (sebelumnya tidak ada di UI) + ganti/hapus gambar. Form tambah produk: pilih gambar (diunggah setelah produk dibuat).

**Cetak label barcode** (`/labels/{id}`, tombol **Cetak label** di detail produk): ukuran 33×15 / 38×25 / 50×25 / 58×40 mm, printer gulungan (satu label per halaman, `@page` sesuai label) atau stiker A4, jumlah per varian, nama/harga opsional, SKU sebagai barcode. Encoder tanpa dependensi `src/lib/barcode.ts` (EAN-13, UPC-A, EAN-8, Code 128 set B) + `pnpm check:barcode` (tabel Code 128 divalidasi: 106 pola unik 11 modul, paritas; struktur EAN; checksum).

**Kasir**: menu **Tampilan** — grid **Otomatis / 3 / 4 / 5 / 6 kolom** (HP selalu 2 kolom) atau **daftar per baris**, plus **Tampilkan gambar**; disimpan per perangkat (`pos-layout.ts`, `useSyncExternalStore`). Tile bergambar (lazy, inisial bila tanpa gambar), label aksesibel per tile.

**Keamanan & kesiapan deploy**:
- **Header keamanan untuk semua halaman** (sebelumnya hanya API): CSP (`frame-ancestors 'none'`, `object-src 'none'`, `base-uri`/`form-action 'self'`, `img-src` https untuk Cloudinary), X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy (kamera hanya origin sendiri), COOP, HSTS di produksi; `poweredByHeader` mati (ADR-026).
- **Rate limit** API (600/menit per pengguna/API key), MCP (120/menit per key), webhook (300/menit per IP) dengan header `RateLimit-*`/`Retry-After` (`src/server/api/rate-limit.ts`).
- Audit route: 15 route tanpa middleware permission diperiksa satu per satu — semuanya punya cek izin/cakupan di service.
- Seed mode produksi: `SEED_DEMO=false` (default saat `NODE_ENV=production`) hanya membuat role, tier, Owner (password ≥ 12).
- `pnpm audit --prod`: 0 kerentanan. SkillSpector: `src/server/mcp` 0/100, `src/server/media` 6/100 (transmisi ke api.cloudinary.com — memang tujuan modul).

**Dokumentasi**: `PANDUAN-PENGGUNAAN.md` (seluruh fitur untuk owner/admin/kasir), `PANDUAN-MARKETPLACE.md` (Shopee & TikTok Shop/Tokopedia langkah demi langkah, cron, masalah umum), `PANDUAN-CLOUDINARY.md` (akun, ambil API key, isi env, verifikasi, keamanan, biaya), `PANDUAN-DEPLOY.md` (env lengkap, VPS, Vercel+Neon, cron, backup, checklist keamanan).

**Open source (MIT)**: `LICENSE`, `README.md` root, `CONTRIBUTING.md`, `SECURITY.md`, `.github/workflows/ci.yml` (typecheck, lint, pemeriksaan, build, audit), `package.json` `license: MIT`.

**Diverifikasi**: e2e API kode produk (otomatis unik untuk nama mirip & opsi terpotong sama, manual beda kapital ditolak, silang SKU↔barcode ditolak, barcode sama ditolak, digit cek salah ditolak, duplikat dalam satu permintaan ditolak, manual valid diterima & dikapitalkan, code-check, regenerate, hapus barcode); thumbnail (PNG valid, bukan gambar → 400, > 1 MB → 413, kasir boleh lihat & tidak boleh unggah → 403, tanpa login → 401, cache-control immutable, katalog kasir membawa imageUrl, hapus); `pnpm check:media`; rate limit (601 → 429, per pengguna); regresi e2e sesi lalu: order online, QRIS kasir, transfer/opname, marketplace, PIN persetujuan, retur & poin, offline sync — lulus (skrip voucher lama tidak idempoten, tidak ada error server); `pnpm check:barcode`; detektor Impeccable bersih; typecheck, lint, build produksi **tanpa database terjangkau** (simulasi CI) lulus.
**Belum diverifikasi di browser**: tampilan form produk, panel informasi produk, dan menu tampilan kasir (sesi login browser pane tidak tersedia) — perlu dicek manual. Belum diuji dengan akun Cloudinary sungguhan.

**Belum**: uji label dengan printer & scanner fisik, scan kamera di layar kasir, pembayaran split, Dockerfile aplikasi, migrasi massal gambar database → Cloudinary.

## 2026-10-18 — Sesi 15: Laporan stok & laporan shift (selisih kas)
**Service** `src/server/services/stock-report.service.ts` (satu query agregat per laporan, cakupan cabang `report:read`, tanpa N+1, tanpa migrasi):
- **Valuasi persediaan** (`stockValuation`, posisi saat ini) per cabang / kategori / produk: SKU berstok, unit, ter-reserve, nilai jual (stok × harga), nilai modal (stok × HPP varian saat ini, hanya dengan `product:view_cost`), jumlah SKU tanpa HPP. Nilai modal menjumlah SKU yang ber-HPP; margin potensial = nilai jual SKU ber-HPP − nilai modal.
- **Umur stok** (`stockAging`): hari sejak barang terakhir masuk (stok awal/penerimaan/transfer masuk) dan hari sejak terjual terakhir per varian per cabang; kelompok 0–30 / 31–60 / 61–90 / >90 hari (SKU, unit, nilai); **barang lambat laku** = masuk > 30 hari lalu dan tidak terjual 60 hari terakhir.
- **Pergerakan stok** (`stockMovements`, periode maks 1 tahun): per jenis mutasi (jumlah mutasi, SKU, qty), atau per produk/kategori/cabang: saldo awal, masuk, keluar, terjual, saldo akhir, perputaran (terjual ÷ rata-rata saldo). Saldo akhir = stok sekarang − mutasi setelah periode; saldo awal = saldo akhir − mutasi periode.
- **Shift & selisih kas** (`shiftReport`): per shift — kas awal, tunai masuk, refund tunai, kas seharusnya (tersimpan saat tutup; untuk shift buka dihitung), kas dihitung, selisih, transaksi, void, omzet, retur, refund, diskon manual, catatan; per kasir — jumlah shift (ditutup), shift kurang, selisih bersih, total kurang, dst., diurutkan dari kekurangan terbesar.

**API**: `GET /reports/stock-valuation?groupBy=branch|category|product`, `/reports/stock-aging`, `/reports/stock-movements?from&to&groupBy=type|product|category|branch`, `/reports/shifts?from&to&groupBy=shift|cashier` (`report:read`), `GET /reports/inventory/export?kind=stock-valuation|stock-aging|stock-movements|shifts` (`report:export`, CSV ber-BOM). Skema OpenAPI lengkap di Scalar.

**MCP**: tool `stock_report` (view valuation/aging/movements) dan `shift_report` (per shift/kasir) — total 21 tool.

**UI** `/reports`: tab baru **Stok** (valuasi per cabang/kategori/produk, umur stok, barang lambat laku; tanpa pilihan periode), **Pergerakan**, **Shift kasir** (per shift/per kasir). KPI, tabel dengan batang porsi, kartu mobile, export CSV sesuai tab. Tab dapat digeser di ponsel. Komponen dipecah: `inventory-reports.tsx`, `report-parts.tsx` (Kpi, Share, Num). Label jenis mutasi dipusatkan di `src/lib/stock-labels.ts` (dipakai kartu stok, laporan, CSV).

**Diverifikasi**: semua endpoint & dimensi via curl (saldo akhir pergerakan per cabang = unit valuasi), CSV semua jenis, `groupBy` tidak valid → 400, rentang wajib → 400, kasir → 403, MCP `tools/list` + `stock_report`/`shift_report` + input salah → error; browser desktop 1280 & mobile 375 (tab Stok/Umur, Pergerakan per produk, Shift per shift & per kasir); typecheck, lint, build.

**Catatan proses**: `npx prettier` sempat terunduh otomatis (bukan dependensi proyek, belum dipindai SkillSpector) dan hanya dipakai untuk merapikan 3 file laporan; tidak ditambahkan ke `package.json`.

**Belum**: laporan stok untuk peran MD tanpa akses laporan keuangan (Q-34), valuasi historis per tanggal (butuh HPP historis), laporan terjadwal, export XLSX/PDF.

## 2026-10-18 — Sesi 14: Adapter TikTok Shop / Tokopedia
**Adapter** `src/server/marketplace/tiktok.ts` (TikTok Shop Partner API versi 202309, juga untuk toko Tokopedia yang sudah bergabung):
- Signature 202309: HMAC-SHA256(app_secret, app_secret + path + query terurut tanpa `sign`/`access_token` + body + app_secret); token seller di header `x-tts-access-token`; `shop_cipher` per toko.
- OAuth: `services.tiktokshop.com/open/authorize?service_id=…&state=…` → callback yang sama dengan Shopee (`/api/v1/marketplace/oauth/tiktok/callback`) → `auth.tiktok-shops.com/api/v2/token/get` → `/authorization/202309/shops` (toko wilayah ID diprioritaskan) → `/logistics/202309/warehouses` (gudang penjualan default). Cipher & gudang disimpan di `Credentials.extra` (ikut terenkripsi). Refresh `/api/v2/token/refresh` mempertahankan cipher.
- Order: `POST /order/202309/orders/search` (rentang `update_time`, `page_token`) + `GET /order/202309/orders?ids=` (50 per panggilan); status TikTok → alur Konten (UNPAID; ON_HOLD/AWAITING_SHIPMENT/AWAITING_COLLECTION → lunas; IN_TRANSIT/DELIVERED → dikirim; COMPLETED; CANCELLED); baris per unit digabung saat impor; hadiah diabaikan; harga `sale_price`.
- Katalog: `POST /product/202309/products/search` (status ACTIVATE) → listing per SKU (`product_id`/`sku_id`, `seller_sku`, nama + atribut, stok semua gudang).
- Stok: `POST /product/202309/products/{id}/inventory/update` per produk ke gudang default.
- Webhook: `Authorization` = HMAC-SHA256(app_secret, app_key + body); type 1 (perubahan status order) diproses, lainnya diabaikan. Error token (kode 105001 dst.) → koneksi `ERROR`.
- Env: `TIKTOK_APP_KEY`, `TIKTOK_APP_SECRET`, `TIKTOK_SERVICE_ID`. Tidak ada perubahan skema/service — seluruh sinkron (pemetaan SKU, reservasi, status, push stok, log, retry) memakai jalur adapter yang sama.
- Pemeriksaan otomatis `pnpm check:marketplace` (`scripts/checks/tiktok.check.mts`): fetch tiruan yang memverifikasi signature setiap panggilan, OAuth + pemilihan toko/gudang, refresh, paginasi & body pencarian order, pemetaan order/katalog, format update stok, webhook valid/palsu/diabaikan, error token → AUTH.

**Diverifikasi**: `pnpm check:marketplace` lulus; daftar marketplace menampilkan TikTok Shop / Tokopedia (aktif bila env diisi); typecheck, lint, build. **Belum diuji dengan akun TikTok Shop sungguhan.**

**Belum**: adapter Lazada, multi-gudang TikTok (saat ini satu gudang default), pengaturan webhook otomatis lewat API.

## 2026-10-18 — Sesi 13: PWA — kasir bisa dibuka ulang saat offline
**PWA**
- `app/manifest.ts` (nama Konten POS, `start_url` /pos, standalone, warna tema, shortcut Kasir & Order online) + ikon PNG dari BrandMark lewat `next/og` (`/icons/icon-192.png`, `icon-512.png`, `maskable-512.png`, `apple-touch-icon.png`; path berekstensi agar tidak terkena proxy login). Metadata `appleWebApp` & ikon di root layout.
- `public/sw.js` (tanpa dependensi): navigasi `/pos` network-first dengan cadangan **shell kasir tersimpan**; navigasi lain network-only dengan cadangan `public/offline.html`; `/_next/static`, font, ikon, manifest cache-first; **`/api/*` tidak pernah di-cache**. Saat aktif / diminta halaman (`warm-pos`), SW menyimpan shell `/pos` beserta semua aset statis yang dirujuknya. Shell yang berisi redirect stream (`NEXT_REDIRECT`, karena Cache Components mengirim redirect di dalam stream HTTP 200) tidak disimpan. Versi cache di nama (`konten-pos-*-v2`), cache lama dihapus saat aktif.
- `next.config.ts`: header `sw.js` (no-cache, CSP `default-src 'self'`).
- `ServiceWorkerRegistration` (root layout): daftar hanya di production; di development SW & cache Konten dilepas agar tidak basi.

**Kasir**
- Sesi kasir terakhir (shift, cabang, pajak, QRIS) disimpan per cabang di IndexedDB (`meta`, versi DB 3) dan dipakai saat halaman dibuka tanpa koneksi; kegagalan jaringan langsung menandai offline (tanpa retry). Tanpa shift saat offline → pesan "butuh koneksi untuk membuka shift".
- Halaman kasir yang termuat online meminta SW menyimpan shell terbaru.
- **Keluar akun**: ditolak bila masih ada transaksi offline di perangkat; shell kasir (berisi nama & hak akses) dihapus dari cache.

**Diverifikasi** (build produksi `next start`): SW aktif & mengontrol halaman, 54 aset statis + shell tersimpan, shell redirect ditolak; server dimatikan → `/pos` dibuka ulang dari cache → mode Offline, shift & katalog lokal tampil → transaksi offline OFF-…-0002 → server hidup lagi → tersinkron otomatis jadi INV/BDG/261018/0019 dengan waktu asli; manifest `application/manifest+json`, ikon PNG, header `sw.js`.

**Belum**: pemberitahuan "versi baru tersedia" saat SW diperbarui, back-office offline (sengaja tidak), Background Sync API (sinkron saat tab tertutup).

## 2026-10-18 — Sesi 12: Mode offline kasir
**Database** (migrasi `0011_offline_sales`): `sales` + `offline_ref` (nomor struk sementara), `synced_at`, `offline_shortfall` (kekurangan stok saat sinkron).

**Server** (`offline.service.ts`, `routes/offline.ts`)
- `GET /pos/offline-pack`: semua varian yang dijual + **harga bertanda tangan HMAC** (berlaku 48 jam) + stok tersedia + kategori + pajak cabang.
- `POST /pos/offline-sales` (header `Idempotency-Key`): sinkron satu transaksi offline — tanda tangan harga diverifikasi (harga tidak bisa diubah perangkat), waktu transaksi = waktu perangkat (maks 7 hari, tidak di masa depan, dalam masa berlaku paket), shift harus milik kasir & masih buka, pembayaran = total. Nomor INV resmi diterbitkan saat sinkron. **Stok kurang tidak menolak transaksi** (barang sudah keluar): stok dipotong sebanyak yang ada, sisanya dicatat di `offline_shortfall` untuk dicek/opname.
- `GET /pos/ping` untuk deteksi koneksi.

**Client kasir** (`src/app/(pos)/pos/offline/`)
- `idb.ts` (IndexedDB tanpa dependensi, store `packs` & `outbox`, aman saat upgrade versi), `connectivity.ts` (navigator.onLine + kegagalan fetch nyata, ping tiap 5 detik saat offline), `pack.ts` (paket offline: diunduh tiap 10 menit saat online, disimpan di IndexedDB, pencarian lokal per kata/barcode/kategori + turunan), `outbox.ts` (antrean persisten, kirim berurutan otomatis saat online, gagal jaringan → berhenti, ditolak server → "gagal" dengan pesan, nomor struk `OFF-{perangkat}-{urut}`), `receipt.ts` (struk sementara dicetak tanpa server), `sync-sheet.tsx` (penanda koneksi di header + daftar antrean: sinkronkan, coba lagi, keluarkan dari antrean).
- Saat offline: katalog & stok dari paket lokal (stok tampilan dikurangi barang di antrean), total dihitung dari harga paket, bayar tunai/EDC/transfer/QRIS statis → **"Tersimpan offline"** + cetak struk sementara. Member, voucher, tukar poin, diskon manual, QRIS dinamis disembunyikan (butuh server). Koneksi putus di tengah bayar online → otomatis masuk antrean dengan **kunci idempotensi yang sama** (tidak dobel bila ternyata sudah tercatat).
- Tutup shift diblokir selama offline atau masih ada antrean shift itu. Kembali online → antrean terkirim otomatis + notifikasi (termasuk kekurangan stok).
- Rincian transaksi menampilkan asal offline, waktu sinkron, dan kekurangan stok.

**Diverifikasi**: e2e API (sinkron normal dengan waktu perangkat, sinkron ulang idempoten, harga diubah → `OFFLINE_PRICE_INVALID`, transaksi sebelum paket terbit → `OFFLINE_PACK_EXPIRED`, stok kurang → tercatat + shortfall & stok jadi 0, pembayaran ≠ total ditolak); browser (offline disimulasikan dengan memblok fetch + event offline): penanda Offline, katalog lokal, catatan mode offline, bayar tunai → OFF-…-0001, tutup shift diblokir, daftar antrean; online kembali → tersinkron otomatis menjadi INV/BDG/… dengan waktu asli; build.

**Belum**: memuat ulang halaman kasir saat offline (butuh service worker/PWA untuk cache aplikasi), member/voucher offline, retur/void offline, sinkron antar perangkat kasir di cabang yang sama (stok antar perangkat saat offline).

## 2026-10-18 — Sesi 11: Integrasi marketplace (adapter + Shopee + simulator)
**Database** (migrasi `0009_marketplace`, `0010_marketplace_retry`): `marketplace_connections` (provider, kanal, ID toko, cabang sumber stok, status ACTIVE/PAUSED/ERROR/DISCONNECTED, tarik order, push stok, buffer, **token terenkripsi AES-256-GCM**, batas sinkron order, order tertunda untuk dicoba ulang, error terakhir), `marketplace_listings` (produk/variasi marketplace + pemetaan ke varian, otomatis via SKU atau manual, stok terakhir dikirim), `marketplace_sync_logs` (jenis, status, angka, masalah per baris), `mock_marketplace_orders` (toko simulasi). `online_orders.connection_id`. Enum `sales_channel` dipindah ke `core.ts`; `payment_method` + `MARKETPLACE`. Permission baru `marketplace:read`/`marketplace:manage` (Owner otomatis lewat migrasi).

**Arsitektur adapter** (`src/server/marketplace/`)
- `types.ts`: kontrak `MarketplaceAdapter` (OAuth, refresh token, daftar order berubah, detail order, katalog, update stok, verifikasi webhook) + model order/listing ternormalisasi, enkripsi kredensial (kunci `MARKETPLACE_SECRET` atau HKDF dari `BETTER_AUTH_SECRET`), state OAuth bertanda tangan.
- `shopee.ts`: Shopee Open Platform v2 — signature HMAC-SHA256 (partner_id + path + timestamp [+ access_token + shop_id]), `auth_partner`, `auth/token/get`, `auth/access_token/get`, `order/get_order_list` (update_time, potongan 15 hari, cursor), `order/get_order_detail` (50 per panggil), `product/get_item_list` + `get_item_base_info` + `get_model_list`, `product/update_stock` (per item, 50 model), verifikasi push (`Authorization` = HMAC(url|body)), pemetaan status Shopee → alur Konten. **Belum diuji dengan akun sandbox.**
- `mock.ts`: toko simulasi (katalog = varian Konten, order di DB, webhook HMAC), mati di production.

**Sinkron** (`marketplace.service.ts`)
- Hubungkan (OAuth → callback `GET /api/v1/marketplace/oauth/{provider}/callback`, atau simulator langsung), ubah pengaturan, jeda, putuskan (token dihapus).
- Katalog: upsert listing + pemetaan otomatis SKU (satu UPDATE, tidak menimpa manual); pemetaan manual per listing.
- Order: tarik order yang berubah sejak sinkron terakhir (tumpang 10 menit) + order tertunda; **upsert idempoten** per kanal + nomor order: harga dari marketplace, reservasi stok cabang sumber, status mengikuti marketplace (UNPAID → menunggu bayar; dibayar → lunas dengan metode MARKETPLACE + transaksi; dikirim → stok dipotong + resi; selesai; batal sebelum kirim → reservasi dilepas/transaksi void; batal setelah kirim → dicatat untuk retur manual). Barang belum dipetakan / stok kurang → dilewati, dicatat, dicoba ulang. Order marketplace tidak ikut kedaluwarsa lokal.
- Stok: kirim `on_hand − reserved − buffer` (min 0) untuk listing terpetakan, hanya yang berubah sejak push terakhir.
- Webhook publik `POST /api/marketplace/webhook/{provider}` (body mentah untuk HMAC) → tarik order yang disebut → push stok. Cron `POST /api/v1/marketplace/sync` (semua toko aktif, error satu toko tidak menghentikan yang lain). Error auth → koneksi `ERROR` (minta hubungkan ulang). `MarketplaceError` dipetakan ke 401/429/502.
- `online-order.service`: `advanceOrderTx` & `cancelOrderTx` (bisa dipanggil sistem tanpa actor, dalam transaksi pemanggil).
- MCP: `marketplace_status`. Total 19 tool.

**UI**
- Pengaturan › **Marketplace** (`/settings/marketplace`): daftar toko + status + order tertunda, **Hubungkan toko** (pilih marketplace & sumber stok; Shopee lewat halaman izin), panel cara kerja.
- `/settings/marketplace/{id}`: angka (produk, terpetakan, belum dipetakan, tertunda), **Sinkron sekarang**, jeda/aktifkan, putuskan, **pemetaan produk** (filter belum dipetakan, cari, petakan via pencarian varian, lepas), riwayat sinkron dengan masalah per order, pengaturan (sumber stok, tarik order, kirim stok, buffer), panel **Simulator** (order dibayar/belum dibayar/barang tak dikenal, majukan status, batal).
- Detail order online dari marketplace: catatan "ditarik otomatis", aksi bayar/kirim/batal manual disembunyikan (mengikuti marketplace).

**Diverifikasi** (simulator): hubungkan → 20 listing terpetakan otomatis, push stok awal & hanya perubahan, order dibayar via webhook → order + reservasi + transaksi MARKETPLACE + stok di marketplace turun, webhook ulang idempoten, dikirim → stok dipotong + resi, selesai, belum bayar lalu batal → reservasi dilepas, barang tak dikenal → dilewati + tertunda, tarik manual idempoten, signature palsu → 401, cron, pemetaan manual/lepas; browser: halaman daftar & detail, simulator; MCP; build.

**Belum**: uji Shopee sandbox sungguhan, adapter TikTok Shop/Tokopedia & Lazada, sinkron harga, label/AWB pengiriman dari marketplace, retur marketplace otomatis, potongan biaya admin marketplace di laporan.

## 2026-10-18 — Sesi 10: Laporan & PIN persetujuan kepala toko
**Database** (migrasi `0008_approvals_reports`): `approval_pins` (hash scrypt + salt per user, terpisah dari tabel Better Auth), `approval_grants` (izin sekali pakai: permission, cabang, peminta, penyetuju, kedaluwarsa, dipakai untuk apa). `sales` + `manual_discount`, `manual_discount_reason`, `manual_discount_approved_by`, `void_approved_by`. `sale_returns` + `reason_code` (SIZE/DEFECT/WRONG_ITEM/NOT_AS_DESCRIBED/CHANGED_MIND/OTHER) + `approved_by`.

**PIN persetujuan**
- `approval.service.ts`: atur/ganti PIN sendiri (6 angka, tolak pola berulang/berurutan, ganti wajib PIN lama), reset oleh admin, `requestApproval` (PIN dicocokkan ke user aktif yang punya permission tsb. global/di cabang itu; tidak bisa menyetujui diri sendiri; salah 5× dalam 10 menit → `APPROVAL_LOCKED`; berhasil → izin 10 menit), `authorizeOrApprove` (punya hak → lanjut; tidak → izin dipakai sekali di transaksi aksi, harus cocok permission + cabang + peminta).
- Dipasang di **void** (`sales.void_approved_by`), **retur** (`sale_returns.approved_by`), dan **diskon manual** (`sales.manual_discount_approved_by`). Route void/retur tidak lagi butuh permission di middleware; otorisasi di service. Kasir cabang (`pos:access`) kini boleh membuka struk cabangnya untuk retur.
- API: `POST /pos/approvals`, `PUT /me/approval-pin`, `DELETE /users/{id}/approval-pin`; header `X-Approval-Id` di `/sales` (checkout), `/pos/qris`, `/sales/{id}/void`, `/sales/{id}/returns`; `/me` mengembalikan `hasApprovalPin`.

**Diskon manual**
- `priceCart`: langkah baru setelah voucher, sebelum tukar poin; nominal atau persen; dibatasi `maxManualDiscountBps` kebijakan toko (default 30%, maks 90%); dialokasikan per baris. Diuji di `pnpm check:pricing`.
- Quote mengembalikan `manualDiscount`, `manual` (diminta/diterapkan/dibatasi) dan `manualNeedsApproval`. Checkout & QRIS menyimpan nominal, alasan (wajib), dan penyetuju.

**Laporan**
- `report.service.ts` + `/reports/sales?groupBy=day|branch|cashier|channel|category|product|payment` dan `/reports/returns?groupBy=reason|product|cashier|branch` (rentang maks 1 tahun, cakupan cabang `report:read`): transaksi, unit bersih, harga jual, diskon, penjualan (tanpa ongkir), retur, **penjualan bersih**, laba kotor (bila boleh lihat HPP), rata-rata transaksi. Satu query agregat per laporan.
- Export CSV `/reports/sales/export`, `/reports/returns/export` (`report:export`): UTF-8 + BOM untuk Excel, baris TOTAL, perlindungan formula injection.
- MCP: `sales_report`, `returns_report`. Total 18 tool.

**UI**
- Menu **Laporan** (`/reports`): tab Penjualan/Retur, pilih dimensi, periode (hari ini, 7/30 hari, bulan ini, bulan lalu), cabang, KPI (transaksi + rata-rata, penjualan + diskon, retur, bersih, laba kotor + margin), tabel dengan batang porsi, kartu di HP, **Export CSV**.
- Kasir: baris **Diskon manual** (%/Rp + alasan, tanda "perlu PIN atasan"), dialog **Persetujuan atasan** (PIN 6 angka) muncul saat bayar/QRIS, void di riwayat shift, dan retur. Tombol Retur selalu ada di kasir (dengan PIN bila perlu).
- Form retur: pilih **alasan** + keterangan. Daftar & riwayat retur menampilkan alasan.
- Menu akun: **Atur/Ganti PIN persetujuan**. Pengaturan › Pengguna: **Hapus PIN persetujuan**. Pengaturan › **Kebijakan toko** (dulu "Poin & retur") + batas diskon manual.
- Komponen baru: `useApproval` (`approval-dialog.tsx`), `ApprovalPinSheet`.

**Diverifikasi**: e2e API (PIN lemah ditolak, diskon manual tanpa PIN ditolak, PIN salah ditolak, PIN benar → transaksi dengan diskon & penyetuju, izin dipakai ulang ditolak, izin void tidak berlaku untuk retur, void & retur dengan PIN, 5× salah → terkunci, semua dimensi laporan, CSV + header, kasir tanpa `report:read` ditolak); browser: laporan penjualan & retur, diskon manual + PIN di kasir sebagai akun kasir, form retur dengan alasan; MCP; build.

**Belum**: grafik tren di laporan, laporan stok/valuasi & shift per kasir (selisih kas), jadwal kirim laporan via email, PIN untuk aksi lain (buka laci, harga manual).

## 2026-10-18 — Sesi 9: QRIS dinamis di layar kasir
**Database** (migrasi `0007_sale_pending`): status transaksi baru `PENDING` (menunggu QRIS dibayar).

**Server**
- `sale.service`: checkout dipecah menjadi `createSale(mode)` — `PAID` (tunai/EDC/transfer, seperti sebelumnya) atau `PENDING` (QRIS dinamis: harga, stok, kuota voucher, dan poin tukar dikunci; pembayaran & poin didapat menyusul). Helper bersama `creditCustomer`, `debitRedeemedPoints`, `reverseSaleEffects` (dipakai void, batal QRIS, kedaluwarsa). `confirmPendingSale` (lunas → PAID + baris pembayaran QRIS + poin & statistik customer), `cancelPendingSale` (dibalik tanpa menarik poin didapat). Tutup shift ditolak bila masih ada QRIS menunggu.
- `payments/intents.ts` (buat intent + QR, satu QR aktif per dokumen) dan `payment.service.ts` (webhook, sinkron status, simulasi, batal) kini **satu jalur untuk order online dan kasir**, dibedakan `reference_type` (`online_order` / `pos_sale`). QR yang sempat ditutup tetapi tetap dibayar: dokumen dilunasi bila belum batal; bila sudah batal → `payment_attention` di audit log (refund manual).
- `pos-qris.service.ts`: mulai QRIS (idempoten via `Idempotency-Key`; gagal buat QR → transaksi langsung dibalik), status (cek gateway tiap ≥3 detik bila webhook belum masuk; lewat masa berlaku + jeda 1 menit → dibatalkan & gateway di-cancel), batal oleh kasir, simulasi (dev), `sweepExpiredIntents` (sebelum tutup shift & di cron `POST /online-orders/expire`).
- `PaymentProvider.cancel()` (Midtrans `POST /v2/{order_id}/cancel`) agar QR yang dibatalkan tidak bisa dibayar lagi.
- API baru: `POST /pos/qris` (header `Idempotency-Key`), `GET /pos/qris/{id}`, `POST /pos/qris/{id}/cancel`, `POST /pos/qris/{id}/simulate` (dev); `/pos/session` mengembalikan `qris.dynamic` & `qris.simulator`.

**UI kasir**
- Tab **QRIS** di dialog bayar: bila gateway aktif → tombol **Tampilkan QR**, QR besar + nominal + hitung mundur, cek status tiap 2 detik, otomatis ke layar "Transaksi berhasil" saat lunas; **Batalkan QR & pilih metode lain**; QR kedaluwarsa → pesan + pilih metode lagi. Menutup dialog saat QR menunggu otomatis membatalkannya. Tanpa gateway → QRIS statis dengan nomor referensi (seperti sebelumnya).
- Status "Menunggu QRIS" di riwayat shift & daftar transaksi. Hook bersama `useRemaining`/`mmss` (dipakai kasir & order online).

**Diverifikasi**: e2e API (PENDING mengunci stok & poin tukar, replay kunci sama → QR sama, tutup shift diblokir, simulasi → PAID + pembayaran QRIS + poin didapat, batal kasir → stok & poin kembali, notifikasi terlambat setelah batal → `SALE_CANCELLED` + audit, notifikasi ganda → `DUPLICATE`, QR kedaluwarsa → transaksi dibatalkan & stok kembali) + regresi tunai/retur/order online; browser: bayar QRIS → lunas otomatis, batal QR, tutup dialog membatalkan QR, HP 375 px; build. **Midtrans sungguhan belum diuji.**

**Belum**: tampilan QR di layar kedua (customer display), refund QRIS otomatis lewat gateway, notifikasi suara saat lunas.

## 2026-10-18 — Sesi 8: Order online, reservasi stok, QRIS dinamis
**Database** (migrasi `0006_online_orders`): `online_orders` (nomor `ORD/{KODE}/{YYMMDD}/{0001}`, cabang sumber stok, kanal, no. order kanal unik per kanal, status PENDING_PAYMENT → PAID → PACKED → SHIPPED → COMPLETED / CANCELLED, penerima, alamat, kurir, resi, ongkir, total, batas bayar `reserved_until`, `sale_id`), `online_order_items`, `payment_intents` (provider, `gateway_order_id` unik, rujukan, nominal, status, `qr_string`, kedaluwarsa), `payment_events` (log notifikasi, `event_key` unik = idempotensi webhook). `sales.shipping_fee`.

**Server**
- `inventory.service`: `reserveStock` (reserved naik hanya bila tersedia cukup, satu UPDATE) & `releaseStock`.
- `payments/provider.ts`: interface `PaymentProvider` + **Midtrans** (Core API `POST /v2/charge` QRIS, cek `GET /v2/{order_id}/status`, signature SHA512(order_id+status_code+gross_amount+ServerKey), sandbox/production) + **simulator lokal** (`mock`, hanya non-production, notifikasi bertanda tangan HMAC lewat jalur webhook yang sama). Dipilih lewat env `PAYMENT_PROVIDER`.
- `online-order.service.ts`: buat order (harga & PPN dari server, reservasi, pesan stok kurang menyebut barang), daftar (+ jumlah per status), detail (status QRIS disinkronkan ke gateway bila webhook belum datang), QRIS (satu QR aktif per order, dibuat ulang bila kedaluwarsa, tidak melewati batas bayar), webhook (signature → event unik → status, satu transaksi), bayar manual, kemas, **kirim** (lepas reservasi + movement SALE `reference_type = online_order`), selesai, batal (lepas reservasi; bila sudah lunas transaksi VOIDED + dana dikembalikan manual), kedaluwarsa otomatis (oportunistik + `POST /online-orders/expire` untuk cron).
- Saat lunas dibuat baris `sales` (channel = kanal, nomor = nomor order, ongkir) → omzet dashboard, daftar transaksi, struk, dan retur ikut otomatis. Retur order online hanya setelah dikirim; ongkir tidak ikut dikembalikan.
- Endpoint publik `POST /api/payments/webhook/{provider}` (di luar `/api/v1`, tanpa sesi).
- API: `/online-orders` (GET/POST), `/online-orders/{id}`, `/{id}/payments/qris`, `/{id}/payments/manual`, `/{id}/payments/simulate` (dev), `/{id}/pack|ship|complete`, `/{id}/cancel`, `/online-orders/expire`.
- MCP: `list_online_orders` (HP penerima dimasking, alamat & QR tidak dikirim). Total 16 tool.
- Package baru: `qrcode-generator@2.0.4` (tanpa dependensi) untuk menggambar QR.

**UI**
- Menu **Order online** (`/orders`): tab status dengan jumlah, filter kanal/cabang, cari nomor/penerima/resi.
- `/orders/new`: barang via scan/SKU/nama (stok tersedia di cabang sumber), hubungkan customer (isi otomatis penerima), alamat, kurir, ongkir, kanal, no. order kanal, batas bayar.
- `/orders/{id}`: timeline Dibuat → Dibayar → Dikemas → Dikirim → Selesai, panel **Pembayaran** (QRIS dinamis + hitung mundur + cek status otomatis tiap 3 detik, tombol simulasi di dev, catat pembayaran manual), kirim dengan resi, selesai, batal dengan alasan.
- Komponen baru: `QrCode` (SVG dari string QRIS, hitam di atas putih), `Timeline` (dipakai transfer & order). Rincian transaksi & struk menampilkan ongkir dan kanal.

**Diverifikasi**: e2e API (reservasi 2 → tersedia turun, duplikat no. order kanal & stok kurang ditolak, QR dipakai ulang, signature palsu ditolak, provider nonaktif ditolak, bayar via simulator → sale QRIS, retur sebelum kirim ditolak, kirim memotong stok & melepas reservasi, batal setelah kirim ditolak, batal sebelum bayar melepas reservasi, bayar manual + batal → sale VOIDED, kedaluwarsa melepas reservasi, retur setelah selesai tanpa ongkir); browser: buat order → QRIS → simulasi bayar → kirim, HP 375 px; MCP; build. **Midtrans sungguhan belum diuji** (butuh server key sandbox).

**Belum**: QRIS dinamis di layar kasir, refund otomatis lewat gateway, VA/e-wallet/kartu, integrasi marketplace (tarik order & sinkron stok), label pengiriman & cek ongkir, poin member untuk order online, rekonsiliasi settlement.

## 2026-10-18 — Sesi 7: Retur penjualan & tukar poin
**Database** (migrasi `0005_returns_points`): `app_settings` (kunci/nilai jsonb tingkat toko), `sale_returns` (nomor `RET/{KODE}/{YYMMDD}/{0001}`, struk asal, shift tempat uang tunai keluar, metode & nominal refund, poin ditarik/dikembalikan, alasan), `sale_return_items` (baris struk, qty, nilai, `restock` layak jual/rusak). `sales` + `points_redeemed`, `points_discount`, `refund_total` (CHECK 0..total). `sale_items` + `returned_qty` (CHECK 0..qty). Enum `point_ledger_type` + `REDEEM`, `REFUND`.

**Mesin harga & retur (fungsi murni, diuji `pnpm check:pricing`)**
- `priceCart` mendapat langkah tukar poin: setelah diskon member & voucher, sebelum PPN. Dibatasi saldo, minimal tukar, dan porsi maksimal tagihan; dialokasikan proporsional per baris (masuk `sale_items.discount`). Mengembalikan `maxRedeemable` agar kasir tahu batasnya.
- `src/lib/returns.ts` → `computeReturn`: nilai baris, uang kembali (termasuk PPN eksklusif), poin ditarik & poin dikembalikan dihitung **kumulatif** sehingga retur bertahap berjumlah tepat sama dengan transaksi.

**Server**
- `settings.service.ts`: kebijakan toko (`pointValue`, `minRedeemPoints`, `maxRedeemBps` maks 90%, `returnWindowDays`) dengan default asumsi Q-24.
- Checkout/quote menerima `pointsRedeem`; poin dicek ulang di dalam transaksi (baris customer dikunci), ledger REDEEM + EARN. Void mengembalikan poin yang ditukar (REFUND) dan menarik poin yang didapat; void ditolak bila struk sudah diretur.
- `return.service.ts`: retur (izin `pos:refund`, batas hari, refund tunai wajib shift terbuka, refund non-tunai hanya ke metode asal), kunci struk, `returned_qty` naik dalam satu UPDATE bersyarat, stok kembali hanya untuk barang layak jual (movement RETURN, `reference_type = sale_return`), poin & total belanja customer disesuaikan, retur penuh mengembalikan kuota voucher. Daftar & detail retur.
- Ringkasan shift: jumlah & total retur, refund tunai mengurangi kas seharusnya.
- Dashboard penjualan: omzet bersih (total − refund) dan produk terlaris dikurangi barang diretur.
- Pemegang `pos:refund` di cabang boleh membuka struk cabang itu (untuk retur).
- API baru: `POST /sales/{id}/returns`, `GET /sale-returns`, `GET /sale-returns/{id}`, `GET /sales/lookup?number=`, `GET/PUT /settings/store-policy`; `pointsRedeem` di `/pos/quote` & `/sales`; field baru di Sale & ShiftSummary.
- MCP: `list_returns`; `sales_summary` kini omzet bersih. Total 15 tool.

**UI**
- Kasir: baris **Tukar poin** untuk member (satu ketuk = pakai maksimal, atau isi jumlah; alasan bila ditolak), rincian "Tukar N poin" di total & struk. Tombol **Retur** di header kasir: cari nomor struk → pilih barang & kondisi → uang tunai keluar dari laci shift. Tutup shift menampilkan retur & refund tunai. Tombol header ikon-saja di HP kini punya `aria-label`.
- Transaksi: status "Retur sebagian"/"Diretur", tombol **Retur barang** di rincian, riwayat retur, laba kotor tidak menghitung barang diretur. Tab baru **Retur** (`/sales/returns`).
- Pengaturan › **Poin & retur** (`/settings/policy`).
- Customer: riwayat poin berlabel (Dapat/Tukar/Ditarik/Dikembalikan).
- Komponen baru: `ReturnForm` (`src/components/app/return-form.tsx`, dipakai back-office & kasir).

**Diverifikasi**: e2e API (tukar 35 poin = Rp3.500, minimal tukar ditolak, ledger REDEEM/EARN, retur sebagian + sisa = total tepat Rp393.500, poin kembali ke saldo awal, barang rusak tidak menambah stok, void setelah retur ditolak, retur melebihi & metode salah ditolak, kas seharusnya berkurang); browser: tukar poin → bayar, retur dari kasir lewat nomor struk, daftar retur, rincian transaksi, halaman kebijakan, HP 375 px; MCP; build.

**Belum**: PIN persetujuan kepala toko untuk kasir tanpa `pos:refund`, barcode nomor struk di cetakan (agar bisa di-scan), cetak bukti retur, tukar barang (exchange), store credit, masa berlaku poin, laporan retur per alasan.

## 2026-10-18 — Sesi 6: Transfer stok & stok opname
**Database** (migrasi `0004_stock_ops`): `stock_transfers` (nomor `TRF/{KODE}/{YYMMDD}/{0001}`, asal ≠ tujuan, status DRAFT → IN_TRANSIT → RECEIVED / CANCELLED, catatan kirim & terima, pelaku + waktu tiap tahap), `stock_transfer_items` (PK transfer+varian, `qty_sent > 0`, `qty_received` 0..qty_sent), `stock_opnames` (nomor `OPN/…`, mode PARTIAL/FULL, status COUNTING/POSTED/CANCELLED, **satu opname COUNTING per cabang** — unique index parsial), `stock_opname_items` (PK opname+varian, `counted_qty`, `system_qty` & `difference` dibekukan saat posting, siapa yang menghitung).

**Server**
- `numbering.ts`: `nextDocNumber(tx, prefix, branch)` — nomor dokumen atomik dipakai INV/TRF/OPN.
- `transfer.service.ts`: daftar (filter cabang + arah masuk/keluar + status, agregat SKU/unit dalam satu subquery), detail (+ stok tersedia di asal), buat (baris duplikat digabung), ubah draf, **kirim** (TRANSFER_OUT di asal; pesan stok kurang menyebut barangnya), **terima** (qty diterima per baris dalam satu `UPDATE … FROM (VALUES…)`, TRANSFER_IN di tujuan; baris yang tidak diisi dianggap diterima penuh; selisih tercatat), batal (stok kembali ke asal bila sudah dikirim).
- `opname.service.ts`: daftar, detail (selisih live terhadap stok sistem saat COUNTING, nilai beku setelah POSTED, ringkasan lebih/kurang/cocok, barang berstok belum dihitung, nilai selisih modal hanya untuk yang boleh lihat HPP), mulai, **hitung** (upsert atomik: tiap scan +1 atau set qty manual — aman dihitung beberapa orang bersamaan), hapus baris, **posting** (mode FULL memasukkan barang berstok yang tidak dihitung sebagai 0; baris dikunci `FOR UPDATE`; satu `applyStockChanges` type OPNAME; tolak bila hasil di bawah stok ter-reserve), batal.
- API: `/stock-transfers` (GET/POST), `/stock-transfers/{id}` (GET/PUT), `/{id}/send`, `/{id}/receive`, `/{id}/cancel`; `/stock-opnames` (GET/POST), `/{id}`, `/{id}/count`, `DELETE /{id}/items/{variantId}`, `/{id}/post`, `/{id}/cancel`. Permission: `stock_transfer:create` (buat/kirim/batal), `stock_transfer:approve` (terima), `stock_opname:create` (mulai/hitung/batal), `stock_opname:approve` (posting).
- MCP: `list_transfers`, `list_opnames` (dengan `number` → rincian). Total 14 tool.

**UI**
- Stok punya tab baru: **Transfer** dan **Stok opname** (tampil sesuai permission).
- `/inventory/transfers`: daftar (filter cabang, masuk/keluar, status). `/inventory/transfers/new`: scan barang ke kardus (scan ulang = +1), stok tersedia di asal, cabang asal terkunci setelah ada barang, "Simpan & kirim" atau "Simpan sebagai draf". `/inventory/transfers/{id}`: timeline Dibuat → Dikirim → Diterima, panel **Terima barang** (scan per barang yang datang, "Semua sesuai kiriman", catatan wajib bila kurang), batal dengan alasan.
- `/inventory/opnames`: daftar + sheet "Mulai opname" (cabang, Sebagian / Seluruh toko, catatan). `/inventory/opnames/{id}`: scan = +1 dengan kartu "terakhir dihitung", ubah jumlah manual, hapus baris, filter Semua/Selisih/Cocok, ringkasan (dihitung, cocok, lebih, kurang, nilai selisih), peringatan barang belum dihitung (FULL = jadi 0), posting dengan konfirmasi; tampilan baca-saja setelah diposting.
- Komponen baru: `variant-lookup.ts` (`lookupVariant` → hit / pilihan / tidak ada), `VariantChoices`. `ConfirmDialog` mendapat prop `tone` ("primary" untuk tindakan final yang tidak merusak).

**Diverifikasi**: e2e API (gabung baris, stok asal turun saat kirim, terima sebagian 5/6 mencatat selisih, batal mengembalikan stok, stok kurang ditolak, satu opname per cabang, scan menambah, qty manual, posting membuat movement OPNAME, hitung setelah posting ditolak); browser: buat → kirim → terima transfer, mulai → scan → ubah qty → posting opname, tampilan HP 375 px tanpa scroll horizontal; MCP; build.

**Belum**: approval transfer sebelum kirim (permintaan stok dari cabang), cetak surat jalan, opname per kategori/rak (filter cakupan), membekukan penjualan barang saat opname, hitung ulang (recount) baris berselisih besar.

## 2026-10-18 — Sesi 5: Voucher & membership
**Database** (migrasi `0003_crm_vouchers`): `membership_tiers` (syarat total belanja, diskon bps, poin per Rp10.000), `customers` (HP unik dinormalisasi `62…`, no. member `M{YY}{00001}`, tier, poin, total belanja, kunjungan, persetujuan data), `point_ledger`, `vouchers` (nominal/persen, maks potongan, min/maks belanja, periode, kuota total & per customer, cakupan produk/pembeli, status), `voucher_targets` (kategori/produk/varian + pengecualian, tier, customer, cabang), `voucher_usages` (potongan, omzet transaksi, APPLIED/REVERSED). `sales` + `customer_id`, `member_discount`, `voucher_id`, `voucher_code`, `voucher_discount`, `points_earned`.

**Mesin harga** (`src/lib/pricing.ts` → `priceCart`): diskon tier member → voucher atas barang yang memenuhi syarat (dari harga setelah diskon member) → PPN. Target kategori induk mencakup sub-kategori, pengecualian produk, min/maks belanja dihitung dari barang eligible, potongan persen dibatasi maks potongan, alokasi proporsional per baris (sisa ke baris terbesar), alasan penolakan dalam Bahasa Indonesia. Pemeriksaan otomatis: `pnpm check:pricing` (9 kasus).

**Server**
- `customer.service.ts`: normalisasi & mask no. HP, daftar/cari (nama, HP, no. member), profil + 10 transaksi + 10 mutasi poin, buat/ubah (member wajib persetujuan), tier CRUD (member ditempatkan ulang otomatis satu UPDATE).
- `voucher.service.ts`: CRUD + target, status turunan (ACTIVE/SCHEDULED/PAUSED/EXHAUSTED/EXPIRED), `resolveVoucher` (periode, kuota, cabang, member/tier/customer, kuota per customer), `claimVoucherQuota` (UPDATE atomik), performa (per voucher + tren), riwayat pemakaian.
- Checkout: `buildCart` dipakai `/pos/quote` & checkout; checkout mengunci baris customer, menghitung ulang di transaksi (tolak bila total berubah), klaim kuota, catat `voucher_usages`, tambah poin + ledger, total belanja, kunjungan, naik tier otomatis. Void: usage REVERSED + kuota kembali, poin dibatalkan (ledger REVERSE, tidak minus), statistik customer dikurangi.
- API baru: `/customers`, `/customers/{id}`, `/membership-tiers`, `/vouchers`, `/vouchers/{id}`, `/vouchers/{id}/status`, `/vouchers/{id}/usages`, `/vouchers/performance`, `/pos/quote`; checkout menerima `customerId` & `voucherCode`.
- MCP: `voucher_performance`, `list_vouchers`, `customer_lookup` (HP dimasking, email disembunyikan). Total 12 tool.
- Pengelolaan tier memakai permission `customer:update` (tanpa resource baru).

**UI**
- `/customers` (+ sub-menu Tier member): daftar, filter member, profil (poin, total belanja, kunjungan, transaksi, riwayat poin), tambah/ubah, jadikan member. `/customers/tiers`: kartu tier, tambah/ubah/hapus.
- `/vouchers`: daftar (status, progres kuota, total potongan, omzet), form lengkap (DatePicker BoardUI + jam, picker target multi-pilih), detail (ringkasan aturan dalam kalimat, performa 7/30/365 hari, biaya per Rp1 omzet, pemakaian terakhir, jeda/aktifkan).
- Kasir: baris customer (F4, cari atau daftar cepat), input voucher dengan status "Hemat Rp…" atau alasan penolakan, rincian diskon member/voucher, poin yang akan didapat; layar sukses menampilkan poin. Struk & rincian transaksi menampilkan customer, diskon, voucher, poin.
- Komponen baru: `MultiPicker`, `customer-form.tsx` (dipakai back-office & kasir). `I18nProvider id-ID`; DatePicker vendor diberi prop `placeholder`.
- Sidebar: Customer & Voucher.

**Diverifikasi**: alur API (tier, member, duplikat HP, voucher butuh customer, batas maks potongan, target kategori, batas per customer, kuota & void), alur kasir di browser (scan → F4 member → voucher → F8 → struk), pembuatan voucher lewat form, MCP, build.

**Belum**: tukar poin sebagai potongan (redeem), masa berlaku poin, turun tier, voucher ulang tahun otomatis, kode unik massal, promo otomatis tanpa kode, voucher bertumpuk.

## 2026-10-17 — Sesi 4: Layar kasir (POS)
**Database** (migrasi `0002_sales`): `shifts` (satu shift terbuka per kasir per cabang — unique index parsial), `sales` (nomor invoice unik, `idempotency_key` unik, snapshot pajak), `sale_items` (snapshot nama/SKU/harga/HPP), `sale_payments` (metode, nominal, uang diterima, kembalian, referensi), `number_sequences`.

**Server**
- `src/lib/pricing.ts`: perhitungan total & PPN (inklusif/eksklusif) sebagai fungsi murni, dipakai keranjang & checkout.
- `sale.service.ts`: buka/tutup shift (kas seharusnya, selisih), katalog kasir (varian aktif + stok tersedia cabang, cari per kata/barcode, filter kategori termasuk sub-kategori), **checkout** (header `Idempotency-Key`, harga dihitung ulang dari DB, validasi pembayaran = total, nomor `INV/{KODE}/{YYMMDD}/{0001}` atomik, potong stok via `applyStockChanges` type SALE dalam satu transaksi), void (hanya sebelum shift ditutup, `pos:void`, stok kembali type RETURN), detail & daftar transaksi.
- API: `/pos/session`, `/pos/shifts`, `/pos/shifts/{id}`, `/pos/shifts/{id}/close`, `/pos/catalog`, `/sales` (POST/GET), `/sales/{id}`, `/sales/{id}/void`, `/dashboard/sales-summary`.
- MCP: tool baru `sales_summary`, `list_sales`.
- Kasir boleh melihat struk transaksinya sendiri tanpa `sale:read`; daftar transaksi lain tetap butuh `sale:read`.
- Filter kategori (produk & kasir) kini mencakup sub-kategori (`inCategoryTree`).

**UI**
- `/pos` (route group `(pos)`, fullscreen): pilih cabang toko, buka shift (kas awal), scan barcode/SKU (Enter langsung masuk keranjang), grid produk + stok cabang, chip kategori, keranjang (batas stok), total & PPN, pintasan F2/F8, pembayaran tunai (nominal cepat, kembalian) / QRIS / EDC / transfer manual (no. referensi), layar sukses, cetak struk, riwayat transaksi shift (cetak ulang, void), tutup shift (ringkasan per metode, hitung kas, selisih). HP: bar keranjang di bawah + panel geser.
- `/pos/receipt/[id]`: struk thermal 58/80 mm (SSR), cetak otomatis, tanda DIBATALKAN.
- `/sales`: daftar transaksi (periode, cabang, status, cari nomor), panel rincian (item, pembayaran, laba kotor bila boleh lihat HPP), cetak struk, void.
- Dashboard: bagian Penjualan (omzet/transaksi hari ini vs kemarin, rata-rata, omzet 14 hari, terlaris, porsi metode bayar).
- Sidebar: menu Kasir & Transaksi.

**Diverifikasi**: checkout tunai via keyboard (F8 → nominal → Enter), idempotensi (retry = transaksi sama), stok tidak cukup & pembayaran tidak cocok ditolak, void mengembalikan stok & tidak bisa diulang, kas seharusnya mengabaikan transaksi void, transaksi tanpa shift ditolak, RBAC kasir BDG (tidak bisa buka shift JKT, tidak bisa void, HPP tersembunyi), MCP `sales_summary`, tampilan HP.

**Belum**: split payment di UI (API sudah mendukung banyak pembayaran), diskon manual & voucher, customer/member di kasir, hold/park transaksi, mode offline, QRIS dinamis via gateway, retur setelah shift ditutup, laporan per kasir.
- Catatan dev: Turbopack beberapa kali memakai bundle server lama setelah edit file beruntun → restart `pnpm dev` bila muncul hydration mismatch.

## 2026-10-17 — Sesi 3: UI master data
- **Pengaturan** (`/settings/*`, menu baru di sidebar, tampil bila punya salah satu permission terkait):
  - Cabang: daftar, tambah/ubah (kode, tipe toko/gudang/online, zona waktu, PPN & harga termasuk/belum, kepala/kaki struk, aktif).
  - Pengguna: daftar + cari + pagination, tambah (password awal), ubah, penugasan **role per cabang** (banyak baris, "Semua cabang"), nonaktifkan (memutus semua sesi), atur ulang password.
  - Role & akses: daftar role + jumlah pengguna, **matriks permission** resource × aksi (centang per baris), anti-eskalasi di UI (akses yang tidak dimiliki redup), role Owner terkunci, duplikat role, hapus dengan konfirmasi.
  - API key & MCP: daftar key (status, terakhir dipakai), buat (masa berlaku), key tampil sekali + perintah koneksi Claude Code, cabut.
  - Audit log: riwayat read-only dengan filter jenis data, detail sebelum/sesudah, cursor pagination.
- **Kategori** (`/products/categories`, sub-menu Produk): pohon 3 tingkat, jumlah produk (tautan ke filter), tambah sub-kategori, ubah induk (mencegah siklus), hapus kategori kosong.
- Komponen baru (`src/components/app`): `Sheet` + `ConfirmDialog` (Modal react-aria), `SubNav`, `Guard`/`HomeGuard`; helper `lib/form-errors.ts`.
- Pengguna tanpa `dashboard:read` (mis. Kasir) diarahkan ke halaman pertama yang boleh dibuka.
- Diverifikasi: Kasir Bandung (dibuat lewat UI) hanya melihat stok BDG, HPP tersembunyi, endpoint admin & eskalasi role → 403. Akun uji tersimpan di `.env` (`TEST_KASIR_*`, lokal).
- Catatan dev: setelah `pnpm install`, restart `pnpm dev` (Turbopack sempat memakai bundle server lama → hydration mismatch).

**Belum selesai:** transfer stok, opname, POS, order online, pembayaran, voucher, membership, laporan penjualan, import/export, label barcode, 2FA, foto produk, test otomatis.

## 2026-10-17 — Sesi 2: Fondasi + Produk & Stok
**Tools & keamanan**
- SkillSpector dipasang (`~/tools/skillspector`), Impeccable & BoardUI discan lalu dipasang; hasil di SECURITY_LOG.md. `.mcp.json` untuk MCP BoardUI (telemetry off).
- `pnpm audit`: esbuild lama dipatch via override; `braces` (dev-only) diterima sementara.

**Proyek**
- Next.js 16.4 + React 19 + TS 5.9 + Tailwind 4 di root; `boardui init` + 38 komponen BoardUI (`src/components/base|application|foundations`).
- PostgreSQL 18 lokal via `embedded-postgres` (`pnpm db:start`) karena Docker Desktop gagal; `docker-compose.yml` tetap tersedia.
- Drizzle schema & migrasi: auth (Better Auth), cabang, RBAC, API key, audit log, kategori, produk, opsi/varian, inventory, stock movement. Seed: 7 role, 3 cabang, Owner, 4 produk.

**Server** (`src/server`)
- Hono di `app/api/[[...route]]` → `/api/auth/*` (Better Auth), `/api/v1/*` (23 path), `/api/mcp`.
- Middleware: autentikasi sesi/API key, CSRF origin check, `requirePermission`, error handler (pesan Indonesia, unique-violation → 409 ramah), Zod locale `id`.
- Service: branch, role (anti-eskalasi), user (buat user + password hash), category (maks 3 level), product (generate varian, SKU & EAN-13 otomatis, stok awal), inventory (`applyStockChanges` satu UPDATE atomik + ledger), dashboard (agregat SQL), audit, api-key, pencarian per kata (`matchAllTerms`).
- OpenAPI 3.1 dari Zod + Scalar di `/api/v1/reference` (dikunci versi, fitur cloud dimatikan, butuh `api_docs:read`).
- MCP server read-only, 7 tool, memanggil API v1 in-process; diuji end-to-end.

**UI** (`src/app`, `src/components/app`)
- Login, app shell (sidebar BoardUI + pemilih cabang + menu akun + drawer HP), toast, data table server-side (tabel ≥768px, kartu di HP), scan input (scanner USB + kamera BarcodeDetector).
- Dashboard stok (KPI, pergerakan 14 hari, stok per cabang, perlu restock).
- Produk: list (cari/scan, filter status & kategori), detail SSR (matriks varian × cabang, ubah varian, aktifkan/arsipkan), tambah produk (generator variasi, harga massal, stok awal per cabang).
- Stok: list per cabang (filter cabang/status), terima/sesuaikan via scan, kartu stok (cursor pagination).
- PRODUCT.md untuk Impeccable; detector Impeccable: 0 temuan.

**Belum selesai**
- UI untuk cabang, pengguna, role (matriks permission), kategori, API key, audit log (API sudah ada).
- Transfer stok, stok opname, POS, order online, payment gateway, voucher, membership, laporan penjualan, notifikasi, import/export CSV, cetak label barcode, 2FA, upload foto (storage belum dipilih).
- Test otomatis (Vitest/Playwright) belum ditulis.

## 2026-10-17 — Sesi 1: Perencanaan
- Membuat dokumen awal: PRD, DESIGN_SYSTEM, ARCHITECTURE, DATABASE, DECISIONS, OPEN_QUESTIONS, README.
- Riset: Next.js 16.4 (`middleware.ts` → `proxy.ts`), BoardUI (CLI `boardui`, Remix Icon, Inter/JetBrains Mono, MCP lokal `npx -y boardui@latest mcp`, komponen Pro butuh lisensi), Impeccable (`pbakaus/impeccable`), SkillSpector (`NVIDIA/SkillSpector`, butuh Python).
- **Belum:** jawaban owner atas OPEN_QUESTIONS, instalasi tools (BoardUI MCP, Impeccable, SkillSpector), inisialisasi project.
