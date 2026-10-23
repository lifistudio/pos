# Panduan Menghubungkan AI Agent (MCP)

Dengan **MCP (Model Context Protocol)**, asisten AI seperti Claude, ChatGPT, Codex, Cursor, Antigravity, atau Hermes Agent bisa **membaca data toko Anda**. Contoh pertanyaan: "stok kaos hitam XL di semua cabang berapa?", "produk apa yang hampir habis?", "penjualan minggu ini dibanding minggu lalu?".

> **Aman secara bawaan:** semua alat MCP **hanya membaca** dan tidak bisa mengubah data. AI hanya melihat apa yang boleh dilihat **pemilik API key** (role & cabang yang sama). Setiap pemanggilan tercatat di **Audit log**. Detail teknis ada di dokumen MCP di folder docs repo.

---

Ada **dua cara masuk**:

| Cara | Untuk | Yang perlu disiapkan |
|---|---|---|
| **Login (OAuth)** | Claude web, Claude Desktop, ChatGPT, dan aplikasi lain yang mendukung login MCP | Cukup **URL MCP**. Anda login dengan akun Konten POS lalu klik **Izinkan**. |
| **API key** | Claude Code, Codex, Cursor, Antigravity, Hermes, VS Code, Gemini CLI, skrip/integrasi | URL MCP + **API key** di header |

Keduanya **hanya-baca** dan mengikuti hak akses akun. Akses lewat login juga dibatasi hanya-baca di sisi server, walaupun akun Anda Owner.

## 1. Siapkan URL & API key

1. Buka **Pengaturan › API key & MCP**.
2. Salin **URL MCP**, misalnya `https://pos.toko-anda.com/api/mcp`.
3. **Untuk login (OAuth): cukup URL di atas**, lanjut ke bagian 3 atau 5. Untuk cara API key: klik **Buat API key**. Beri nama sesuai pemakainya (misalnya *Claude – Owner*), atur masa berlaku, lalu **salin key-nya sekarang**. Key hanya ditampilkan sekali.
4. Di layar yang sama, pilih **Aplikasi AI** Anda. Konfigurasi siap salin langsung berisi URL dan key Anda.

> **Tips keamanan**
> - Buat **satu key per aplikasi/orang**, supaya bisa dicabut satu per satu.
> - Buat key dari akun dengan hak akses **seperlunya**. AI mewarisi semua hak akses pemilik key.
> - Jangan tempel key di chat, dokumen bersama, atau repo Git. Bila bocor, **Cabut** key itu lalu buat yang baru.
> - Bila bisa, simpan key di **variabel lingkungan** `KONTEN_POS_API_KEY`, bukan langsung di file konfigurasi.

Server menerima key lewat header `x-api-key: <key>` **atau** `Authorization: Bearer <key>`, dengan transport **Streamable HTTP**.

> **Aplikasi berbasis cloud** (Claude web/desktop lewat *Connectors* dan ChatGPT) terhubung dari server mereka, bukan dari komputer Anda. Karena itu keduanya **tidak bisa** membuka `localhost` dan butuh alamat **HTTPS publik** (setelah deploy, lihat [Panduan deploy](./PANDUAN-DEPLOY.md)). Claude Code, Codex, Cursor, Antigravity, Hermes, VS Code, dan Gemini CLI berjalan di komputer Anda sehingga bisa memakai `localhost` saat mencoba.

## 2. Claude Code

Jalankan di terminal:

```bash
claude mcp add --transport http konten-pos https://pos.toko-anda.com/api/mcp --header "x-api-key: <API_KEY>"
```

Buka Claude Code, ketik `/mcp`, dan pastikan **konten-pos** berstatus *connected*.

## 3. Claude web (claude.ai) & Claude Desktop: Connectors (login)

1. Buka **Settings › Connectors › Add custom connector**. Di Team/Enterprise, admin menambahkannya lewat **Organization settings › Connectors**.
2. **Name:** `Konten POS`. **Remote MCP server URL:** URL MCP Anda (HTTPS publik). Pengaturan lanjutan (OAuth Client ID/Secret, Request headers) **dikosongkan**.
3. Klik **Add**, lalu **Connect**. Halaman **Izinkan aplikasi AI** dari Konten POS terbuka. Login bila diminta, periksa nama aplikasi dan alamat tujuannya (*claude.ai*), lalu klik **Izinkan**.
4. Kembali ke Claude. Di kolom chat klik **+ › Connectors** lalu aktifkan **Konten POS**.

