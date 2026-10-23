import { createRoute, z } from "@hono/zod-openapi";
import { createCategory, deleteCategory, listCategories, updateCategory } from "@/server/services/category.service";
import { requirePermission } from "../middleware";
import { createRouter } from "../router";
import { body, dataOf, errorResponses, idParam, json, serialize } from "../schemas";

const categorySchema = z
  .object({
    id: z.string(),
    parentId: z.string().nullable(),
    name: z.string(),
    slug: z.string(),
    sortOrder: z.number(),
    productCount: z.number().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("Category");

const categoryInput = z
  .object({
    name: z.string().trim().min(1).max(60),
    parentId: z.string().uuid().nullish(),
    sortOrder: z.number().int().min(0).max(9999).optional(),
  })
  .openapi("CategoryInput");

export const categoryRoutes = createRouter()
  .openapi(
    createRoute({
      method: "get",
      path: "/categories",
      tags: ["Kategori"],
      summary: "Semua kategori (flat, dengan parentId) beserta jumlah produk",
      middleware: [requirePermission("category:read")] as const,
      responses: { 200: json(dataOf(z.array(categorySchema))), ...errorResponses },
    }),
    async (c) => c.json({ data: serialize(await listCategories()) }, 200),
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/categories",
      tags: ["Kategori"],
      summary: "Tambah kategori (maks 3 tingkat)",
      middleware: [requirePermission("category:create")] as const,
      request: { body: body(categoryInput) },
      responses: { 201: json(dataOf(categorySchema), "Kategori dibuat"), ...errorResponses },
    }),
    async (c) => c.json({ data: serialize(await createCategory(c.get("actor"), c.req.valid("json"))) }, 201),
  )
  .openapi(
    createRoute({
      method: "patch",
      path: "/categories/{id}",
      tags: ["Kategori"],
      summary: "Ubah kategori",
      middleware: [requirePermission("category:update")] as const,
      request: { params: idParam, body: body(categoryInput.partial()) },
      responses: { 200: json(dataOf(categorySchema)), ...errorResponses },
    }),
    async (c) =>
      c.json({ data: serialize(await updateCategory(c.get("actor"), c.req.valid("param").id, c.req.valid("json"))) }, 200),
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/categories/{id}",
      tags: ["Kategori"],
      summary: "Hapus kategori kosong",
      middleware: [requirePermission("category:delete")] as const,
      request: { params: idParam },
      responses: { 204: { description: "Dihapus" }, ...errorResponses },
    }),
    async (c) => {
      await deleteCategory(c.get("actor"), c.req.valid("param").id);
      return c.body(null, 204);
    },
  );
