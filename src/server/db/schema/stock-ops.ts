import { sql } from "drizzle-orm";
import { check, index, integer, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { productVariants } from "./catalog";
import { branches, id, timestamps } from "./core";

// ── Transfer stok antar cabang ──────────────────────────────────────────

/**
 * DRAFT → IN_TRANSIT (stok keluar dari asal) → RECEIVED (stok masuk tujuan sesuai jumlah diterima).
 * IN_TRANSIT bisa CANCELLED (stok kembali ke asal). Selisih kirim–terima tercatat per item.
 */
export const transferStatus = pgEnum("transfer_status", ["DRAFT", "IN_TRANSIT", "RECEIVED", "CANCELLED"]);

export const stockTransfers = pgTable(
  "stock_transfers",
  {
    id: id(),
    number: text("number").notNull(),
    fromBranchId: uuid("from_branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    toBranchId: uuid("to_branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    status: transferStatus("status").notNull().default("DRAFT"),
    note: text("note"),
    receiveNote: text("receive_note"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    sentBy: text("sent_by").references(() => user.id, { onDelete: "set null" }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    receivedBy: text("received_by").references(() => user.id, { onDelete: "set null" }),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    cancelledBy: text("cancelled_by").references(() => user.id, { onDelete: "set null" }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("stock_transfers_number_uq").on(t.number),
    index("stock_transfers_from_idx").on(t.fromBranchId, t.createdAt.desc()),
    index("stock_transfers_to_idx").on(t.toBranchId, t.createdAt.desc()),
    index("stock_transfers_status_idx").on(t.status),
    check("stock_transfers_diff_branch", sql`${t.fromBranchId} <> ${t.toBranchId}`),
  ],
);

export const stockTransferItems = pgTable(
  "stock_transfer_items",
  {
    transferId: uuid("transfer_id")
      .notNull()
      .references(() => stockTransfers.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "restrict" }),
    qtySent: integer("qty_sent").notNull(),
    /** null sampai diterima. */
    qtyReceived: integer("qty_received"),
  },
  (t) => [
    primaryKey({ columns: [t.transferId, t.variantId] }),
    index("stock_transfer_items_variant_idx").on(t.variantId),
    check("stock_transfer_items_qty_pos", sql`${t.qtySent} > 0`),
    check("stock_transfer_items_recv_valid", sql`${t.qtyReceived} is null or (${t.qtyReceived} >= 0 and ${t.qtyReceived} <= ${t.qtySent})`),
  ],
);

// ── Stok opname ─────────────────────────────────────────────────────────

/**
 * COUNTING → POSTED (selisih dibukukan sebagai pergerakan OPNAME) atau CANCELLED.
 * PARTIAL: hanya barang yang dihitung. FULL: barang berstok yang tidak dihitung dianggap 0 saat posting.
 */
export const opnameStatus = pgEnum("opname_status", ["COUNTING", "POSTED", "CANCELLED"]);
export const opnameMode = pgEnum("opname_mode", ["PARTIAL", "FULL"]);

export const stockOpnames = pgTable(
  "stock_opnames",
  {
    id: id(),
    number: text("number").notNull(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    mode: opnameMode("mode").notNull().default("PARTIAL"),
    status: opnameStatus("status").notNull().default("COUNTING"),
    note: text("note"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    postedBy: text("posted_by").references(() => user.id, { onDelete: "set null" }),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("stock_opnames_number_uq").on(t.number),
    index("stock_opnames_branch_idx").on(t.branchId, t.createdAt.desc()),
    // Satu opname berjalan per cabang agar hitungan tidak tumpang tindih.
    uniqueIndex("stock_opnames_one_counting_per_branch").on(t.branchId).where(sql`${t.status} = 'COUNTING'`),
  ],
);

export const stockOpnameItems = pgTable(
  "stock_opname_items",
  {
    opnameId: uuid("opname_id")
      .notNull()
      .references(() => stockOpnames.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "restrict" }),
    countedQty: integer("counted_qty").notNull().default(0),
    /** Diisi saat posting: stok sistem tepat sebelum penyesuaian & selisih yang dibukukan. */
    systemQty: integer("system_qty"),
    difference: integer("difference"),
    countedBy: text("counted_by").references(() => user.id, { onDelete: "set null" }),
    updatedAt: timestamps.updatedAt,
  },
  (t) => [
    index("stock_opname_items_variant_idx").on(t.variantId),primaryKey({ columns: [t.opnameId, t.variantId] }), check("stock_opname_items_counted_nonneg", sql`${t.countedQty} >= 0`)],
);
