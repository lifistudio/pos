import { MASKED_PAN_RE } from "@/lib/payment-terminal";
import { createRoute, z } from "@hono/zod-openapi";
import {
  checkout,
  findSaleByNumber,
  quoteCart,
  closeShift,
  getCurrentShift,
  getSale,
  getShiftSummary,
  listSales,
  openShift,
  posCatalog,
  voidSale,
} from "@/server/services/sale.service";
import { cancelQris, getQrisStatus, simulateQris, startQrisCheckout, sweepExpiredIntents } from "@/server/services/pos-qris.service";
import { badRequest } from "../errors";
import { requirePermission } from "../middleware";
import { pageMeta, pageQuery } from "../pagination";
import { createRouter } from "../router";
import { body, dataOf, errorResponses, idParam, json, money, serialize } from "../schemas";

const method = z.enum(["CASH", "QRIS", "DEBIT", "CREDIT", "TRANSFER", "EWALLET", "MARKETPLACE"]);
/** Metode yang boleh dipakai kasir (MARKETPLACE hanya dari order marketplace). */
const posMethod = z.enum(["CASH", "QRIS", "DEBIT", "CREDIT", "TRANSFER", "EWALLET"]);
const code = (max: number) => z.string().trim().min(1).max(max).regex(/^[\w .\-/]+$/, "Hanya huruf, angka, spasi, . - /");
/** Data mesin EDC terintegrasi. Nomor kartu wajib tersamar (maks. 4 digit terakhir) — PCI DSS. */
const terminalSchema = z
  .object({
    provider: code(40),
    approvalCode: code(20),
    terminalId: code(20).nullish(),
    merchantId: code(30).nullish(),
    rrn: code(20).nullish(),
    traceNo: code(12).nullish(),
    batchNo: code(12).nullish(),
    cardType: code(40).nullish(),
    maskedPan: z.string().regex(MASKED_PAN_RE, "Nomor kartu harus tersamar (hanya 4 digit terakhir)").nullish(),
  })
  .strict()
  .openapi("TerminalReceipt");
const tax = z.object({ enabled: z.boolean(), rateBps: z.number(), inclusive: z.boolean() });

const shiftSchema = z
  .object({
    id: z.string(),
    branchId: z.string(),
    userId: z.string(),
    status: z.enum(["OPEN", "CLOSED"]),
    openingCash: z.number(),
    expectedCash: z.number().nullable(),
    countedCash: z.number().nullable(),
    note: z.string().nullable(),
    openedAt: z.string(),
    closedAt: z.string().nullable(),
  })
  .openapi("Shift");

const shiftSummarySchema = z
  .object({
    shift: shiftSchema,
    cashierName: z.string(),
    branchName: z.string(),
    paidCount: z.number(),
    voidCount: z.number(),
    revenue: z.number(),
    taxTotal: z.number(),
    payments: z.array(z.object({ method, amount: z.number(), count: z.number() })),
    refundCount: z.number(),
    refundTotal: z.number(),
    cashRefund: z.number().describe("Refund tunai dari laci shift ini (mengurangi kas seharusnya)"),
    expectedCash: z.number(),
    difference: z.number().optional(),
  })
  .openapi("ShiftSummary");

