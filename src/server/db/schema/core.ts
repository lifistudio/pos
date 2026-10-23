import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

/** PK uuid v7 (urut waktu) — fungsi bawaan PostgreSQL 18. */
export const id = () => uuid("id").primaryKey().default(sql`uuidv7()`);
export const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const branchType = pgEnum("branch_type", ["STORE", "WAREHOUSE", "ONLINE"]);

export const branches = pgTable(
  "branches",
  {
    id: id(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    type: branchType("type").notNull().default("STORE"),
    address: text("address"),
    phone: text("phone"),
    timezone: text("timezone").notNull().default("Asia/Jakarta"),
    settings: jsonb("settings").$type<BranchSettings>().notNull().default({}),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex("branches_code_uq").on(t.code)],
);

export type BranchSettings = {
  taxEnabled?: boolean;
  taxRateBps?: number;
  taxInclusive?: boolean;
  receiptHeader?: string;
  receiptFooter?: string;
};

// ── RBAC ────────────────────────────────────────────────────────────────
// Katalog permission ada di kode (src/server/rbac/permissions.ts); DB menyimpan string `resource:action`.

export const roles = pgTable(
  "roles",
  {
    id: id(),
    name: text("name").notNull(),
    description: text("description"),
    isSystem: boolean("is_system").notNull().default(false),
    ...timestamps,
  },
  (t) => [uniqueIndex("roles_name_uq").on(t.name), uniqueIndex("roles_name_lower_uq").on(sql`lower(${t.name})`)],
);

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permission: text("permission").notNull(),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permission] })],
);

/** branchId NULL = role berlaku di semua cabang. */
export const userRoleAssignments = pgTable(
  "user_role_assignments",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "restrict" }),
    branchId: uuid("branch_id").references(() => branches.id, { onDelete: "cascade" }),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    index("user_role_assignments_branch_idx").on(t.branchId),
    index("ura_user_idx").on(t.userId),
    index("ura_role_idx").on(t.roleId),
    unique("ura_user_role_branch_uq").on(t.userId, t.roleId, t.branchId).nullsNotDistinct(),
  ],
);

// ── API key (integrasi & MCP) ───────────────────────────────────────────

export const apiKeys = pgTable(
  "api_keys",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** 8 karakter awal untuk identifikasi di UI; key penuh tidak pernah disimpan. */
    prefix: text("prefix").notNull(),
    keyHash: text("key_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamps.createdAt,
  },
  (t) => [uniqueIndex("api_keys_hash_uq").on(t.keyHash), index("api_keys_user_idx").on(t.userId)],
);

// ── Audit log ───────────────────────────────────────────────────────────

export const auditActorType = pgEnum("audit_actor_type", ["USER", "API_KEY", "OAUTH", "SYSTEM"]);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    actorId: text("actor_id"),
    actorType: auditActorType("actor_type").notNull(),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    index("audit_logs_created_idx").on(t.createdAt.desc()),
    index("audit_logs_entity_idx").on(t.entity, t.entityId),
    index("audit_logs_actor_idx").on(t.actorId),
  ],
);

/** Pengaturan tingkat toko (berlaku semua cabang), satu baris per kunci. Nilai divalidasi Zod di service. */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** PIN persetujuan (mis. kepala toko) — hash scrypt + salt per user, terpisah dari tabel milik Better Auth. */
export const approvalPins = pgTable("approval_pins", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  pinHash: text("pin_hash").notNull(),
  salt: text("salt").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Izin sekali pakai hasil PIN atasan: kasir tanpa permission X boleh menjalankan satu aksi X
 * di cabang tertentu sebelum `expires_at`. Dipakai (used_at) di dalam transaksi aksinya.
 */
export const approvalGrants = pgTable(
  "approval_grants",
  {
    id: id(),
    permission: text("permission").notNull(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    requestedBy: text("requested_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    approvedBy: text("approved_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    usedFor: text("used_for"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("approval_grants_branch_idx").on(t.branchId),index("approval_grants_requester_idx").on(t.requestedBy, t.createdAt.desc())],
);

/** Kanal penjualan online (order online & marketplace). */
export const salesChannel = pgEnum("sales_channel", ["WEBSITE", "WHATSAPP", "INSTAGRAM", "SHOPEE", "TOKOPEDIA", "TIKTOK", "LAZADA", "OTHER"]);
