import "server-only";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gt, isNull, max, min, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { oauthClients, oauthCodes, oauthTokens, user } from "@/server/db/schema";
import type { Actor } from "@/server/api/context";
import { forbidden, notFound } from "@/server/api/errors";
import { env } from "@/server/env";
import { validRedirectUri } from "@/lib/oauth-redirect";
import { writeAudit } from "./audit.service";

/**
 * Authorization server OAuth 2.1 kecil untuk MCP (spesifikasi otorisasi MCP): metadata RFC 8414/9728, Dynamic Client
 * Registration (RFC 7591), authorization code + PKCE S256 wajib, refresh token dirotasi dengan deteksi pemakaian ulang.
 * Token hanya-baca (lihat middleware): AI agent tidak bisa mengubah data walau pemilik akunnya Owner.
 */

export const OAUTH_SCOPE = "mcp:read";
const ACCESS_TTL_S = 3600;
const REFRESH_TTL_S = 30 * 86_400;
const CODE_TTL_S = 300;
export const ACCESS_PREFIX = "pos_oat_";
const REFRESH_PREFIX = "pos_ort_";
const CODE_PREFIX = "pos_oac_";

export const issuer = () => new URL(env.BETTER_AUTH_URL).origin;
export const mcpResource = () => `${issuer()}/api/mcp`;

const hash = (v: string) => createHash("sha256").update(v).digest("hex");
const token = (prefix: string) => prefix + randomBytes(32).toString("base64url");

/** Kesalahan format RFC 6749 §5.2 (`error`, `error_description`). */
export class OAuthError extends Error {
  constructor(
    readonly error: string,
    readonly description: string,
    readonly status: 400 | 401 = 400,
  ) {
    super(description);
  }
}

// ── Metadata ────────────────────────────────────────────────────────────

