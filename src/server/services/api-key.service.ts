import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNull, or } from "drizzle-orm";
import { db } from "@/server/db";
import { apiKeys, user } from "@/server/db/schema";
import type { Actor } from "@/server/api/context";
import { notFound } from "@/server/api/errors";
import { writeAudit } from "./audit.service";

const KEY_PREFIX = "pos_";

function hashKey(key: string) {
  return createHash("sha256").update(key).digest("hex");
}

/** Key berentropi tinggi (256 bit), jadi SHA-256 cukup — tidak perlu hash lambat. */
export async function createApiKey(actor: Actor, input: { name: string; expiresInDays?: number }) {
  const key = KEY_PREFIX + randomBytes(32).toString("base64url");
  const expiresAt = input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86_400_000) : null;
  const [row] = await db
    .insert(apiKeys)
    .values({ userId: actor.userId, name: input.name, prefix: key.slice(0, 12), keyHash: hashKey(key), expiresAt })
    .returning({ id: apiKeys.id, name: apiKeys.name, prefix: apiKeys.prefix, expiresAt: apiKeys.expiresAt, createdAt: apiKeys.createdAt });
  await writeAudit(actor, { action: "create", entity: "api_key", entityId: row.id, after: { name: row.name } });
  // Key penuh hanya dikembalikan sekali.
  return { ...row, key };
}

export async function listApiKeys(actor: Actor) {
  return db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      prefix: apiKeys.prefix,
      expiresAt: apiKeys.expiresAt,
      lastUsedAt: apiKeys.lastUsedAt,
      revokedAt: apiKeys.revokedAt,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.userId, actor.userId))
    .orderBy(desc(apiKeys.createdAt));
}

export async function revokeApiKey(actor: Actor, id: string) {
  const [row] = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, actor.userId), isNull(apiKeys.revokedAt)))
    .returning({ id: apiKeys.id });
  if (!row) throw notFound("API key");
  await writeAudit(actor, { action: "revoke", entity: "api_key", entityId: id });
}

/** Dipakai middleware auth. Mengembalikan pemilik key bila valid & aktif. */
export async function verifyApiKey(key: string) {
  if (!key.startsWith(KEY_PREFIX)) return null;
  const now = new Date();
  const [row] = await db
    .select({ id: apiKeys.id, userId: user.id, name: user.name, email: user.email, isActive: user.isActive })
    .from(apiKeys)
    .innerJoin(user, eq(user.id, apiKeys.userId))
    .where(
      and(
        eq(apiKeys.keyHash, hashKey(key)),
        isNull(apiKeys.revokedAt),
        or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, now)),
      ),
    )
    .limit(1);
  if (!row || !row.isActive) return null;
  // Tidak perlu ditunggu; kegagalan update last_used tidak boleh menggagalkan request.
  void db.update(apiKeys).set({ lastUsedAt: now }).where(eq(apiKeys.id, row.id)).catch(() => {});
  return row;
}