Koneksi muncul di **Pengaturan › API key & MCP › Aplikasi terhubung**. Klik **Putuskan** untuk mencabut akses kapan saja. Sesi login berlaku 30 hari sejak terakhir dipakai; setelah itu Claude meminta login ulang.

> Alternatif tanpa login: bila akun Anda punya pilihan **Request headers**, tambahkan header `x-api-key` berisi API key (tandai **Required**).

## 4. Claude Desktop: file konfigurasi (alternatif)

Cara ini bisa memakai `localhost` saat mencoba di komputer sendiri. Untuk server yang sudah online, **bagian 3 lebih mudah**. Butuh **Node.js** terpasang.

1. Claude Desktop › **Settings › Developer › Edit Config**. File `claude_desktop_config.json` terbuka.
2. Isi (atau gabungkan ke `mcpServers` yang sudah ada):

```json
{
  "mcpServers": {
    "konten-pos": {
      "command": "npx",
      "args": ["-y", "mcp-remote@latest", "https://pos.toko-anda.com/api/mcp", "--header", "x-api-key:${KONTEN_POS_API_KEY}"],
      "env": { "KONTEN_POS_API_KEY": "<API_KEY>" }
    }
  }
}
```

3. Simpan, **tutup penuh** Claude Desktop (termasuk dari tray), lalu buka lagi. Menu alat di kolom chat menampilkan alat Konten POS.

> `mcp-remote` adalah jembatan open-source (npm) yang menyambungkan Claude Desktop ke server MCP jarak jauh. Paket ini diunduh dan dijalankan di komputer Anda saat Claude Desktop dibuka. Tulis `x-api-key:${…}` **tanpa spasi** setelah titik dua (spasi bermasalah di Windows).

## 5. ChatGPT

1. **Settings › Apps & Connectors › Advanced settings**, lalu nyalakan **Developer mode**. Tersedia di paket Plus/Pro/Business/Enterprise/Edu; di workspace perlu diizinkan admin.
2. Kembali ke **Apps & Connectors › Create**. Isi **Name** `Konten POS` dan **MCP server URL** (HTTPS publik).
3. **Authentication:** pilih **OAuth**. Centang pernyataan risiko, lalu **Create**.
4. Halaman **Izinkan aplikasi AI** dari Konten POS terbuka. Login, periksa nama aplikasi dan alamat tujuannya (*chatgpt.com*), lalu klik **Izinkan**.
5. Di chat pilih **+ › Developer mode › Konten POS**.

> Bila ChatGPT di akun Anda menawarkan **API key / Bearer token**, cara itu juga bisa: isi API key, dan ChatGPT mengirimnya sebagai `Authorization: Bearer`. **No authentication** tidak didukung, karena Konten POS sengaja tidak membuka data tanpa login.

## 6. Codex (OpenAI): CLI, IDE & aplikasi

Simpan key di variabel lingkungan `KONTEN_POS_API_KEY`, lalu tambahkan ke `~/.codex/config.toml`:

```toml
[mcp_servers.konten-pos]
url = "https://pos.toko-anda.com/api/mcp"
bearer_token_env_var = "KONTEN_POS_API_KEY"
```

Atau lewat perintah:

```bash
codex mcp add konten-pos --url https://pos.toko-anda.com/api/mcp --bearer-token-env-var KONTEN_POS_API_KEY
```

Konfigurasi ini dipakai bersama oleh Codex CLI, ekstensi IDE, dan aplikasi Codex. Cek dengan `codex mcp list`, atau `/mcp` di dalam Codex.

## 7. Cursor

Simpan key di variabel lingkungan `KONTEN_POS_API_KEY`. Tambahkan ke `~/.cursor/mcp.json` (berlaku untuk semua proyek) atau `.cursor/mcp.json` (satu proyek):

```json
{
  "mcpServers": {
    "konten-pos": {
      "url": "https://pos.toko-anda.com/api/mcp",
      "headers": { "x-api-key": "${env:KONTEN_POS_API_KEY}" }
    }
  }
}
```

Cek di **Cursor Settings › MCP** (titik hijau = terhubung).

## 8. Google Antigravity

1. Di panel **Agent**, buka menu **…** › **MCP Servers** › **Manage MCP Servers** › **View raw config**. File `mcp_config.json` terbuka.
2. Tambahkan:

