# Log Keamanan: Package, Skill & MCP

Setiap skill, MCP server, atau package baru diperiksa sebelum dipakai. Catat di sini: tanggal, objek, alat, hasil, keputusan.
Alat: **SkillSpector** (NVIDIA, untuk skill/MCP; dipasang di `~/tools/skillspector`, `skillspector scan <path> --no-llm`), **pnpm audit** (package npm), inspeksi manual untuk temuan.

## 2026-10-17

| Objek | Alat | Hasil mentah | Keputusan |
|---|---|---|---|
| Impeccable skill (`pbakaus/impeccable`, commit `08d5b47`, engine 0.1.15) | SkillSpector statis | Skor 100, "DO NOT INSTALL" | **Dipakai.** Temuan HIGH berada di file referensi markdown (instruksi desain) — pola teks, bukan kode berbahaya. Hook menjalankan launcher yang mengunduh binary engine dari GitHub Releases resmi dan **memverifikasi SHA-256** sebelum eksekusi. Endpoint jaringan di skrip: hanya `localhost` dan `github.com/pbakaus/impeccable`. Dipasang sebagai salinan persis hasil scan di `.claude/skills/impeccable` (tanpa hook otomatis). |
| BoardUI CLI/MCP `boardui@0.5.8` | SkillSpector statis | Skor 73, "DO NOT INSTALL" | **Dipakai.** Temuan "self-modification" = prompt overwrite file komponen. Jaringan hanya ke `boardui.com` (registry/lisensi) dan telemetry anonim (PostHog, `boardui.com/api/cli/telemetry`). `spawn` hanya untuk `pnpm/npm install`. Telemetry **dimatikan** via `BOARDUI_TELEMETRY_DISABLED=1` (`.env`, `.mcp.json`). Versi dikunci di `.mcp.json`. |
| `embedded-postgres@18.4.0-beta.17` (+ `@embedded-postgres/windows-x64`) | Inspeksi manual | postinstall `hydrate-symlinks.js` | **Dipakai (dev only).** Skrip hanya membuat ulang symlink dari `pg-symlinks.json`; tidak ada akses jaringan. Diizinkan di `pnpm-workspace.yaml > allowBuilds`. |
| `esbuild` (build script) | — | dibutuhkan drizzle-kit/tsx | Diizinkan di `allowBuilds`. Script build lain (sharp, unrs-resolver) tetap diblok. |
| MCP server proyek (`src/server/mcp`) | SkillSpector statis | Skor 0, SAFE | — |
| Seluruh dependensi | `pnpm audit` | 1 high (`braces` ≤3.0.3 via eslint-config-next → fast-glob), 1 moderate (`esbuild` ≤0.24.2 via drizzle-kit → @esbuild-kit) | `esbuild` diperbaiki dengan override `@esbuild-kit/core-utils>esbuild: ^0.25.12`. `braces`: belum ada versi perbaikan (3.0.4 belum terbit); hanya dipakai tooling lint dengan pola dari kode sendiri → **risiko diterima**, cek ulang berkala. |
| Scalar API Reference (CDN) | Konfigurasi | Default memuat versi terbaru dari jsDelivr + fitur cloud (Ask AI, Share, Generate SDK) | Bundle **dikunci** ke `@scalar/api-reference@1.72.3`; toolbar, developer tools, telemetry, agent AI, dan MCP cloud Scalar **dimatikan** agar spesifikasi tidak terkirim ke pihak luar. |
| `qrcode-generator@2.0.4` (2026-10-18) | `npm view` + `pnpm audit` | MIT, tanpa dependensi, rilis 2025-08-07 (> 2 minggu); 0 kerentanan | Dipilih daripada `qrcode` (menarik yargs + pngjs). Dipakai di client untuk menggambar QR sebagai SVG. |
| Webhook payment (`/api/payments/webhook/*`) | Desain | Endpoint publik | Signature wajib (SHA512 Midtrans / HMAC simulator, timing-safe), idempotensi `payment_events.event_key`, nominal dicocokkan dengan intent, simulator mati di production. Server key hanya dari `.env`. |
| Integrasi marketplace (2026-10-18) | Desain | Endpoint webhook publik + token OAuth toko | Webhook diverifikasi HMAC (Shopee: url\|body dengan partner_key; simulator: HMAC rahasia server, mati di production). Token dienkripsi AES-256-GCM (kunci HKDF), tidak keluar dari server. State OAuth HMAC + kedaluwarsa + terikat user. Partner key hanya di `.env`. |
| Service worker PWA (2026-10-18) | Desain | Cache di perangkat | API tidak di-cache; shell kasir (berisi nama & permission) hanya disimpan bila valid dan dihapus saat keluar; `sw.js` diberi CSP `default-src 'self'` dan no-cache; tidak ada skrip pihak ketiga. |

