import "server-only";
import { createMiddleware } from "hono/factory";
import { auth } from "@/server/auth/auth";
import { env } from "@/server/env";
import { can, loadAccess } from "@/server/rbac/access";
import type { Permission } from "@/server/rbac/permissions";
import { verifyApiKey } from "@/server/services/api-key.service";
import { ACCESS_PREFIX, verifyAccessToken } from "@/server/services/oauth.service";
import type { AppEnv } from "./context";
import { ApiError, forbidden, unauthorized } from "./errors";
import { clientIp } from "./rate-limit";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const allowedOrigin = new URL(env.BETTER_AUTH_URL).origin;

function readApiKey(headers: Headers) {
  const explicit = headers.get("x-api-key");
  if (explicit) return explicit;
  const authz = headers.get("authorization");
  return authz?.startsWith("Bearer ") ? authz.slice(7) : null;
}

/**
 * Autentikasi: API key (header `x-api-key` / `Authorization: Bearer`) atau cookie sesi Better Auth.
 * Request mutasi berbasis cookie wajib dari origin aplikasi (proteksi CSRF selain SameSite).
 */
export const authenticate = createMiddleware<AppEnv>(async (c, next) => {
  const headers = c.req.raw.headers;
  const ip = clientIp(headers);
  const userAgent = headers.get("user-agent");

  const apiKey = readApiKey(headers);
  if (apiKey?.startsWith(ACCESS_PREFIX)) {
    const grant = await verifyAccessToken(apiKey);
    if (!grant) throw new ApiError(401, "INVALID_TOKEN", "Token akses tidak valid atau kedaluwarsa.");
    // Token OAuth = aplikasi AI: hanya membaca (GET) dan memanggil MCP, apa pun role pemilik akunnya.
    if (MUTATING.has(c.req.method) && !c.req.path.endsWith("/api/mcp")) throw new ApiError(403, "READ_ONLY_TOKEN", "Token aplikasi AI hanya boleh membaca data.");
    c.set("actor", {
      type: "OAUTH",
      userId: grant.userId,
      oauthTokenId: grant.id,
      oauthClientId: grant.clientId,
      user: { id: grant.userId, name: grant.name, email: grant.email },
      access: await loadAccess(grant.userId),
      ip,
      userAgent,
    });
    return next();
  }
  if (apiKey) {
    const owner = await verifyApiKey(apiKey);
    if (!owner) throw new ApiError(401, "INVALID_API_KEY", "API key tidak valid, kedaluwarsa, atau sudah dicabut.");
    c.set("actor", {
      type: "API_KEY",
      userId: owner.userId,
      apiKeyId: owner.id,
      user: { id: owner.userId, name: owner.name, email: owner.email },
      access: await loadAccess(owner.userId),
      ip,
      userAgent,
    });
    return next();
  }

  const session = await auth.api.getSession({ headers });
  if (!session) throw unauthorized();
  if (session.user.isActive === false) throw new ApiError(403, "ACCOUNT_DISABLED", "Akun Anda dinonaktifkan.");

  if (MUTATING.has(c.req.method)) {
    const origin = headers.get("origin");
    if (origin && origin !== allowedOrigin) throw new ApiError(403, "BAD_ORIGIN", "Permintaan ditolak.");
  }

  c.set("actor", {
    type: "USER",
    userId: session.user.id,
    user: { id: session.user.id, name: session.user.name, email: session.user.email },
    access: await loadAccess(session.user.id),
    ip,
    userAgent,
  });
  return next();
});

/** Otorisasi per route. Pengecekan cakupan cabang tetap dilakukan di service. */
export const requirePermission = (permission: Permission) =>
  createMiddleware<AppEnv>(async (c, next) => {
    if (!can(c.get("actor").access, permission)) throw forbidden(permission);
    return next();
  });
