import { createRoute, z } from "@hono/zod-openapi";
import { createBrand, deleteBrand, listBrands, mergeBrand, updateBrand } from "@/server/services/brand.service";
import { requirePermission } from "../middleware";
import { pageMeta, pageQuery } from "../pagination";
import { createRouter } from "../router";
import { body, dataOf, errorResponses, idParam, json, serialize } from "../schemas";

const brandSchema = z
  .object({ id: z.string(), name: z.string(), productCount: z.number(), exact: z.boolean().optional(), updatedAt: z.string().optional() })
  .openapi("Brand");

const brandInput = z
  .object({ name: z.string().trim().min(1, "Nama merek wajib diisi").max(60, "Maksimal 60 karakter") })
  .openapi("BrandInput");

export const brandRoutes = createRouter()
  .openapi(
    createRoute({
      method: "get",
      path: "/brands",
      tags: ["Merek"],
      summary: "Daftar merek + jumlah produk; `q` mencari sebagian & ejaan mirip (paling mirip di atas, `exact` = sama persis setelah normalisasi)",
      middleware: [requirePermission("brand:read")] as const,
      request: { query: pageQuery.extend({ q: z.string().trim().max(60).optional() }) },
      responses: { 200: json(z.object({ data: z.array(brandSchema), meta: pageMeta })), ...errorResponses },
    }),
    async (c) => c.json(serialize(await listBrands(c.req.valid("query"))), 200),
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/brands",
      tags: ["Merek"],
      summary: "Tambah merek",
      description:
        'Nama dinormalisasi (spasi dirapikan). Ditolak `409 BRAND_EXISTS` bila sudah ada merek yang sama tanpa membedakan huruf besar/kecil, spasi, tanda baca, atau aksen (mis. "Coca-Cola" = "coca cola"); `details.brandId` berisi merek yang sudah ada.',
      middleware: [requirePermission("brand:create")] as const,
      request: { body: body(brandInput) },
      responses: { 201: json(dataOf(brandSchema), "Merek dibuat"), ...errorResponses },
    }),
    async (c) => c.json({ data: serialize(await createBrand(c.get("actor"), c.req.valid("json"))) }, 201),
  )
  .openapi(
    createRoute({
      method: "patch",
      path: "/brands/{id}",
      tags: ["Merek"],
      summary: "Ubah nama merek (berlaku untuk semua produknya)",
      middleware: [requirePermission("brand:update")] as const,
      request: { params: idParam, body: body(brandInput) },
      responses: { 200: json(dataOf(z.object({ id: z.string(), name: z.string() }))), ...errorResponses },
    }),
    async (c) => c.json({ data: serialize(await updateBrand(c.get("actor"), c.req.valid("param").id, c.req.valid("json"))) }, 200),
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/brands/{id}/merge",
      tags: ["Merek"],
      summary: "Gabungkan merek ganda/salah ketik ke merek lain (produk dipindah, merek asal dihapus)",
      middleware: [requirePermission("brand:delete")] as const,
      request: { params: idParam, body: body(z.object({ intoId: z.string().uuid() }).openapi("BrandMergeInput")) },
      responses: { 200: json(dataOf(z.object({ into: z.object({ id: z.string(), name: z.string() }), movedProducts: z.number() }))), ...errorResponses },
    }),
    async (c) => c.json({ data: serialize(await mergeBrand(c.get("actor"), c.req.valid("param").id, c.req.valid("json").intoId)) }, 200),
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/brands/{id}",
      tags: ["Merek"],
      summary: "Hapus merek yang tidak dipakai produk (`409 BRAND_IN_USE` bila masih dipakai)",
      middleware: [requirePermission("brand:delete")] as const,
      request: { params: idParam },
      responses: { 204: { description: "Dihapus" }, ...errorResponses },
    }),
    async (c) => {
      await deleteBrand(c.get("actor"), c.req.valid("param").id);
      return c.body(null, 204);
    },
  );
