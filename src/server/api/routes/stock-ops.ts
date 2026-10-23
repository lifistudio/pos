import { createRoute, z } from "@hono/zod-openapi";
import {
  cancelOpname,
  countItem,
  createOpname,
  getOpname,
  listOpnames,
  postOpname,
  removeCountItem,
} from "@/server/services/opname.service";
import {
  cancelTransfer,
  createTransfer,
  getTransfer,
  listTransfers,
  receiveTransfer,
  sendTransfer,
  updateTransferDraft,
} from "@/server/services/transfer.service";
import { requirePermission } from "../middleware";
import { pageMeta, pageQuery } from "../pagination";
import { createRouter } from "../router";
import { body, dataOf, errorResponses, idParam, json, serialize } from "../schemas";

const transferStatus = z.enum(["DRAFT", "IN_TRANSIT", "RECEIVED", "CANCELLED"]);
const opnameStatus = z.enum(["COUNTING", "POSTED", "CANCELLED"]);
const qty = z.number().int().min(1).max(1_000_000);

const transferListItem = z
  .object({
    id: z.string(),
    number: z.string(),
    status: transferStatus,
    fromBranchId: z.string(),
    fromBranchName: z.string(),
    toBranchId: z.string(),
    toBranchName: z.string(),
    note: z.string().nullable(),
    createdAt: z.string(),
    sentAt: z.string().nullable(),
    receivedAt: z.string().nullable(),
    lines: z.number(),
    qtySent: z.number(),
    qtyReceived: z.number().nullable(),
  })
  .openapi("StockTransferListItem");

const transferDetail = z
  .object({
    id: z.string(),
    number: z.string(),
    status: transferStatus,
    fromBranchId: z.string(),
    fromBranchName: z.string(),
    fromBranchCode: z.string(),
    toBranchId: z.string(),
    toBranchName: z.string(),
    toBranchCode: z.string(),
    note: z.string().nullable(),
    receiveNote: z.string().nullable(),
    createdByName: z.string().nullable(),
    createdAt: z.string(),
    sentAt: z.string().nullable(),
    receivedAt: z.string().nullable(),
    cancelledAt: z.string().nullable(),
    items: z.array(
      z.object({
        variantId: z.string(),
        qtySent: z.number(),
        qtyReceived: z.number().nullable(),
        sku: z.string(),
        barcode: z.string().nullable(),
        variantTitle: z.string(),
        productName: z.string(),
        availableAtOrigin: z.number(),
      }),
    ),
  })
  .openapi("StockTransfer");

const transferItemsInput = z.array(z.object({ variantId: z.string().uuid(), qty })).min(1, "Tambahkan minimal satu barang").max(500);

const opnameListItem = z
  .object({
    id: z.string(),
    number: z.string(),
    status: opnameStatus,
    mode: z.enum(["PARTIAL", "FULL"]),
    branchId: z.string(),
    branchName: z.string(),
    note: z.string().nullable(),
    createdAt: z.string(),
    postedAt: z.string().nullable(),
    createdByName: z.string().nullable(),
    lines: z.number(),
    counted: z.number(),
    plus: z.number(),
    minus: z.number(),
  })
  .openapi("StockOpnameListItem");

const opnameDetail = z
  .object({
    id: z.string(),
    number: z.string(),
    status: opnameStatus,
    mode: z.enum(["PARTIAL", "FULL"]),
    branchId: z.string(),
    branchName: z.string(),
    branchCode: z.string(),
    note: z.string().nullable(),
    createdByName: z.string().nullable(),
    createdAt: z.string(),
    postedAt: z.string().nullable(),
    items: z.array(
      z.object({
        variantId: z.string(),
        sku: z.string(),
        barcode: z.string().nullable(),
        variantTitle: z.string(),
        productName: z.string(),
        countedQty: z.number(),
        systemQty: z.number(),
        difference: z.number(),
        valueDifference: z.number().nullable(),
        updatedAt: z.string(),
      }),
    ),
    summary: z.object({
      lines: z.number(),
      counted: z.number(),
      plus: z.number(),
      minus: z.number(),
      matched: z.number(),
      valueDifference: z.number().nullable(),
      uncountedVariants: z.number(),
      uncountedUnits: z.number(),
    }),
  })
  .openapi("StockOpname");

