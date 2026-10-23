import { createRoute, z } from "@hono/zod-openapi";
import {
  completeOAuth,
  createMockOrder,
  disconnect,
  getConnection,
  listConnections,
  listListings,
  listMockOrders,
  listProviders,
  mapListing,
  setMockOrderStatus,
  startConnect,
  syncAll,
  syncConnection,
  updateConnection,
} from "@/server/services/marketplace.service";
import { requirePermission } from "../middleware";
import { pageMeta, pageQuery } from "../pagination";
import { createRouter } from "../router";
import { body, dataOf, errorResponses, idParam, json, serialize } from "../schemas";

const status = z.enum(["ACTIVE", "PAUSED", "ERROR", "DISCONNECTED"]);
const connectionSchema = z
  .object({
    id: z.string(),
    provider: z.string(),
    channel: z.string(),
    name: z.string(),
    externalShopId: z.string(),
    branchId: z.string(),
    branchName: z.string(),
    status,
    pullOrders: z.boolean(),
    pushStock: z.boolean(),
    stockBuffer: z.number(),
    tokenExpiresAt: z.string().nullable(),
    ordersSyncedUntil: z.string().nullable(),
    lastSyncAt: z.string().nullable(),
    lastError: z.string().nullable(),
    retryCount: z.number(),
    createdAt: z.string(),
  })
  .openapi("MarketplaceConnection");
const detailSchema = connectionSchema
  .extend({
    stats: z.object({ listings: z.number(), mapped: z.number(), unmapped: z.number() }),
    simulator: z.boolean(),
    logs: z.array(
      z.object({
        id: z.string(),
        kind: z.enum(["ORDERS", "STOCK", "LISTINGS", "WEBHOOK"]),
        status: z.enum(["OK", "PARTIAL", "FAILED"]),
        stats: z.record(z.string(), z.number()),
        issues: z.array(z.object({ ref: z.string(), message: z.string() })),
        error: z.string().nullable(),
        startedAt: z.string(),
        finishedAt: z.string().nullable(),
      }),
    ),
  })
  .openapi("MarketplaceConnectionDetail");

