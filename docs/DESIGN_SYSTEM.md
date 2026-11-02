# Design System

> Status: **v0.2 — terpasang**. Token ada di `src/styles/theme.css` (hasil `boardui init`, belum diubah). Dokumen ini mengatur *cara pakai*, bukan menyalin nilai. Mode Impeccable untuk back-office: **Operate** (presisi & konsistensi, bukan ekspresi).
> Referensi visual: https://www.boardui.com (minimalis, modern, premium).

## 1. Prinsip

1. **Data dulu, dekorasi belakangan.** Angka penting (omzet, stok, total bayar) adalah elemen terbesar di layarnya. Tidak ada ilustrasi atau gradient yang bersaing dengan data.
2. **Cepat untuk kasir, jelas untuk manajer.** Layar POS mengutamakan target sentuh besar & keyboard. Layar back-office mengutamakan kepadatan informasi yang tetap lapang.
3. **Satu sumber komponen.** Semua elemen UI (button, input, select dengan search, date picker, time picker, dialog, table, chart, toast, badge, tabs, dll.) memakai komponen **BoardUI**. Dilarang membuat komponen dasar baru bila BoardUI punya. Bila tidak ada, komposisikan dari primitive BoardUI + `react-aria-components` dengan token yang sama, lalu catat di §8.
4. **Gerak punya fungsi.** Animasi hanya untuk memberi konteks (masuk/keluar, perubahan angka, urutan), bukan hiasan.
5. **Bahasa manusia.** Teks UI dalam Bahasa Indonesia yang ringkas dan konkret (lihat §7).

## 2. Fondasi dari BoardUI

| Aspek | Keputusan |
|---|---|
| Instalasi | `npx boardui@latest init` lalu `npx boardui@latest add <komponen>`; atau via MCP BoardUI. Source komponen disalin ke `src/components/ui/` dan boleh disesuaikan |
| Primitive | `react-aria-components` (aksesibilitas & keyboard bawaan) |
| Styling | Tailwind CSS v4, utilitas digabung dengan `tailwind-merge` (`cn()`) |
| Token | `src/styles/theme.css`: `@theme` (primitive) → `:root` (semantic, light) → `.dark` (override) → `@theme inline` (semantic sebagai utilitas Tailwind) |
| Ikon | **Remix Icon** (`@remixicon/react`) — library ikon bawaan BoardUI, ±3.000 ikon line & fill. Ikon tambahan **hanya** dari Remix Icon agar konsisten. Tidak ada SVG ikon buatan sendiri/AI |
| Font | Inter (`--font-inter`) + JetBrains Mono (`--font-mono-source`) via `next/font` di `src/app/layout.tsx` — default BoardUI **[Q-18]** |
| Dark mode | Class `.dark` di `<html>`; toggle `ThemeToggle` di sidebar; pilihan disimpan (`boardui:theme`) dan diterapkan sebelum paint. Default terang (tidak mengikuti sistem, sesuai perilaku BoardUI) |

## 3. Token (aturan pakai)

**Warna — selalu pakai token semantic BoardUI, jangan hex/palet mentah (`text-gray-500`, `bg-white`) di komponen.**

| Peran | Token (utilitas Tailwind) | Pakai untuk |
|---|---|---|
| Latar halaman | `bg-background-full` | `<body>` |
| Permukaan | `bg-background-primary-default` (kartu putih/form), `bg-background-secondary-default` (panel/kartu chart, sidebar), `bg-background-tertiary-default` (skeleton, chip netral) | Lapisan |
| Teks | `text-text-primary`, `text-text-secondary`, `text-text-tertiary`, `text-text-error-primary` | Isi, label, keterangan, error |
| Ikon | `text-foreground-icon-primary` … `-quaternary` | Ikon Remix |
| Garis | `border-border-button-default`, `border-separator-border`, `border-border-table` | Kartu, pemisah, tabel |
| Accent | `accent-50…950` (default biru) | Tombol primer, item nav aktif, fokus, link. Ganti warna brand = override variabel accent |
| Status | `bg-status-{lime,rose,yellow,…}-background` + `text-status-…-text`; komponen `Chip` | Aman/menipis/habis, sukses/gagal |
| Chart | `chart-1…9` (+ `-active`), `chart-neutral`, `chart-track` | Seri chart. Konvensi: **masuk/utama = `chart-6-active`** (biru accent), **pembanding/keluar = `chart-neutral`** |

