import { sql } from "drizzle-orm";
import { bigint, boolean, check, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { TerminalReceipt } from "@/lib/payment-terminal";
import { user } from "./auth";
import { productVariants } from "./catalog";
import { branches, id, timestamps } from "./core";
import { customers, vouchers } from "./crm";

const money = (name: string) => bigint(name, { mode: "number" });

// ── Shift kasir ─────────────────────────────────────────────────────────

export const shiftStatus = pgEnum("shift_status", ["OPEN", "CLOSED"]);

/** Satu kasir hanya boleh punya satu shift terbuka per cabang (unique index parsial). */
export const shifts = pgTable(
  "shifts",
  {
    id: id(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    status: shiftStatus("status").notNull().default("OPEN"),
    openingCash: money("opening_cash").notNull().default(0),
    /** Diisi saat tutup: kas yang seharusnya ada (kas awal + tunai masuk − kembalian). */
    expectedCash: money("expected_cash"),
    countedCash: money("counted_cash"),
    note: text("note"),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("shifts_one_open_per_user_branch").on(t.userId, t.branchId).where(sql`${t.status} = 'OPEN'`),
    index("shifts_branch_opened_idx").on(t.branchId, t.openedAt.desc()),
  ],
);

// ── Penjualan ───────────────────────────────────────────────────────────

/** PENDING = menunggu QRIS dinamis dibayar (stok, voucher, poin tukar sudah dikunci). */
export const saleStatus = pgEnum("sale_status", ["PENDING", "PAID", "VOIDED"]);
/** MARKETPLACE = dibayar pembeli lewat marketplace, dana dicairkan marketplace ke toko. */
export const paymentMethod = pgEnum("payment_method", ["CASH", "QRIS", "DEBIT", "CREDIT", "TRANSFER", "EWALLET", "MARKETPLACE"]);

export type TaxSnapshot = { enabled: boolean; rateBps: number; inclusive: boolean };

export const sales = pgTable(
  "sales",
  {
    id: id(),
    number: text("number").notNull(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    shiftId: uuid("shift_id").references(() => shifts.id, { onDelete: "restrict" }),
    cashierId: text("cashier_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    channel: text("channel").notNull().default("POS"),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    /** Diskon otomatis tier member (rupiah). */
    memberDiscount: money("member_discount").notNull().default(0),
    voucherId: uuid("voucher_id").references(() => vouchers.id, { onDelete: "set null" }),
    voucherCode: text("voucher_code"),
    voucherDiscount: money("voucher_discount").notNull().default(0),
    /** Diskon manual kasir (setelah voucher, sebelum tukar poin) + alasan & siapa yang menyetujui. */
    manualDiscount: money("manual_discount").notNull().default(0),
    manualDiscountReason: text("manual_discount_reason"),
    manualDiscountApprovedBy: text("manual_discount_approved_by").references(() => user.id, { onDelete: "set null" }),
    /** Ongkir (order online); tidak ikut dasar PPN maupun nilai retur barang. */
    shippingFee: money("shipping_fee").notNull().default(0),
    pointsEarned: integer("points_earned").notNull().default(0),
    /** Poin member yang ditukar sebagai potongan, dan nilai rupiahnya. */
    pointsRedeemed: integer("points_redeemed").notNull().default(0),
    pointsDiscount: money("points_discount").notNull().default(0),
    /** Akumulasi uang yang sudah dikembalikan lewat retur. */
    refundTotal: money("refund_total").notNull().default(0),
    status: saleStatus("status").notNull().default("PAID"),
    subtotal: money("subtotal").notNull(),
    discountTotal: money("discount_total").notNull().default(0),
    taxTotal: money("tax_total").notNull().default(0),
    total: money("total").notNull(),
    /** Pengaturan pajak cabang saat transaksi terjadi — laporan lama tidak berubah bila pengaturan diubah. */
    taxSnapshot: jsonb("tax_snapshot").$type<TaxSnapshot>().notNull(),
    note: text("note"),
    /** Transaksi offline: nomor struk sementara di perangkat, kapan disinkronkan, dan kekurangan stok saat sinkron. */
    offlineRef: text("offline_ref"),
    syncedAt: timestamp("synced_at", { withTimezone: true }),
    offlineShortfall: jsonb("offline_shortfall").$type<{ variantId: string; sku: string; qty: number }[]>(),
    /** Dikirim client per transaksi; klik ganda / retry jaringan tidak membuat transaksi ganda. */
    idempotencyKey: text("idempotency_key").notNull(),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidedBy: text("voided_by").references(() => user.id, { onDelete: "set null" }),
    voidReason: text("void_reason"),
    /** Atasan yang menyetujui void lewat PIN (null = pelaku punya hak sendiri). */
    voidApprovedBy: text("void_approved_by").references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    index("sales_voucher_idx").on(t.voucherId),
    uniqueIndex("sales_number_uq").on(t.number),
    uniqueIndex("sales_idempotency_uq").on(t.idempotencyKey),
    index("sales_branch_created_idx").on(t.branchId, t.createdAt.desc()),
    index("sales_shift_idx").on(t.shiftId),
    index("sales_cashier_idx").on(t.cashierId),
    index("sales_customer_idx").on(t.customerId, t.createdAt.desc()),
    check("sales_total_nonneg", sql`${t.total} >= 0`),
    check("sales_refund_range", sql`${t.refundTotal} between 0 and ${t.total}`),
  ],
);

export const saleItems = pgTable(
  "sale_items",
  {
    id: id(),
    saleId: uuid("sale_id")
      .notNull()
      .references(() => sales.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "restrict" }),
    // Snapshot agar struk & laporan tetap benar walau produk diubah/diarsipkan.
    productName: text("product_name").notNull(),
    variantTitle: text("variant_title").notNull(),
    sku: text("sku").notNull(),
    qty: integer("qty").notNull(),
    unitPrice: money("unit_price").notNull(),
    costPrice: money("cost_price"),
    discount: money("discount").notNull().default(0),
    lineTotal: money("line_total").notNull(),
    /** Jumlah yang sudah diretur; tidak boleh melebihi qty (dijaga CHECK + UPDATE bersyarat). */
    returnedQty: integer("returned_qty").notNull().default(0),
  },
  (t) => [
    index("sale_items_sale_idx").on(t.saleId),
    index("sale_items_variant_idx").on(t.variantId),
    check("sale_items_qty_pos", sql`${t.qty} > 0`),
    check("sale_items_returned_range", sql`${t.returnedQty} between 0 and ${t.qty}`),
  ],
);

export const salePayments = pgTable(
  "sale_payments",
  {
    id: id(),
    saleId: uuid("sale_id")
      .notNull()
      .references(() => sales.id, { onDelete: "cascade" }),
    method: paymentMethod("method").notNull(),
    /** Nominal yang diterapkan ke tagihan. */
    amount: money("amount").notNull(),
    /** Tunai: uang yang diterima dari pelanggan; kembalian = tendered − amount. */
    tendered: money("tendered"),
    change: money("change").notNull().default(0),
    /** No. referensi QRIS/EDC/transfer (input manual kasir). */
    reference: text("reference"),
    /** Data dari mesin EDC terintegrasi (approval, RRN, TID, kartu tersamar) — null bila dicatat manual. */
    terminal: jsonb("terminal").$type<TerminalReceipt>(),
    createdAt: timestamps.createdAt,
  },
  (t) => [index("sale_payments_sale_idx").on(t.saleId), check("sale_payments_amount_pos", sql`${t.amount} > 0`)],
);

/** Penomoran berurutan (invoice per cabang per hari) — dinaikkan atomik dengan UPSERT. */
export const numberSequences = pgTable("number_sequences", {
  key: text("key").primaryKey(),
  value: integer("value").notNull().default(0),
});

// ── Retur penjualan ─────────────────────────────────────────────────────

export const returnReason = pgEnum("return_reason", ["SIZE", "DEFECT", "WRONG_ITEM", "NOT_AS_DESCRIBED", "CHANGED_MIND", "OTHER"]);

/** Retur atas struk: uang kembali (tunai dari laci shift atau metode non-tunai), stok kembali bila layak jual. */
export const saleReturns = pgTable(
  "sale_returns",
  {
    id: id(),
    number: text("number").notNull(),
    saleId: uuid("sale_id")
      .notNull()
      .references(() => sales.id, { onDelete: "restrict" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    /** Shift kasir tempat uang tunai dikeluarkan (wajib untuk refund tunai). */
    shiftId: uuid("shift_id").references(() => shifts.id, { onDelete: "restrict" }),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    refundMethod: paymentMethod("refund_method").notNull(),
    refundAmount: money("refund_amount").notNull(),
    /** Poin hasil transaksi yang ditarik kembali. */
    pointsReversed: integer("points_reversed").notNull().default(0),
    /** Poin yang dulu ditukar dan dikembalikan ke customer. */
    pointsRestored: integer("points_restored").notNull().default(0),
    reasonCode: returnReason("reason_code").notNull().default("OTHER"),
    reason: text("reason").notNull(),
    reference: text("reference"),
    approvedBy: text("approved_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    uniqueIndex("sale_returns_number_uq").on(t.number),
    index("sale_returns_sale_idx").on(t.saleId),
    index("sale_returns_branch_created_idx").on(t.branchId, t.createdAt.desc()),
    index("sale_returns_shift_idx").on(t.shiftId),
    index("sale_returns_reason_idx").on(t.reasonCode, t.createdAt.desc()),
    check("sale_returns_amount_nonneg", sql`${t.refundAmount} >= 0`),
  ],
);

export const saleReturnItems = pgTable(
  "sale_return_items",
  {
    id: id(),
    returnId: uuid("return_id")
      .notNull()
      .references(() => saleReturns.id, { onDelete: "cascade" }),
    saleItemId: uuid("sale_item_id")
      .notNull()
      .references(() => saleItems.id, { onDelete: "restrict" }),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "restrict" }),
    qty: integer("qty").notNull(),
    /** Bagian nilai baris (setelah diskon, sebelum PPN eksklusif). */
    amount: money("amount").notNull(),
    /** true = layak jual, kembali ke stok; false = rusak, tidak menambah stok. */
    restock: boolean("restock").notNull(),
  },
  (t) => [
    index("sale_return_items_variant_idx").on(t.variantId),index("sale_return_items_return_idx").on(t.returnId), index("sale_return_items_sale_item_idx").on(t.saleItemId), check("sale_return_items_qty_pos", sql`${t.qty} > 0`)],
);
