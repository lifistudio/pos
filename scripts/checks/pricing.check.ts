/** Pemeriksaan cepat mesin harga: `npx tsx scripts/checks/pricing.check.ts` (gagal = exit 1). */
import assert from "node:assert/strict";
import { priceCart, type CartLineInput, type VoucherRule } from "../../src/lib/pricing";
import { computeReturn } from "../../src/lib/returns";

const noTax = { enabled: false, rateBps: 0, inclusive: true };
const lines: CartLineInput[] = [
  { variantId: "v1", productId: "p1", categoryIds: ["tops", "apparel"], unitPrice: 100_000, qty: 2 },
  { variantId: "v2", productId: "p2", categoryIds: ["acc"], unitPrice: 50_000, qty: 1 },
];
const base: VoucherRule = { code: "X", valueType: "PERCENT", value: 2000, maxDiscount: null, minSpend: 0, maxSpend: null, productScope: "ALL", includeIds: [], excludeIds: [] };

// 20% semua barang
let r = priceCart(lines, { memberDiscountBps: 0, voucher: base, tax: noTax });
assert.equal(r.voucherDiscount, 50_000);
assert.equal(r.total, 200_000);

// maks potongan
r = priceCart(lines, { memberDiscountBps: 0, voucher: { ...base, maxDiscount: 30_000 }, tax: noTax });
assert.equal(r.voucherDiscount, 30_000);

// target kategori induk "apparel" → hanya baris 1
r = priceCart(lines, { memberDiscountBps: 0, voucher: { ...base, productScope: "CATEGORY", includeIds: ["apparel"] }, tax: noTax });
assert.equal(r.voucherDiscount, 40_000);
assert.equal(r.lines[1].voucherDiscount, 0);

// min belanja dihitung dari barang eligible saja
r = priceCart(lines, { memberDiscountBps: 0, voucher: { ...base, productScope: "VARIANT", includeIds: ["v2"], minSpend: 60_000 }, tax: noTax });
assert.equal(r.voucher?.applied, false);
assert.match(r.voucher?.reason ?? "", /kurang Rp10\.000/);

// member 10% lalu voucher nominal; voucher tidak melebihi subtotal eligible
r = priceCart(lines, { memberDiscountBps: 1000, voucher: { ...base, valueType: "NOMINAL", value: 1_000_000 }, tax: noTax });
assert.equal(r.memberDiscount, 25_000);
assert.equal(r.voucherDiscount, 225_000);
assert.equal(r.total, 0);

// pengecualian
r = priceCart(lines, { memberDiscountBps: 0, voucher: { ...base, excludeIds: ["p1"] }, tax: noTax });
assert.equal(r.voucherDiscount, 10_000);

// maks belanja
r = priceCart(lines, { memberDiscountBps: 0, voucher: { ...base, maxSpend: 100_000 }, tax: noTax });
assert.equal(r.voucher?.applied, false);

// alokasi selalu berjumlah sama dengan diskon
r = priceCart([{ ...lines[0], unitPrice: 33_333, qty: 3 }, { ...lines[1], unitPrice: 11_111 }], { memberDiscountBps: 0, voucher: { ...base, value: 1234 }, tax: noTax });
assert.equal(r.lines.reduce((s, l) => s + l.voucherDiscount, 0), r.voucherDiscount);

// PPN eksklusif dihitung setelah diskon
r = priceCart(lines, { memberDiscountBps: 0, voucher: base, tax: { enabled: true, rateBps: 1100, inclusive: false } });
assert.equal(r.taxTotal, 22_000);
assert.equal(r.total, 222_000);


