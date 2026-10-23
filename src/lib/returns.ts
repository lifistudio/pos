/**
 * Perhitungan retur — fungsi murni, dipakai server (sumber kebenaran) dan form retur (pratinjau).
 * Semua nilai dihitung KUMULATIF: nilai untuk "a unit pertama yang diretur" = floor(nilai × a / jumlah),
 * dan tepat nilai penuh saat semuanya diretur. Retur bertahap tidak pernah menimbulkan selisih pembulatan.
 */
export type ReturnSale = { subtotal: number; total: number; refundTotal: number; pointsEarned: number; pointsRedeemed: number };
export type ReturnLine = { id: string; qty: number; returnedQty: number; lineTotal: number };
export type ReturnPick = { saleItemId: string; qty: number };

function cumulative(amount: number, part: number, whole: number) {
  if (whole <= 0) return 0;
  if (part >= whole) return amount;
  return Math.floor((amount * part) / whole);
}

export type ReturnComputation = {
  items: { saleItemId: string; qty: number; amount: number }[];
  /** Uang yang dikembalikan (termasuk PPN bila eksklusif). */
  refund: number;
  /** Poin hasil transaksi yang ditarik (sebelum dibatasi saldo customer). */
  pointsReversed: number;
  /** Poin yang dulu ditukar dan dikembalikan. */
  pointsRestored: number;
  /** Semua barang di struk sudah diretur setelah retur ini. */
  isFull: boolean;
  error: string | null;
};

export function computeReturn(sale: ReturnSale, lines: ReturnLine[], picks: ReturnPick[]): ReturnComputation {
  const pickQty = new Map<string, number>();
  for (const p of picks) if (p.qty > 0) pickQty.set(p.saleItemId, (pickQty.get(p.saleItemId) ?? 0) + p.qty);

  let error: string | null = pickQty.size === 0 ? "Pilih minimal satu barang yang diretur." : null;
  let baseBefore = 0;
  let baseAfter = 0;
  let isFull = true;
  const items: ReturnComputation["items"] = [];
  for (const l of lines) {
    const r = pickQty.get(l.id) ?? 0;
    if (l.returnedQty + r > l.qty) error = "Jumlah retur melebihi sisa barang di struk.";
    const before = cumulative(l.lineTotal, l.returnedQty, l.qty);
    const after = cumulative(l.lineTotal, Math.min(l.qty, l.returnedQty + r), l.qty);
    baseBefore += before;
    baseAfter += after;
    if (l.returnedQty + r < l.qty) isFull = false;
    if (r > 0) items.push({ saleItemId: l.id, qty: r, amount: after - before });
  }
  if ([...pickQty.keys()].some((id) => !lines.some((l) => l.id === id))) error = "Barang tidak ada di struk ini.";

  const refund = Math.max(0, cumulative(sale.total, baseAfter, sale.subtotal) - sale.refundTotal);
  return {
    items,
    refund,
    pointsReversed: cumulative(sale.pointsEarned, baseAfter, sale.subtotal) - cumulative(sale.pointsEarned, baseBefore, sale.subtotal),
    pointsRestored: cumulative(sale.pointsRedeemed, baseAfter, sale.subtotal) - cumulative(sale.pointsRedeemed, baseBefore, sale.subtotal),
    isFull,
    error,
  };
}
