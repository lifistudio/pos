"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useDebounced } from "@/hooks/use-url-state";
import { api } from "@/lib/api-client";
import type { CartLine } from "./use-cart";

export type Quote = {
  gross: number;
  subtotal: number;
  memberDiscount: number;
  memberDiscountBps: number;
  voucherDiscount: number;
  pointsDiscount: number;
  manualDiscount: number;
  manual: { requested: number; applied: number; capped: boolean } | null;
  /** Kasir tanpa hak diskon manual → minta PIN atasan saat bayar. */
  manualNeedsApproval: boolean;
  /** Hanya untuk member: saldo, batas tukar, dan hasil tukar poin. */
  points: { balance: number; maxRedeemable: number; pointValue: number; minRedeem: number; requested: number; redeemed: number; reason: string | null } | null;
  taxTotal: number;
  total: number;
  pointsEarned: number;
  voucher: { code: string; applied: boolean; reason: string | null } | null;
  lines: { variantId: string; memberDiscount: number; voucherDiscount: number; lineTotal: number }[];
};

export type ManualDiscount = { type: "NOMINAL" | "PERCENT"; value: number; reason: string };

export type PosCustomer = { id: string; name: string; phone: string; isMember: boolean; memberNo: string | null; tierName: string | null; tierDiscountBps: number | null; points: number };

/**
 * Total resmi dari server bila ada customer atau voucher (diskon member, syarat voucher, poin).
 * Tanpa keduanya, keranjang memakai perhitungan lokal yang identik (lib/pricing).
 */
export function useQuote(branchId: string, lines: CartLine[], customer: PosCustomer | null, voucherCode: string | null, pointsRedeem: number, manual: ManualDiscount | null) {
  const items = lines.map((l) => ({ variantId: l.variantId, qty: l.qty }));
  const key = useDebounced(JSON.stringify({ items, c: customer?.id ?? null, v: voucherCode, p: pointsRedeem, m: manual }), 200);
  const enabled = lines.length > 0 && (!!customer || !!voucherCode || !!manual);
  return useQuery({
    queryKey: ["pos-quote", branchId, key],
    queryFn: () => {
      const parsed = JSON.parse(key) as { items: typeof items; c: string | null; v: string | null; p: number; m: ManualDiscount | null };
      return api<{ data: Quote }>("/pos/quote", {
        method: "POST",
        body: { branchId, items: parsed.items, customerId: parsed.c, voucherCode: parsed.v, pointsRedeem: parsed.p || null, manualDiscount: parsed.m },
      }).then((r) => r.data);
    },
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  });
}