```json
{
  "mcpServers": {
    "konten-pos": {
      "serverUrl": "https://pos.toko-anda.com/api/mcp",
      "headers": { "x-api-key": "<API_KEY>" }
    }
  }
}
```

3. Simpan, lalu klik **Refresh**. Perhatikan: Antigravity memakai `serverUrl`, bukan `url`.

## 9. Hermes Agent (Nous Research)

Tambahkan ke `~/.hermes/config.yaml`:

```yaml
mcp_servers:
  konten-pos:
    url: "https://pos.toko-anda.com/api/mcp"
    headers:
      x-api-key: "<API_KEY>"
```

Di Hermes jalankan `/reload-mcp`, atau uji dari terminal dengan `hermes mcp test konten-pos`.

## 10. VS Code (GitHub Copilot)

**Command Palette › MCP: Open User Configuration** (atau buat `.vscode/mcp.json`):

```json
{
  "inputs": [{ "type": "promptString", "id": "konten-pos-key", "description": "API key Konten POS", "password": true }],
  "servers": {
    "konten-pos": {
      "type": "http",
      "url": "https://pos.toko-anda.com/api/mcp",
      "headers": { "x-api-key": "${input:konten-pos-key}" }
    }
  }
}
```

VS Code meminta API key saat server pertama dijalankan dan menyimpannya dengan aman. Pakai di Copilot Chat mode **Agent**.

## 11. Gemini CLI

Simpan key di `KONTEN_POS_API_KEY`, lalu tambahkan ke `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "konten-pos": {
      "httpUrl": "https://pos.toko-anda.com/api/mcp",
      "headers": { "x-api-key": "$KONTEN_POS_API_KEY" }
    }
  }
}
```

Cek dengan `/mcp` di Gemini CLI.

## 12. AI agent lainnya (Windsurf, Cline, Zed, n8n, LangChain, dll.)

Hampir semua klien MCP modern bisa terhubung dengan tiga isian ini:

| Isian | Nilai |
|---|---|
| Transport | **Streamable HTTP** (kadang ditulis *HTTP* atau *remote*; bukan SSE) |
| URL | URL MCP dari halaman Pengaturan |
| Header | `x-api-key: <API key>`, atau `Authorization: Bearer <API key>` bila klien hanya mendukung token bearer |

Klien yang **hanya** mendukung server lokal (stdio) bisa memakai jembatan `mcp-remote`:

```bash
npx -y mcp-remote@latest https://pos.toko-anda.com/api/mcp --header x-api-key:<API_KEY>
```

## 13. Masalah umum

| Gejala | Penyebab & solusi |
|---|---|
| `401` / *unauthorized* | Key salah, dicabut, atau kedaluwarsa. Cek status di **Pengaturan › API key & MCP**, lalu buat key baru bila perlu. |
| Data cabang tertentu tidak muncul | Pemilik key tidak punya akses ke cabang itu. AI mewarisi hak akses pemilik key. |
| `429` / *too many requests* | Batas 120 permintaan per menit per key. Tunggu sebentar. |
| Claude web / ChatGPT gagal menyambung ke `localhost` | Wajar: keduanya berjalan di cloud. Pakai alamat HTTPS publik. |
| Claude Desktop tidak menampilkan alat | Pastikan Node.js terpasang, JSON valid (tanpa koma berlebih), lalu tutup penuh dan buka ulang aplikasinya. |
| Halaman login/persetujuan tidak muncul | Pastikan URL memakai **HTTPS publik** (bukan localhost) dan sama persis dengan URL di Pengaturan. Hapus connector lalu tambahkan ulang. |
| *Permintaan tidak valid* di halaman persetujuan | Tautan login sudah kedaluwarsa atau aplikasi berubah alamat. Tutup halaman, lalu klik **Connect** ulang dari aplikasi AI. |
| Aplikasi minta login ulang | Sesi login berlaku 30 hari sejak terakhir dipakai, atau aplikasi sudah **diputus** di Aplikasi terhubung. Login lagi. |
| AI bisa membaca tapi tidak bisa mengubah data | Benar. Akses lewat login dan API key sama-sama hanya-baca. |
| AI menjawab "tidak bisa mengubah data" | Benar, MCP Konten POS hanya-baca. Ubah data lewat aplikasi. |
