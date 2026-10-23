import { createRoute, z } from "@hono/zod-openapi";
import {
  createVoucher,
  getVoucher,
  listVouchers,
  setVoucherStatus,
  updateVoucher,
  voucherPerformance,
  voucherUsageList,
} from "@/server/services/voucher.service";
import { requirePermission } from "../middleware";
import { pageMeta, pageQuery } from "../pagination";
import { createRouter } from "../router";
import { body, dataOf, errorResponses, idParam, json, money, serialize } from "../schemas";

const state = z.enum(["ACTIVE", "SCHEDULED", "EXPIRED", "EXHAUSTED", "PAUSED"]);
const productScope = z.enum(["ALL", "CATEGORY", "PRODUCT", "VARIANT"]);
const customerScope = z.enum(["ALL", "MEMBER", "TIER", "CUSTOMER"]);

const voucherListItem = z
  .object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    valueType: z.enum(["NOMINAL", "PERCENT"]),
    value: z.number(),
    maxDiscount: z.number().nullable(),
    minSpend: z.number(),
    startsAt: z.string(),
    endsAt: z.string().nullable(),
    quotaTotal: z.number().nullable(),
    quotaUsed: z.number(),
    productScope,
    customerScope,
    state,
    totalDiscount: z.number(),
    revenue: z.number(),
  })
  .openapi("VoucherListItem");

const voucherDetail = z
  .object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    valueType: z.enum(["NOMINAL", "PERCENT"]),
    value: z.number(),
    maxDiscount: z.number().nullable(),
    minSpend: z.number(),
    maxSpend: z.number().nullable(),
    startsAt: z.string(),
    endsAt: z.string().nullable(),
    quotaTotal: z.number().nullable(),
    quotaUsed: z.number(),
    quotaPerCustomer: z.number().nullable(),
    productScope,
    customerScope,
    status: z.enum(["ACTIVE", "PAUSED"]),
    state,
    targets: z.array(z.object({ type: z.string(), id: z.string(), isExclusion: z.boolean(), label: z.string() })),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("VoucherDetail");

const voucherInput = z
  .object({
    code: z
      .string()
      .trim()
      .min(3)
      .max(30)
      .regex(/^[A-Za-z0-9_-]+$/, "Kode hanya huruf, angka, - dan _"),
    name: z.string().trim().min(2).max(80),
    description: z.string().trim().max(500).nullish(),
    valueType: z.enum(["NOMINAL", "PERCENT"]),
    value: z.number().int().positive().max(1_000_000_000_000).openapi({ description: "NOMINAL: rupiah. PERCENT: basis poin (1500 = 15%)" }),
    maxDiscount: money.nullish(),
    minSpend: money.optional(),
    maxSpend: money.nullish(),
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true }).nullish(),
    quotaTotal: z.number().int().min(1).max(10_000_000).nullish(),
    quotaPerCustomer: z.number().int().min(1).max(1000).nullish(),
    productScope,
    customerScope,
    status: z.enum(["ACTIVE", "PAUSED"]).optional(),
    productIds: z.array(z.string().uuid()).max(500).optional(),
    excludeIds: z.array(z.object({ type: z.enum(["CATEGORY", "PRODUCT", "VARIANT"]), id: z.string().uuid() })).max(500).optional(),
    customerIds: z.array(z.string().uuid()).max(5000).optional(),
    branchIds: z.array(z.string().uuid()).max(200).optional(),
  })
  .openapi("VoucherInput");

const performanceSchema = z
  .object({
    days: z.number(),
    vouchers: z.array(
      z.object({
        voucherId: z.string(),
        code: z.string(),
        name: z.string(),
        state,
        quotaTotal: z.number().nullable(),
        quotaUsed: z.number(),
        uses: z.number(),
        uniqueCustomers: z.number(),
        totalDiscount: z.number(),
        revenue: z.number(),
        avgOrder: z.number(),
      }),
    ),
    trend: z.array(z.object({ day: z.string(), uses: z.number(), discount: z.number(), revenue: z.number() })),
  })
  .openapi("VoucherPerformance");

