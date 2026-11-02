# Arsitektur Teknis

> Status: **v0.2 — sebagian terimplementasi** (lihat CHANGELOG). Versi package dicek pada 2026-10-17. Sebelum memakai API sebuah library, cek dokumentasi terbaru via **Context7** — jangan mengandalkan ingatan.

## 1. Tech Stack

| Lapisan | Pilihan | Versi (2026-10-17) | Alasan |
|---|---|---|---|
| Framework | Next.js (App Router), fullstack | 16.4.x | Diminta owner; SSR + API dalam satu project |
| UI runtime | React | 19.x | Syarat BoardUI |
| Bahasa | TypeScript strict | 5.9 (bawaan create-next-app 16.4) | TS 7 (native) ditunda sampai tooling Next mendukung penuh |
| Styling | Tailwind CSS | 4.x | Syarat BoardUI |
| UI kit | BoardUI (CLI `boardui`) + `react-aria-components` | boardui 0.5.x | Diminta owner |
| Ikon | `@remixicon/react` | 4.x | Bawaan BoardUI |
| Motion | `motion` (Framer Motion) + `gsap` (terbatas) | 14.x / 3.x | Diminta owner |
| Database | PostgreSQL | 18 (`uuidv7()` bawaan) | Diminta owner. Dev: `embedded-postgres` (ADR-009) |
| ORM | **Drizzle ORM** + drizzle-kit (migrasi) | 0.45.x | SQL-first: join & query eksplisit sehingga N+1 mudah dihindari dan terlihat; ringan, type-safe. (Alternatif Prisma 8 masih RC) |
| API router | **Hono** di dalam Route Handler Next (`app/api/[[...route]]/route.ts`) + `@hono/zod-openapi` | | Satu rantai middleware (auth → RBAC → rate limit → validasi) untuk semua endpoint; OpenAPI tergenerate dari schema |
| Validasi | Zod | 4.x | Satu schema untuk validasi request, tipe TS, dan OpenAPI |
| Docs API | **Scalar** (`@scalar/nextjs-api-reference` / `@scalar/hono-api-reference`) | | UI modern pengganti Swagger UI |
| Auth | **Better Auth** (email/password, sesi DB) + API key buatan sendiri (ADR-010) | 1.7.x | Self-hosted, data user di Postgres kita; 2FA plugin menyusul |
| Data fetching client | TanStack Query | 5.x | Cache, refetch, optimistic update untuk POS & tabel |
| Tabel | TanStack Table (via data table BoardUI) | | |
| MCP | `@modelcontextprotocol/sdk` (Streamable HTTP) | 1.x | |
| Background job | **pg-boss** (antrian di Postgres) — belum dipasang | | Tanpa infrastruktur tambahan (Redis) di awal |
| Media | **Cloudinary** (REST API bertanda tangan, tanpa SDK) — cadangan: Postgres (bytea) bila belum dikonfigurasi (ADR-025) | | Thumbnail produk; video/media berikutnya lewat modul yang sama |
| Payment | Midtrans / Xendit SDK **[Q-09]** | | |
| Testing | Vitest (unit/service), Playwright (E2E alur kasir) | | |
| Kualitas | ESLint, Prettier, Impeccable (audit UI), SkillSpector + `npm audit`/OSV (audit package & skill) | | |

## 2. Prinsip Arsitektur (WAJIB)

1. **Satu jalur data: semua baca/tulis lewat API.**
   UI tidak pernah meng-import Drizzle/`db` atau service secara langsung.
   - Client Component → `fetch`/TanStack Query → `/api/v1/...`.
   - Server Component (SSR) → `apiServer()` yang memanggil aplikasi Hono **di dalam proses** (`app.request(...)`) dengan cookie user yang sama. Request tetap melewati middleware auth, RBAC, validasi, dan audit yang sama persis, tanpa hop jaringan.
   - MCP tools → memanggil API/service yang sama dengan konteks user pemilik API key.
   - Lint rule (`no-restricted-imports`) melarang import `@/server/db` dan `@/server/services` dari `src/app/(app)/**` dan `src/components/**`.
2. **Layering di server:** `route (Hono, validasi Zod)` → `service (logika bisnis + cek permission level data)` → `repository/query (Drizzle)`. Route tipis, service tidak tahu HTTP.
3. **Uang = integer rupiah** (`bigint`), tidak ada float. Persen disimpan dalam basis poin (`2000` = 20,00%).
4. **Ledger untuk stok, poin, dan kuota voucher.** Tabel saldo hanya cache dari ledger dan diperbarui di transaksi DB yang sama.
5. **Idempotensi** untuk pembuatan transaksi POS, order online, dan webhook pembayaran (header `Idempotency-Key` / id event) — mencegah transaksi ganda saat kasir klik dua kali atau jaringan retry.
6. **Server adalah otoritas.** Harga, diskon, voucher, pajak, total dihitung ulang di server; nilai dari client hanya input.

## 3. Struktur Folder (aktual)