Status stok konsisten di semua layar: **Habis** = Chip `rose`, **Menipis** (≤ batas minimum) = `yellow`, **Aman** = `gray` / angka polos. Warna selalu disertai teks.

**Tipografi:** pakai utilitas komposit BoardUI (`text-title-1-medium`, `text-headline-medium`, `text-body-medium`, `text-body-2-regular`, `text-caption-1-regular`, …) — jangan menumpuk `text-sm font-medium`. Judul halaman `text-title-1-medium`, judul panel `text-headline-medium`, isi `text-body-*`. Angka: `tabular-nums`. SKU/barcode/kode: `font-mono`.

**Radius & shadow:** pakai token BoardUI (kartu besar membulat lembut, inner shadow halus seperti kartu chart di boardui.com). Tidak ada kartu bersarang dalam kartu dengan border ganda.

**Spacing:** skala Tailwind kelipatan 4px. Kepadatan:
- Back-office: baris tabel 44–48px, padding kartu 20–24px.
- POS: tombol min 48px tinggi, tile produk min 120px, jarak antar tile 12px.

**Tipografi (skala):**

| Level | Penggunaan |
|---|---|
| Display (36–48px, semibold, tracking rapat) | Angka KPI utama, total bayar di POS |
| H1 (24px) | Judul halaman |
| H2 (18px) | Judul kartu/seksi |
| Body (14px) | Isi, tabel |
| Caption (12–13px, `text-muted`) | Label, metadata, keterangan chart |
| Mono (13px) | SKU, barcode, kode voucher, nomor invoice |

Angka memakai `tabular-nums` agar kolom rata. Format Rupiah: `Rp1.250.000` (tanpa desimal), persentase `+5,2%`.

## 4. Layout

- **App shell back-office:** sidebar kiri (bisa diciutkan) berisi navigasi per modul, header dengan pemilih cabang aktif, quick search (`Ctrl/⌘K` — command menu BoardUI), notifikasi, toggle tema, menu user.
- **Halaman list:** judul + aksi utama kanan atas → baris filter (search, select bisa search, date range) → data table (sort, filter, pagination server-side, kolom bisa disembunyikan, bulk action) → empty state yang menjelaskan langkah berikutnya.
- **Data master (cabang, pengguna, role, kategori, API key):** daftar di halaman, form di `Sheet` dari kanan (HP: dari bawah). Role memakai pola master–detail: daftar role kiri, matriks permission kanan dengan bar simpan sticky.
- **Halaman detail/form:** form dalam satu kolom lebar terbatas (≤ 720px) atau 2 kolom untuk data + ringkasan. Tombol simpan sticky di bawah pada form panjang.
- **Layar POS (terpasang):** fullscreen tanpa sidebar, bar atas 56px (kembali, cabang, info shift, transaksi shift, tutup shift). Kiri: input scan 48px (autofocus, F2), chip kategori 40px, grid tile ≥120px (nama, varian, harga `text-headline-semibold`, stok kuning ≤5 / merah habis, badge qty di keranjang). Kanan ≥1024px: keranjang 380–420px di latar sekunder, total `text-display-4-medium`, tombol Bayar 56px (F8). <1024px: bar keranjang di bawah + panel geser dari bawah. Pembayaran: dialog modal (fokus terlindungi), nominal tunai besar, tombol nominal cepat, kembalian `text-title-2-medium`, layar sukses dengan kembalian `text-display-3-medium`.
- **Struk:** monospace 11px hitam di putih (bukan token tema — kertas thermal), lebar 58/80 mm, garis putus-putus, tanpa warna.
- **Dashboard:** grid kartu KPI di atas (angka + delta badge seperti "+5,2%"), chart utama lebar penuh, chart pendukung 2 kolom, tabel ringkas di bawah. Pola kartu chart mengikuti boardui.com: judul kecil, angka besar, pemilih periode di kanan atas.
- Breakpoint: mobile (< 768) sidebar jadi drawer, tabel jadi list kartu; tablet (768–1279) layout POS tetap 2 panel; desktop ≥ 1280.

## 5. Komponen Kunci → BoardUI

