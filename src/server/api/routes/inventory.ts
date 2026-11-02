import { createRoute, z } from "@hono/zod-openapi";
import { adjustStock, listInventory, listStockMovements, setReorderPoint } from "@/server/services/inventory.service";
import { idempotent } from "../idempotency";
import { requirePermission } from "../middleware";
import { cursorQuery, pageMeta, pageQuery } from "../pagination";
import { createRouter } from "../router";
import { body, dataOf, errorResponses, json, serialize } from "../schemas";

const levelSchema = z
  .object({
    branchId: z.string(),
    branchName: z.string(),
    variantId: z.string(),
    sku: z.string(),
    barcode: z.string().nullable(),
    variantTitle: z.string(),
    productId: z.string(),
    productName: z.string(),
    onHand: z.number(),
    reserved: z.number(),
    available: z.number(),
    reorderPoint: z.number(),
    updatedAt: z.string(),
  })
  .openapi("InventoryLevel");

const movementSchema = z
  .object({
    id: z.string(),
    type: z.string(),
    qtyChange: z.number(),
    balanceAfter: z.number(),
    reason: z.string().nullable(),
    referenceType: z.string().nullable(),
    referenceId: z.string().nullable(),
    createdAt: z.string(),
    branchName: z.string(),
    sku: z.string(),
    variantTitle: z.string(),
    productName: z.string(),
    actorName: z.string().nullable(),
  })
  .openapi("StockMovement");

export const inventoryRoutes = createRouter()
  .openapi(
    createRoute({
      method: "get",
      path: "/inventory",
      tags: ["Stok"],
      summary: "Stok per varian per cabang",
      middleware: [requirePermission("inventory:read")] as const,
      request: {
        query: pageQuery.extend({
          branchId: z.string().uuid().optional(),
          q: z.string().trim().max(100).optional(),
          status: z.enum(["low", "out"]).optional().openapi({ description: "low = menipis, out = habis" }),
        }),
      },
      responses: { 200: json(z.object({ data: z.array(levelSchema), meta: pageMeta })), ...errorResponses },
    }),
    async (c) => c.json(serialize(await listInventory(c.get("actor"), c.req.valid("query"))), 200),
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/inventory/adjustments",
      tags: ["Stok"],
      summary: "Penerimaan barang atau penyesuaian stok (tercatat di ledger)",
      middleware: [requirePermission("inventory:adjust"), idempotent] as const,
      request: {
        body: body(
          z
            .object({
              branchId: z.string().uuid(),
              type: z.enum(["RECEIPT", "ADJUSTMENT"]),
              reason: z.string().trim().min(3, "Tuliskan alasan").max(300),
              items: z
                .array(
                  z.object({
                    variantId: z.string().uuid(),
                    qtyChange: z
                      .number()
                      .int()
                      .min(-1_000_000)
                      .max(1_000_000)
                      .refine((n) => n !== 0, "Jumlah tidak boleh 0"),
                  }),
                )
                .min(1)
                .max(500),
            })
            .refine((v) => v.type !== "RECEIPT" || v.items.every((i) => i.qtyChange > 0), {
              message: "Penerimaan barang harus bernilai positif",
              path: ["items"],
            })
            .openapi("StockAdjustmentInput"),
        ),
      },
      responses: {
        200: json(dataOf(z.array(z.object({ branchId: z.string(), variantId: z.string(), onHand: z.number() })))),
        ...errorResponses,
      },
    }),
    async (c) => c.json({ data: await adjustStock(c.get("actor"), c.req.valid("json")) }, 200),
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/inventory/reorder-point",
      tags: ["Stok"],
      summary: "Atur batas stok minimum (pemicu status menipis)",
      middleware: [requirePermission("inventory:adjust")] as const,
      request: {
        body: body(
          z.object({
            branchId: z.string().uuid(),
            variantId: z.string().uuid(),
            reorderPoint: z.number().int().min(0).max(1_000_000),
          }),
        ),
      },
      responses: { 204: { description: "Tersimpan" }, ...errorResponses },
    }),
    async (c) => {
      await setReorderPoint(c.get("actor"), c.req.valid("json"));
      return c.body(null, 204);
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/inventory/movements",
      tags: ["Stok"],
      summary: "Kartu stok (riwayat pergerakan), cursor pagination",
      middleware: [requirePermission("inventory:read")] as const,
      request: {
        query: cursorQuery.extend({ branchId: z.string().uuid().optional(), variantId: z.string().uuid().optional() }),
      },
      responses: {
        200: json(z.object({ data: z.array(movementSchema), nextCursor: z.string().nullable() })),
        ...errorResponses,
      },
    }),
    async (c) => c.json(serialize(await listStockMovements(c.get("actor"), c.req.valid("query"))), 200),
  );
