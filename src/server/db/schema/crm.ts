import { sql } from "drizzle-orm";
import { bigint, boolean, check, date, index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { id, timestamps } from "./core";

const money = (name: string) => bigint(name, { mode: "number" });

// ── Membership ──────────────────────────────────────────────────────────

/** Tier member: naik otomatis berdasarkan total belanja seumur hidup (minSpend). */
export const membershipTiers = pgTable(
  "membership_tiers",
  {
    id: id(),
    name: text("name").notNull(),
    minSpend: money("min_spend").notNull().default(0),
    /** Diskon otomatis untuk member tier ini (basis poin, 500 = 5%). */
    discountBps: integer("discount_bps").notNull().default(0),
    /** Poin yang didapat per Rp10.000 belanja (setelah diskon). */
    pointsPer10k: integer("points_per_10k").notNull().default(1),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("membership_tiers_name_uq").on(t.name),
    uniqueIndex("membership_tiers_name_lower_uq").on(sql`lower(${t.name})`),
    check("membership_tiers_discount_range", sql`${t.discountBps} between 0 and 10000`),
  ],
);

// ── Customer ────────────────────────────────────────────────────────────

export const customers = pgTable(
  "customers",
  {
    id: id(),
    name: text("name").notNull(),
    /** Format 62xxxxxxxx (dinormalisasi di service) — kunci utama identifikasi di kasir. */
    phone: text("phone").notNull(),
    email: text("email"),
    birthDate: date("birth_date"),
    notes: text("notes"),
    isMember: boolean("is_member").notNull().default(false),
    memberNo: text("member_no"),
    tierId: uuid("tier_id").references(() => membershipTiers.id, { onDelete: "set null" }),
    points: integer("points").notNull().default(0),
    totalSpent: money("total_spent").notNull().default(0),
    visitCount: integer("visit_count").notNull().default(0),
    lastVisitAt: timestamp("last_visit_at", { withTimezone: true }),
    /** Persetujuan pemrosesan data pribadi (UU PDP). */
    consentAt: timestamp("consent_at", { withTimezone: true }),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("customers_phone_uq").on(t.phone),
    uniqueIndex("customers_member_no_uq").on(t.memberNo),
    index("customers_name_trgm_idx").using("gin", sql`${t.name} gin_trgm_ops`),
    index("customers_tier_idx").on(t.tierId),
    check("customers_points_nonneg", sql`${t.points} >= 0`),
  ],
);

export const pointLedgerType = pgEnum("point_ledger_type", ["EARN", "REVERSE", "ADJUST", "REDEEM", "REFUND"]);

/** Ledger poin (pola sama dengan stok): saldo di `customers.points` hanya berubah bersama baris ini. */
export const pointLedger = pgTable(
  "point_ledger",
  {
    id: id(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    type: pointLedgerType("type").notNull(),
    change: integer("change").notNull(),
    balanceAfter: integer("balance_after").notNull(),
    saleId: uuid("sale_id"),
    reason: text("reason"),
    createdAt: timestamps.createdAt,
  },
  (t) => [index("point_ledger_customer_idx").on(t.customerId, t.createdAt.desc())],
);

// ── Voucher ─────────────────────────────────────────────────────────────

export const voucherValueType = pgEnum("voucher_value_type", ["NOMINAL", "PERCENT"]);
export const voucherStatus = pgEnum("voucher_status", ["ACTIVE", "PAUSED"]);
export const voucherProductScope = pgEnum("voucher_product_scope", ["ALL", "CATEGORY", "PRODUCT", "VARIANT"]);
export const voucherCustomerScope = pgEnum("voucher_customer_scope", ["ALL", "MEMBER", "TIER", "CUSTOMER"]);
export const voucherTargetType = pgEnum("voucher_target_type", ["CATEGORY", "PRODUCT", "VARIANT", "TIER", "CUSTOMER", "BRANCH"]);

export const vouchers = pgTable(
  "vouchers",
  {
    id: id(),
    /** Disimpan huruf besar; pencocokan tidak peka huruf. */
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    valueType: voucherValueType("value_type").notNull(),
    /** NOMINAL: rupiah. PERCENT: basis poin (1500 = 15%). */
    value: integer("value").notNull(),
    /** Batas potongan untuk tipe persen (rupiah). */
    maxDiscount: money("max_discount"),
    minSpend: money("min_spend").notNull().default(0),
    maxSpend: money("max_spend"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    /** null = tanpa batas. */
    quotaTotal: integer("quota_total"),
    quotaUsed: integer("quota_used").notNull().default(0),
    quotaPerCustomer: integer("quota_per_customer"),
    productScope: voucherProductScope("product_scope").notNull().default("ALL"),
    customerScope: voucherCustomerScope("customer_scope").notNull().default("ALL"),
    status: voucherStatus("status").notNull().default("ACTIVE"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("vouchers_code_uq").on(t.code),
    index("vouchers_status_idx").on(t.status, t.startsAt),
    check("vouchers_value_pos", sql`${t.value} > 0`),
    check("vouchers_percent_range", sql`${t.valueType} <> 'PERCENT' or ${t.value} <= 10000`),
    check("vouchers_quota_valid", sql`${t.quotaTotal} is null or ${t.quotaUsed} <= ${t.quotaTotal}`),
  ],
);

/** Target voucher: produk (kategori/produk/varian, bisa pengecualian), customer/tier, dan cabang. */
export const voucherTargets = pgTable(
  "voucher_targets",
  {
    id: id(),
    voucherId: uuid("voucher_id")
      .notNull()
      .references(() => vouchers.id, { onDelete: "cascade" }),
    type: voucherTargetType("type").notNull(),
    targetId: uuid("target_id").notNull(),
    isExclusion: boolean("is_exclusion").notNull().default(false),
  },
  (t) => [index("voucher_targets_voucher_idx").on(t.voucherId), uniqueIndex("voucher_targets_uq").on(t.voucherId, t.type, t.targetId, t.isExclusion)],
);

export const voucherUsageStatus = pgEnum("voucher_usage_status", ["APPLIED", "REVERSED"]);

export const voucherUsages = pgTable(
  "voucher_usages",
  {
    id: id(),
    voucherId: uuid("voucher_id")
      .notNull()
      .references(() => vouchers.id, { onDelete: "restrict" }),
    saleId: uuid("sale_id").notNull(),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    discount: money("discount").notNull(),
    /** Omzet transaksi (total akhir) untuk analisis performa voucher. */
    saleTotal: money("sale_total").notNull(),
    status: voucherUsageStatus("status").notNull().default("APPLIED"),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    index("voucher_usages_customer_only_idx").on(t.customerId),
    uniqueIndex("voucher_usages_sale_uq").on(t.saleId),
    index("voucher_usages_voucher_idx").on(t.voucherId, t.createdAt.desc()),
    index("voucher_usages_customer_idx").on(t.voucherId, t.customerId),
  ],
);
