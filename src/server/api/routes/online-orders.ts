import { createRoute, z } from "@hono/zod-openapi";
import {
  advanceOrder,
  cancelOrder,
  createOrder,
  createQrisPayment,
  expireStaleOrders,
  getOrder,
  listOrders,
  markPaidManual,
} from "@/server/services/online-order.service";
import { simulateIntentPaid, syncLatest } from "@/server/services/payment.service";
import { latestIntent } from "@/server/payments/intents";
import { sweepExpiredIntents } from "@/server/services/pos-qris.service";
import { conflict } from "../errors";
import { requirePermission } from "../middleware";
import { pageMeta, pageQuery } from "../pagination";
import { createRouter } from "../router";
import { body, dataOf, errorResponses, idParam, json, money, serialize } from "../schemas";

const channel = z.enum(["WEBSITE", "WHATSAPP", "INSTAGRAM", "SHOPEE", "TOKOPEDIA", "TIKTOK", "LAZADA", "OTHER"]);
const status = z.enum(["PENDING_PAYMENT", "PAID", "PACKED", "SHIPPED", "COMPLETED", "CANCELLED"]);
const manualMethod = z.enum(["TRANSFER", "QRIS", "EWALLET", "CASH", "DEBIT", "CREDIT"]);

const paymentSchema = z
  .object({
    id: z.string(),
    provider: z.string(),
    gatewayOrderId: z.string(),
    method: z.string(),
    amount: z.number(),
    status: z.enum(["PENDING", "PAID", "EXPIRED", "FAILED", "CANCELLED"]),
    qrString: z.string().nullable(),
    expiresAt: z.string(),
    paidAt: z.string().nullable(),
  })
  .openapi("PaymentIntent");

const orderSchema = z
  .object({
    id: z.string(),
    number: z.string(),
    branchId: z.string(),
    channel,
    externalOrderNo: z.string().nullable(),
    connectionId: z.string().nullable().describe("Toko marketplace asal; null = input manual"),
    status,
    customerId: z.string().nullable(),
    recipientName: z.string(),
    recipientPhone: z.string(),
    shippingAddress: z.string(),
    courier: z.string().nullable(),
    trackingNo: z.string().nullable(),
    shippingFee: z.number(),
    subtotal: z.number(),
    taxTotal: z.number(),
    total: z.number(),
    note: z.string().nullable(),
    reservedUntil: z.string(),
    saleId: z.string().nullable(),
    paidAt: z.string().nullable(),
    packedAt: z.string().nullable(),
    shippedAt: z.string().nullable(),
    completedAt: z.string().nullable(),
    cancelledAt: z.string().nullable(),
    cancelReason: z.string().nullable(),
    createdAt: z.string(),
    items: z.array(
      z.object({ variantId: z.string(), productName: z.string(), variantTitle: z.string(), sku: z.string(), qty: z.number(), unitPrice: z.number(), lineTotal: z.number() }),
    ),
    branch: z.object({ id: z.string(), name: z.string(), code: z.string() }),
    customer: z.object({ id: z.string(), name: z.string(), memberNo: z.string().nullable() }).nullable(),
    createdByUser: z.object({ name: z.string() }).nullable(),
    sale: z.object({ id: z.string(), number: z.string(), status: z.string(), refundTotal: z.number() }).nullable(),
    payment: paymentSchema.nullable(),
    qris: z.object({ available: z.boolean(), provider: z.string().nullable(), simulator: z.boolean() }),
    refundRequired: z.boolean().optional(),
  })
  .openapi("OnlineOrder");

