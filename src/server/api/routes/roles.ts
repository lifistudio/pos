import { createRoute, z } from "@hono/zod-openapi";
import { ACTION_LABELS, RESOURCES } from "@/server/rbac/permissions";
import { createRole, deleteRole, listRoles, updateRole } from "@/server/services/role.service";
import { requirePermission } from "../middleware";
import { createRouter } from "../router";
import { body, dataOf, errorResponses, idParam, json, serialize } from "../schemas";

const roleSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    isSystem: z.boolean(),
    permissions: z.array(z.string()),
    userCount: z.number(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("Role");

const roleInput = z
  .object({
    name: z.string().trim().min(2).max(50),
    description: z.string().trim().max(200).nullish(),
    permissions: z.array(z.string().max(64)).max(200),
  })
  .openapi("RoleInput");

const catalogSchema = z
  .object({
    resources: z.array(
      z.object({ key: z.string(), label: z.string(), actions: z.array(z.object({ key: z.string(), label: z.string() })) }),
    ),
  })
  .openapi("PermissionCatalog");

export const roleRoutes = createRouter()
  .openapi(
    createRoute({
      method: "get",
      path: "/permissions",
      tags: ["Role & akses"],
      summary: "Katalog permission (resource × action) untuk matriks role",
      middleware: [requirePermission("role:read")] as const,
      responses: { 200: json(dataOf(catalogSchema)), ...errorResponses },
    }),
    (c) =>
      c.json(
        {
          data: {
            resources: Object.entries(RESOURCES).map(([key, r]) => ({
              key,
              label: r.label,
              actions: r.actions.map((a) => ({ key: a, label: ACTION_LABELS[a] ?? a })),
            })),
          },
        },
        200,
      ),
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/roles",
      tags: ["Role & akses"],
      summary: "Daftar role beserta permission dan jumlah pengguna",
      middleware: [requirePermission("role:read")] as const,
      responses: { 200: json(dataOf(z.array(roleSchema))), ...errorResponses },
    }),
    async (c) => c.json({ data: serialize(await listRoles()) }, 200),
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/roles",
      tags: ["Role & akses"],
      summary: "Buat role baru",
      middleware: [requirePermission("role:create")] as const,
      request: { body: body(roleInput) },
      responses: { 201: json(dataOf(roleSchema), "Role dibuat"), ...errorResponses },
    }),
    async (c) => c.json({ data: serialize(await createRole(c.get("actor"), c.req.valid("json"))) }, 201),
  )
  .openapi(
    createRoute({
      method: "patch",
      path: "/roles/{id}",
      tags: ["Role & akses"],
      summary: "Ubah role (nama, deskripsi, permission)",
      middleware: [requirePermission("role:update")] as const,
      request: { params: idParam, body: body(roleInput.partial()) },
      responses: { 200: json(dataOf(roleSchema)), ...errorResponses },
    }),
    async (c) =>
      c.json({ data: serialize(await updateRole(c.get("actor"), c.req.valid("param").id, c.req.valid("json"))) }, 200),
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/roles/{id}",
      tags: ["Role & akses"],
      summary: "Hapus role yang tidak dipakai",
      middleware: [requirePermission("role:delete")] as const,
      request: { params: idParam },
      responses: { 204: { description: "Dihapus" }, ...errorResponses },
    }),
    async (c) => {
      await deleteRole(c.get("actor"), c.req.valid("param").id);
      return c.body(null, 204);
    },
  );
