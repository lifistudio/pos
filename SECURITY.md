# Kebijakan Keamanan

## Melaporkan celah keamanan

**Jangan** melaporkan celah keamanan lewat issue publik.

Gunakan fitur **GitHub › Security › Report a vulnerability** (private vulnerability reporting) di repositori ini. Sertakan:
- Deskripsi celah dan dampaknya.
- Langkah reproduksi atau proof of concept (tanpa data pribadi asli).
- Versi/commit yang terdampak.

Kami berusaha menanggapi dalam 7 hari dan memberi kabar perkembangan perbaikan. Mohon beri waktu wajar sebelum mengungkap ke publik.

## Cakupan

Termasuk: autentikasi & sesi, otorisasi/RBAC dan cakupan cabang, API `/api/v1`, MCP server `/api/mcp`, webhook pembayaran & marketplace, penyimpanan kredensial, unggahan media, mode offline/service worker.

Di luar cakupan: celah pada layanan pihak ketiga (Midtrans, Cloudinary, Shopee, TikTok Shop) — laporkan ke penyedia masing-masing; serangan yang membutuhkan akses fisik ke perangkat yang sudah login; rekayasa sosial.

## Untuk yang men-deploy

Ikuti checklist keamanan di [docs/PANDUAN-DEPLOY.md](docs/PANDUAN-DEPLOY.md#8-checklist-keamanan-produksi): HTTPS, `NODE_ENV=production`, secret acak & unik, database tidak terbuka ke internet, backup teruji, dan update dependensi rutin.
