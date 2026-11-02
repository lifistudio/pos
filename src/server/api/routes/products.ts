import { createRoute, z } from "@hono/zod-openapi";
import {
  createProduct,
  getProduct,
  listOptionNames,
  listProducts,
  searchVariants,
  updateProduct,
  updateVariant,
} from "@/server/services/product.service";
import { findCodeOwner } from "@/server/services/product-codes";
import { getProductThumbnail, removeProductThumbnail, setProductThumbnail, THUMBNAIL_MAX_BYTES } from "@/server/services/product-image.service";
import { can } from "@/server/rbac/access";
import { ApiError, forbidden } from "../errors";
import { idempotent } from "../idempotency";
import { requirePermission } from "../middleware";
import { pageMeta, pageQuery } from "../pagination";
import { createRouter } from "../router";
import { body, dataOf, errorResponses, idParam, json, money, serialize } from "../schemas";

const status = z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]);

const productListItem = z
  .object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    status,
    brand: z.string().nullable(),
    brandId: z.string().nullable(),
    imageUrl: z.string().nullable(),
    hasVariants: z.boolean(),
    categoryId: z.string().nullable(),
    categoryName: z.string().nullable(),
    variantCount: z.number().nullable(),
    minPrice: z.number().nullable(),
    maxPrice: z.number().nullable(),
    stockOnHand: z.number(),
    updatedAt: z.string(),
  })
  .openapi("ProductListItem");

const variantSchema = z
  .object({
    id: z.string(),
    productId: z.string(),
    sku: z.string(),
    barcode: z.string().nullable(),
    title: z.string(),
    price: z.number(),
    compareAtPrice: z.number().nullable(),
    costPrice: z.number().nullable().optional().openapi({ description: "Hanya untuk permission product:view_cost" }),
    weightGram: z.number().nullable(),
    isActive: z.boolean(),
    optionValueIds: z.array(z.string()),
    inventory: z.array(
      z.object({
        branchId: z.string(),
        branchName: z.string(),
        branchCode: z.string(),
        onHand: z.number(),
        reserved: z.number(),
        reorderPoint: z.number(),
      }),
    ),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("ProductVariant");

const productDetail = z
  .object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    description: z.string().nullable(),
    categoryId: z.string().nullable(),
    category: z.object({ id: z.string(), name: z.string() }).nullable(),
    brand: z.object({ id: z.string(), name: z.string() }).nullable(),
    brandId: z.string().nullable(),
    status,
    hasVariants: z.boolean(),
    weightGram: z.number().nullable(),
    imageUrl: z.string().nullable(),
    options: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        position: z.number(),
        values: z.array(z.object({ id: z.string(), value: z.string(), position: z.number() })),
      }),
    ),
    variants: z.array(variantSchema),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("ProductDetail");

const productFields = {
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(5000).nullish(),
  categoryId: z.string().uuid().nullish(),
  /** Dari GET /brands; buat merek baru lewat POST /brands. */
  brandId: z.string().uuid().nullish(),
  status: status.optional(),
  weightGram: z.number().int().min(0).max(1_000_000).nullish(),
  /** Gambar eksternal (https). Untuk unggah file, pakai PUT /products/{id}/thumbnail. */
  imageUrl: z
    .string()
    .url()
    .max(500)
    .refine((u) => u.startsWith("https://"), "URL gambar harus diawali https://")
    .nullish(),
};

const productCreateInput = z
  .object({
    ...productFields,
    options: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(30),
          values: z.array(z.string().trim().min(1).max(40)).min(1).max(50),
        }),
      )
      .max(3)
      .default([]),
    variants: z
      .array(
        z.object({
          optionValues: z.array(z.string().trim().min(1).max(40)).max(3).default([]),
          sku: z.string().trim().max(64).regex(/^[A-Za-z0-9._-]*$/, "SKU hanya huruf, angka, titik, - dan _").nullish(),
          barcode: z.string().trim().max(32).nullish(),
          price: money,
          compareAtPrice: money.nullish(),
          costPrice: money.nullish(),
          isActive: z.boolean().optional(),
          initialStock: z
            .array(z.object({ branchId: z.string().uuid(), qty: z.number().int().min(0, "Tidak boleh minus").max(1_000_000, "Maksimal 1.000.000 per cabang") }))
            .max(500)
            .optional(),
        }),
      )
      .min(1)
      .max(500),
  })
  // Field tak dikenal ditolak (bukan diam-diam diabaikan) agar klien API luar tahu bila salah nama field, mis. `brand` → `brandId`.
  .strict()
  .openapi("ProductCreateInput");