export function authorizationServerMetadata() {
  const base = issuer();
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/api/oauth/token`,
    registration_endpoint: `${base}/api/oauth/register`,
    revocation_endpoint: `${base}/api/oauth/revoke`,
    scopes_supported: [OAUTH_SCOPE],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    service_documentation: `${base}/panduan/mcp`,
  };
}

export function protectedResourceMetadata() {
  return {
    resource: mcpResource(),
    authorization_servers: [issuer()],
    scopes_supported: [OAUTH_SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "Konten POS (MCP, hanya-baca)",
    resource_documentation: `${issuer()}/panduan/mcp`,
  };
}

// ── Pendaftaran klien (RFC 7591) ───────────────────────────────────────

export async function registerClient(input: { client_name?: string; redirect_uris?: unknown; token_endpoint_auth_method?: string; grant_types?: unknown; response_types?: unknown }) {
  const uris = Array.isArray(input.redirect_uris) ? input.redirect_uris.filter((u): u is string => typeof u === "string") : [];
  if (!uris.length || uris.length > 10 || uris.length !== (input.redirect_uris as unknown[]).length) {
    throw new OAuthError("invalid_redirect_uri", "redirect_uris wajib berisi 1–10 URL.");
  }
  const bad = uris.find((u) => !validRedirectUri(u));
  if (bad) throw new OAuthError("invalid_redirect_uri", `redirect_uri tidak diizinkan: ${bad.slice(0, 100)}`);
  const method = input.token_endpoint_auth_method ?? "none";
  if (!["none", "client_secret_post", "client_secret_basic"].includes(method)) {
    throw new OAuthError("invalid_client_metadata", "token_endpoint_auth_method tidak didukung.");
  }
  const grants = Array.isArray(input.grant_types) ? input.grant_types : ["authorization_code", "refresh_token"];
  if (grants.some((g) => g !== "authorization_code" && g !== "refresh_token")) throw new OAuthError("invalid_client_metadata", "grant_types tidak didukung.");
  const responses = Array.isArray(input.response_types) ? input.response_types : ["code"];
  if (responses.some((r) => r !== "code")) throw new OAuthError("invalid_client_metadata", "response_types tidak didukung.");

  // Nama dari klien tidak tepercaya: dirapikan & dibatasi; di layar persetujuan selalu ditampilkan bersama alamat tujuannya.
  const name = (typeof input.client_name === "string" ? input.client_name : "").replace(/[\p{C}<>]/gu, "").trim().slice(0, 80) || "Aplikasi AI";
  const clientId = `kpc_${randomBytes(16).toString("base64url")}`;
  const secret = method === "none" ? null : token("pos_ocs_");
  await db.insert(oauthClients).values({ id: clientId, name, redirectUris: uris, authMethod: method, secretHash: secret ? hash(secret) : null });
  return {
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: name,
    redirect_uris: uris,
    token_endpoint_auth_method: method,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    scope: OAUTH_SCOPE,
    ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
  };
}

// ── Otorisasi (layar persetujuan) ──────────────────────────────────────

export type AuthorizeParams = {
  response_type: string;
  client_id: string;
  redirect_uri?: string;
  code_challenge?: string;
  code_challenge_method?: string;
  scope?: string;
  state?: string;
  resource?: string;
};

/** Validasi permintaan otorisasi. Kesalahan sebelum redirect_uri terpercaya → ditampilkan, bukan di-redirect (RFC 6749 §4.1.2.1). */
async function checkAuthorize(p: AuthorizeParams) {
  const [client] = await db.select().from(oauthClients).where(eq(oauthClients.id, p.client_id)).limit(1);
  if (!client) throw new OAuthError("invalid_client", "Aplikasi tidak dikenal. Hubungkan ulang dari aplikasi AI Anda.");
  const redirectUri = p.redirect_uri ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : "");
  if (!client.redirectUris.includes(redirectUri)) throw new OAuthError("invalid_request", "Alamat kembali (redirect_uri) tidak terdaftar untuk aplikasi ini.");
  // Setelah redirect_uri valid, kesalahan lain dikembalikan ke aplikasi lewat redirect.
  let error: { error: string; description: string } | null = null;
  if (p.response_type !== "code") error = { error: "unsupported_response_type", description: "Hanya response_type=code." };
  else if (!p.code_challenge || p.code_challenge_method !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(p.code_challenge)) {
    error = { error: "invalid_request", description: "PKCE S256 wajib (code_challenge)." };
  } else if (p.scope && p.scope.split(" ").some((s) => s && s !== OAUTH_SCOPE)) error = { error: "invalid_scope", description: `Scope yang tersedia: ${OAUTH_SCOPE}.` };
  else if (p.resource && p.resource.replace(/\/$/, "") !== mcpResource() && p.resource.replace(/\/$/, "") !== issuer()) {
    error = { error: "invalid_target", description: "resource bukan server MCP ini." };
  }
  return { client, redirectUri, error };
}

const withParams = (uri: string, params: Record<string, string | undefined>) => {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, v);
  u.searchParams.set("iss", issuer());
  return u.toString();
};

export async function describeAuthorization(actor: Actor, p: AuthorizeParams) {
  if (actor.type !== "USER") throw forbidden("Persetujuan hanya dari sesi login.");
  const { client, redirectUri, error } = await checkAuthorize(p);
  const target = new URL(redirectUri);
  return {
    client: { id: client.id, name: client.name, redirectHost: target.protocol === "https:" || target.protocol === "http:" ? target.host : target.protocol.replace(/:$/, "") },
    scope: OAUTH_SCOPE,
    error: error ? { ...error, redirectTo: withParams(redirectUri, { error: error.error, error_description: error.description, state: p.state }) } : null,
    account: { name: actor.user.name, email: actor.user.email },
  };
}

export async function decideAuthorization(actor: Actor, p: AuthorizeParams, approve: boolean) {
  if (actor.type !== "USER") throw forbidden("Persetujuan hanya dari sesi login.");
  const { client, redirectUri, error } = await checkAuthorize(p);
  if (error) return { redirectTo: withParams(redirectUri, { error: error.error, error_description: error.description, state: p.state }) };
  if (!approve) return { redirectTo: withParams(redirectUri, { error: "access_denied", error_description: "Pengguna menolak akses.", state: p.state }) };
  const code = token(CODE_PREFIX);
  await db.insert(oauthCodes).values({
    codeHash: hash(code),
    clientId: client.id,
    userId: actor.userId,
    redirectUri,
    codeChallenge: p.code_challenge!,
    scope: OAUTH_SCOPE,
    resource: p.resource ?? null,
    expiresAt: new Date(Date.now() + CODE_TTL_S * 1000),
  });
  await writeAudit(actor, { action: "authorize", entity: "oauth_client", entityId: client.id, after: { name: client.name, redirectUri } });
  return { redirectTo: withParams(redirectUri, { code, state: p.state }) };
}

// ── Token endpoint ──────────────────────────────────────────────────────

const safeEq = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

async function authenticateClient(form: Record<string, string>, basic: { id: string; secret: string } | null) {
  const clientId = basic?.id ?? form.client_id;
  if (!clientId) throw new OAuthError("invalid_client", "client_id wajib.", 401);
  const [client] = await db.select().from(oauthClients).where(eq(oauthClients.id, clientId)).limit(1);
  if (!client) throw new OAuthError("invalid_client", "Klien tidak dikenal.", 401);
  if (client.authMethod !== "none") {
    const secret = basic?.secret ?? form.client_secret;
    if (!secret || !client.secretHash || !safeEq(hash(secret), client.secretHash)) throw new OAuthError("invalid_client", "Autentikasi klien gagal.", 401);
  }
  return client;
}

async function issueTokens(tx: Pick<typeof db, "insert">, clientId: string, userId: string, familyId: string) {
  const access = token(ACCESS_PREFIX);
  const refresh = token(REFRESH_PREFIX);
  const now = Date.now();
  await tx.insert(oauthTokens).values({
    familyId,
    clientId,
    userId,
    scope: OAUTH_SCOPE,
    accessHash: hash(access),
    refreshHash: hash(refresh),
    accessExpiresAt: new Date(now + ACCESS_TTL_S * 1000),
    refreshExpiresAt: new Date(now + REFRESH_TTL_S * 1000),
  });
  return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: OAUTH_SCOPE };
}

const pkceOk = (verifier: string | undefined, challenge: string) =>
  !!verifier && /^[A-Za-z0-9\-._~]{43,128}$/.test(verifier) && safeEq(createHash("sha256").update(verifier).digest("base64url"), challenge);

type Issued = Awaited<ReturnType<typeof issueTokens>>;
async function settle(p: Promise<Issued | { reject: OAuthError }>) {
  const r = await p;
  if ("reject" in r) throw r.reject;
  return r;
}

export async function exchangeToken(form: Record<string, string>, basic: { id: string; secret: string } | null) {
  const client = await authenticateClient(form, basic);

  if (form.grant_type === "authorization_code") {
    if (!form.code) throw new OAuthError("invalid_request", "code wajib.");
    return settle(db.transaction(async (tx) => {
      // Kunci baris kode: dua penukaran bersamaan → hanya satu yang berhasil.
      const [row] = await tx.select().from(oauthCodes).where(eq(oauthCodes.codeHash, hash(form.code))).for("update").limit(1);
      if (!row || row.clientId !== client.id) throw new OAuthError("invalid_grant", "Kode tidak valid.");
      if (row.usedAt) {
        // Kode dipakai dua kali → kemungkinan bocor: cabut token yang pernah diterbitkan dari kode ini.
        const issuedAt = new Date(row.expiresAt.getTime() - CODE_TTL_S * 1000);
        await tx
          .update(oauthTokens)
          .set({ revokedAt: new Date() })
          .where(and(eq(oauthTokens.clientId, row.clientId), eq(oauthTokens.userId, row.userId), isNull(oauthTokens.revokedAt), gt(oauthTokens.createdAt, issuedAt)));
        return { reject: new OAuthError("invalid_grant", "Kode sudah dipakai.") }; // dikembalikan (bukan dilempar) agar pencabutan ter-commit
      }
      if (row.expiresAt < new Date()) throw new OAuthError("invalid_grant", "Kode kedaluwarsa. Ulangi login dari aplikasi AI.");
      if ((form.redirect_uri ?? row.redirectUri) !== row.redirectUri) throw new OAuthError("invalid_grant", "redirect_uri tidak cocok.");
      if (!pkceOk(form.code_verifier, row.codeChallenge)) throw new OAuthError("invalid_grant", "code_verifier tidak cocok (PKCE).");
      const [owner] = await tx.select({ isActive: user.isActive }).from(user).where(eq(user.id, row.userId)).limit(1);
      if (!owner?.isActive) throw new OAuthError("invalid_grant", "Akun dinonaktifkan.");
      await tx.update(oauthCodes).set({ usedAt: new Date() }).where(eq(oauthCodes.codeHash, row.codeHash));
      return issueTokens(tx, client.id, row.userId, randomUUID());
    }));
  }

  if (form.grant_type === "refresh_token") {
    if (!form.refresh_token) throw new OAuthError("invalid_request", "refresh_token wajib.");
    return settle(db.transaction(async (tx) => {
      const [row] = await tx.select().from(oauthTokens).where(eq(oauthTokens.refreshHash, hash(form.refresh_token))).for("update").limit(1);
      if (!row || row.clientId !== client.id) throw new OAuthError("invalid_grant", "Refresh token tidak valid.");
      if (row.rotatedAt || row.revokedAt) {
        // Refresh token lama dipakai lagi → dicuri atau bocor: cabut seluruh keluarga token.
        if (row.rotatedAt) await tx.update(oauthTokens).set({ revokedAt: new Date() }).where(and(eq(oauthTokens.familyId, row.familyId), isNull(oauthTokens.revokedAt)));
        return { reject: new OAuthError("invalid_grant", "Refresh token sudah tidak berlaku. Hubungkan ulang aplikasi.") };
      }
      if (row.refreshExpiresAt < new Date()) throw new OAuthError("invalid_grant", "Sesi aplikasi kedaluwarsa. Hubungkan ulang.");
      const [owner] = await tx.select({ isActive: user.isActive }).from(user).where(eq(user.id, row.userId)).limit(1);
      if (!owner?.isActive) throw new OAuthError("invalid_grant", "Akun dinonaktifkan.");
      await tx.update(oauthTokens).set({ rotatedAt: new Date() }).where(eq(oauthTokens.id, row.id));
      return issueTokens(tx, client.id, row.userId, row.familyId);
    }));
  }

  throw new OAuthError("unsupported_grant_type", "grant_type tidak didukung.");
}

/** RFC 7009: cabut access/refresh token; selalu 200 (tidak membocorkan apakah token ada). */
export async function revokeToken(form: Record<string, string>, basic: { id: string; secret: string } | null) {
  const client = await authenticateClient(form, basic);
  if (!form.token) return;
  const h = hash(form.token);
  const [row] = await db
    .select({ familyId: oauthTokens.familyId, clientId: oauthTokens.clientId })
    .from(oauthTokens)
    .where(sql`${oauthTokens.accessHash} = ${h} or ${oauthTokens.refreshHash} = ${h}`)
    .limit(1);
  if (row && row.clientId === client.id) await db.update(oauthTokens).set({ revokedAt: new Date() }).where(and(eq(oauthTokens.familyId, row.familyId), isNull(oauthTokens.revokedAt)));
}

/** Dipakai middleware auth. */
export async function verifyAccessToken(value: string) {
  if (!value.startsWith(ACCESS_PREFIX)) return null;
  const now = new Date();
  const [row] = await db
    .select({ id: oauthTokens.id, clientId: oauthTokens.clientId, userId: user.id, name: user.name, email: user.email, isActive: user.isActive })
    .from(oauthTokens)
    .innerJoin(user, eq(user.id, oauthTokens.userId))
    .where(and(eq(oauthTokens.accessHash, hash(value)), isNull(oauthTokens.revokedAt), isNull(oauthTokens.rotatedAt), gt(oauthTokens.accessExpiresAt, now)))
    .limit(1);
  if (!row || !row.isActive) return null;
  void db.update(oauthTokens).set({ lastUsedAt: now }).where(eq(oauthTokens.id, row.id)).catch(() => {});
  return row;
}

// ── Aplikasi terhubung (Pengaturan) ────────────────────────────────────

export async function listConnectedApps(actor: Actor) {
  const active = and(eq(oauthTokens.userId, actor.userId), isNull(oauthTokens.revokedAt), isNull(oauthTokens.rotatedAt), gt(oauthTokens.refreshExpiresAt, new Date()));
  return db
    .select({
      clientId: oauthClients.id,
      name: oauthClients.name,
      redirectUris: oauthClients.redirectUris,
      connectedAt: min(oauthTokens.createdAt),
      lastUsedAt: max(oauthTokens.lastUsedAt),
    })
    .from(oauthTokens)
    .innerJoin(oauthClients, eq(oauthClients.id, oauthTokens.clientId))
    .where(active)
    .groupBy(oauthClients.id)
    .orderBy(desc(max(oauthTokens.createdAt)))
    .limit(100);
}

export async function disconnectApp(actor: Actor, clientId: string) {
  if (actor.type !== "USER") throw forbidden("Hanya dari sesi login.");
  const rows = await db
    .update(oauthTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(oauthTokens.userId, actor.userId), eq(oauthTokens.clientId, clientId), isNull(oauthTokens.revokedAt)))
    .returning({ id: oauthTokens.id });
  if (!rows.length) throw notFound("Aplikasi terhubung");
  await writeAudit(actor, { action: "revoke", entity: "oauth_client", entityId: clientId });
}
