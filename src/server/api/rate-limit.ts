import "server-only";
import { createMiddleware } from "hono/factory";
import { ApiError } from "./errors";
import type { AppEnv } from "./context";

/**
 * Rate limit jendela tetap, di memori proses. Cukup untuk satu instance (VPS/container tunggal);
 * untuk banyak instance, tempatkan rate limit juga di reverse proxy/CDN (lihat docs/PANDUAN-DEPLOY.md).
 */
type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
let lastSweep = Date.now();

function hit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  if (now - lastSweep > 60_000) {
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    lastSweep = now;
  }
  let b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + windowMs };
    buckets.set(key, b);
  }
  b.count++;
  return { allowed: b.count <= limit, retryAfter: Math.ceil((b.resetAt - now) / 1000), remaining: Math.max(0, limit - b.count) };
}

export const clientIp = (headers: Headers) => headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "unknown";

/**
 * `by: "actor"` → kunci per pengguna/API key (dipasang setelah autentikasi), `by: "ip"` → endpoint publik.
 */
export const rateLimit = (name: string, limit: number, windowMs = 60_000, by: "actor" | "ip" = "actor") =>
  createMiddleware<AppEnv>(async (c, next) => {
    const actor = by === "actor" ? c.get("actor") : undefined;
    const who = actor ? (actor.type === "API_KEY" ? `key:${actor.apiKeyId}` : actor.type === "OAUTH" ? `oauth:${actor.oauthClientId}:${actor.userId}` : `user:${actor.userId}`) : `ip:${clientIp(c.req.raw.headers)}`;
    const r = hit(`${name}:${who}`, limit, windowMs);
    c.header("RateLimit-Limit", String(limit));
    c.header("RateLimit-Remaining", String(r.remaining));
    if (!r.allowed) {
      c.header("Retry-After", String(r.retryAfter));
      throw new ApiError(429, "RATE_LIMITED", `Terlalu banyak permintaan. Coba lagi dalam ${r.retryAfter} detik.`);
    }
    return next();
  });