```
/docs                          # semua konteks proyek (baca README.md dulu)
PRODUCT.md                     # konteks produk untuk skill Impeccable
/scripts                       # dev-db.ts (PostgreSQL lokal), seed.ts
/src
  proxy.ts                     # Next 16 (pengganti middleware.ts): cek cookie sesi saja
  /app
    /(auth)/login              # halaman masuk
    /(app)/layout.tsx          # shell: SSR /me di dalam Suspense → AppShell
    /(app)/dashboard|sales|products|inventory|settings
    /(pos)/pos                 # layar kasir fullscreen + /pos/receipt/[id] (struk)
    /api/[[...route]]/route.ts # mount Hono: /api/auth/*, /api/v1/*, /api/mcp
  /components
    /base /application /foundations  # BoardUI (hasil CLI, vendor)
    /app                       # komposisi proyek: app-shell, app-sidebar, data-table, scan-input, toast, page-header, session-context
  /hooks                       # use-url-state, use-count-up (BoardUI)
  /lib                         # api-client (client), auth-client, format, slug
  /styles                      # theme.css, typography.css, globals.css (BoardUI) + app.css
  /server
    env.ts                     # validasi env (Zod)
    /api                       # app.ts, middleware.ts, router.ts, schemas.ts, pagination.ts, errors.ts, server-client.ts, routes/*
    /services                  # logika bisnis per modul
    /db                        # index.ts (koneksi), schema/*, migrations/*, search.ts
    /auth                      # konfigurasi Better Auth
    /rbac                      # permissions.ts (katalog, aman untuk client), access.ts
    /mcp                       # server.ts (tool MCP)
```
Rencana: `/server/payments` (PaymentProvider untuk QRIS dinamis), `/server/jobs` (pg-boss).
`src/lib/pricing.ts` = perhitungan total/PPN bersama client & server (ADR-013).

## 4. Konvensi API

- Base path `/api/v1`. Resource jamak, kebab-case: `/products`, `/stock-transfers`, `/vouchers/{id}/usages`.
- Respons sukses: `{ data, meta? }`. Error: `{ error: { code, message, details? } }` dengan kode stabil (misal `VOUCHER_MIN_SPEND_NOT_MET`) agar UI bisa menampilkan pesan yang tepat.
- **Pagination:** list besar memakai **cursor** (`?cursor=&limit=`, default 25, maks 100) — transaksi, stock movement, audit log. Tabel admin yang butuh "halaman 3 dari 20" boleh offset dengan `limit` maksimal & total count terpisah/approximate.
- Filter & sort lewat query string tervalidasi Zod (whitelist kolom sort — tidak pernah menyusun SQL dari input mentah).
- Semua endpoint terdaftar di OpenAPI dengan schema request/response + permission yang dibutuhkan (`x-permission`).
- Versi API: breaking change → `/api/v2`.

## 5. Keamanan

**Autentikasi**
- Better Auth, sesi disimpan di DB, cookie `httpOnly`, `Secure`, `SameSite=Lax`; rotasi sesi saat login & ganti password.
- Password di-hash (scrypt/argon2 bawaan Better Auth). PIN kasir di-hash terpisah, berlaku hanya di perangkat POS terdaftar.
- 2FA TOTP wajib untuk role dengan permission `role:update`/`setting:update`.
- Rate limit: login (Better Auth), API 600/menit per pengguna/API key, MCP 120/menit, webhook 300/menit per IP (`src/server/api/rate-limit.ts`, in-memory per instance — tambahkan rate limit di proxy bila multi-instance).
- API key (untuk MCP & integrasi): hanya ditampilkan sekali, disimpan hash, punya scope, tanggal kedaluwarsa, bisa dicabut, tercatat last-used.

**Otorisasi (berlapis)**
1. `proxy.ts` — hanya pengecekan ringan: ada cookie sesi atau tidak → redirect ke `/login` untuk halaman. **Bukan** tempat otorisasi (sesuai panduan Next.js 16).
2. Middleware Hono `requireAuth` — validasi sesi/API key sungguhan.
3. Middleware Hono `requirePermission('product', 'update')` — per route.
4. Service — cek cakupan cabang (user hanya akses data cabang yang di-assign) dan filter field sensitif (HPP, data pribadi).
5. Server Component/halaman juga memeriksa permission sebelum render (defense in depth), UI menyembunyikan aksi yang tidak diizinkan.

**Lainnya**
- Validasi semua input dengan Zod; query parametrik via Drizzle (anti SQL injection).
- CSRF: cookie SameSite + cek header `Origin` untuk request mutasi berbasis cookie.
- Security headers semua halaman (`next.config.ts`): CSP (skrip `'self' 'unsafe-inline'` karena Cache Components — ADR-026), `frame-ancestors 'none'`, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy, COOP, HSTS (produksi). API: `secureHeaders` Hono.
- Kredensial payment gateway dienkripsi (AES-256-GCM) dengan kunci dari env; secret tidak pernah dikirim ke client.
- Webhook: verifikasi signature + idempotensi + allowlist IP bila gateway menyediakan.
- Upload: validasi MIME & ukuran, upload langsung ke storage via presigned URL, nama file acak.
- Audit log untuk semua mutasi (lihat PRD §3.12).
- Data pribadi customer dimasking di log & MCP; kepatuhan UU PDP.
- Supply chain: setiap package baru diperiksa (lihat §9) sebelum masuk `package.json`; lockfile di-commit.

