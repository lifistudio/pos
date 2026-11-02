import { createRoute, z } from "@hono/zod-openapi";
import { createReturn, getReturn, listReturns } from "@/server/services/return.service";
import { getStorePolicy, storePolicySchema, updateStorePolicy } from "@/server/services/settings.service";
import { requirePermission } from "../middleware";
import { pageMeta, pageQuery } from "../pagination";
import { idempotent } from "../idempotency";
import { createRouter } from "../router";
import { body, dataOf, errorResponses, idParam, json, serialize } from "../schemas";

const method = z.enum(["CASH", "QRIS", "DEBIT", "CREDIT", "TRANSFER", "EWALLET", "MARKETPLACE"]);
export const reasonCode = z.enum(["SIZE", "DEFECT", "WRONG_ITEM", "NOT_AS_DESCRIBED", "CHANGED_MIND", "OTHER"]);

const returnSchema = z
  .object({
    id: z.string(),
    number: z.string(),
    saleId: z.string(),
    branchId: z.string(),
    shiftId: z.string().nullable(),
    refundMethod: method,
    refundAmount: z.number(),
    pointsReversed: z.number(),
    pointsRestored: z.number(),
    reasonCode,
    reason: z.string(),
    reference: z.string().nullable(),
    approvedBy: z.string().nullable(),
    createdAt: z.string(),
    sale: z.object({ id: z.string(), number: z.string(), total: z.number(), refundTotal: z.number() }),
    branch: z.object({ id: z.string(), name: z.string(), code: z.string() }),
    createdByUser: z.object({ name: z.string() }),
    items: z.array(
      z.object({
        id: z.string(),
        saleItemId: z.string(),
        variantId: z.string(),
        qty: z.number(),
        amount: z.number(),
        restock: z.boolean(),
        saleItem: z.object({ productName: z.string(), variantTitle: z.string(), sku: z.string(), unitPrice: z.number() }),
      }),
    ),
  })
  .openapi("SaleReturn");

const policySchema = storePolicySchema.openapi("StorePolicy");

export const returnRoutes = createRouter()
  .openapi(
    createRoute({
      method: "post",
      path: "/sales/{id}/returns",
      tags: ["Transaksi"],
      summary: "Retur barang dari struk: refund, stok kembali (bila layak jual), poin disesuaikan",
      middleware: [idempotent] as const,
      description:
        "Nilai refund dihitung server secara proporsional terhadap total yang dibayar (setelah diskon, termasuk PPN). Refund tunai wajib shift terbuka dan mengurangi kas seharusnya shift itu. Retur penuh mengembalikan kuota voucher.",
      request: {
        headers: z.object({ "x-approval-id": z.string().uuid().optional().describe("Izin PIN atasan bila tidak punya pos:refund") }),
        params: idParam,
        body: body(
          z
            .object({
              items: z
                .array(z.object({ saleItemId: z.string().uuid(), qty: z.number().int().min(1).max(10_000), restock: z.boolean() }))
                .min(1, "Pilih barang yang diretur")
                .max(300),
              refundMethod: method,
              reasonCode: reasonCode.default("OTHER"),
              reason: z.string().trim().min(3, "Tuliskan keterangan retur").max(200),
              reference: z.string().trim().max(100).nullish(),
            })
            .openapi("CreateReturnInput"),
        ),
      },
      responses: { 201: json(dataOf(returnSchema), "Retur tersimpan"), ...errorResponses },
    }),
    async (c) =>
      c.json({ data: serialize(await createReturn(c.get("actor"), c.req.valid("param").id, { ...c.req.valid("json"), approvalId: c.req.valid("header")["x-approval-id"] })) }, 201),
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/sale-returns",
      tags: ["Transaksi"],
      summary: "Daftar retur (filter cabang, tanggal, nomor retur/struk)",
      middleware: [requirePermission("sale:read")] as const,
      request: {
        query: pageQuery.extend({
          branchId: z.string().uuid().optional(),
          q: z.string().trim().max(60).optional(),
          from: z.string().datetime().optional(),
          to: z.string().datetime().optional(),
        }),
      },
      responses: {
        200: json(
          z.object({
            data: z.array(
              z.object({
                id: z.string(),
                number: z.string(),
                saleId: z.string(),
                saleNumber: z.string(),
                branchName: z.string(),
                createdByName: z.string(),
                refundMethod: method,
                refundAmount: z.number(),
                reasonCode,
                reason: z.string(),
                createdAt: z.string(),
                qty: z.number(),
                damagedQty: z.number(),
              }),
            ),
            meta: pageMeta,
          }),
        ),
        ...errorResponses,
      },
    }),
    async (c) => c.json(serialize(await listReturns(c.get("actor"), c.req.valid("query"))), 200),
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/sale-returns/{id}",
      tags: ["Transaksi"],
      summary: "Detail retur",
      request: { params: idParam },
      responses: { 200: json(dataOf(returnSchema)), ...errorResponses },
    }),
    async (c) => c.json({ data: serialize(await getReturn(c.get("actor"), c.req.valid("param").id)) }, 200),
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/settings/store-policy",
      tags: ["Pengaturan"],
      summary: "Kebijakan toko: nilai & batas tukar poin, batas hari retur",
      middleware: [requirePermission("setting:read")] as const,
      responses: { 200: json(dataOf(policySchema)), ...errorResponses },
    }),
    async (c) => c.json({ data: await getStorePolicy() }, 200),
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/settings/store-policy",
      tags: ["Pengaturan"],
      summary: "Ubah kebijakan toko",
      middleware: [requirePermission("setting:update")] as const,
      request: { body: body(policySchema) },
      responses: { 200: json(dataOf(policySchema)), ...errorResponses },
    }),
    async (c) => c.json({ data: await updateStorePolicy(c.get("actor"), c.req.valid("json")) }, 200),
  );