| Kebutuhan POS | Komponen BoardUI (free/Pro dicek saat implementasi) |
|---|---|
| Tombol, input teks, textarea, checkbox, switch, radio | Button, Input, Textarea, Checkbox, Switch, Radio |
| Dropdown dengan pencarian (pilih kategori, cabang, customer) | Combobox / Select with search |
| Tanggal, rentang tanggal, jam | Date picker, Date range picker, Time picker |
| Tabel produk, transaksi, stok | Data table (TanStack Table) — **Pro** |
| Grafik penjualan, funnel, bar, radar, donut | Chart components (19 chart) — **Pro** |
| Dialog, drawer, popover, tooltip, toast | Dialog, Drawer/Sheet, Popover, Tooltip, Toast |
| Tabs, segmented control (Mingguan/Bulanan/Tahunan) | Tabs, Segmented control |
| Badge status, avatar, progress (kuota voucher) | Badge, Avatar, Progress/Meter |
| Command menu (`⌘K`) | Command menu — **Pro** |
| Upload foto produk | File upload / dropzone |
| Empty state, skeleton loading | Empty state, Skeleton |

## 6. Motion

- Library: **Motion** (`motion`, dulu Framer Motion) untuk transisi komponen React; **GSAP** hanya bila perlu timeline kompleks (misal animasi onboarding/hero login). Hindari memakai keduanya di satu komponen.
- Durasi: 150–200ms mikro-interaksi, 250–350ms panel/dialog. Easing ease-out untuk masuk, ease-in untuk keluar.
- Pola yang dipakai: angka KPI count-up saat data dimuat, bar chart tumbuh dari bawah, item keranjang masuk dengan slide+fade, toast dari pojok, skeleton → konten crossfade.
- **Wajib** hormati `prefers-reduced-motion`: animasi dimatikan/diganti fade instan.
- Layar POS: animasi minimal agar tidak memperlambat kasir.

## 7. Wording & Microcopy

- Bahasa Indonesia baku santai, kalimat aktif, sapaan tanpa "Anda" berlebihan.
- Tombol = kata kerja + objek: "Simpan produk", "Kirim transfer", "Bayar Rp125.000". Hindari "Submit", "OK", "Klik di sini".
- Pesan error menjelaskan masalah + cara memperbaiki: "SKU sudah dipakai produk Kaos Basic Hitam. Gunakan SKU lain." bukan "Error 409".
- Empty state: apa yang terjadi + aksi berikutnya: "Belum ada voucher. Buat voucher pertama untuk mulai promosi."
- Konfirmasi aksi destruktif menyebut objek & akibat: "Arsipkan 3 produk? Produk tidak akan tampil di kasir."
- Istilah konsisten (glosarium): Produk, Varian, SKU, Stok, Cabang, Transfer stok, Stok opname, Penyesuaian stok, Transaksi, Retur, Voucher, Member, Poin, Shift, Kanal penjualan.
- Hindari frasa generik AI: "Selamat datang di dashboard yang powerful", "Kelola bisnis Anda dengan mudah!", emoji dekoratif.

## 8. Anti-pattern (dicek dengan Impeccable)

- Gradient ungu/biru dekoratif, glow, glassmorphism berlebihan.
- Kartu di dalam kartu di dalam kartu.
- Teks abu-abu di atas latar berwarna (kontras rendah).
- Ikon dari banyak library atau ikon buatan.
- Semua elemen sama tebal/sama besar — hierarki harus jelas.
- Placeholder sebagai pengganti label.
- Warna sebagai satu-satunya penanda status (selalu ada teks/ikon).

## 9. Komponen Kustom (komposisi proyek, `src/components/app`)

Semua dibangun dari primitive BoardUI + token yang sama.

