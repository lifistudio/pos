import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ResolveLink } from "@/components/app/markdown";

/** Panduan pengguna yang tampil di aplikasi. Sumbernya tetap docs/*.md (satu sumber untuk repo & aplikasi). */
export const GUIDES = [
  {
    slug: "penggunaan",
    short: "Penggunaan",
    file: "PANDUAN-PENGGUNAAN.md",
    title: "Penggunaan POS by lifistudio",
    description: "Kasir, produk, stok, customer, voucher, laporan, dan pengaturan, langkah demi langkah.",
    audience: "Semua pengguna",
  },
  {
    slug: "pembayaran",
    short: "Pembayaran",
    file: "PANDUAN-PEMBAYARAN.md",
    title: "Pembayaran: QRIS, EDC & layar pelanggan",
    description: "Tunai, QRIS otomatis lunas, mesin EDC manual & tersambung kabel, transfer, layar pelanggan, dan scanner.",
    audience: "Kasir & kepala toko",
  },
  {
    slug: "printer",
    short: "Printer struk",
    file: "PANDUAN-PRINTER.md",
    title: "Printer struk",
    description: "Printer thermal USB, Bluetooth, serial, LAN, cetak otomatis, laci kas, dan PDF.",
    audience: "Kasir & kepala toko",
  },
  {
    slug: "marketplace",
    short: "Marketplace",
    file: "PANDUAN-MARKETPLACE.md",
    title: "Integrasi marketplace",
    description: "Shopee dan TikTok Shop/Tokopedia: order masuk otomatis, stok mengikuti POS.",
    audience: "Owner & admin",
  },
  {
    slug: "mcp",
    short: "AI agent (MCP)",
    file: "PANDUAN-MCP.md",
    title: "Hubungkan AI agent (MCP)",
    description: "Claude, ChatGPT, Codex, Cursor, Antigravity, Hermes Agent, dan agent lain membaca data toko.",
    audience: "Owner & admin",
  },
  {
    slug: "cloudinary",
    short: "Gambar & media",
    file: "PANDUAN-CLOUDINARY.md",
    title: "Gambar & media (Cloudinary)",
    description: "Simpan gambar produk di Cloudinary: ambil API key dan isi variabel lingkungan.",
    audience: "Admin teknis",
  },
  {
    slug: "env",
    short: "Pengaturan server",
    file: "PANDUAN-ENV.md",
    title: "Pengaturan server (.env)",
    description: "Isi variabel lingkungan: database, kunci login, QRIS Midtrans, Cloudinary, marketplace, dan cara mendapatkan tiap nilai.",
    audience: "Admin teknis",
  },
  {
    slug: "deploy",
    short: "Deploy",
    file: "PANDUAN-DEPLOY.md",
    title: "Deploy ke server",
    description: "Membawa POS by lifistudio ke internet dengan aman: database, domain, variabel lingkungan, backup.",
    audience: "Admin teknis",
  },
] as const;

export type Guide = (typeof GUIDES)[number];

export const PANDUAN_DESCRIPTION = "Cara memakai POS by lifistudio serta menyambungkan perangkat dan layanan pendukung.";
export const guideTabs = () => GUIDES.map((g) => ({ href: `/panduan/${g.slug}`, label: g.short }));

export const findGuide = (slug: string) => GUIDES.find((g) => g.slug === slug) ?? null;

/** Tautan antar-panduan → /panduan/<slug>; dokumen teknis lain (folder docs/ di repo) jadi teks biasa; hanya http(s) yang diizinkan. */
export const resolveGuideLink: ResolveLink = (href) => {
  if (href.startsWith("#")) return { href, external: false };
  const doc = /^\.\/([\w-]+\.md)(#[\w-]+)?$/.exec(href);
  if (doc) {
    const g = GUIDES.find((x) => x.file === doc[1]);
    return g ? { href: `/panduan/${g.slug}${doc[2] ?? ""}`, external: false } : null;
  }
  if (/^https?:\/\//i.test(href)) return { href, external: true };
  return null;
};

export async function readGuide(guide: Guide) {
  "use cache";
  return readFile(path.join(process.cwd(), "docs", guide.file), "utf8");
}
