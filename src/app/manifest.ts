import type { MetadataRoute } from "next";
import { BRAND_INK } from "@/lib/brand";

/** Manifest PWA: dipasang sebagai aplikasi kasir (layar penuh, langsung ke /pos). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "POS by lifistudio",
    short_name: "POS",
    description: "Kasir & back-office multi-cabang. Kasir tetap bisa berjualan saat internet putus.",
    id: "/pos",
    start_url: "/pos",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#ffffff",
    theme_color: BRAND_INK,
    lang: "id",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [{ name: "Kasir", url: "/pos" }, { name: "Order online", url: "/orders" }],
  };
}
