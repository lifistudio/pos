"use client";

import { api } from "@/lib/api-client";

export type VariantHit = { id: string; sku: string; barcode: string | null; title: string; productName: string; price?: number };

export type LookupResult = { kind: "hit"; variant: VariantHit } | { kind: "choices"; options: VariantHit[] } | { kind: "none"; code: string };

/**
 * Ubah hasil scan/ketikan menjadi varian: barcode/SKU persis → langsung; satu hasil → langsung;
 * beberapa hasil → pilihan; tidak ada → "none". Dipakai halaman stok, transfer, dan opname.
 */
export async function lookupVariant(code: string): Promise<LookupResult> {
  const { data } = await api<{ data: VariantHit[] }>("/variants/search", { query: { q: code, limit: 8 } });
  const exact = data.find((v) => v.barcode === code || v.sku.toUpperCase() === code.toUpperCase());
  if (exact) return { kind: "hit", variant: exact };
  if (data.length === 1) return { kind: "hit", variant: data[0] };
  if (data.length === 0) return { kind: "none", code };
  return { kind: "choices", options: data };
}

export const variantLabel = (v: { productName: string; variantTitle?: string; title?: string }) => {
  const t = v.variantTitle ?? v.title ?? "Default";
  return t === "Default" ? v.productName : `${v.productName} · ${t}`;
};
