import { createRoute, z } from "@hono/zod-openapi";
import { offlinePack, syncOfflineSale } from "@/server/services/offline.service";
import { requirePermission } from "../middleware";
import { createRouter } from "../router";
import { body, dataOf, errorResponses, json, money, serialize } from "../schemas";
import { saleSchema } from "./sales";

const method = z.enum(["CASH", "QRIS", "DEBIT", "CREDIT", "TRANSFER", "EWALLET"]);

export const offlineRoutes = createRouter()
  .openapi(
    createRoute({
      method: "get",
      path: "/pos/ping",
      tags: ["Kasir (POS)"],
      summary: "Cek koneksi ringan untuk layar kasir (deteksi online/offline)",
      responses: { 200: json(dataOf(z.object({ now: z.string() }))), ...errorResponses },
    }),
    (c) => c.json({ data: { now: new Date().toISOString() } }, 200),
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/pos/offline-pack",
      tags: ["Kasir (POS)"],
      summary: "Paket offline: semua varian yang dijual + harga bertanda tangan (berlaku 48 jam) + stok + kategori + pajak",
      middleware: [requirePermission("pos:access")] as const,
      request: { query: z.object({ branchId: z.string().uuid() }) },
      responses: {
        200: json(
          dataOf(
            z
              .object({
                branchId: z.string(),
                issuedAt: z.string(),
                validUntil: z.string(),
                tax: z.object({ enabled: z.boolean(), rateBps: z.number(), inclusive: z.boolean() }),
                categories: z.array(z.object({ id: z.string(), name: z.string(), parentId: z.string().nullable() })),
                items: z.array(
                  z.object({
                    variantId: z.string(),
                    productId: z.string(),
                    productName: z.string(),
                    title: z.string(),
                    sku: z.string(),
                    barcode: z.string().nullable(),
                    price: z.number(),
                    imageUrl: z.string().nullable(),
                    categoryId: z.string().nullable(),
                    categoryName: z.string().nullable(),
                    available: z.number(),
                    sig: z.string(),
                  }),
                ),
              })
              .openapi("OfflinePack"),
          ),
        ),
        ...errorResponses,
      },
    }),
    async (c) => c.json({ data: await offlinePack(c.get("actor"), c.req.valid("query").branchId) }, 200),
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/pos/offline-sales",
      tags: ["Kasir (POS)"],
      summary: "Sinkron transaksi yang dibuat saat offline (idempoten, harga diverifikasi tanda tangan paket)",
      description:
        "Wajib header `Idempotency-Key` (sama untuk setiap percobaan ulang). Waktu transaksi = waktu di perangkat. Stok kurang tidak menolak transaksi; kekurangannya dicatat di `offlineShortfall`.",
      middleware: [requirePermission("pos:access")] as const,
      request: {
        headers: z.object({ "idempotency-key": z.string().min(8).max(100) }),
        body: body(
          z
            .object({
              branchId: z.string().uuid(),
              shiftId: z.string().uuid(),
              localRef: z.string().min(3).max(60),
              createdAt: z.string().datetime(),
              packIssuedAt: z.string().datetime(),
              items: z.array(z.object({ variantId: z.string().uuid(), qty: z.number().int().min(1).max(10_000), unitPrice: money, sig: z.string().min(10).max(64) })).min(1).max(300),
              payments: z
                .array(z.object({ method, amount: money.refine((n) => n > 0), tendered: money.nullish(), reference: z.string().trim().max(100).nullish() }))
                .min(1)
                .max(5),
              note: z.string().trim().max(300).nullish(),
            })
            .openapi("OfflineSaleInput"),
        ),
      },
      responses: {
        200: json(dataOf(z.object({ sale: saleSchema, shortfall: z.array(z.object({ variantId: z.string(), sku: z.string(), qty: z.number() })), replayed: z.boolean() }))),
        ...errorResponses,
      },
    }),
    async (c) => c.json({ data: serialize(await syncOfflineSale(c.get("actor"), { ...c.req.valid("json"), idempotencyKey: c.req.valid("header")["idempotency-key"] })) }, 200),
  );
