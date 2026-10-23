import { createRoute, z } from "@hono/zod-openapi";
import { createApiKey, listApiKeys, revokeApiKey } from "@/server/services/api-key.service";
import { forbidden } from "../errors";
import { requirePermission } from "../middleware";
import { createRouter } from "../router";
import { body, dataOf, errorResponses, idParam, json, serialize } from "../schemas";

const apiKeySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    prefix: z.string(),
    expiresAt: z.string().nullable(),
    lastUsedAt: z.string().nullable(),
    revokedAt: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi("ApiKey");

export const apiKeyRoutes = createRouter()
  .openapi(
    createRoute({
      method: "get",
      path: "/api-keys",
      tags: ["API key"],
      summary: "API key milik pengguna yang sedang login",
      middleware: [requirePermission("api_key:read")] as const,
      responses: { 200: json(dataOf(z.array(apiKeySchema))), ...errorResponses },
    }),
    async (c) => c.json({ data: serialize(await listApiKeys(c.get("actor"))) }, 200),
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/api-keys",
      tags: ["API key"],
      summary: "Buat API key (untuk MCP/integrasi). Key penuh hanya ditampilkan sekali.",
      middleware: [requirePermission("api_key:create")] as const,
      request: {
        body: body(
          z.object({
            name: z.string().trim().min(2).max(60),
            expiresInDays: z.number().int().min(1).max(365).optional(),
          }),
        ),
      },
      responses: {
        201: json(
          dataOf(
            z.object({
              id: z.string(),
              name: z.string(),
              prefix: z.string(),
              key: z.string(),
              expiresAt: z.string().nullable(),
              createdAt: z.string(),
            }),
          ),
          "API key dibuat",
        ),
        ...errorResponses,
      },
    }),
    async (c) => {
      // API key tidak boleh membuat API key lain (mencegah key bocor menggandakan diri).
      if (c.get("actor").type !== "USER") throw forbidden();
      return c.json({ data: serialize(await createApiKey(c.get("actor"), c.req.valid("json"))) }, 201);
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/api-keys/{id}",
      tags: ["API key"],
      summary: "Cabut API key",
      middleware: [requirePermission("api_key:delete")] as const,
      request: { params: idParam },
      responses: { 204: { description: "Dicabut" }, ...errorResponses },
    }),
    async (c) => {
      await revokeApiKey(c.get("actor"), c.req.valid("param").id);
      return c.body(null, 204);
    },
  );