export const marketplaceRoutes = createRouter()
  .openapi(
    createRoute({
      method: "get",
      path: "/marketplace/providers",
      tags: ["Marketplace"],
      summary: "Marketplace yang bisa dihubungkan di instalasi ini",
      middleware: [requirePermission("marketplace:read")] as const,
      responses: { 200: json(dataOf(z.array(z.object({ provider: z.string(), label: z.string(), channel: z.string(), oauth: z.boolean(), available: z.boolean() })))), ...errorResponses },
    }),
    async (c) => c.json({ data: listProviders() }, 200),
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/marketplace/connections",
      tags: ["Marketplace"],
      summary: "Toko marketplace yang terhubung",
      middleware: [requirePermission("marketplace:read")] as const,
      responses: { 200: json(dataOf(z.array(connectionSchema))), ...errorResponses },
    }),
    async (c) => c.json({ data: serialize(await listConnections()) }, 200),
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/marketplace/connections",
      tags: ["Marketplace"],
      summary: "Hubungkan toko: OAuth → URL otorisasi; simulator → langsung terhubung",
      middleware: [requirePermission("marketplace:manage")] as const,
      request: { body: body(z.object({ provider: z.string().min(1).max(30), branchId: z.string().uuid().describe("Cabang/gudang sumber stok") })) },
      responses: { 200: json(dataOf(z.object({ authorizeUrl: z.string().nullable(), connectionId: z.string().nullable() }))), ...errorResponses },
    }),
    async (c) => c.json({ data: await startConnect(c.get("actor"), c.req.valid("json")) }, 200),
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/marketplace/oauth/{provider}/callback",
      tags: ["Marketplace"],
      summary: "Callback OAuth marketplace (redirect browser) → halaman koneksi",
      middleware: [requirePermission("marketplace:manage")] as const,
      request: { params: z.object({ provider: z.string() }) },
      responses: { 302: { description: "Redirect ke halaman Marketplace" } },
    }),
    async (c) => {
      try {
        const id = await completeOAuth(c.get("actor"), c.req.valid("param").provider, new URL(c.req.url).searchParams);
        return c.redirect(`/settings/marketplace/${id}?connected=1`, 302);
      } catch (error) {
        return c.redirect(`/settings/marketplace?error=${encodeURIComponent((error as Error).message)}`, 302);
      }
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/marketplace/sync",
      tags: ["Marketplace"],
      summary: "Cron (mis. tiap 5 menit): tarik order & push stok semua toko aktif",
      middleware: [requirePermission("marketplace:manage")] as const,
      responses: { 200: json(dataOf(z.array(z.object({ id: z.string(), name: z.string(), ok: z.boolean(), result: z.unknown().optional(), error: z.string().optional() })))), ...errorResponses },
    }),
    async (c) => c.json({ data: await syncAll() }, 200),
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/marketplace/connections/{id}",
      tags: ["Marketplace"],
      summary: "Detail koneksi: ringkasan pemetaan & log sinkron terakhir",
      middleware: [requirePermission("marketplace:read")] as const,
      request: { params: idParam },
      responses: { 200: json(dataOf(detailSchema)), ...errorResponses },
    }),
    async (c) => c.json({ data: serialize(await getConnection(c.req.valid("param").id)) }, 200),
  )
  .openapi(
    createRoute({
      method: "patch",
      path: "/marketplace/connections/{id}",
      tags: ["Marketplace"],
      summary: "Ubah pengaturan koneksi (cabang sumber, tarik order, push stok, buffer, jeda)",
      middleware: [requirePermission("marketplace:manage")] as const,
      request: {
        params: idParam,
        body: body(
          z.object({
            name: z.string().trim().min(2).max(80).optional(),
            branchId: z.string().uuid().optional(),
            pullOrders: z.boolean().optional(),
            pushStock: z.boolean().optional(),
            stockBuffer: z.number().int().min(0).max(1000).optional(),
            status: z.enum(["ACTIVE", "PAUSED"]).optional(),
          }),
        ),
      },
      responses: { 200: json(dataOf(detailSchema)), ...errorResponses },
    }),
    async (c) => c.json({ data: serialize(await updateConnection(c.get("actor"), c.req.valid("param").id, c.req.valid("json"))) }, 200),
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/marketplace/connections/{id}/disconnect",
      tags: ["Marketplace"],
      summary: "Putuskan koneksi (token dihapus; order yang sudah masuk tetap ada)",
      middleware: [requirePermission("marketplace:manage")] as const,
      request: { params: idParam },
      responses: { 200: json(dataOf(detailSchema)), ...errorResponses },
    }),
    async (c) => c.json({ data: serialize(await disconnect(c.get("actor"), c.req.valid("param").id)) }, 200),
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/marketplace/connections/{id}/sync",
      tags: ["Marketplace"],
      summary: "Sinkron sekarang: semua / order / stok / katalog",
      middleware: [requirePermission("marketplace:manage")] as const,
      request: { params: idParam, body: body(z.object({ kind: z.enum(["all", "orders", "stock", "listings"]).default("all") })) },
      responses: { 200: json(dataOf(z.record(z.string(), z.unknown()))), ...errorResponses },
    }),
    async (c) => c.json({ data: await syncConnection(c.req.valid("param").id, c.req.valid("json").kind) }, 200),
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/marketplace/connections/{id}/listings",
      tags: ["Marketplace"],
      summary: "Produk marketplace & pemetaannya ke varian",
      middleware: [requirePermission("marketplace:read")] as const,
      request: { params: idParam, query: pageQuery.extend({ filter: z.enum(["all", "mapped", "unmapped"]).optional(), q: z.string().trim().max(60).optional() }) },
      responses: {
        200: json(
          z.object({
            data: z.array(
              z.object({
                id: z.string(),
                externalItemId: z.string(),
                externalModelId: z.string(),
                externalSku: z.string().nullable(),
                name: z.string(),
                variantId: z.string().nullable(),
                manualMapping: z.boolean(),
                marketplaceStock: z.number().nullable(),
                lastPushedQty: z.number().nullable(),
                lastPushedAt: z.string().nullable(),
                variantSku: z.string().nullable(),
                variantLabel: z.string().nullable(),
              }),
            ),
            meta: pageMeta,
          }),
        ),
        ...errorResponses,
      },
    }),
    async (c) => c.json(serialize(await listListings(c.req.valid("param").id, c.req.valid("query"))), 200),
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/marketplace/listings/{id}",
      tags: ["Marketplace"],
      summary: "Petakan listing ke varian secara manual (null = lepas)",
      middleware: [requirePermission("marketplace:manage")] as const,
      request: { params: idParam, body: body(z.object({ variantId: z.string().uuid().nullable() })) },
      responses: { 200: json(dataOf(z.object({ id: z.string(), connectionId: z.string() }))), ...errorResponses },
    }),
    async (c) => c.json({ data: await mapListing(c.get("actor"), c.req.valid("param").id, c.req.valid("json").variantId) }, 200),
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/marketplace/connections/{id}/mock/orders",
      tags: ["Marketplace"],
      summary: "DEV: order di toko simulasi",
      middleware: [requirePermission("marketplace:manage")] as const,
      request: { params: idParam },
      responses: { 200: json(dataOf(z.array(z.object({ orderSn: z.string(), status: z.string(), updatedAt: z.string() })))), ...errorResponses },
    }),
    async (c) => c.json({ data: serialize(await listMockOrders(c.req.valid("param").id)) }, 200),
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/marketplace/connections/{id}/mock/orders",
      tags: ["Marketplace"],
      summary: "DEV: buat order di toko simulasi (dikirim lewat webhook)",
      middleware: [requirePermission("marketplace:manage")] as const,
      request: {
        params: idParam,
        body: body(z.object({ status: z.enum(["UNPAID", "PAID"]).optional(), qty: z.number().int().min(1).max(50).optional(), unmapped: z.boolean().optional() })),
      },
      responses: { 200: json(dataOf(z.record(z.string(), z.unknown()))), ...errorResponses },
    }),
    async (c) => c.json({ data: await createMockOrder(c.req.valid("param").id, c.req.valid("json")) }, 200),
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/marketplace/connections/{id}/mock/orders/{orderSn}/status",
      tags: ["Marketplace"],
      summary: "DEV: ubah status order simulasi (dikirim lewat webhook)",
      middleware: [requirePermission("marketplace:manage")] as const,
      request: {
        params: idParam.extend({ orderSn: z.string().min(3).max(40) }),
        body: body(z.object({ status: z.enum(["PAID", "SHIPPED", "COMPLETED", "CANCELLED"]) })),
      },
      responses: { 200: json(dataOf(z.record(z.string(), z.unknown()))), ...errorResponses },
    }),
    async (c) => {
      const { id, orderSn } = c.req.valid("param");
      return c.json({ data: await setMockOrderStatus(id, orderSn, c.req.valid("json").status) }, 200);
    },
  );