| Komponen | Alasan | Dibangun dari |
|---|---|---|
| `AppSidebar` | Sidebar BoardUI berisi menu template demo; butuh nav berbasis permission + pemilih cabang | Pola `NavItem`/`Collapsible` sidebar BoardUI, `Dropdown`, `ThemeToggle`, `Avatar` |
| `AppShell` | Layout responsif: sidebar mengambang ≥1024px, bar atas + drawer di bawahnya | Sidebar di atas |
| `DataTable` | `data-table` BoardUI adalah contoh berdata statis; butuh pagination server & tampilan kartu di HP | `Table`, `Pagination`, `Skeleton` |
| `ScanInput` | Scan barcode (scanner USB & kamera) untuk kasir/stok/audit | `InputBase`, `Button`, BarcodeDetector API |
| `ToastProvider` | Umpan balik setelah aksi | `Notification`, `NotificationViewport` |
| `PageHeader`, `Panel`, `Skeleton` | Konsistensi judul halaman & permukaan kartu | Token & tipografi BoardUI |
| `BrandMark` | Logo sementara "POS" | Gradien accent + `RiStore2Fill` |
| `MultiPicker` | Pilih banyak target (kategori/produk/varian/customer/tier/cabang) dengan pencarian API | `InputBase`, `Checkbox`, chip token sekunder |
| `VariantChoices` + `lookupVariant()` | Hasil scan: langsung cocok (barcode/SKU persis), daftar pilihan bila kode cocok ke banyak varian, atau "tidak ditemukan"; dipakai transfer & opname | `Button`, `/variants/search` |
| `ReturnForm` (`return-form.tsx`) | Retur atas satu struk: qty per baris, kondisi rusak, metode refund, pratinjau uang & poin (rumus `lib/returns`) | `Button`, `Checkbox`, `Select`, `Input` |
| `QrCode` (`qr-code.tsx`) | QRIS dinamis sebagai SVG (qrcode-generator), selalu hitam di atas putih | — (SVG murni) |
| `Timeline` (`timeline.tsx`) | Tahapan status dokumen (transfer, order online) | Token BoardUI, `RiCheckLine` |
| `useApproval` (`approval-dialog.tsx`) | Dialog PIN atasan; `request(permission, branchId)` → id izin untuk header `X-Approval-Id` | `Modal`, `InputBase`, `Button` |
| `ApprovalPinSheet` | Atur/ganti PIN persetujuan sendiri dari menu akun | `Sheet`, `Input` |
| `ConnectivityBadge` + `SyncSheet` (`pos/offline/sync-sheet.tsx`) | Penanda offline/antrean di header kasir + daftar transaksi offline (sinkron, coba lagi, keluarkan) | `Sheet`, `Button`, `ConfirmDialog` |
| `ThumbnailPicker` (`thumbnail-picker.tsx`) | Pilih gambar produk; diperkecil di perangkat (≤ 1024 px) sebelum diunggah; pratinjau & hapus | `Button`, token permukaan; `FileUpload` BoardUI tidak dipakai karena progresnya simulasi |
| `BarcodeSvg` (`barcode-svg.tsx`) + halaman `/labels/{id}` | Label barcode cetak: hitam di atas putih (bukan token tema), ukuran mm, `@page` sesuai label | SVG murni, `src/lib/barcode.ts` |
| `SearchSelect` (`search-select.tsx`) | Pilihan master data bisa-cari ke server + opsi "Tambah"; BoardUI belum punya combobox | react-aria `ComboBox`, gaya trigger/menu `Select` & `menu-styles` BoardUI |
| `BrandPicker` (`brand-picker.tsx`) | Pilih/tambah merek; nama sama ejaan lain → pakai merek yang ada | `SearchSelect` |
| `CourierPicker` (`courier-picker.tsx`) | Kurir dari daftar standar atau ketik sendiri | `SearchSelect`, `src/lib/couriers.ts` |
| `CodeField` (`code-field.tsx`) | Input SKU/barcode dengan cek bentrok langsung ke server + duplikat di form | `Input` |
| `LayoutMenu` + `pos-layout.ts` (kasir) | Pilihan tampilan katalog: grid otomatis/3–6 kolom, daftar per baris, tampilkan gambar — per perangkat | `Dropdown`, `Switch`, Remix Icon |
| `CustomerForm` (`customer-form.tsx`) | Satu form customer untuk back-office & daftar cepat di kasir | `Input`, `Textarea`, `Checkbox` |
| `SubNav` | Sub-navigasi modul (Stok, Produk, Pengaturan), tab tersembunyi bila tak punya izin | Gaya underline tab BoardUI |
| `Sheet` | Form tambah/ubah data master tanpa meninggalkan daftar; fokus terkunci, Esc menutup | `Modal`/`Dialog` react-aria (dasar BoardUI), token permukaan & `shadow-dropdown` |
| `ConfirmDialog` | Konfirmasi aksi destruktif yang menyebut objek & akibat | `Modal` react-aria + `Button` (`danger`) |
| `PrinterSheet` + `useReceiptPrinter` (`printing/`) | Pengaturan printer struk per perangkat & satu fungsi cetak (printer OS, USB/serial/Bluetooth ESC/POS, PDF) | `Sheet`, `RadioGroup`, `SegmentedControl`, `Select`, `Switch` |
| `Markdown` (`markdown.tsx`) + `/panduan` | Panduan dari `docs/PANDUAN-*.md` di aplikasi; elemen React, tanpa HTML mentah. Pola sama dengan modul lain: `PageHeader` + `SubNav` (tab per panduan) + isi; tabel `bui-table` dalam wadah DataTable, callout `bg-background-secondary-default` + ikon info (tanpa garis samping), blok kode = `CodeBlock` (salin, seperti CopyField), tautan `text-accent-600`, daftar isi `GuideToc` sticky ≥1280px. Tanpa emoji | Tipografi & token BoardUI |
| `TerminalSheet` + `chargeTerminal` (`payment-terminal/`) | Pengaturan mesin EDC per perangkat (manual/ECR/simulasi) dan alur tagih otomatis di dialog bayar | `Sheet`, `RadioGroup`, `Select` |
| `DevicesMenu` (kasir) | Satu menu **Perangkat** di kepala kasir: printer struk, mesin EDC, layar pelanggan | `Dropdown` BoardUI |
| Layar pelanggan `/pos/display` | Monitor menghadap pelanggan: keranjang, total, QRIS besar, terima kasih + kembalian | Token & tipografi display BoardUI, `QrCode` |
| Layar persetujuan `/oauth/authorize` | "Izinkan aplikasi AI?" — kartu yang sama dengan halaman login | `Button`, token permukaan |
| `McpConnect` (pengaturan API key) | Pilih aplikasi AI → langkah + konfigurasi siap salin | `Select`, `CopyField` |
| `Guard` / `HomeGuard` | Pesan "belum punya akses" / arahkan ke halaman awal yang diizinkan (UI saja; otorisasi tetap di API) | Token & tipografi BoardUI |