const variantParam = z.object({
  id: z.string().uuid().openapi({ param: { name: "id", in: "path" } }),
  variantId: z.string().uuid().openapi({ param: { name: "variantId", in: "path" } }),
});

export const stockOpsRoutes = createRouter()
  // ── Transfer ──
  .openapi(
    createRoute({
      method: "get",
      path: "/stock-transfers",
      tags: ["Transfer stok"],
      summary: "Daftar transfer (filter cabang & arah masuk/keluar, status)",
      middleware: [requirePermission("stock_transfer:read")] as const,
      request: {
        query: pageQuery.extend({ branchId: z.string().uuid().optional(), direction: z.enum(["in", "out"]).optional(), status: transferStatus.optional() }),
      },
      responses: { 200: json(z.object({ data: z.array(transferListItem), meta: pageMeta })), ...errorResponses },
    }),
    async (c) => c.json(serialize(await listTransfers(c.get("actor"), c.req.valid("query"))), 200),
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/stock-transfers/{id}",
      tags: ["Transfer stok"],
      summary: "Detail transfer + item",
      middleware: [requirePermission("stock_transfer:read")] as const,
      request: { params: idParam },
      responses: { 200: json(dataOf(transferDetail)), ...errorResponses },
    }),
    async (c) => c.json({ data: serialize(await getTransfer(c.get("actor"), c.req.valid("param").id)) }, 200),
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/stock-transfers",
      tags: ["Transfer stok"],
      summary: "Buat draf transfer",
      middleware: [requirePermission("stock_transfer:create")] as const,
      request: {
        body: body(
          z
            .object({ fromBranchId: z.string().uuid(), toBranchId: z.string().uuid(), note: z.string().trim().max(300).nullish(), items: transferItemsInput })
            .openapi("StockTransferInput"),
        ),
      },
      responses: { 201: json(dataOf(transferDetail), "Draf dibuat"), ...errorResponses },
    }),
    async (c) => c.json({ data: serialize(await createTransfer(c.get("actor"), c.req.valid("json"))) }, 201),
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/stock-transfers/{id}",
      tags: ["Transfer stok"],
      summary: "Ubah draf transfer (item diganti seluruhnya)",
      middleware: [requirePermission("stock_transfer:create")] as const,
      request: { params: idParam, body: body(z.object({ note: z.string().trim().max(300).nullish(), items: transferItemsInput })) },
      responses: { 200: json(dataOf(transferDetail)), ...errorResponses },
    }),
    async (c) => c.json({ data: serialize(await updateTransferDraft(c.get("actor"), c.req.valid("param").id, c.req.valid("json"))) }, 200),
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/stock-transfers/{id}/send",
      tags: ["Transfer stok"],
      summary: "Kirim: stok cabang asal berkurang, status dalam perjalanan",
      middleware: [requirePermission("stock_transfer:create")] as const,
      request: { params: idParam },
      responses: { 200: json(dataOf(transferDetail)), ...errorResponses },
    }),
    async (c) => c.json({ data: serialize(await sendTransfer(c.get("actor"), c.req.valid("param").id)) }, 200),
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/stock-transfers/{id}/receive",
      tags: ["Transfer stok"],
      summary: "Terima di cabang tujuan (item yang tidak disebut = diterima penuh)",
      middleware: [requirePermission("stock_transfer:approve")] as const,
      request: {
        params: idParam,
        body: body(
          z.object({
            items: z.array(z.object({ variantId: z.string().uuid(), qtyReceived: z.number().int().min(0).max(1_000_000) })).max(500).optional(),
            note: z.string().trim().max(300).nullish(),
          }),
        ),
      },
      responses: { 200: json(dataOf(transferDetail)), ...errorResponses },
    }),
    async (c) => c.json({ data: serialize(await receiveTransfer(c.get("actor"), c.req.valid("param").id, c.req.valid("json"))) }, 200),
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/stock-transfers/{id}/cancel",
      tags: ["Transfer stok"],
      summary: "Batalkan (stok kembali ke asal bila sudah dikirim)",
      request: { params: idParam, body: body(z.object({ reason: z.string().trim().min(3, "Tuliskan alasan").max(200) })) },
      responses: { 200: json(dataOf(transferDetail)), ...errorResponses },
    }),
    async (c) => c.json({ data: serialize(await cancelTransfer(c.get("actor"), c.req.valid("param").id, c.req.valid("json").reason)) }, 200),
  )
  // ── Opname ──
  .openapi(
    createRoute({
      method: "get",
      path: "/stock-opnames",
      tags: ["Stok opname"],
      summary: "Daftar stok opname",
      middleware: [requirePermission("stock_opname:read")] as const,
      request: { query: pageQuery.extend({ branchId: z.string().uuid().optional(), status: opnameStatus.optional() }) },
      responses: { 200: json(z.object({ data: z.array(opnameListItem), meta: pageMeta })), ...errorResponses },
    }),
    async (c) => c.json(serialize(await listOpnames(c.get("actor"), c.req.valid("query"))), 200),
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/stock-opnames/{id}",
      tags: ["Stok opname"],
      summary: "Detail opname: hitungan vs stok sistem, selisih, barang belum dihitung",
      middleware: [requirePermission("stock_opname:read")] as const,
      request: { params: idParam },
      responses: { 200: json(dataOf(opnameDetail)), ...errorResponses },
    }),
    async (c) => c.json({ data: serialize(await getOpname(c.get("actor"), c.req.valid("param").id)) }, 200),
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/stock-opnames",
      tags: ["Stok opname"],
      summary: "Mulai stok opname (satu yang berjalan per cabang)",
      middleware: [requirePermission("stock_opname:create")] as const,
      request: {
        body: body(z.object({ branchId: z.string().uuid(), mode: z.enum(["PARTIAL", "FULL"]).default("PARTIAL"), note: z.string().trim().max(300).nullish() })),
      },
      responses: { 201: json(dataOf(opnameDetail), "Opname dimulai"), ...errorResponses },
    }),
    async (c) => c.json({ data: serialize(await createOpname(c.get("actor"), c.req.valid("json"))) }, 201),
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/stock-opnames/{id}/count",
      tags: ["Stok opname"],
      summary: "Catat hitungan: `delta` (scan, default +1) atau `qty` (koreksi manual)",
      middleware: [requirePermission("stock_opname:create")] as const,
      request: {
        params: idParam,
        body: body(
          z.object({
            variantId: z.string().uuid(),
            delta: z.number().int().min(-10_000).max(10_000).optional(),
            qty: z.number().int().min(0).max(1_000_000).optional(),
          }),
        ),
      },
      responses: { 200: json(dataOf(z.object({ variantId: z.string(), countedQty: z.number() }))), ...errorResponses },
    }),
    async (c) => c.json({ data: await countItem(c.get("actor"), c.req.valid("param").id, c.req.valid("json")) }, 200),
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/stock-opnames/{id}/items/{variantId}",
      tags: ["Stok opname"],
      summary: "Hapus baris hitungan",
      middleware: [requirePermission("stock_opname:create")] as const,
      request: { params: variantParam },
      responses: { 204: { description: "Dihapus" }, ...errorResponses },
    }),
    async (c) => {
      const { id, variantId } = c.req.valid("param");
      await removeCountItem(c.get("actor"), id, variantId);
      return c.body(null, 204);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/stock-opnames/{id}/post",
      tags: ["Stok opname"],
      summary: "Posting: selisih dibukukan ke stok (pergerakan OPNAME)",
      middleware: [requirePermission("stock_opname:approve")] as const,
      request: { params: idParam },
      responses: { 200: json(dataOf(opnameDetail)), ...errorResponses },
    }),
    async (c) => c.json({ data: serialize(await postOpname(c.get("actor"), c.req.valid("param").id)) }, 200),
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/stock-opnames/{id}/cancel",
      tags: ["Stok opname"],
      summary: "Batalkan opname (stok tidak berubah)",
      middleware: [requirePermission("stock_opname:create")] as const,
      request: { params: idParam },
      responses: { 200: json(dataOf(opnameDetail)), ...errorResponses },
    }),
    async (c) => c.json({ data: serialize(await cancelOpname(c.get("actor"), c.req.valid("param").id)) }, 200),
  );