// ── Tukar poin ──────────────────────────────────────────────────────────
const pts = { balance: 500, pointValue: 100, minRedeem: 10, maxBps: 5000 };
// batas 50% dari 250.000 = 125.000 → maks 500 poin (saldo), minta 300 → 30.000
r = priceCart(lines, { memberDiscountBps: 0, voucher: null, tax: noTax, points: { ...pts, requested: 300 } });
assert.equal(r.pointsDiscount, 30_000);
assert.equal(r.total, 220_000);
assert.equal(r.points?.maxRedeemable, 500);
assert.equal(r.lines[0].pointsDiscount + r.lines[1].pointsDiscount, 30_000);
// porsi maksimal: belanja 50.000 → maks 25.000 = 250 poin
r = priceCart([lines[1]], { memberDiscountBps: 0, voucher: null, tax: noTax, points: { ...pts, requested: 400 } });
assert.equal(r.points?.redeemed, 250);
assert.equal(r.total, 25_000);
// di bawah minimal & melebihi saldo
r = priceCart(lines, { memberDiscountBps: 0, voucher: null, tax: noTax, points: { ...pts, requested: 5 } });
assert.equal(r.pointsDiscount, 0);
assert.match(r.points?.reason ?? "", /Minimal tukar 10/);
r = priceCart(lines, { memberDiscountBps: 0, voucher: null, tax: noTax, points: { ...pts, requested: 900 } });
assert.match(r.points?.reason ?? "", /tidak cukup/);
// poin dihitung setelah voucher, PPN eksklusif dari subtotal akhir
r = priceCart(lines, { memberDiscountBps: 0, voucher: { ...base, valueType: "NOMINAL", value: 50_000 }, tax: { enabled: true, rateBps: 1100, inclusive: false }, points: { ...pts, requested: 100 } });
assert.equal(r.subtotal, 190_000);
assert.equal(r.taxTotal, 20_900);

// ── Retur ───────────────────────────────────────────────────────────────
const sale = { subtotal: 100_000, total: 111_000, refundTotal: 0, pointsEarned: 11, pointsRedeemed: 0 };
const rl = [
  { id: "a", qty: 3, returnedQty: 0, lineTotal: 70_000 },
  { id: "b", qty: 1, returnedQty: 0, lineTotal: 30_000 },
];
let ret = computeReturn(sale, rl, [{ saleItemId: "a", qty: 1 }]);
assert.equal(ret.items[0].amount, 23_333);
assert.equal(ret.refund, 25_899); // 111.000 × 23.333 / 100.000 (PPN eksklusif ikut kembali)
assert.equal(ret.isFull, false);
// retur sisa bertahap: total uang kembali tepat = total transaksi
const step2 = computeReturn({ ...sale, refundTotal: ret.refund }, [{ ...rl[0], returnedQty: 1 }, rl[1]], [{ saleItemId: "a", qty: 2 }, { saleItemId: "b", qty: 1 }]);
assert.equal(ret.refund + step2.refund, 111_000);
assert.equal(ret.pointsReversed + step2.pointsReversed, 11);
assert.equal(step2.isFull, true);
// melebihi sisa
ret = computeReturn(sale, [{ ...rl[0], returnedQty: 3 }, rl[1]], [{ saleItemId: "a", qty: 1 }]);
assert.ok(ret.error);

console.log("pricing & returns: semua pemeriksaan lulus");

// ── Diskon manual ───────────────────────────────────────────────────────
// 10% dari 250.000 = 25.000, lalu poin dari sisa
r = priceCart(lines, { memberDiscountBps: 0, voucher: null, tax: noTax, manual: { type: "PERCENT", value: 1000, maxBps: 3000 }, points: { ...pts, requested: 100 } });
assert.equal(r.manualDiscount, 25_000);
assert.equal(r.pointsDiscount, 10_000);
assert.equal(r.total, 215_000);
// nominal melebihi batas 30% → dipotong ke 75.000
r = priceCart(lines, { memberDiscountBps: 0, voucher: null, tax: noTax, manual: { type: "NOMINAL", value: 100_000, maxBps: 3000 } });
assert.equal(r.manualDiscount, 75_000);
assert.equal(r.manual?.capped, true);
// setelah voucher: voucher 50.000 → dasar 200.000 → 10% = 20.000
r = priceCart(lines, { memberDiscountBps: 0, voucher: { ...base, valueType: "NOMINAL", value: 50_000 }, tax: noTax, manual: { type: "PERCENT", value: 1000, maxBps: 10_000 } });
assert.equal(r.manualDiscount, 20_000);
assert.equal(r.lines.reduce((s, l) => s + l.manualDiscount, 0), 20_000);
console.log("diskon manual: lulus");
