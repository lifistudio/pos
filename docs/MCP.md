# MCP Server (untuk AI Agent)

Endpoint: `POST /api/mcp` — Model Context Protocol, transport Streamable HTTP mode **stateless** (respons JSON).
Implementasi: `src/server/mcp/server.ts`, di-mount di `src/server/api/app.ts`.

## Prinsip
- **Read-only** (fase ini). Semua tool berlabel `readOnlyHint`.
- **Satu jalur data:** setiap tool memanggil REST API `/api/v1` in-process dengan kredensial klien MCP. Tidak ada query database langsung → permission, cakupan cabang, dan penyaringan data sensitif (mis. HPP tanpa `product:view_cost`) sama persis dengan UI.
- **Audit:** setiap pemanggilan tool tercatat di audit log (`action = mcp_tool`).
- **Rate limit:** 120 permintaan/menit per API key (HTTP 429 + `Retry-After` bila terlampaui).
- **Status:** final untuk cakupan **read-only** (21 tool). Tool yang mengubah data sengaja belum ada; bila kelak ditambah, wajib memakai permission yang sama dan konfirmasi manusia.
- Hasil scan SkillSpector untuk `src/server/mcp`: 0/100, SAFE (lihat SECURITY_LOG.md).

## Autentikasi
**Dua cara:** (1) **OAuth 2.1** untuk klien yang mendukung login MCP (Claude web/Desktop Connectors, ChatGPT) — lihat bagian *OAuth* di bawah; (2) **API key** personal, dibuat di **Pengaturan › API key & MCP** (atau `POST /api/v1/api-keys`), butuh permission `api_key:create`. Halaman itu juga menampilkan URL MCP dan perintah koneksi siap salin. Kirim di header:
```
x-api-key: pos_xxxxxxxx…
```
atau `Authorization: Bearer pos_…`. AI agent mewarisi role & cabang pemilik key. Key disimpan sebagai hash SHA-256, bisa kedaluwarsa dan dicabut (`DELETE /api/v1/api-keys/{id}`). API key tidak bisa membuat API key lain.

