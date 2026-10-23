# Konten POS

**Aplikasi kasir (POS) & back-office open source untuk usaha multi-cabang di Indonesia.**
Kasir yang tetap jalan saat internet putus, stok per cabang dengan scan barcode, member & voucher, QRIS dinamis, order online & marketplace, laporan lengkap, RBAC per cabang, API terdokumentasi, dan MCP server untuk asisten AI.

*Open-source multi-branch point-of-sale and back-office for Indonesian retail: offline-capable till, per-branch inventory with barcode scanning, memberships & vouchers, dynamic QRIS, online & marketplace orders, reports, branch-scoped RBAC, documented REST API, and an MCP server for AI assistants. UI and docs are in Bahasa Indonesia.*

---

## Fitur

| Area | Isi |
|---|---|
| **Kasir (POS)** | Scan barcode, katalog grid 3–6 kolom atau daftar dengan gambar produk, member & poin, voucher, diskon manual dengan PIN atasan, tunai/QRIS dinamis/EDC/transfer, struk 58/80 mm, void & retur, shift + selisih kas, **mode offline + PWA** |
| **Produk** | Variasi (maks 3 jenis), **SKU & barcode EAN-13 otomatis yang dijamin unik** (atau isi sendiri), **cetak label barcode**, thumbnail via Cloudinary, kategori, harga modal tersembunyi sesuai izin |
| **Stok** | Stok per cabang dengan ledger (kartu stok), penerimaan & penyesuaian via scan, transfer antarcabang, stok opname, reservasi order online |
| **Pelanggan** | Customer, tier member (diskon & poin), tukar poin, voucher dengan target & kuota + performa |
| **Order online** | Website/WhatsApp/Instagram/marketplace, reservasi stok, QRIS dinamis (Midtrans), kemas–kirim–selesai |
| **Marketplace** | Shopee & TikTok Shop/Tokopedia: tarik order otomatis & sinkron stok (arsitektur adapter) |
| **Laporan** | Penjualan (per hari/cabang/kasir/kanal/kategori/produk/metode), retur, valuasi & umur stok, pergerakan stok, shift kasir — export CSV |
| **Keamanan** | Better Auth, RBAC `resource:action` per cabang, PIN persetujuan, audit log, rate limit, CSP & security headers, kredensial terenkripsi |
| **Integrasi** | REST API `/api/v1` + dokumentasi **Scalar**, API key, **MCP server** read-only untuk Claude/ChatGPT/agent lain |

## Teknologi

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4 · BoardUI + React Aria · Remix Icon · Hono + Zod OpenAPI · Drizzle ORM · PostgreSQL 18 · Better Auth · TanStack Query · Cloudinary · Midtrans · Model Context Protocol.

## Mulai cepat (development)

```bash
corepack enable
pnpm install
cp .env.example .env      # isi BETTER_AUTH_SECRET & SEED_OWNER_PASSWORD (lihat komentar di file)
pnpm db:start             # PostgreSQL lokal tanpa Docker (biarkan berjalan) — atau: docker compose up -d db
pnpm db:migrate
pnpm db:seed              # role, cabang & produk contoh, akun Owner
pnpm dev                  # http://localhost:3000
```

Butuh Node.js ≥ 22 dan pnpm. Detail: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Dokumentasi

| Untuk | Dokumen |
|---|---|
| Pengguna (owner, admin, kasir) | [Panduan penggunaan](docs/PANDUAN-PENGGUNAAN.md) |
| Deploy ke produksi | [Panduan deploy](docs/PANDUAN-DEPLOY.md) |
| Gambar & media | [Panduan Cloudinary](docs/PANDUAN-CLOUDINARY.md) |
| Shopee / TikTok Shop / Tokopedia | [Panduan marketplace](docs/PANDUAN-MARKETPLACE.md) |
| Asisten AI | [MCP](docs/MCP.md) |
| Developer & AI agent | [docs/README.md](docs/README.md) (mulai di sini), [Arsitektur](docs/ARCHITECTURE.md), [Database](docs/DATABASE.md), [Design system](docs/DESIGN_SYSTEM.md), [Keputusan (ADR)](docs/DECISIONS.md) |

## Pemeriksaan

```bash
pnpm typecheck && pnpm lint && pnpm build
pnpm check:pricing && pnpm check:marketplace && pnpm check:media && pnpm check:barcode
pnpm audit:deps
```

## Kontribusi & keamanan

- Cara berkontribusi: [CONTRIBUTING.md](CONTRIBUTING.md)
- Melaporkan celah keamanan: [SECURITY.md](SECURITY.md) — jangan lewat issue publik.

## Lisensi

[MIT](LICENSE). Komponen UI di `src/components/base`, `application`, dan `foundations` berasal dari BoardUI (komponen gratis); lihat catatan pihak ketiga di [docs/SECURITY_LOG.md](docs/SECURITY_LOG.md).