export const voucherRoutes = createRouter()
  .openapi(
    createRoute({
      method: "get",
      path: "/vouchers",
      tags: ["Voucher"],
      summary: "Daftar voucher dengan status, kuota, total potongan & omzet",
      middleware: [requirePermission("voucher:read")] as const,
      request: { query: pageQuery.extend({ q: z.string().trim().max(60).optional(), state: state.optional() }) },
      responses: { 200: json(z.object({ data: z.array(voucherListItem), meta: pageMeta })), ...errorResponses },
    }),
    async (c) => c.json(serialize(await listVouchers(c.req.valid("query"))), 200),
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/vouchers/performance",
      tags: ["Voucher"],
      summary: "Performa voucher N hari terakhir: pemakaian, customer unik, potongan, omzet, tren",
      middleware: [requirePermission("voucher:read")] as const,
      request: { query: z.object({ days: z.coerce.number().int().min(1).max(365).default(7), voucherId: z.string().uuid().optional() }) },
      responses: { 200: json(dataOf(performanceSchema)), ...errorResponses },
    }),
    async (c) => c.json({ data: await voucherPerformance(c.req.valid("query")) }, 200),
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/vouchers/{id}",
      tags: ["Voucher"],
      summary: "Detail voucher beserta target",
      middleware: [requirePermission("voucher:read")] as const,
      request: { params: idParam },
      responses: { 200: json(dataOf(voucherDetail)), ...errorResponses },
    }),
    async (c) => c.json({ data: serialize(await getVoucher(c.req.valid("param").id)) }, 200),
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/vouchers/{id}/usages",
      tags: ["Voucher"],
      summary: "20 pemakaian terakhir",
      middleware: [requirePermission("voucher:read")] as const,
      request: { params: idParam },
      responses: {
        200: json(
          dataOf(
            z.array(
              z.object({
                saleId: z.string(),
                number: z.string(),
                discount: z.number(),
                saleTotal: z.number(),
                status: z.string(),
                createdAt: z.string(),
                customerName: z.string().nullable(),
                branchName: z.string(),
              }),
            ),
          ),
        ),
        ...errorResponses,
      },
    }),
    async (c) => c.json({ data: serialize(await voucherUsageList(c.req.valid("param").id)) }, 200),
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/vouchers",
      tags: ["Voucher"],
      summary: "Buat voucher",
      middleware: [requirePermission("voucher:create")] as const,
      request: { body: body(voucherInput) },
      responses: { 201: json(dataOf(voucherDetail), "Voucher dibuat"), ...errorResponses },
    }),
    async (c) => c.json({ data: serialize(await createVoucher(c.get("actor"), c.req.valid("json"))) }, 201),
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/vouchers/{id}",
      tags: ["Voucher"],
      summary: "Ubah voucher (target diganti seluruhnya)",
      middleware: [requirePermission("voucher:update")] as const,
      request: { params: idParam, body: body(voucherInput) },
      responses: { 200: json(dataOf(voucherDetail)), ...errorResponses },
    }),
    async (c) => c.json({ data: serialize(await updateVoucher(c.get("actor"), c.req.valid("param").id, c.req.valid("json"))) }, 200),
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/vouchers/{id}/status",
      tags: ["Voucher"],
      summary: "Jeda atau aktifkan kembali voucher",
      middleware: [requirePermission("voucher:update")] as const,
      request: { params: idParam, body: body(z.object({ status: z.enum(["ACTIVE", "PAUSED"]) })) },
      responses: { 200: json(dataOf(voucherDetail)), ...errorResponses },
    }),
    async (c) => c.json({ data: serialize(await setVoucherStatus(c.get("actor"), c.req.valid("param").id, c.req.valid("json").status)) }, 200),
  );
