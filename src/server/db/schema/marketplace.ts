import { boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { productVariants } from "./catalog";
import { branches, id, salesChannel, timestamps } from "./core";

export const connectionStatus = pgEnum("marketplace_connection_status", ["ACTIVE", "PAUSED", "ERROR", "DISCONNECTED"]);

/**
 * Satu toko marketplace yang terhubung. Kredensial (token OAuth) disimpan terenkripsi AES-256-GCM
 * (`credentials_enc`), tidak pernah dikirim ke client. Stok yang disinkronkan = stok tersedia cabang sumber − buffer.
 */
export const marketplaceConnections = pgTable(
  "marketplace_connections",
  {
    id: id(),
    /** Kode adapter: "shopee" | "mock". */
    provider: text("provider").notNull(),
    channel: salesChannel("channel").notNull(),
    name: text("name").notNull(),
    externalShopId: text("external_shop_id").notNull(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    status: connectionStatus("status").notNull().default("ACTIVE"),
    pullOrders: boolean("pull_orders").notNull().default(true),
    pushStock: boolean("push_stock").notNull().default(true),
    /** Unit yang ditahan (tidak ditampilkan di marketplace) untuk mencegah oversell. */
    stockBuffer: integer("stock_buffer").notNull().default(0),
    credentialsEnc: text("credentials_enc"),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    /** Batas bawah penarikan order berikutnya (update_time terakhir yang sudah diproses). */
    ordersSyncedUntil: timestamp("orders_synced_until", { withTimezone: true }),
    /** Order yang gagal diimpor (barang belum dipetakan / stok kurang) — dicoba lagi tiap sinkron. */
    retryOrderNos: jsonb("retry_order_nos").$type<string[]>().notNull().default([]),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    index("marketplace_connections_branch_idx").on(t.branchId),uniqueIndex("marketplace_connections_shop_uq").on(t.provider, t.externalShopId)],
);

/** Produk/varian di marketplace dan pemetaannya ke varian Konten (otomatis lewat SKU, bisa diubah manual). */
export const marketplaceListings = pgTable(
  "marketplace_listings",
  {
    id: id(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => marketplaceConnections.id, { onDelete: "cascade" }),
    externalItemId: text("external_item_id").notNull(),
    /** "0" bila produk tanpa variasi. */
    externalModelId: text("external_model_id").notNull().default("0"),
    externalSku: text("external_sku"),
    name: text("name").notNull(),
    variantId: uuid("variant_id").references(() => productVariants.id, { onDelete: "set null" }),
    /** true = dipetakan manual (tidak ditimpa pemetaan otomatis). */
    manualMapping: boolean("manual_mapping").notNull().default(false),
    marketplaceStock: integer("marketplace_stock"),
    lastPushedQty: integer("last_pushed_qty"),
    lastPushedAt: timestamp("last_pushed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("marketplace_listings_uq").on(t.connectionId, t.externalItemId, t.externalModelId),
    index("marketplace_listings_variant_idx").on(t.variantId),
  ],
);

export const syncKind = pgEnum("marketplace_sync_kind", ["ORDERS", "STOCK", "LISTINGS", "WEBHOOK"]);
export const syncStatus = pgEnum("marketplace_sync_status", ["OK", "PARTIAL", "FAILED"]);

/** Jejak setiap sinkronisasi (untuk layar status & debugging). */
export const marketplaceSyncLogs = pgTable(
  "marketplace_sync_logs",
  {
    id: id(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => marketplaceConnections.id, { onDelete: "cascade" }),
    kind: syncKind("kind").notNull(),
    status: syncStatus("status").notNull(),
    /** Ringkasan angka: { imported, updated, skipped, pushed, unchanged, ... }. */
    stats: jsonb("stats").$type<Record<string, number>>().notNull().default({}),
    /** Masalah per baris, mis. order dengan barang belum dipetakan. */
    issues: jsonb("issues").$type<{ ref: string; message: string }[]>().notNull().default([]),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("marketplace_sync_logs_conn_idx").on(t.connectionId, t.startedAt.desc())],
);

/** Penyimpanan toko simulasi (provider "mock") — dipakai development/demo, tidak di production. */
export const mockMarketplaceOrders = pgTable(
  "mock_marketplace_orders",
  {
    orderSn: text("order_sn").primaryKey(),
    shopId: text("shop_id").notNull(),
    status: text("status").notNull(),
    payload: jsonb("payload").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("mock_marketplace_orders_shop_idx").on(t.shopId, t.updatedAt)],
);

