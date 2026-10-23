import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { id } from "./core";

/**
 * OAuth 2.1 untuk MCP (Claude, ChatGPT, dll. login dengan akun Konten POS). Klien mendaftar sendiri
 * (Dynamic Client Registration), PKCE S256 wajib, token disimpan sebagai hash SHA-256 (seperti API key).
 */
export const oauthClients = pgTable("oauth_clients", {
  /** client_id publik (acak). */
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  redirectUris: text("redirect_uris").array().notNull(),
  /** "none" (klien publik + PKCE) atau "client_secret_post"/"client_secret_basic". */
  authMethod: text("auth_method").notNull().default("none"),
  secretHash: text("secret_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Kode otorisasi sekali pakai (berlaku 5 menit). */
export const oauthCodes = pgTable(
  "oauth_codes",
  {
    codeHash: text("code_hash").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    redirectUri: text("redirect_uri").notNull(),
    codeChallenge: text("code_challenge").notNull(),
    scope: text("scope").notNull(),
    resource: text("resource"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
  (t) => [index("oauth_codes_client_idx").on(t.clientId), index("oauth_codes_user_idx").on(t.userId)],
);

/**
 * Satu baris = sepasang access + refresh token. Refresh dirotasi: baris lama dicabut (`rotatedAt`), baris baru dibuat
 * dengan `familyId` sama. Refresh token lama dipakai lagi → seluruh keluarga dicabut (deteksi pencurian token).
 */
export const oauthTokens = pgTable(
  "oauth_tokens",
  {
    id: id(),
    familyId: uuid("family_id").notNull(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    scope: text("scope").notNull(),
    accessHash: text("access_hash").notNull(),
    refreshHash: text("refresh_hash").notNull(),
    accessExpiresAt: timestamp("access_expires_at", { withTimezone: true }).notNull(),
    refreshExpiresAt: timestamp("refresh_expires_at", { withTimezone: true }).notNull(),
    rotatedAt: timestamp("rotated_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("oauth_tokens_access_uq").on(t.accessHash),
    uniqueIndex("oauth_tokens_refresh_uq").on(t.refreshHash),
    index("oauth_tokens_user_client_idx").on(t.userId, t.clientId),
    index("oauth_tokens_family_idx").on(t.familyId),
    index("oauth_tokens_client_idx").on(t.clientId),
    check("oauth_tokens_expiry", sql`${t.refreshExpiresAt} >= ${t.accessExpiresAt}`),
  ],
);