## 6. Performa & Data Fetching

**Strategi render per area:**

| Area | Strategi |
|---|---|
| Login, halaman publik | SSR/statis |
| Layout & shell back-office | SSR (cek sesi + permission, menu sesuai role) |
| Dashboard | CSR (TanStack Query) karena bergantung cabang aktif per perangkat — lihat ADR-011 |
| List (produk, stok, kartu stok) | CSR + skeleton; filter & halaman disimpan di URL; `keepPreviousData` agar tabel tidak berkedip |
| Detail produk | SSR via `apiServer()` (Suspense) → hydrate ke TanStack Query (`initialData`) |
| Form | Client component, validasi ulang di server |
| **Layar POS** | **CSR**: sesi/shift & katalog via TanStack Query (48 per halaman, cache 15 detik, di-refresh setelah transaksi); scan memanggil `/pos/catalog?q=` dan langsung menambahkan hasil yang cocok persis. Offline mode belum (Q-01) |
| **Struk** | SSR via `apiServer()`, CSS `@page` sesuai lebar thermal |
| Laporan berat | Background job → file unduhan |

**Mencegah N+1 query:**
- Ambil relasi dengan join / Drizzle relational query (`with:`) atau query batch `WHERE id IN (...)` — **tidak pernah query di dalam loop**.
- Agregasi (total penjualan, stok per cabang) dilakukan di SQL (`GROUP BY`), bukan di JavaScript.
- Dev mode: logger menghitung jumlah query per request dan memberi peringatan bila > ambang (misal 10).
- Review code: setiap service list wajib menyebut jumlah query yang diharapkan di test.

**Lainnya:**
- Index untuk kolom filter/join (SKU, barcode, `branch_id + variant_id`, `created_at`, foreign key). Pencarian produk memakai `pg_trgm`.
- Lazy loading: gambar via `next/image`, komponen berat (chart, editor, scanner kamera) via `next/dynamic`, daftar panjang dengan virtualisasi.
- Materialized view / tabel ringkasan harian untuk dashboard bila data besar (refresh via job).
- Connection pooling (PgBouncer atau pooler bawaan hosting).

## 7. Konsistensi Transaksi
- Checkout POS = satu DB transaction: validasi harga & voucher → kunci baris stok (`SELECT ... FOR UPDATE` atau `UPDATE ... SET qty = qty - $1 WHERE qty >= $1`) → insert sale, item, payment, stock movement, point ledger, voucher usage → commit.
- Nomor invoice dari sequence per cabang per hari (tabel counter dengan lock).
- Pembayaran gateway: sale dibuat status `PENDING_PAYMENT` dengan stok ter-reserve; webhook/polling menandai `PAID`; timeout melepas reserve.

## 8. Deployment **[Q-19]**
- Opsi A: VPS (Docker Compose: Next.js + Postgres + worker pg-boss + MinIO) — biaya rendah, butuh pemeliharaan.
- Opsi B: Vercel (Next) + Postgres terkelola (Neon/Supabase/RDS) + worker terpisah (Railway/Fly) — mudah, biaya naik seiring skala.
- Environment: `development`, `staging`, `production`. Secret via env, `.env.example` di-commit tanpa nilai.
- CI: lint, typecheck, test, build, audit package, Impeccable detector.

## 9. Workflow Keamanan Package & Kualitas UI
- **SkillSpector (NVIDIA):** dipakai untuk memindai *agent skill* & MCP server yang dipasang (Impeccable, MCP BoardUI, dsb.) sebelum dipakai. Catatan: SkillSpector dirancang untuk skill AI agent; untuk package npm biasa dilengkapi dengan `npm audit` + pengecekan OSV.dev (SkillSpector juga memakai OSV untuk dependency). Hasil scan dicatat di `docs/SECURITY_LOG.md`.
- **Impeccable:** `init` menghasilkan konteks produk & desain; jalankan audit (`detect`) sebelum setiap fitur UI dianggap selesai.
- **Context7:** cek dokumentasi resmi versi terpasang sebelum menulis kode untuk library apa pun.

## Idempotensi & konkurensi
- Kunci alami bila ada: `sales.idempotency_key`, `online_orders` (kanal + nomor), `payment_events` (provider + event_key).
- Selain itu middleware `idempotent` (`src/server/api/idempotency.ts`): aktif bila klien mengirim `Idempotency-Key`, hanya respons sukses disimpan, kunci sama dengan isi berbeda ditolak 422.
- Kas: transaksi memegang kunci bersama baris shift (`lockOpenShift`), tutup shift memegang kunci eksklusif, sehingga angka kas tidak bisa bergeser setelah dihitung.
- QRIS: pembuatan intent diserialkan per dokumen dengan advisory lock + indeks unik parsial.
- Gateway: `PaymentProvider` di `src/server/payments`. `providerByName` tidak terbatas pada gateway aktif agar QR lama tetap diproses setelah pindah gateway.
