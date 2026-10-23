/**
 * Perhitungan total transaksi — fungsi murni, dipakai keranjang (client) dan checkout (server)
 * agar angka di layar kasir sama persis dengan yang disimpan. Server tetap menghitung ulang
 * dari harga di database; nilai dari client hanya untuk tampilan.
 * Semua nilai rupiah integer; persen dalam basis poin (1100 = 11%).
 */
export type TaxConfig = { enabled: boolean; rateBps: number; inclusive: boolean };
export type PricedLine = { unitPrice: number; qty: number; discount?: number };

export type Totals = {
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
};

export function computeTotals(lines: PricedLine[], tax: TaxConfig): Totals {
  const gross = lines.reduce((s, l) => s + l.unitPrice * l.qty, 0);
  const discountTotal = lines.reduce((s, l) => s + (l.discount ?? 0), 0);
  const subtotal = Math.max(0, gross - discountTotal);
  if (!tax.enabled || tax.rateBps <= 0) return { subtotal, discountTotal, taxTotal: 0, total: subtotal };
  if (tax.inclusive) {
    // Harga sudah termasuk PPN: pajak = bagian PPN di dalam subtotal.
    const base = Math.round((subtotal * 10_000) / (10_000 + tax.rateBps));
    return { subtotal, discountTotal, taxTotal: subtotal - base, total: subtotal };
  }
  const taxTotal = Math.round((subtotal * tax.rateBps) / 10_000);
  return { subtotal, discountTotal, taxTotal, total: subtotal + taxTotal };
}

// ── Diskon member & voucher ─────────────────────────────────────────────

export type CartLineInput = {
  variantId: string;
  productId: string;
  /** Kategori produk beserta semua induknya (agar target kategori induk ikut cocok). */
  categoryIds: string[];
  unitPrice: number;
  qty: number;
};

export type VoucherRule = {
  code: string;
  valueType: "NOMINAL" | "PERCENT";
  value: number;
  maxDiscount: number | null;
  minSpend: number;
  maxSpend: number | null;
  productScope: "ALL" | "CATEGORY" | "PRODUCT" | "VARIANT";
  /** id kategori/produk/varian yang disasar (sesuai productScope). */
  includeIds: string[];
  /** id kategori/produk/varian yang dikecualikan (berlaku untuk semua scope). */
  excludeIds: string[];
};

/** Aturan tukar poin (pengaturan toko) + saldo customer. `requested` 0 = hanya hitung batas maksimal. */
export type PointsRule = {
  requested: number;
  balance: number;
  /** Nilai rupiah per poin. */
  pointValue: number;
  minRedeem: number;
  /** Porsi maksimal tagihan (setelah member & voucher) yang boleh dibayar poin, basis poin. */
  maxBps: number;
};

/** Diskon manual kasir atas seluruh keranjang (setelah voucher), dibatasi porsi maksimal kebijakan toko. */
export type ManualDiscountRule = { type: "NOMINAL" | "PERCENT"; value: number; maxBps: number };

export type PricedCartLine = CartLineInput & { memberDiscount: number; voucherDiscount: number; manualDiscount: number; pointsDiscount: number; lineTotal: number; voucherEligible: boolean };

export type CartPricing = Totals & {
  lines: PricedCartLine[];
  memberDiscount: number;
  voucherDiscount: number;
  voucher: { code: string; applied: boolean; reason: string | null; eligibleSubtotal: number } | null;
  manualDiscount: number;
  manual: { requested: number; applied: number; capped: boolean } | null;
  pointsDiscount: number;
  points: { balance: number; maxRedeemable: number; pointValue: number; minRedeem: number; requested: number; redeemed: number; reason: string | null } | null;
};

