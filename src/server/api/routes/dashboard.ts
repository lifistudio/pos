import { createRoute, z } from "@hono/zod-openapi";
import { getInventorySummary, getSalesSummary } from "@/server/services/dashboard.service";
import { requirePermission } from "../middleware";
import { createRouter } from "../router";
import { dataOf, errorResponses, json } from "../schemas";

const summarySchema = z
  .object({
    totals: z.object({
      activeProducts: z.number(),
      variants: z.number(),
      units: z.number(),
      stockValue: z.number().nullable().openapi({ description: "null bila tidak punya product:view_cost" }),
      retailValue: z.number(),
      lowCount: z.number(),
      outCount: z.number(),
    }),
    byBranch: z.array(z.object({ branchId: z.string(), branchName: z.string(), units: z.number(), retailValue: z.number() })),
    lowStock: z.array(
      z.object({
        branchName: z.string(),
        productName: z.string(),
        variantTitle: z.string(),
        sku: z.string(),
        onHand: z.number(),
        reorderPoint: z.number(),
      }),
    ),
    movementTrend: z.array(z.object({ day: z.string(), inbound: z.number(), outbound: z.number() })),
  })
  .openapi("InventorySummary");

export const dashboardRoutes = createRouter()
  .openapi(
  createRoute({
    method: "get",
    path: "/dashboard/inventory-summary",
    tags: ["Dashboard"],
    summary: "KPI stok, stok per cabang, stok menipis, dan tren pergerakan 14 hari",
    middleware: [requirePermission("dashboard:read")] as const,
    request: { query: z.object({ branchId: z.string().uuid().optional() }) },
    responses: { 200: json(dataOf(summarySchema)), ...errorResponses },
  }),
  async (c) => c.json({ data: await getInventorySummary(c.get("actor"), c.req.valid("query")) }, 200),
)
  .openapi(
    createRoute({
      method: "get",
      path: "/dashboard/sales-summary",
      tags: ["Dashboard"],
      summary: "Omzet & transaksi hari ini vs kemarin, tren harian, produk terlaris, porsi metode bayar",
      middleware: [requirePermission("dashboard:read")] as const,
      request: {
        query: z.object({
          branchId: z.string().uuid().optional(),
          days: z.coerce.number().int().min(1).max(90).default(14),
        }),
      },
      responses: {
        200: json(
          dataOf(
            z
              .object({
                days: z.number(),
                today: z.object({ revenue: z.number(), count: z.number(), avg: z.number() }),
                yesterday: z.object({ revenue: z.number(), count: z.number() }),
                period: z.object({ revenue: z.number(), count: z.number() }),
                trend: z.array(z.object({ day: z.string(), revenue: z.number(), count: z.number() })),
                topProducts: z.array(
                  z.object({ productName: z.string(), variantTitle: z.string(), sku: z.string(), qty: z.number(), revenue: z.number(), grossProfit: z.number().nullable() }),
                ),
                paymentMix: z.array(z.object({ method: z.string(), amount: z.number() })),
              })
              .openapi("SalesSummary"),
          ),
        ),
        ...errorResponses,
      },
    }),
    async (c) => c.json({ data: await getSalesSummary(c.get("actor"), c.req.valid("query")) }, 200),
  );
