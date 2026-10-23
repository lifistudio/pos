import "server-only";
import { and, desc, eq, lt, or, type SQL } from "drizzle-orm";
import { db, type Tx } from "@/server/db";
import { auditLogs, user } from "@/server/db/schema";
import type { Actor } from "@/server/api/context";
import { decodeCursor, encodeCursor } from "@/server/api/pagination";

type AuditEntry = {
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
};

/** Catat mutasi. Bila `tx` diberikan, audit ikut commit/rollback bersama perubahan datanya. */
export async function writeAudit(actor: Actor | null, entry: AuditEntry, tx?: Tx) {
  await (tx ?? db).insert(auditLogs).values({
    actorId: actor?.userId ?? null,
    actorType: actor?.type ?? "SYSTEM",
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    ip: actor?.ip ?? null,
    userAgent: actor?.userAgent ?? null,
  });
}

export async function listAuditLogs(params: { entity?: string; actorId?: string; cursor?: string; limit: number }) {
  const filters: SQL[] = [];
  if (params.entity) filters.push(eq(auditLogs.entity, params.entity));
  if (params.actorId) filters.push(eq(auditLogs.actorId, params.actorId));
  const cursor = decodeCursor(params.cursor);
  if (cursor) {
    filters.push(
      or(
        lt(auditLogs.createdAt, new Date(cursor.t)),
        and(eq(auditLogs.createdAt, new Date(cursor.t)), lt(auditLogs.id, cursor.id)),
      )!,
    );
  }

  const rows = await db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      entity: auditLogs.entity,
      entityId: auditLogs.entityId,
      actorType: auditLogs.actorType,
      actorName: user.name,
      before: auditLogs.before,
      after: auditLogs.after,
      ip: auditLogs.ip,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .leftJoin(user, eq(user.id, auditLogs.actorId))
    .where(and(...filters))
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
    .limit(params.limit + 1);

  const hasMore = rows.length > params.limit;
  const data = hasMore ? rows.slice(0, params.limit) : rows;
  const last = data.at(-1);
  return { data, nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null };
}