export const saleSchema = z
  .object({
    id: z.string(),
    number: z.string(),
    branchId: z.string(),
    shiftId: z.string().nullable(),
    cashierId: z.string(),
    channel: z.string(),
    status: z.enum(["PENDING", "PAID", "VOIDED"]),
    subtotal: z.number(),
    discountTotal: z.number(),
    customerId: z.string().nullable(),
    memberDiscount: z.number(),
    voucherCode: z.string().nullable(),
    voucherDiscount: z.number(),
    pointsEarned: z.number(),
    pointsRedeemed: z.number(),
    pointsDiscount: z.number(),
    refundTotal: z.number(),
    shippingFee: z.number(),
    manualDiscount: z.number(),
    manualDiscountReason: z.string().nullable(),
    offlineRef: z.string().nullable().describe("Nomor struk sementara bila dibuat offline"),
    syncedAt: z.string().nullable(),
    offlineShortfall: z.array(z.object({ variantId: z.string(), sku: z.string(), qty: z.number() })).nullable(),
    taxTotal: z.number(),
    total: z.number(),
    taxSnapshot: tax,
    note: z.string().nullable(),
    voidedAt: z.string().nullable(),
    voidReason: z.string().nullable(),
    createdAt: z.string(),
    items: z.array(
      z.object({
        id: z.string(),
        variantId: z.string(),
        productName: z.string(),
        variantTitle: z.string(),
        sku: z.string(),
        qty: z.number(),
        unitPrice: z.number(),
        costPrice: z.number().nullable().optional(),
        discount: z.number(),
        lineTotal: z.number(),
        returnedQty: z.number(),
      }),
    ),
    payments: z.array(
      z.object({ id: z.string(), method, amount: z.number(), tendered: z.number().nullable(), change: z.number(), reference: z.string().nullable(), terminal: terminalSchema.nullable().optional() }),
    ),
    branch: z.object({
      id: z.string(),
      code: z.string(),
      name: z.string(),
      address: z.string().nullable(),
      phone: z.string().nullable(),
      timezone: z.string(),
      settings: z.record(z.string(), z.unknown()),
    }),
    cashier: z.object({ id: z.string(), name: z.string() }),
    customer: z.object({ id: z.string(), name: z.string(), memberNo: z.string().nullable(), points: z.number() }).nullable(),
    returns: z.array(
      z.object({
        id: z.string(),
        number: z.string(),
        refundMethod: method,
        refundAmount: z.number(),
        pointsReversed: z.number(),
        pointsRestored: z.number(),
        reason: z.string(),
        createdAt: z.string(),
        createdByUser: z.object({ name: z.string() }),
        items: z.array(z.object({ saleItemId: z.string(), qty: z.number(), restock: z.boolean() })),
      }),
    ),
  })
  .openapi("Sale");

const posQrisSchema = z
  .object({
    sale: saleSchema,
    payment: z
      .object({
        id: z.string(),
        status: z.enum(["PENDING", "PAID", "EXPIRED", "FAILED", "CANCELLED"]),
        amount: z.number(),
        qrString: z.string().nullable(),
        expiresAt: z.string(),
        paidAt: z.string().nullable(),
        provider: z.string(),
      })
      .nullable(),
    simulator: z.boolean(),
  })
  .openapi("PosQris");