export const productRoutes = createRouter()
  .openapi(
    createRoute({
      method: "get",
      path: "/products",
      tags: ["Produk"],
      summary: "Daftar produk (cari nama/SKU/barcode, filter status & kategori)",
      middleware: [requirePermission("product:read")] as const,
      request: {
        query: pageQuery.extend({
          q: z.string().trim().max(100).optional(),
          status: status.optional(),
          categoryId: z.string().uuid().optional(),
          brandId: z.string().uuid().optional(),
        }),
      },
      responses: { 200: json(z.object({ data: z.array(productListItem), meta: pageMeta })), ...errorResponses },
    }),
    async (c) => c.json(serialize(await listProducts(c.get("actor"), c.req.valid("query"))), 200),
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/products/option-names",
      tags: ["Produk"],
      summary: "Nama variasi yang sudah dipakai (Warna, Ukuran, …) beserta jumlah pemakaian — untuk saran agar seragam",
      middleware: [requirePermission("product:read")] as const,
      request: { query: z.object({ q: z.string().trim().max(30).optional() }) },
      responses: { 200: json(dataOf(z.array(z.object({ name: z.string(), uses: z.number() })))), ...errorResponses },
    }),
    async (c) => c.json({ data: await listOptionNames(c.req.valid("query").q) }, 200),
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/products/{id}",
      tags: ["Produk"],
      summary: "Detail produk: variasi, varian, dan stok per cabang",
      middleware: [requirePermission("product:read")] as const,
      request: { params: idParam },
      responses: { 200: json(dataOf(productDetail)), ...errorResponses },
    }),
    async (c) => c.json({ data: serialize(await getProduct(c.get("actor"), c.req.valid("param").id)) }, 200),
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/products",
      tags: ["Produk"],
      summary: "Tambah produk beserta variasi, varian, dan stok awal",
      description:
        "SKU dan barcode (EAN-13 in-store) dibuat otomatis bila kosong. Produk tanpa variasi dikirim dengan `options: []` dan tepat 1 varian.",
      middleware: [requirePermission("product:create"), idempotent] as const,
      request: { body: body(productCreateInput) },
      responses: { 201: json(dataOf(productDetail), "Produk dibuat"), ...errorResponses },
    }),
    async (c) => c.json({ data: serialize(await createProduct(c.get("actor"), c.req.valid("json"))) }, 201),
  )
  .openapi(
    createRoute({
      method: "patch",
      path: "/products/{id}",
      tags: ["Produk"],
      summary: "Ubah informasi produk atau status (arsipkan dengan status ARCHIVED)",
      middleware: [requirePermission("product:update")] as const,
      request: { params: idParam, body: body(z.object(productFields).partial().strict().openapi("ProductUpdateInput")) },
      responses: { 200: json(dataOf(productDetail)), ...errorResponses },
    }),
    async (c) =>
      c.json({ data: serialize(await updateProduct(c.get("actor"), c.req.valid("param").id, c.req.valid("json"))) }, 200),
  )
  .openapi(
    createRoute({
      method: "patch",
      path: "/variants/{id}",
      tags: ["Produk"],
      summary: "Ubah SKU, barcode, harga, atau status varian",
      description:
        "SKU & barcode wajib unik di seluruh katalog, termasuk silang (barcode tidak boleh sama dengan SKU varian lain). `generateSku`/`generateBarcode` = ganti dengan kode otomatis baru. `barcode: null` menghapus barcode.",
      middleware: [requirePermission("product:update")] as const,
      request: {
        params: idParam,
        body: body(
          z
            .object({
              sku: z.string().trim().min(2).max(64).regex(/^[A-Za-z0-9._-]+$/, "SKU hanya huruf, angka, titik, - dan _"),
              barcode: z.string().trim().max(32).nullable(),
              generateSku: z.boolean(),
              generateBarcode: z.boolean(),
              price: money,
              compareAtPrice: money.nullable(),
              costPrice: money.nullable(),
              isActive: z.boolean(),
            })
            .partial()
            .openapi("VariantUpdateInput"),
        ),
      },
      responses: { 200: json(dataOf(productDetail)), ...errorResponses },
    }),
    async (c) =>
      c.json({ data: serialize(await updateVariant(c.get("actor"), c.req.valid("param").id, c.req.valid("json"))) }, 200),
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/variants/code-check",
      tags: ["Produk"],
      summary: "Cek apakah SKU/barcode sudah dipakai varian lain (validasi langsung di form)",
      middleware: [requirePermission("product:read")] as const,
      request: { query: z.object({ code: z.string().trim().min(1).max(64), excludeVariantId: z.string().uuid().optional() }) },
      responses: {
        200: json(
          dataOf(
            z
              .object({ variantId: z.string(), productName: z.string(), variantTitle: z.string(), usedAs: z.enum(["SKU", "BARCODE"]) })
              .nullable()
              .openapi("CodeOwner"),
          ),
        ),
        ...errorResponses,
      },
    }),
    async (c) => {
      const q = c.req.valid("query");
      return c.json({ data: await findCodeOwner(q.code, q.excludeVariantId) }, 200);
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/variants/search",
      tags: ["Produk"],
      summary: "Cari varian (barcode/SKU persis diurutkan teratas) — untuk scan di kasir & stok",
      middleware: [requirePermission("product:read")] as const,
      request: {
        query: z.object({
          q: z.string().trim().min(1).max(100),
          limit: z.coerce.number().int().min(1).max(25).default(10),
        }),
      },
      responses: {
        200: json(
          dataOf(
            z.array(
              z.object({
                id: z.string(),
                sku: z.string(),
                barcode: z.string().nullable(),
                title: z.string(),
                price: z.number(),
                isActive: z.boolean(),
                productId: z.string(),
                productName: z.string(),
              }),
            ),
          ),
        ),
        ...errorResponses,
      },
    }),
    async (c) => c.json({ data: await searchVariants(c.req.valid("query")) }, 200),
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/products/{id}/thumbnail",
      tags: ["Produk"],
      summary: "Unggah/ganti thumbnail produk (body = file gambar mentah)",
      description:
        "Kirim isi file sebagai body dengan Content-Type `image/webp`, `image/jpeg`, atau `image/png` (maks 1 MB, sisi terpanjang ≤ 2048 px; UI memperkecil ke 1024 px sebelum mengunggah). Disimpan di Cloudinary bila dikonfigurasi, selain itu di database. Format dicek dari isi file.",
      middleware: [requirePermission("product:update")] as const,
      request: {
        params: idParam,
        body: { content: { "image/webp": { schema: z.string().openapi({ format: "binary" }) }, "image/jpeg": { schema: z.string().openapi({ format: "binary" }) }, "image/png": { schema: z.string().openapi({ format: "binary" }) } }, required: true },
      },
      responses: {
        200: json(dataOf(z.object({ imageUrl: z.string(), width: z.number(), height: z.number(), bytes: z.number() }).openapi("ProductThumbnail"))),
        ...errorResponses,
      },
    }),
    async (c) => {
      const declared = Number(c.req.header("content-length") ?? 0);
      if (declared > THUMBNAIL_MAX_BYTES) throw new ApiError(413, "IMAGE_TOO_LARGE", "Gambar terlalu besar (maks 1 MB setelah diperkecil). Pilih gambar lain.");
      const data = Buffer.from(await c.req.arrayBuffer());
      return c.json({ data: await setProductThumbnail(c.get("actor"), c.req.valid("param").id, data) }, 200);
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/products/{id}/thumbnail",
      tags: ["Produk"],
      summary: "Hapus thumbnail produk",
      middleware: [requirePermission("product:update")] as const,
      request: { params: idParam },
      responses: { 204: { description: "Dihapus" }, ...errorResponses },
    }),
    async (c) => {
      await removeProductThumbnail(c.get("actor"), c.req.valid("param").id);
      return c.body(null, 204);
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/products/{id}/thumbnail",
      tags: ["Produk"],
      summary: "Gambar thumbnail produk (untuk katalog kasir & daftar produk)",
      description: "Boleh diakses pemegang `product:read` atau `pos:access`. URL dengan `?v=` yang cocok dengan versi gambar di-cache permanen.",
      request: { params: idParam, query: z.object({ v: z.string().max(64).optional() }) },
      responses: {
        200: { description: "File gambar", content: { "image/webp": { schema: z.string().openapi({ format: "binary" }) } } },
        ...errorResponses,
      },
    }),
    async (c) => {
      const access = c.get("actor").access;
      if (!can(access, "product:read") && !can(access, "pos:access")) throw forbidden("product:read");
      const image = await getProductThumbnail(c.req.valid("param").id);
      if (!image) throw new ApiError(404, "NOT_FOUND", "Produk belum punya thumbnail.");
      const { v } = c.req.valid("query");
      const etag = `"${image.hash}"`;
      const headers = {
        "Content-Type": image.mime,
        ETag: etag,
        // Versi cocok → aman di-cache selamanya (URL berubah saat gambar diganti). private: butuh login.
        "Cache-Control": v === image.hash ? "private, max-age=31536000, immutable" : "private, no-cache",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      };
      if (c.req.header("if-none-match") === etag) return c.body(null, 304, headers);
      return c.body(new Uint8Array(image.data), 200, headers);
    },
  );
