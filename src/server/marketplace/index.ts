import "server-only";
import { createMockAdapter } from "./mock";
import { createShopeeAdapter } from "./shopee";
import { createTikTokAdapter } from "./tiktok";
import type { MarketplaceAdapter } from "./types";

/** Daftar adapter yang bisa dipakai di instalasi ini (tergantung env). */
export function marketplaceAdapters(): MarketplaceAdapter[] {
  return [createShopeeAdapter(), createTikTokAdapter(), createMockAdapter()].filter((a): a is MarketplaceAdapter => a !== null);
}

export function getAdapter(provider: string): MarketplaceAdapter | null {
  return marketplaceAdapters().find((a) => a.provider === provider) ?? null;
}

/** Marketplace yang direncanakan tetapi belum punya adapter (ditampilkan sebagai "segera"). */
export const PLANNED_PROVIDERS = [
  { provider: "lazada", label: "Lazada" },
] as const;
