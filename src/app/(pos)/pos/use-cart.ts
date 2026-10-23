"use client";

import { useMemo, useReducer } from "react";
import { computeTotals, type TaxConfig } from "@/lib/pricing";

export type CatalogItem = {
  variantId: string;
  productId: string;
  productName: string;
  title: string;
  sku: string;
  barcode: string | null;
  price: number;
  imageUrl: string | null;
  categoryName: string | null;
  available: number;
};

export type CartLine = CatalogItem & { qty: number };

type Action =
  | { type: "add"; item: CatalogItem }
  | { type: "setQty"; variantId: string; qty: number }
  | { type: "remove"; variantId: string }
  | { type: "clear" };

function reducer(lines: CartLine[], action: Action): CartLine[] {
  switch (action.type) {
    case "add": {
      const existing = lines.find((l) => l.variantId === action.item.variantId);
      if (existing) return lines.map((l) => (l.variantId === action.item.variantId ? { ...l, qty: l.qty + 1 } : l));
      // Barang terakhir dipindai tampil paling atas agar kasir langsung melihatnya.
      return [{ ...action.item, qty: 1 }, ...lines];
    }
    case "setQty":
      return action.qty <= 0
        ? lines.filter((l) => l.variantId !== action.variantId)
        : lines.map((l) => (l.variantId === action.variantId ? { ...l, qty: Math.min(action.qty, 10_000) } : l));
    case "remove":
      return lines.filter((l) => l.variantId !== action.variantId);
    case "clear":
      return [];
  }
}

export function useCart(tax: TaxConfig) {
  const [lines, dispatch] = useReducer(reducer, []);
  const totals = useMemo(() => computeTotals(lines.map((l) => ({ unitPrice: l.price, qty: l.qty })), tax), [lines, tax]);
  const units = lines.reduce((s, l) => s + l.qty, 0);
  return { lines, totals, units, dispatch };
}