## OAuth (login aplikasi AI)
Sesuai spesifikasi otorisasi MCP. Implementasi: `src/server/services/oauth.service.ts`, route publik di `src/server/api/app.ts` (`/api/oauth/*`), route bersesi `src/server/api/routes/oauth.ts`, layar persetujuan `src/app/(auth)/oauth/authorize`.
- **Penemuan:** `POST /api/mcp` tanpa kredensial → `401` + `WWW-Authenticate: Bearer resource_metadata=".../.well-known/oauth-protected-resource/api/mcp"`. Metadata: `/.well-known/oauth-protected-resource[/api/mcp]` (RFC 9728) dan `/.well-known/oauth-authorization-server` (RFC 8414), dilayani API lewat rewrite `next.config.ts`.
- **Pendaftaran klien dinamis** `POST /api/oauth/register` (RFC 7591, 30/jam per IP). `redirect_uri` hanya https, http loopback, atau skema aplikasi (cursor://, vscode://); `javascript:`/`data:`/`file:` dll. ditolak. Nama klien dirapikan dan selalu ditampilkan bersama alamat tujuannya.
- **Otorisasi** `/oauth/authorize` (halaman, wajib login): PKCE **S256 wajib**, scope `mcp:read`, `resource` harus server ini, `state` & `iss` dikembalikan. Kesalahan sebelum `redirect_uri` tervalidasi ditampilkan, tidak di-redirect.
- **Token** `POST /api/oauth/token` (form atau JSON; klien publik atau `client_secret_post`/`basic`): access token 1 jam, refresh 30 hari **dirotasi**. Refresh lama dipakai lagi → seluruh keluarga token dicabut; kode otorisasi dipakai dua kali → token dari kode itu dicabut. Token disimpan hash SHA-256 (`oauth_tokens`). Revokasi `POST /api/oauth/revoke` (RFC 7009).
- **Hanya-baca:** actor `OAUTH` hanya boleh `GET` di `/api/v1` dan `POST /api/mcp` (`READ_ONLY_TOKEN` 403), tidak bisa membuat API key / PIN. Audit memakai `actor_type = OAUTH` ("Aplikasi AI").
- **Pengguna:** Pengaturan › API key & MCP › **Aplikasi terhubung** (`GET/DELETE /api/v1/oauth/apps`).
- Belum: pembersihan otomatis klien DCR yang tidak pernah dipakai & kode kedaluwarsa (tabel kecil; bisa lewat cron kelak).

## Menghubungkan ke klien
Claude Code:
```bash
claude mcp add --transport http pos-lifistudio http://localhost:3000/api/mcp --header "x-api-key: <API_KEY>"
```
Klien lain (Claude web/desktop, ChatGPT, Codex, Cursor, Antigravity, Hermes Agent, VS Code, Gemini CLI, dll.): lihat [PANDUAN-MCP.md](./PANDUAN-MCP.md). Konfigurasi siap salin per klien juga ada di halaman Pengaturan (`src/lib/mcp-clients.ts`).

## Daftar tool
| Tool | Fungsi | Contoh pertanyaan |
|---|---|---|
| `list_branches` | Cabang yang bisa diakses | "Cabang apa saja yang ada?" |
| `check_stock` | Stok per varian per cabang (cari nama/SKU/barcode, per kata) | "Stok hoodie hitam di BDG?" |
| `low_stock_report` | Varian menipis & habis | "Barang apa yang perlu restock di Jakarta?" |
| `inventory_summary` | KPI stok, stok per cabang, tren 14 hari | "Ringkas kondisi stok minggu ini" |
| `search_products` | Cari produk (harga, varian, status, stok) | "Produk draf apa saja?" |
| `get_product` | Detail produk + stok per cabang | "Detail Kaos Essential Cotton" |
| `stock_movements` | Kartu stok (kenapa stok berubah) | "Kenapa stok KEC-PTH-M bertambah?" |
| `sales_summary` | Omzet & transaksi hari ini vs kemarin, N hari, tren, terlaris, metode bayar | "Omzet minggu ini di BDG?", "10 produk terlaris bulan ini" |
| `list_sales` | Daftar transaksi (filter cabang, status, tanggal) | "Transaksi yang dibatalkan hari ini" |
| `voucher_performance` | Pemakaian, customer unik, potongan, omzet, sisa kuota per voucher + tren | "Performa voucher 1 minggu terakhir" |
| `list_vouchers` | Voucher & statusnya | "Voucher apa yang kuotanya habis?" |
| `sales_report` | Penjualan bersih per hari/cabang/kasir/kanal/kategori/produk/metode bayar | "Kasir mana yang paling banyak menjual bulan ini?" |
| `returns_report` | Retur per alasan/produk/pemroses/cabang | "Alasan retur terbanyak bulan ini?" |
| `stock_report` | `view=valuation` nilai stok per cabang/kategori/produk; `aging` umur stok + lambat laku; `movements` mutasi N hari (per jenis / saldo awal–akhir) | "Berapa nilai stok Bandung?", "Barang apa yang 90 hari tidak laku?" |
| `shift_report` | Shift kasir & selisih kas, per shift atau per kasir | "Kasir mana yang paling sering kurang kas bulan ini?" |
| `marketplace_status` | Toko marketplace terhubung, sinkron terakhir, error, belum dipetakan, tertunda | "Apakah sinkron Shopee lancar?" |
| `list_online_orders` | Order online per status/kanal; `number` → rincian (HP dimasking, alamat disembunyikan) | "Berapa order yang belum dikirim?" |
| `list_returns` | Retur: struk asal, alasan, barang (rusak), refund | "Retur minggu ini apa saja dan alasannya?" |
| `list_transfers` | Transfer stok (filter cabang, masuk/keluar, status); `number` → rincian barang | "Barang apa yang masih di perjalanan ke Bandung?" |
| `list_opnames` | Riwayat stok opname; `number` → selisih per barang | "Hasil opname terakhir di Jakarta?" |
| `customer_lookup` | Customer/member: tier, poin, total belanja (HP dimasking, email disembunyikan) | "Poin member Sari berapa?" |

## Rencana tool berikutnya
`shift_summary` — ditambahkan bersama modulnya (PRD §3.15). Tool tulis (mis. buat transfer stok) hanya dengan konfirmasi eksplisit, fase P2.
