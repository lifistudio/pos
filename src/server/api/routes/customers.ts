import { createRoute, z } from "@hono/zod-openapi";
import {
  createCustomer,
  createTier,
  deleteTier,
  getCustomer,
  listCustomers,
  listTiers,
  updateCustomer,
  updateTier,
} from "@/server/services/customer.service";
import { requirePermission } from "../middleware";
import { pageMeta, pageQuery } from "../pagination";
import { createRouter } from "../router";
import { body, dataOf, errorResponses, idParam, json, money, serialize } from "../schemas";

const customerItem = z
  .object({
    id: z.string(),
    name: z.string(),
    phone: z.string(),
    email: z.string().nullable(),
    isMember: z.boolean(),
    memberNo: z.string().nullable(),
    tierId: z.string().nullable(),
    tierName: z.string().nullable(),
    tierDiscountBps: z.number().nullable(),
    points: z.number(),
    totalSpent: z.number(),
    visitCount: z.number(),
    lastVisitAt: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi("CustomerListItem");

const customerDetail = customerItem
  .extend({
    birthDate: z.string().nullable(),
    notes: z.string().nullable(),
    consentAt: z.string().nullable(),
    recentSales: z.array(
      z.object({
        id: z.string(),
        number: z.string(),
        total: z.number(),
        status: z.string(),
        createdAt: z.string(),
        branchName: z.string(),
        voucherCode: z.string().nullable(),
        pointsEarned: z.number(),
      }),
    ),
    pointHistory: z.array(z.object({ id: z.string(), type: z.string(), change: z.number(), balanceAfter: z.number(), reason: z.string().nullable(), createdAt: z.string() })),
  })
  .openapi("CustomerDetail");

const customerInput = z
  .object({
    name: z.string().trim().min(2).max(80),
    phone: z.string().trim().min(8).max(20),
    email: z.string().trim().email().nullish().or(z.literal("")),
    birthDate: z.string().date().nullish().or(z.literal("")),
    notes: z.string().trim().max(500).nullish(),
    isMember: z.boolean().optional(),
    consent: z.boolean().optional().openapi({ description: "Persetujuan penyimpanan data pribadi (wajib untuk member)" }),
  })
  .openapi("CustomerInput");

const tierSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    minSpend: z.number(),
    discountBps: z.number(),
    pointsPer10k: z.number(),
    memberCount: z.number().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("MembershipTier");

const tierInput = z
  .object({
    name: z.string().trim().min(2).max(40),
    minSpend: money,
    discountBps: z.number().int().min(0).max(5000).openapi({ description: "Diskon otomatis, basis poin (500 = 5%), maks 50%" }),
    pointsPer10k: z.number().int().min(0).max(100),
  })
  .openapi("MembershipTierInput");

export const customerRoutes = createRouter()
  .openapi(
    createRoute({
      method: "get",
      path: "/customers",
      tags: ["Customer & member"],
      summary: "Cari customer (nama, no. HP, no. member)",
      middleware: [requirePermission("customer:read")] as const,
      request: {
        query: pageQuery.extend({
          q: z.string().trim().max(60).optional(),
          member: z.enum(["true", "false"]).optional(),
          tierId: z.string().uuid().optional(),
        }),
      },
      responses: { 200: json(z.object({ data: z.array(customerItem), meta: pageMeta })), ...errorResponses },
    }),
    async (c) => {
      const { member, ...rest } = c.req.valid("query");
      return c.json(serialize(await listCustomers({ ...rest, member: member === undefined ? undefined : member === "true" })), 200);
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/customers/{id}",
      tags: ["Customer & member"],
      summary: "Profil customer, transaksi terakhir, dan riwayat poin",
      middleware: [requirePermission("customer:read")] as const,
      request: { params: idParam },
      responses: { 200: json(dataOf(customerDetail)), ...errorResponses },
    }),
    async (c) => c.json({ data: serialize(await getCustomer(c.req.valid("param").id)) }, 200),
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/customers",
      tags: ["Customer & member"],
      summary: "Daftarkan customer / member baru",
      middleware: [requirePermission("customer:create")] as const,
      request: { body: body(customerInput) },
      responses: { 201: json(dataOf(customerDetail), "Customer dibuat"), ...errorResponses },
    }),
    async (c) => c.json({ data: serialize(await createCustomer(c.get("actor"), c.req.valid("json"))) }, 201),
  )
  .openapi(
    createRoute({
      method: "patch",
      path: "/customers/{id}",
      tags: ["Customer & member"],
      summary: "Ubah data customer atau jadikan member",
      middleware: [requirePermission("customer:update")] as const,
      request: { params: idParam, body: body(customerInput.partial()) },
      responses: { 200: json(dataOf(customerDetail)), ...errorResponses },
    }),
    async (c) => c.json({ data: serialize(await updateCustomer(c.get("actor"), c.req.valid("param").id, c.req.valid("json"))) }, 200),
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/membership-tiers",
      tags: ["Customer & member"],
      summary: "Tier member beserta jumlah anggotanya",
      middleware: [requirePermission("customer:read")] as const,
      responses: { 200: json(dataOf(z.array(tierSchema))), ...errorResponses },
    }),
    async (c) => c.json({ data: serialize(await listTiers()) }, 200),
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/membership-tiers",
      tags: ["Customer & member"],
      summary: "Tambah tier (member otomatis ditempatkan ulang sesuai total belanja)",
      middleware: [requirePermission("customer:update")] as const,
      request: { body: body(tierInput) },
      responses: { 201: json(dataOf(tierSchema), "Tier dibuat"), ...errorResponses },
    }),
    async (c) => c.json({ data: serialize(await createTier(c.get("actor"), c.req.valid("json"))) }, 201),
  )
  .openapi(
    createRoute({
      method: "patch",
      path: "/membership-tiers/{id}",
      tags: ["Customer & member"],
      summary: "Ubah tier",
      middleware: [requirePermission("customer:update")] as const,
      request: { params: idParam, body: body(tierInput.partial()) },
      responses: { 200: json(dataOf(tierSchema)), ...errorResponses },
    }),
    async (c) => c.json({ data: serialize(await updateTier(c.get("actor"), c.req.valid("param").id, c.req.valid("json"))) }, 200),
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/membership-tiers/{id}",
      tags: ["Customer & member"],
      summary: "Hapus tier (member dipindah ke tier yang sesuai)",
      middleware: [requirePermission("customer:update")] as const,
      request: { params: idParam },
      responses: { 204: { description: "Dihapus" }, ...errorResponses },
    }),
    async (c) => {
      await deleteTier(c.get("actor"), c.req.valid("param").id);
      return c.body(null, 204);
    },
  );