## 2026-10-20

| Objek | Alat | Hasil mentah | Keputusan |
|---|---|---|---|
| Modul media Cloudinary (`src/server/media`) | SkillSpector statis | 6/100 LOW, 1 temuan "External Transmission" (cloudinary.ts) | **Dipakai.** Transmisi ke `api.cloudinary.com` adalah tujuan modul; yang dikirim file gambar + tanda tangan, **bukan** API secret. Tanpa SDK/package baru. |
| MCP server (`src/server/mcp`, 21 tool) | SkillSpector statis | 0/100 SAFE | Read-only; kini juga rate limit 120/menit per API key. |
| Seluruh dependensi | `pnpm audit --prod` / `pnpm audit` | prod: 0; dev: 1 high `braces` ≤3.0.3 (via eslint-config-next) | Advisory menyebut perbaikan ≥3.0.4 tetapi versi itu **belum terbit di npm** (terakhir 3.0.3) → risiko tetap diterima (tooling lint lokal, tidak masuk bundle). |
| Header halaman | Review | Halaman tanpa CSP/X-Frame-Options sebelumnya | Ditambahkan (ADR-026). |
| Rate limit API/MCP/webhook | Review | Belum ada sebelumnya | Ditambahkan in-memory (ADR-026). |
| Unggahan thumbnail | Desain | Endpoint menerima file | Izin `product:update`, cek magic bytes (bukan Content-Type), ≤ 1 MB, ≤ 2048 px, respons gambar dengan CSP `sandbox`, `nosniff`; Cloudinary bertanda tangan dari server. |
| Lisensi BoardUI | Review | CLI `boardui` MIT; lisensi source komponen gratis tidak eksplisit; tanpa lisensi Pro (tidak ada komponen Pro terpasang) | Perlu konfirmasi sebelum repo publik (OPEN_QUESTIONS Q-37). |
| Aset & komponen demo BoardUI (2026-10-21) | Analisis keterjangkauan import | 15 komponen `application/*` demo + aset `public/{avatars,carousel,ai-chat,templates,brand}` + SVG bawaan create-next-app tidak dipakai | **Dihapus** sebelum repo publik (foto orang & logo pihak ketiga tidak didistribusikan). |
| `npx prettier` (2026-10-18) | — | Terunduh otomatis tanpa pemindaian, dipakai sekali untuk format 3 file | Tidak ditambahkan ke proyek; aturan: jangan `npx` tool yang bukan dependensi. |

## Kebijakan
- pnpm memblok build script secara default; setiap pengecualian harus dicatat di sini.
- Versi package yang baru dirilis (< 2 minggu) dihindari untuk aset yang dimuat dari CDN.
- Analisis LLM SkillSpector belum diaktifkan (butuh API key, lihat OPEN_QUESTIONS Q-23).

## 2026-10-21 — Sesi 20: tinjauan keamanan OAuth & EDC
- Tanpa dependensi baru (OAuth dan ECR ditulis sendiri; tidak ada paket yang perlu dipindai).
- OAuth: PKCE S256 wajib; redirect_uri dicocokkan persis dengan daftar klien; skema berbahaya ditolak; kesalahan sebelum redirect tervalidasi tidak di-redirect (anti open-redirect); token/kode di-hash SHA-256, dibandingkan timing-safe; rotasi refresh + deteksi pemakaian ulang; kode sekali pakai dikunci `FOR UPDATE`; endpoint token/register dibatasi laju per IP; token hanya-baca di middleware; layar persetujuan menampilkan alamat tujuan agar phishing lewat nama klien terlihat.
- EDC: tidak ada PAN lengkap/CVV/PIN yang dikirim atau disimpan; server menolak PAN tidak tersamar & field asing; simulator diblokir di produksi.