Kontainer `overflow-y-auto` wajib `relative`: input tersembunyi react-aria (`position:absolute`) di dalamnya bila tidak, memanjangkan dokumen (scroll ganda).

Catatan: komponen BoardUI `stat-cards` & pola kartu chart dipakai langsung di dashboard. Chart memakai `recharts` (dependensi BoardUI).

### Merek & akun
- `BrandMark`: tanda gulungan struk (`MARK_PATH`, `src/lib/brand.ts`) memakai warna teks, ditambah "POS / by lifistudio". Jangan beri latar kotak gradien dan jangan ganti dengan ikon: Remix Icon License melarang ikon sebagai logo. Aset di `public/brand`, dibuat ulang dengan `node scripts/brand/build-logo.mjs`: `logo-lockup` (logo lengkap, minimal lebar 120 px agar "by lifistudio" terbaca), `logo-mark` (tanda saja), `logo-tile` (ikon berkotak). Akhiran `-light` untuk latar gelap. Jangan edit SVG manual; skrip menolak hasil yang masih berisi stroke.
- `ChangePasswordSheet`: ganti password sendiri dari menu akun. Halaman `/forgot-password` & `/reset-password` hanya berguna bila SMTP aktif; `LoginHelp` menampilkan tautannya sesuai `/api/public/config`.
- Logo tidak punya pengaturan: tidak ada env maupun menu untuk menggantinya (TRADEMARK.md).
- Di mode gelap, `bg-background-primary-default` menaikkan `--color-background-tertiary-default` (`app.css`), karena permukaannya sama dengan warna kolom input.

## 10. Perubahan pada komponen vendor BoardUI
Catat setiap perubahan pada `src/components/base|application|foundations` agar bisa diterapkan ulang saat memperbarui BoardUI.
- `base/date-picker/date-picker.tsx`: prop `placeholder` (default "Select date") untuk lokalisasi. Locale tanggal mengikuti `I18nProvider locale="id-ID"` di `components/app/providers.tsx`.

## 11. Warna semantik tambahan (konvensi)
- Member/tier & poin: `text-status-purple-text` / Chip `purple`.
- Voucher berhasil: `text-status-lime-text`; voucher ditolak: latar `bg-status-rose-background` + teks `text-status-rose-text` beserta alasannya.
