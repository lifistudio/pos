"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { TaxConfig } from "@/lib/pricing";
import type { CatalogItem } from "../use-cart";
import { idbGet, idbSet } from "./idb";

export type PackItem = CatalogItem & { categoryId: string | null; sig: string };
export type OfflinePack = {
  branchId: string;
  issuedAt: string;
  validUntil: string;
  tax: TaxConfig;
  categories: { id: string; name: string; parentId: string | null }[];
  items: PackItem[];
};

/**
 * Paket katalog offline per cabang: diambil dari server saat online (tiap 10 menit) dan disimpan di
 * IndexedDB; saat offline dipakai dari IndexedDB. Harga bertanda tangan berlaku 48 jam.
 */
export function useOfflinePack(branchId: string, online: boolean) {
  const stored = useQuery({
    queryKey: ["offline-pack-local", branchId],
    queryFn: async () => {
      const p = (await idbGet<OfflinePack>("packs", branchId)) ?? null;
      // Paket lama (harga bertanda tangan kedaluwarsa) tidak dipakai.
      return p && new Date(p.validUntil).getTime() > Date.now() ? p : null;
    },
    networkMode: "always",
    staleTime: Infinity,
  });
  const remote = useQuery({
    queryKey: ["offline-pack", branchId],
    queryFn: async () => {
      const { data } = await api<{ data: OfflinePack }>("/pos/offline-pack", { query: { branchId } });
      await idbSet("packs", branchId, data).catch(() => null);
      return data;
    },
    enabled: online,
    refetchInterval: online ? 10 * 60_000 : false,
    staleTime: 5 * 60_000,
    retry: false,
  });
  return { pack: remote.data ?? stored.data ?? null, loading: stored.isPending && remote.isPending };
}

/** Cari di paket lokal: barcode/SKU persis lebih dulu, lalu semua kata cocok ke nama/varian/SKU. */
export function searchPack(pack: OfflinePack, q: string, categoryId: string | null) {
  let items = pack.items;
  if (categoryId) {
    const tree = new Set([categoryId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const c of pack.categories) {
        if (c.parentId && tree.has(c.parentId) && !tree.has(c.id)) {
          tree.add(c.id);
          grew = true;
        }
      }
    }
    items = items.filter((i) => i.categoryId && tree.has(i.categoryId));
  }
  const term = q.trim().toLowerCase();
  if (!term) return items;
  const exact = items.filter((i) => i.barcode === q.trim() || i.sku.toLowerCase() === term);
  const words = term.split(/\s+/);
  const rest = items.filter((i) => !exact.includes(i) && words.every((w) => `${i.productName} ${i.title} ${i.sku}`.toLowerCase().includes(w)));
  return [...exact, ...rest];
}
