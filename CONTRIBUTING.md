# Berkontribusi ke POS by lifistudio

Terima kasih ingin membantu! Kontribusi berupa laporan bug, saran fitur, perbaikan dokumentasi, maupun kode sangat diterima.

## Sebelum mulai
1. Baca [docs/README.md](docs/README.md) — status proyek, peta dokumen, dan **aturan wajib** (semua data lewat API, otorisasi di server, tanpa N+1, pagination, UI hanya dari BoardUI + Remix Icon, teks UI Bahasa Indonesia, responsif).
2. Untuk perubahan besar, buka **issue** dulu untuk mendiskusikan pendekatannya.
3. Setup lokal: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Alur kerja
1. Fork & buat branch: `fitur/nama-singkat` atau `perbaikan/nama-singkat`.
2. Ikuti alur "Menambah fitur" di DEVELOPMENT.md (schema → migrasi → service → route OpenAPI → UI → tes → docs).
3. Jalankan sebelum membuka PR:
   ```bash
   pnpm typecheck && pnpm lint && pnpm build
   pnpm check:pricing && pnpm check:marketplace && pnpm check:media && pnpm check:barcode
   ```
4. Perubahan UI: uji di lebar 375, 768, dan 1280 px; jalankan detektor Impeccable bila tersedia (`docs/DESIGN_SYSTEM.md`).
5. Perbarui dokumentasi: entri `docs/CHANGELOG.md`, ADR di `docs/DECISIONS.md` untuk keputusan arsitektur, `docs/DATABASE.md` untuk perubahan schema.
6. Buka Pull Request dengan deskripsi: apa yang berubah, kenapa, cara menguji, screenshot untuk UI.

## Aturan penting
- **Package baru** harus diperiksa keamanannya (`pnpm audit`, rilis ≥ 14 hari, tanpa skrip instalasi mencurigakan) dan dicatat di `docs/SECURITY_LOG.md`.
- **Jangan pernah** commit `.env`, kunci API, atau data pelanggan asli. Gunakan data contoh.
- Migrasi yang sudah dirilis tidak diubah; buat migrasi baru.
- Pesan commit singkat dan bermakna (Bahasa Indonesia atau Inggris), misal `Tambah laporan shift per kasir`.

## Melaporkan bug
Sertakan: langkah mereproduksi, hasil yang diharapkan vs yang terjadi, perangkat/browser, dan screenshot. **Hapus data pribadi** dari screenshot. Celah keamanan → ikuti [SECURITY.md](SECURITY.md), bukan issue publik.

Dengan berkontribusi, Anda setuju kontribusi dirilis di bawah [lisensi MIT](LICENSE).

Perubahan alur transaksi, stok, marketplace, atau RBAC: tambahkan skenario di `scripts/checks/flows.check.mts` dan jalankan `pnpm check:flows` pada database sekali pakai (lihat README).

Tampilan memakai komponen gratis [BoardUI](https://www.boardui.com). Jangan menyalin komponen BoardUI Pro ke repositori ini, lisensinya melarang publikasi. Logo dan nama tidak diubah lewat kontribusi, lihat [TRADEMARK.md](TRADEMARK.md).
