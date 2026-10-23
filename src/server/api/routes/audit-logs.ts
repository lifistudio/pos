import { createRoute, z } from "@hono/zod-openapi";
import { listAuditLogs } from "@/server/services/audit.service";
import { requirePermission } from "../middleware";
import { cursorQuery } from "../pagination";
import { createRouter } from "../router";
import { errorResponses, json, serialize } from "../schemas";

const auditSchema = z
  .object({
    id: z.string(),
    action: z.string(),
    entity: z.string(),
    entityId: z.string().nullable(),
    actorType: z.string(),
    actorName: z.string().nullable(),
    before: z.unknown(),
    after: z.unknown(),
    ip: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi("AuditLog");

export const auditRoutes = createRouter().openapi(
  createRoute({
    method: "get",
    path: "/audit-logs",
    tags: ["Audit log"],
    summary: "Riwayat perubahan data (read-only)",
    middleware: [requirePermission("audit_log:read")] as const,
    request: { query: cursorQuery.extend({ entity: z.string().max(40).optional(), actorId: z.string().max(64).optional() }) },
    responses: { 200: json(z.object({ data: z.array(auditSchema), nextCursor: z.string().nullable() })), ...errorResponses },
  }),
  async (c) => c.json(serialize(await listAuditLogs(c.req.valid("query"))), 200),
);