/** Bagi `amount` ke baris secara proporsional terhadap `weights`; sisa pembulatan ke baris terbesar. */
function allocate(amount: number, weights: number[]): number[] {
  const total = weights.reduce((s, w) => s + w, 0);
  if (amount <= 0 || total <= 0) return weights.map(() => 0);
  const parts = weights.map((w) => Math.floor((amount * w) / total));
  const rest = amount - parts.reduce((s, p) => s + p, 0);
  const biggest = weights.indexOf(Math.max(...weights));
  parts[biggest] += rest;
  return parts;
}

const rp = (n: number) => `Rp${n.toLocaleString("id-ID")}`;

function lineMatches(line: CartLineInput, ids: string[]) {
  return ids.includes(line.variantId) || ids.includes(line.productId) || line.categoryIds.some((c) => ids.includes(c));
}

/**
 * Urutan: (1) diskon tier member untuk semua baris, (2) voucher atas baris yang memenuhi syarat,
 * dihitung dari harga setelah diskon member, (3) diskon manual kasir, (4) tukar poin member atas sisa tagihan,
 * (5) PPN atas subtotal akhir.
 * Syarat voucher yang butuh database (periode, kuota, customer, cabang) dicek di service sebelum memanggil ini.
 */
export function priceCart(
  lines: CartLineInput[],
  opts: { memberDiscountBps: number; voucher: VoucherRule | null; tax: TaxConfig; points?: PointsRule | null; manual?: ManualDiscountRule | null },
): CartPricing {
  const gross = lines.map((l) => l.unitPrice * l.qty);
  const memberParts = gross.map((g) => Math.floor((g * Math.max(0, opts.memberDiscountBps)) / 10_000));
  const afterMember = gross.map((g, i) => g - memberParts[i]);

  let voucherParts = lines.map(() => 0);
  let voucherInfo: CartPricing["voucher"] = null;
  const v = opts.voucher;
  if (v) {
    const eligible = lines.map((l) => {
      if (v.excludeIds.length && lineMatches(l, v.excludeIds)) return false;
      return v.productScope === "ALL" || lineMatches(l, v.includeIds);
    });
    const eligibleSubtotal = afterMember.reduce((s, a, i) => s + (eligible[i] ? a : 0), 0);
    let reason: string | null = null;
    if (eligibleSubtotal === 0) reason = "Tidak ada barang di keranjang yang termasuk voucher ini.";
    else if (eligibleSubtotal < v.minSpend) reason = `Minimal belanja ${rp(v.minSpend)} untuk barang yang termasuk voucher (kurang ${rp(v.minSpend - eligibleSubtotal)}).`;
    else if (v.maxSpend !== null && eligibleSubtotal > v.maxSpend) reason = `Voucher hanya berlaku untuk belanja maksimal ${rp(v.maxSpend)}.`;

    if (!reason) {
      let discount = v.valueType === "PERCENT" ? Math.floor((eligibleSubtotal * v.value) / 10_000) : v.value;
      if (v.valueType === "PERCENT" && v.maxDiscount !== null) discount = Math.min(discount, v.maxDiscount);
      discount = Math.min(discount, eligibleSubtotal);
      voucherParts = allocate(discount, afterMember.map((a, i) => (eligible[i] ? a : 0)));
    }
    voucherInfo = { code: v.code, applied: !reason, reason, eligibleSubtotal };
  }

  // Diskon manual: atas sisa setelah voucher, dibatasi porsi maksimal (kebijakan toko).
  const afterVoucherRaw = afterMember.map((a, i) => a - voucherParts[i]);
  let manualParts = lines.map(() => 0);
  let manualInfo: CartPricing["manual"] = null;
  const md = opts.manual;
  if (md && md.value > 0) {
    const base = afterVoucherRaw.reduce((s, a) => s + a, 0);
    const requested = md.type === "PERCENT" ? Math.floor((base * Math.min(md.value, 10_000)) / 10_000) : md.value;
    const cap = Math.floor((base * md.maxBps) / 10_000);
    const applied = Math.max(0, Math.min(requested, cap, base));
    manualParts = allocate(applied, afterVoucherRaw);
    manualInfo = { requested, applied, capped: applied < requested };
  }

  // Tukar poin: potongan atas sisa tagihan, dibatasi saldo, porsi maksimal, dan kelipatan nilai poin.
  let pointsParts = lines.map(() => 0);
  let pointsInfo: CartPricing["points"] = null;
  const pr = opts.points;
  if (pr && pr.pointValue > 0) {
    const afterVoucher = afterVoucherRaw.map((a, i) => a - manualParts[i]);
    const base = afterVoucher.reduce((s, a) => s + a, 0);
    const maxRedeemable = Math.max(0, Math.min(pr.balance, Math.floor(Math.floor((base * pr.maxBps) / 10_000) / pr.pointValue)));
    let redeemed = 0;
    let reason: string | null = null;
    if (pr.requested > 0) {
      if (pr.requested < pr.minRedeem) reason = `Minimal tukar ${pr.minRedeem.toLocaleString("id-ID")} poin.`;
      else if (pr.requested > pr.balance) reason = `Poin tidak cukup (saldo ${pr.balance.toLocaleString("id-ID")}).`;
      else if (maxRedeemable < pr.minRedeem || maxRedeemable === 0) reason = "Belanja terlalu kecil untuk tukar poin.";
      else redeemed = Math.min(pr.requested, maxRedeemable);
    }
    pointsParts = allocate(redeemed * pr.pointValue, afterVoucher);
    pointsInfo = { balance: pr.balance, maxRedeemable, pointValue: pr.pointValue, minRedeem: pr.minRedeem, requested: pr.requested, redeemed, reason };
  }

  const priced: PricedCartLine[] = lines.map((l, i) => ({
    ...l,
    memberDiscount: memberParts[i],
    voucherDiscount: voucherParts[i],
    manualDiscount: manualParts[i],
    pointsDiscount: pointsParts[i],
    lineTotal: gross[i] - memberParts[i] - voucherParts[i] - manualParts[i] - pointsParts[i],
    voucherEligible: voucherParts[i] > 0,
  }));
  const totals = computeTotals(
    priced.map((l) => ({ unitPrice: l.unitPrice, qty: l.qty, discount: l.memberDiscount + l.voucherDiscount + l.manualDiscount + l.pointsDiscount })),
    opts.tax,
  );
  return {
    ...totals,
    lines: priced,
    memberDiscount: memberParts.reduce((s, p) => s + p, 0),
    voucherDiscount: voucherParts.reduce((s, p) => s + p, 0),
    voucher: voucherInfo,
    manualDiscount: manualParts.reduce((s, p) => s + p, 0),
    manual: manualInfo,
    pointsDiscount: pointsParts.reduce((s, p) => s + p, 0),
    points: pointsInfo,
  };
}

/** Poin = floor(total setelah diskon / 10.000) × poin per 10rb tier. */
export function pointsFor(total: number, pointsPer10k: number) {
  return Math.floor(total / 10_000) * Math.max(0, pointsPer10k);
}

/** Tombol nominal cepat untuk pembayaran tunai: uang pas + pecahan rupiah terdekat di atasnya. */
export function quickCashAmounts(total: number): number[] {
  const notes = [10_000, 20_000, 50_000, 100_000];
  const out = new Set<number>([total]);
  for (const n of notes) {
    const rounded = Math.ceil(total / n) * n;
    if (rounded > total) out.add(rounded);
  }
  return [...out].sort((a, b) => a - b).slice(0, 4);
}

export const PAYMENT_LABEL: Record<string, string> = {
  CASH: "Tunai",
  QRIS: "QRIS",
  DEBIT: "Kartu debit",
  CREDIT: "Kartu kredit",
  TRANSFER: "Transfer",
  EWALLET: "E-wallet",
  MARKETPLACE: "Marketplace",
};