export const salesRoutes = createRouter()
  .openapi(
    createRoute({
      method: "get",
      path: "/pos/session",
      tags: ["Kasir (POS)"],
      summary: "Shift terbuka milik kasir di cabang ini + pengaturan pajak cabang",
      middleware: [requirePermission("pos:access")] as const,
      request: { query: z.object({ branchId: z.string().uuid() }) },
      responses: {
        200: json(
          dataOf(
            z.object({
              shift: shiftSchema.nullable(),
              branch: z.object({ id: z.string(), code: z.string(), name: z.string(), tax }),
              qris: z.object({ dynamic: z.boolean().describe("QRIS dinamis via gateway tersedia"), simulator: z.boolean() }),
            }),
          ),
        ),
        ...errorResponses,
      },
    }),
    async (c) => c.json({ data: serialize(await getCurrentShift(c.get("actor"), c.req.valid("query").branchId)) }, 200),
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/pos/shifts",
      tags: ["Kasir (POS)"],
      summary: "Buka shift dengan kas awal",
      middleware: [requirePermission("pos:access")] as const,
      request: { body: body(z.object({ branchId: z.string().uuid(), openingCash: money })) },
      responses: { 201: json(dataOf(shiftSchema), "Shift dibuka"), ...errorResponses },
    }),
    async (c) => c.json({ data: serialize(await openShift(c.get("actor"), c.req.valid("json"))) }, 201),
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/pos/shifts/{id}",
      tags: ["Kasir (POS)"],
      summary: "Ringkasan shift: jumlah transaksi, omzet, per metode bayar, kas seharusnya",
      request: { params: idParam },
      responses: { 200: json(dataOf(shiftSummarySchema)), ...errorResponses },
    }),
    async (c) => c.json({ data: serialize(await getShiftSummary(c.get("actor"), c.req.valid("param").id)) }, 200),
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/pos/shifts/{id}/close",
      tags: ["Kasir (POS)"],
      summary: "Tutup shift dengan hasil hitung kas; selisih dicatat",
      request: { params: idParam, body: body(z.object({ countedCash: money, note: z.string().trim().max(300).nullish() })) },
      responses: { 200: json(dataOf(shiftSummarySchema)), ...errorResponses },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      // QR yang sudah kedaluwarsa di shift ini dibereskan dulu agar tidak menghalangi tutup shift.
      await sweepExpiredIntents({ shiftId: id });
      return c.json({ data: serialize(await closeShift(c.get("actor"), id, c.req.valid("json"))) }, 200);
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/pos/catalog",
      tags: ["Kasir (POS)"],
      summary: "Varian yang bisa dijual + stok tersedia di cabang (cari nama/SKU/barcode)",
      middleware: [requirePermission("pos:access")] as const,
      request: {
        query: pageQuery.extend({
          branchId: z.string().uuid(),
          q: z.string().trim().max(100).optional(),
          categoryId: z.string().uuid().optional(),
        }),
      },
      responses: {
        200: json(
          z.object({
            data: z.array(
              z.object({
                variantId: z.string(),
                productId: z.string(),
                productName: z.string(),
                title: z.string(),
                sku: z.string(),
                barcode: z.string().nullable(),
                price: z.number(),
                imageUrl: z.string().nullable(),
                categoryName: z.string().nullable(),
                available: z.number(),
              }),
            ),
            meta: pageMeta,
          }),
        ),
        ...errorResponses,
      },
    }),
    async (c) => c.json(await posCatalog(c.get("actor"), c.req.valid("query")), 200),
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/pos/quote",
      tags: ["Kasir (POS)"],
      summary: "Pratinjau total: diskon member, voucher (dengan alasan bila ditolak), PPN, poin",
      middleware: [requirePermission("pos:access")] as const,
      request: {
        body: body(
          z.object({
            branchId: z.string().uuid(),
            items: z.array(z.object({ variantId: z.string().uuid(), qty: z.number().int().min(1).max(10_000) })).min(1).max(300),
            customerId: z.string().uuid().nullish(),
            voucherCode: z.string().trim().max(30).nullish(),
            pointsRedeem: z.number().int().min(0).max(10_000_000).nullish().describe("Poin member yang ingin ditukar"),
            manualDiscount: z
              .object({ type: z.enum(["NOMINAL", "PERCENT"]), value: z.number().int().min(1).max(100_000_000).describe("Rupiah, atau basis poin untuk PERCENT (1000 = 10%)"), reason: z.string().trim().max(200) })
              .nullish(),
          }),
        ),
      },
      responses: {
        200: json(
          dataOf(
            z
              .object({
                gross: z.number(),
                subtotal: z.number(),
                memberDiscount: z.number(),
                memberDiscountBps: z.number(),
                voucherDiscount: z.number(),
                pointsDiscount: z.number(),
                points: z
                  .object({
                    balance: z.number(),
                    maxRedeemable: z.number(),
                    pointValue: z.number(),
                    minRedeem: z.number(),
                    requested: z.number(),
                    redeemed: z.number(),
                    reason: z.string().nullable(),
                  })
                  .nullable()
                  .describe("Hanya untuk member: saldo, batas tukar, dan hasil tukar poin"),
                manualDiscount: z.number(),
                manual: z.object({ requested: z.number(), applied: z.number(), capped: z.boolean() }).nullable(),
                manualNeedsApproval: z.boolean(),
                taxTotal: z.number(),
                total: z.number(),
                pointsEarned: z.number(),
                voucher: z.object({ code: z.string(), applied: z.boolean(), reason: z.string().nullable() }).nullable(),
                lines: z.array(z.object({ variantId: z.string(), memberDiscount: z.number(), voucherDiscount: z.number(), manualDiscount: z.number(), pointsDiscount: z.number(), lineTotal: z.number() })),
              })
              .openapi("CartQuote"),
          ),
        ),
        ...errorResponses,
      },
    }),
    async (c) => c.json({ data: await quoteCart(c.get("actor"), c.req.valid("json")) }, 200),
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/sales",
      tags: ["Transaksi"],
      summary: "Checkout POS: simpan transaksi, pembayaran, dan potong stok (atomik)",
      description:
        "Wajib header `Idempotency-Key` (UUID per transaksi). Request ulang dengan kunci sama mengembalikan transaksi yang sama, tidak membuat transaksi ganda. Harga & pajak dihitung ulang di server.",
      middleware: [requirePermission("pos:access")] as const,
      request: {
        headers: z.object({ "idempotency-key": z.string().min(8).max(100), "x-approval-id": z.string().uuid().optional() }),
        body: body(
          z
            .object({
              branchId: z.string().uuid(),
              items: z.array(z.object({ variantId: z.string().uuid(), qty: z.number().int().min(1).max(10_000) })).min(1, "Keranjang kosong").max(300),
              customerId: z.string().uuid().nullish(),
              voucherCode: z.string().trim().max(30).nullish(),
              pointsRedeem: z.number().int().min(0).max(10_000_000).nullish(),
              manualDiscount: z
              .object({ type: z.enum(["NOMINAL", "PERCENT"]), value: z.number().int().min(1).max(100_000_000).describe("Rupiah, atau basis poin untuk PERCENT (1000 = 10%)"), reason: z.string().trim().max(200) })
              .nullish(),
              payments: z
                .array(
                  z.object({
                    method: posMethod,
                    amount: money.refine((n) => n > 0, "Nominal harus lebih dari 0"),
                    tendered: money.nullish(),
                    reference: z.string().trim().max(100).nullish(),
                    terminal: terminalSchema.nullish(),
                  }),
                )
                .min(1, "Pilih metode pembayaran")
                .max(5),
              note: z.string().trim().max(300).nullish(),
            })
            .openapi("CheckoutInput"),
        ),
      },
      responses: { 201: json(dataOf(saleSchema), "Transaksi tersimpan"), ...errorResponses },
    }),
    async (c) => {
      const headers = c.req.valid("header");
      const key = headers["idempotency-key"];
      if (!key) throw badRequest("IDEMPOTENCY_KEY_REQUIRED", "Header Idempotency-Key wajib diisi.");
      return c.json({ data: serialize(await checkout(c.get("actor"), { ...c.req.valid("json"), idempotencyKey: key, approvalId: headers["x-approval-id"] })) }, 201);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/pos/qris",
      tags: ["Kasir (POS)"],
      summary: "Bayar dengan QRIS dinamis: transaksi PENDING + QR; lunas otomatis lewat webhook gateway",
      description:
        "Wajib header `Idempotency-Key`. Harga, stok, voucher, dan poin tukar dikunci saat QR dibuat. Pantau lewat `GET /pos/qris/{id}`; QR kedaluwarsa/dibatalkan → transaksi dibalik (stok kembali).",
      middleware: [requirePermission("pos:access")] as const,
      request: {
        headers: z.object({ "idempotency-key": z.string().min(8).max(100), "x-approval-id": z.string().uuid().optional() }),
        body: body(
          z.object({
            branchId: z.string().uuid(),
            items: z.array(z.object({ variantId: z.string().uuid(), qty: z.number().int().min(1).max(10_000) })).min(1, "Keranjang kosong").max(300),
            customerId: z.string().uuid().nullish(),
            voucherCode: z.string().trim().max(30).nullish(),
            pointsRedeem: z.number().int().min(0).max(10_000_000).nullish(),
            manualDiscount: z
              .object({ type: z.enum(["NOMINAL", "PERCENT"]), value: z.number().int().min(1).max(100_000_000).describe("Rupiah, atau basis poin untuk PERCENT (1000 = 10%)"), reason: z.string().trim().max(200) })
              .nullish(),
            note: z.string().trim().max(300).nullish(),
          }),
        ),
      },
      responses: { 200: json(dataOf(posQrisSchema)), ...errorResponses },
    }),
    async (c) => {
      const headers = c.req.valid("header");
      return c.json(
        { data: serialize(await startQrisCheckout(c.get("actor"), { ...c.req.valid("json"), idempotencyKey: headers["idempotency-key"], approvalId: headers["x-approval-id"] })) },
        200,
      );
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/pos/qris/{id}",
      tags: ["Kasir (POS)"],
      summary: "Status QRIS transaksi kasir (dicek ke gateway bila webhook belum masuk)",
      middleware: [requirePermission("pos:access")] as const,
      request: { params: idParam },
      responses: { 200: json(dataOf(posQrisSchema)), ...errorResponses },
    }),
    async (c) => c.json({ data: serialize(await getQrisStatus(c.get("actor"), c.req.valid("param").id)) }, 200),
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/pos/qris/{id}/cancel",
      tags: ["Kasir (POS)"],
      summary: "Batalkan QRIS yang belum dibayar; transaksi dibalik (stok, voucher, poin kembali)",
      middleware: [requirePermission("pos:access")] as const,
      request: { params: idParam },
      responses: { 200: json(dataOf(posQrisSchema)), ...errorResponses },
    }),
    async (c) => c.json({ data: serialize(await cancelQris(c.get("actor"), c.req.valid("param").id)) }, 200),
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/pos/qris/{id}/simulate",
      tags: ["Kasir (POS)"],
      summary: "DEV: simulasikan pelanggan membayar QR (hanya PAYMENT_PROVIDER=mock)",
      middleware: [requirePermission("pos:access")] as const,
      request: { params: idParam },
      responses: { 200: json(dataOf(posQrisSchema)), ...errorResponses },
    }),
    async (c) => c.json({ data: serialize(await simulateQris(c.get("actor"), c.req.valid("param").id)) }, 200),
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/sales",
      tags: ["Transaksi"],
      summary: "Daftar transaksi (filter cabang, shift, status, tanggal, nomor)",
      request: {
        query: pageQuery.extend({
          branchId: z.string().uuid().optional(),
          shiftId: z.string().uuid().optional(),
          status: z.enum(["PENDING", "PAID", "VOIDED"]).optional(),
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
                status: z.enum(["PENDING", "PAID", "VOIDED"]),
                total: z.number(),
                refundTotal: z.number(),
                createdAt: z.string(),
                branchName: z.string(),
                cashierName: z.string(),
                itemQty: z.number(),
                methods: z.array(z.string()).nullable(),
              }),
            ),
            meta: pageMeta,
          }),
        ),
        ...errorResponses,
      },
    }),
    async (c) => c.json(serialize(await listSales(c.get("actor"), c.req.valid("query"))), 200),
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/sales/lookup",
      tags: ["Transaksi"],
      summary: "Cari struk berdasarkan nomor persis (untuk retur di kasir)",
      request: { query: z.object({ number: z.string().trim().min(3).max(60) }) },
      responses: { 200: json(dataOf(saleSchema)), ...errorResponses },
    }),
    async (c) => c.json({ data: serialize(await findSaleByNumber(c.get("actor"), c.req.valid("query").number)) }, 200),
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/sales/{id}",
      tags: ["Transaksi"],
      summary: "Detail transaksi (untuk struk)",
      request: { params: idParam },
      responses: { 200: json(dataOf(saleSchema)), ...errorResponses },
    }),
    async (c) => c.json({ data: serialize(await getSale(c.get("actor"), c.req.valid("param").id)) }, 200),
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/sales/{id}/void",
      tags: ["Transaksi"],
      summary: "Batalkan transaksi (sebelum shift ditutup); stok dikembalikan",
      request: {
        headers: z.object({ "x-approval-id": z.string().uuid().optional().describe("Izin PIN atasan bila tidak punya pos:void") }),
        params: idParam,
        body: body(z.object({ reason: z.string().trim().min(3, "Tuliskan alasan").max(200) })),
      },
      responses: { 200: json(dataOf(saleSchema)), ...errorResponses },
    }),
    async (c) =>
      c.json({ data: serialize(await voidSale(c.get("actor"), c.req.valid("param").id, c.req.valid("json").reason, c.req.valid("header")["x-approval-id"])) }, 200),
  );
