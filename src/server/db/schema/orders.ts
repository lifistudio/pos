import { sql } from "drizzle-orm";
import { bigint, check, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { productVariants } from "./catalog";
import { branches, id, salesChannel, timestamps } from "./core";
import { marketplaceConnections } from "./marketplace";
import { customers } from "./crm";
import { sales, type TaxSnapshot } from "./sales";

const money = (name: string) => bigint(name, { mode: "number" });

// ── Order online ────────────────────────────────────────────────────────

export const onlineOrderStatus = pgEnum("online_order_status", ["PENDING_PAYMENT", "PAID", "PACKED", "SHIPPED", "COMPLETED", "CANCELLED"]);

/**
 * Order dari kanal online. Stok cabang sumber di-reserve sejak order dibuat, dipotong saat dikirim,
 * dilepas saat dibatalkan/kedaluwarsa. Saat lunas, dibuat baris `sales` (channel = kanal) agar omzet,
 * struk, dan retur memakai jalur yang sama dengan kasir.
 */
export const onlineOrders = pgTable(
  "online_orders",
  {
    id: id(),
    number: text("number").notNull(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    channel: salesChannel("channel").notNull(),
    externalOrderNo: text("external_order_no"),
    /** Toko marketplace asal (order ditarik otomatis); null = input manual. */
    connectionId: uuid("connection_id").references(() => marketplaceConnections.id, { onDelete: "set null" }),
    status: onlineOrderStatus("status").notNull().default("PENDING_PAYMENT"),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    recipientName: text("recipient_name").notNull(),
    recipientPhone: text("recipient_phone").notNull(),
    shippingAddress: text("shipping_address").notNull(),
    courier: text("courier"),
    trackingNo: text("tracking_no"),
    shippingFee: money("shipping_fee").notNull().default(0),
    subtotal: money("subtotal").notNull(),
    taxTotal: money("tax_total").notNull().default(0),
    total: money("total").notNull(),
    taxSnapshot: jsonb("tax_snapshot").$type<TaxSnapshot>().notNull(),
    note: text("note"),
    /** Batas bayar: lewat dari ini order PENDING_PAYMENT dibatalkan otomatis dan reservasi dilepas. */
    reservedUntil: timestamp("reserved_until", { withTimezone: true }).notNull(),
    saleId: uuid("sale_id").references(() => sales.id, { onDelete: "restrict" }),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    packedAt: timestamp("packed_at", { withTimezone: true }),
    shippedAt: timestamp("shipped_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: text("cancelled_by").references(() => user.id, { onDelete: "set null" }),
    cancelReason: text("cancel_reason"),
    ...timestamps,
  },
  (t) => [
    index("online_orders_connection_idx").on(t.connectionId),
    index("online_orders_customer_idx").on(t.customerId),
    uniqueIndex("online_orders_number_uq").on(t.number),
    uniqueIndex("online_orders_sale_uq").on(t.saleId),
    // Order marketplace yang sama tidak boleh diinput dua kali.
    uniqueIndex("online_orders_external_uq").on(t.channel, t.externalOrderNo).where(sql`${t.externalOrderNo} is not null`),
    index("online_orders_branch_created_idx").on(t.branchId, t.createdAt.desc()),
    index("online_orders_pending_idx").on(t.reservedUntil).where(sql`${t.status} = 'PENDING_PAYMENT'`),
    index("online_orders_status_idx").on(t.status, t.createdAt.desc()),
    check("online_orders_total_nonneg", sql`${t.total} >= 0 and ${t.shippingFee} >= 0`),
  ],
);

export const onlineOrderItems = pgTable(
  "online_order_items",
  {
    orderId: uuid("order_id")
      .notNull()
      .references(() => onlineOrders.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "restrict" }),
    productName: text("product_name").notNull(),
    variantTitle: text("variant_title").notNull(),
    sku: text("sku").notNull(),
    qty: integer("qty").notNull(),
    unitPrice: money("unit_price").notNull(),
    lineTotal: money("line_total").notNull(),
  },
  (t) => [
    index("online_order_items_variant_idx").on(t.variantId),primaryKey({ columns: [t.orderId, t.variantId] }), check("online_order_items_qty_pos", sql`${t.qty} > 0`)],
);

// ── Payment gateway ─────────────────────────────────────────────────────

export const paymentIntentStatus = pgEnum("payment_intent_status", ["PENDING", "PAID", "EXPIRED", "FAILED", "CANCELLED"]);

/** Satu permintaan bayar ke gateway (mis. QRIS dinamis). Bisa dibuat ulang bila QR kedaluwarsa. */
export const paymentIntents = pgTable(
  "payment_intents",
  {
    id: id(),
    provider: text("provider").notNull(),
    /** order_id yang dikirim ke gateway — unik per percobaan bayar. */
    gatewayOrderId: text("gateway_order_id").notNull(),
    referenceType: text("reference_type").notNull(),
    referenceId: uuid("reference_id").notNull(),
    method: text("method").notNull().default("QRIS"),
    amount: money("amount").notNull(),
    status: paymentIntentStatus("status").notNull().default("PENDING"),
    providerRef: text("provider_ref"),
    qrString: text("qr_string"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("payment_intents_gateway_order_uq").on(t.provider, t.gatewayOrderId),
    index("payment_intents_reference_idx").on(t.referenceType, t.referenceId, t.createdAt.desc()),
    check("payment_intents_amount_pos", sql`${t.amount} > 0`),
  ],
);

/** Log notifikasi gateway. `event_key` unik → notifikasi yang dikirim ulang hanya diproses sekali. */
export const paymentEvents = pgTable(
  "payment_events",
  {
    id: id(),
    provider: text("provider").notNull(),
    eventKey: text("event_key").notNull(),
    intentId: uuid("intent_id").references(() => paymentIntents.id, { onDelete: "set null" }),
    payload: jsonb("payload").notNull(),
    outcome: text("outcome").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("payment_events_key_uq").on(t.provider, t.eventKey), index("payment_events_intent_idx").on(t.intentId)],
);

export { salesChannel };