## 2026-11-02 — Sesi 22: audit sebelum open source
| Objek | Alat | Hasil | Keputusan |
|---|---|---|---|
| Dependensi | `pnpm audit` | prod: 1 high `body-parser`, 4 `fast-uri` (via `@modelcontextprotocol/sdk`). Dev: `minimatch` | `body-parser` ^2.4.0 (rilis 2026-10-22, 11 hari) dan `fast-uri` ^3.1.9 lewat override, pengecualian aturan 2 minggu karena perbaikan keamanan dan kode Express tidak dipakai aplikasi. `minimatch`: hanya tooling lint, perbaikan butuh versi mayor berumur < 1 minggu, risiko diterima. |
| Riwayat git | Pemindaian file & pola secret | Hanya `.env.example`, nilai contoh | Aman dibuka. Nama & email author commit ikut publik. |
| Lisensi | boardui.com/license, Remix Icon License v1.0, repo Impeccable | Semua cocok dengan repo MIT. Remix Icon melarang ikon sebagai logo | Logo lama diganti. NOTICE.md ditambahkan. Lisensi Impeccable (Apache-2.0) disalin. Tidak ada komponen BoardUI Pro (`license_status`: tanpa lisensi). |
| Rate limit login | Uji HTTP | Limit bawaan Better Auth lolos dengan `X-Forwarded-For` berubah-ubah | Ditambah limit per IP tepercaya + penguncian per akun. |
| Image Docker | Review | Next standalone ikut menyalin `.env` yang dibuat saat build | Diperbaiki di sesi 23: `.env` dikeluarkan dari build, `next build` memakai nilai sementara. |
| Tidak ada package/skill baru | — | Logo dibuat tanpa dependensi | — |

## 2026-11-02 — Sesi 23: dependensi terbaru & pemindaian
| Objek | Alat | Hasil | Keputusan |
|---|---|---|---|
| React 19.3.0 | Advisory Next.js/React 14 Oktober 2026 (RCE React Flight, `use cache`) | Tidak terdeteksi `pnpm audit` | Naik ke 19.3.1. Next 16.4.4. Jangan hanya mengandalkan `pnpm audit`. |
| Semua dependensi | `pnpm outdated`, `pnpm audit` | 0 kerentanan prod & dev | Semua versi terbaru atas permintaan owner, termasuk rilis < 2 minggu (pengecualian aturan lama; better-auth, hono, react-query, dan Next dirilis di hari yang sama, risiko rantai pasok diterima owner). `minimatch` di-override ke ^11.0.4. TypeScript 6.0.3 karena typescript-eslint belum mendukung TS 7. |
| `nodemailer@10.3.1` | npm, `pnpm audit`, inspeksi manual | Tanda tangan npm & provenance SLSA, tanpa dependensi, tanpa install script, MIT-0. `child_process` hanya di transport sendmail yang tidak dipakai. SkillSpector atas `smtp-connection`: 37/100, wajar untuk modul jaringan | **Dipakai** untuk SMTP. |
| `src/server/{payments,email,api,auth,mcp,marketplace}` | SkillSpector statis | 0–9/100 | Aman. Label CAUTION berasal dari koneksi keluar ke gateway/marketplace, itu tujuan modulnya. |
| `scripts/`, `install.sh` | SkillSpector statis | 100 & 73 "DO NOT INSTALL" | Ditinjau manual. Temuan: membaca/menulis `.env` (PE3), rantai perintah installer dan `curl get.docker.com | sh` yang selalu ditanyakan dulu (TM2/SC2), lazim untuk installer. Tidak ada tujuan jaringan selain GitHub, get.docker.com, dan Docker Hub. |
| Kode baru | Review manual (skill `security-review` gagal: repo tanpa `origin/HEAD`) | 4 temuan | Diperbaiki: password Owner tertinggal di `.env` mode lokal, installer tanpa terminal, `openssl -base64` merusak URL database, `payment.failure` Xendit membatalkan transaksi. |
