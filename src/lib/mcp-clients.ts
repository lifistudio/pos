/**
 * Cara menghubungkan klien AI ke MCP Konten POS. Dipakai halaman Pengaturan › API key & MCP; isi yang sama dijelaskan
 * di docs/PANDUAN-MCP.md. Dua cara masuk: login OAuth (Claude web/Desktop, ChatGPT — cukup URL) atau API key lewat
 * header `x-api-key` / `Authorization: Bearer`.
 * `key` boleh berupa placeholder (<API_KEY>) atau key asli tepat setelah dibuat.
 */
export type McpClient = {
  id: string;
  name: string;
  /** Langkah singkat (teks polos). */
  steps: string[];
  /** Konfigurasi/perintah siap salin; null bila cukup lewat UI aplikasi. */
  snippet: { label: string; value: (url: string, key: string) => string } | null;
  /** Butuh URL HTTPS publik (klien berjalan di cloud, tidak bisa membuka localhost). */
  publicUrl?: boolean;
};

const ENV = "KONTEN_POS_API_KEY";

export const MCP_CLIENTS: McpClient[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    steps: ["Jalankan perintah ini di terminal, lalu buka Claude Code dan ketik /mcp untuk memastikan konten-pos terhubung."],
    snippet: { label: "Perintah", value: (url, key) => `claude mcp add --transport http konten-pos ${url} --header "x-api-key: ${key}"` },
  },
  {
    id: "claude-app",
    name: "Claude (web & desktop)",
    publicUrl: true,
    steps: [
      "Buka claude.ai atau aplikasi Claude Desktop › Settings › Connectors › Add custom connector.",
      "Name: Konten POS. Remote MCP server URL: tempel URL MCP. Kosongkan pengaturan lanjutan (tanpa API key).",
      "Klik Add, lalu Connect: halaman login Konten POS terbuka. Masuk dengan akun Anda dan klik Izinkan.",
      "Aktifkan Konten POS dari menu alat (+) di kolom chat. Akses bisa diputus di Aplikasi terhubung.",
    ],
    snippet: null,
  },
  {
    id: "claude-desktop-config",
    name: "Claude Desktop (file konfigurasi)",
    steps: [
      "Claude Desktop › Settings › Developer › Edit Config untuk membuka claude_desktop_config.json.",
      "Tambahkan isi di bawah (butuh Node.js; jembatan mcp-remote meneruskan header API key), simpan, lalu tutup dan buka ulang Claude Desktop.",
    ],
    snippet: {
      label: "claude_desktop_config.json",
      value: (url, key) =>
        JSON.stringify(
          { mcpServers: { "konten-pos": { command: "npx", args: ["-y", "mcp-remote@latest", url, "--header", `x-api-key:\${${ENV}}`], env: { [ENV]: key } } } },
          null,
          2,
        ),
    },
  },
  {
    id: "chatgpt",
    name: "ChatGPT",
    publicUrl: true,
    steps: [
      "Settings › Apps & Connectors › Advanced settings › nyalakan Developer mode (paket Plus/Pro/Business/Enterprise/Edu; di workspace perlu diizinkan admin).",
      "Kembali ke Apps & Connectors › Create. Isi nama Konten POS dan MCP server URL.",
      "Authentication: pilih OAuth, lalu Create. Halaman login Konten POS terbuka: masuk dan klik Izinkan.",
      "Di chat pilih + › Developer mode › Konten POS.",
    ],
    snippet: null,
  },
  {
    id: "codex",
    name: "Codex (OpenAI)",
    steps: [
      `Simpan API key di variabel lingkungan ${ENV} (jangan ditulis di file konfigurasi).`,
      "Tambahkan ke ~/.codex/config.toml (atau jalankan: codex mcp add konten-pos --url <URL> --bearer-token-env-var " + ENV + "). Berlaku untuk Codex CLI, ekstensi IDE, dan aplikasi Codex.",
    ],
    snippet: { label: "~/.codex/config.toml", value: (url) => `[mcp_servers.konten-pos]\nurl = "${url}"\nbearer_token_env_var = "${ENV}"` },
  },
  {
    id: "cursor",
    name: "Cursor",
    steps: [`Simpan API key di variabel lingkungan ${ENV}.`, "Tambahkan ke ~/.cursor/mcp.json (semua proyek) atau .cursor/mcp.json (satu proyek), lalu cek di Settings › MCP."],
    snippet: {
      label: "mcp.json",
      value: (url) => JSON.stringify({ mcpServers: { "konten-pos": { url, headers: { "x-api-key": `\${env:${ENV}}` } } } }, null, 2),
    },
  },
  {
    id: "antigravity",
    name: "Antigravity",
    steps: ["Di panel Agent › menu … › MCP Servers › Manage MCP Servers › View raw config (mcp_config.json).", "Tambahkan isi di bawah, simpan, lalu klik Refresh."],
    snippet: {
      label: "mcp_config.json",
      value: (url, key) => JSON.stringify({ mcpServers: { "konten-pos": { serverUrl: url, headers: { "x-api-key": key } } } }, null, 2),
    },
  },
  {
    id: "hermes",
    name: "Hermes Agent",
    steps: ["Tambahkan ke ~/.hermes/config.yaml.", "Di Hermes jalankan /reload-mcp, atau cek dari terminal: hermes mcp test konten-pos."],
    snippet: { label: "~/.hermes/config.yaml", value: (url, key) => `mcp_servers:\n  konten-pos:\n    url: "${url}"\n    headers:\n      x-api-key: "${key}"` },
  },
  {
    id: "vscode",
    name: "VS Code (Copilot)",
    steps: ["Command Palette › MCP: Open User Configuration (atau buat .vscode/mcp.json), tambahkan isi di bawah. VS Code meminta API key saat pertama dijalankan dan menyimpannya dengan aman."],
    snippet: {
      label: "mcp.json",
      value: (url) =>
        JSON.stringify(
          {
            inputs: [{ type: "promptString", id: "konten-pos-key", description: "API key Konten POS", password: true }],
            servers: { "konten-pos": { type: "http", url, headers: { "x-api-key": "${input:konten-pos-key}" } } },
          },
          null,
          2,
        ),
    },
  },
  {
    id: "gemini-cli",
    name: "Gemini CLI",
    steps: [`Simpan API key di variabel lingkungan ${ENV}.`, "Tambahkan ke ~/.gemini/settings.json, lalu cek dengan /mcp."],
    snippet: {
      label: "settings.json",
      value: (url) => JSON.stringify({ mcpServers: { "konten-pos": { httpUrl: url, headers: { "x-api-key": `$${ENV}` } } } }, null, 2),
    },
  },
  {
    id: "other",
    name: "AI agent lainnya",
    steps: [
      "Pilih transport Streamable HTTP (bukan SSE/stdio) dan isi URL MCP.",
      "Tambahkan header x-api-key: <API key>, atau Authorization: Bearer <API key> bila klien hanya mendukung token bearer.",
      "Klien yang hanya mendukung stdio: jalankan jembatan npx -y mcp-remote@latest <URL> --header x-api-key:<API key>.",
    ],
    snippet: { label: "Header", value: (_url, key) => `x-api-key: ${key}` },
  },
];