export const onlineOrderRoutes = createRouter()
  .openapi(
    createRoute({
      method: "get",
      path: "/online-orders",
      tags: ["Order online"],
      summary: "Daftar order online (filter cabang, status, kanal, cari nomor/resi/penerima) + jumlah per status",
      middleware: [requirePermission("online_order:read")] as const,
      request: {
        query: pageQuery.extend({
          branchId: z.string().uuid().optional(),
          status: status.optional(),
          channel: channel.optional(),
          q: z.string().trim().max(60).optional(),
        }),
      },
      responses: {
        200: json(
          z.object({
            data: z.array(
              z.object({
                id: z.string(),
                number: z.string(),
                channel,
                externalOrderNo: z.string().nullable(),
                status,
                recipientName: z.string(),
                branchName: z.string(),
                total: z.number(),
                itemQty: z.number(),
                courier: z.string().nullable(),
                trackingNo: z.string().nullable(),
                reservedUntil: z.string(),
                createdAt: z.string(),
              }),
            ),
            meta: pageMeta.extend({ statusCounts: z.record(z.string(), z.number()) }),
          }),
        ),
        ...errorResponses,
      },
    }),
    async (c) => c.json(serialize(await listOrders(c.get("actor"), c.req.valid("query"))), 200),
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/online-orders",
      tags: ["Order online"],
      summary: "Buat order online manual; stok cabang sumber langsung di-reserve",
      middleware: [requirePermission("online_order:create")] as const,
      request: {
        body: body(
          z
            .object({
              branchId: z.string().uuid(),
              channel,
              externalOrderNo: z.string().trim().max(60).nullish(),
              customerId: z.string().uuid().nullish(),
              recipientName: z.string().trim().min(2, "Isi nama penerima").max(100),
              recipientPhone: z.string().trim().min(6, "Isi nomor HP penerima").max(20),
              shippingAddress: z.string().trim().min(10, "Isi alamat lengkap").max(500),
              courier: z.string().trim().max(60).nullish(),
              shippingFee: money.default(0),
              note: z.string().trim().max(300).nullish(),
              paymentDeadlineHours: z.number().int().min(1).max(168).default(24),
              items: z.array(z.object({ variantId: z.string().uuid(), qty: z.number().int().min(1).max(10_000) })).min(1, "Tambahkan barang").max(200),
            })
            .openapi("CreateOnlineOrderInput"),
        ),
      },
      responses: { 201: json(dataOf(orderSchema), "Order dibuat"), ...errorResponses },
    }),
    async (c) => c.json({ data: serialize(await createOrder(c.get("actor"), c.req.valid("json"))) }, 201),
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/online-orders/expire",
      tags: ["Order online"],
      summary: "Cron (mis. tiap 5 menit): batalkan order belum bayar yang lewat batas + tutup QRIS kasir kedaluwarsa",
      middleware: [requirePermission("online_order:update")] as const,
      responses: { 200: json(dataOf(z.object({ expired: z.number() }))), ...errorResponses },
    }),
    async (c) => {
      const orders = await expireStaleOrders();
      await sweepExpiredIntents(); // QRIS kasir yang ditinggal tanpa dibayar
      return c.json({ data: orders }, 200);
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/online-orders/{id}",
      tags: ["Order online"],
      summary: "Detail order + status pembayaran (status QRIS dicek ke gateway bila webhook belum masuk)",
      middleware: [requirePermission("online_order:read")] as const,
      request: { params: idParam },
      responses: { 200: json(dataOf(orderSchema)), ...errorResponses },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const order = await getOrder(c.get("actor"), id);
      // Webhook bisa terlambat/tidak sampai (mis. dev tanpa URL publik): cek status langsung ke gateway.
      if (order.status === "PENDING_PAYMENT" && order.payment?.status === "PENDING") {
        await syncLatest("online_order", id);
        return c.json({ data: serialize(await getOrder(c.get("actor"), id)) }, 200);
      }
      return c.json({ data: serialize(order) }, 200);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/online-orders/{id}/payments/qris",
      tags: ["Order online"],
      summary: "Buat QRIS dinamis (atau pakai QR yang masih aktif)",
      middleware: [requirePermission("online_order:update")] as const,
      request: { params: idParam },
      responses: { 200: json(dataOf(orderSchema)), ...errorResponses },
    }),
    async (c) => c.json({ data: serialize(await createQrisPayment(c.get("actor"), c.req.valid("param").id)) }, 200),
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/online-orders/{id}/payments/simulate",
      tags: ["Order online"],
      summary: "DEV: simulasikan QRIS dibayar (hanya PAYMENT_PROVIDER=mock, non-production)",
      middleware: [requirePermission("online_order:update")] as const,
      request: { params: idParam },
      responses: { 200: json(dataOf(z.object({ outcome: z.string(), order: orderSchema }))), ...errorResponses },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      await getOrder(c.get("actor"), id); // cek akses cabang
      const intent = await latestIntent("online_order", id);
      if (!intent) throw conflict("NO_PENDING_QRIS", "Buat QRIS terlebih dahulu.");
      const result = await simulateIntentPaid(intent);
      return c.json({ data: serialize({ ...result, order: await getOrder(c.get("actor"), id) }) }, 200);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/online-orders/{id}/payments/manual",
      tags: ["Order online"],
      summary: "Catat pembayaran manual (transfer, COD, dana dari marketplace)",
      middleware: [requirePermission("online_order:update")] as const,
      request: { params: idParam, body: body(z.object({ method: manualMethod, reference: z.string().trim().max(100).nullish() })) },
      responses: { 200: json(dataOf(orderSchema)), ...errorResponses },
    }),
    async (c) => c.json({ data: serialize(await markPaidManual(c.get("actor"), c.req.valid("param").id, c.req.valid("json"))) }, 200),
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/online-orders/{id}/cancel",
      tags: ["Order online"],
      summary: "Batalkan order yang belum dikirim; reservasi dilepas (dana lunas dikembalikan manual)",
      middleware: [requirePermission("online_order:update")] as const,
      request: { params: idParam, body: body(z.object({ reason: z.string().trim().min(3, "Tuliskan alasan").max(200) })) },
      responses: { 200: json(dataOf(orderSchema)), ...errorResponses },
    }),
    async (c) => c.json({ data: serialize(await cancelOrder(c.get("actor"), c.req.valid("param").id, c.req.valid("json").reason)) }, 200),
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/online-orders/{id}/{action}",
      tags: ["Order online"],
      summary: "Lanjutkan status: pack (dikemas), ship (dikirim — stok dipotong), complete (selesai)",
      middleware: [requirePermission("online_order:update")] as const,
      request: {
        params: idParam.extend({ action: z.enum(["pack", "ship", "complete"]) }),
        body: body(z.object({ courier: z.string().trim().max(60).nullish(), trackingNo: z.string().trim().max(60).nullish() })),
      },
      responses: { 200: json(dataOf(orderSchema)), ...errorResponses },
    }),
    async (c) => {
      const { id, action } = c.req.valid("param");
      return c.json({ data: serialize(await advanceOrder(c.get("actor"), id, action, c.req.valid("json"))) }, 200);
    },
  );
