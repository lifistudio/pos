import { createRoute, z } from "@hono/zod-openapi";
import { returnsCsv, returnsReport, salesCsv, salesReport } from "@/server/services/report.service";
import { agingCsv, movementsCsv, shiftReport, shiftsCsv, stockAging, stockMovements, stockValuation, valuationCsv } from "@/server/services/stock-report.service";
import { badRequest } from "../errors";
import { requirePermission } from "../middleware";
import { createRouter } from "../router";
import { dataOf, errorResponses, json } from "../schemas";

const salesGroup = z.enum(["day", "branch", "cashier", "channel", "category", "product", "payment"]);
const returnsGroup = z.enum(["reason", "product", "cashier", "branch"]);
const rangeQuery = z.object({
  from: z.string().datetime().describe("Awal periode (ISO, inklusif)"),
  to: z.string().datetime().describe("Akhir periode (ISO, eksklusif)"),
  branchId: z.string().uuid().optional(),
});

const salesRow = z.object({
  key: z.string(),
  label: z.string(),
  transactions: z.number(),
  units: z.number().nullable(),
  gross: z.number().describe("Harga jual sebelum diskon"),
  discount: z.number(),
  revenue: z.number().describe("Penjualan setelah diskon (tanpa ongkir)"),
  refunds: z.number(),
  net: z.number().describe("Penjualan − retur"),
  grossProfit: z.number().nullable().describe("Hanya bila boleh melihat HPP"),
});
const salesReportSchema = z
  .object({
    groupBy: salesGroup,
    from: z.string(),
    to: z.string(),
    showCost: z.boolean(),
    rows: z.array(salesRow),
    totals: salesRow.omit({ key: true, label: true }).extend({ averageTicket: z.number() }),
  })
  .openapi("SalesReport");

const returnsRow = z.object({ key: z.string(), label: z.string(), returns: z.number(), units: z.number(), damagedUnits: z.number(), amount: z.number() });
const returnsReportSchema = z
  .object({
    groupBy: returnsGroup,
    from: z.string(),
    to: z.string(),
    rows: z.array(returnsRow),
    totals: z.object({ returns: z.number().nullable(), units: z.number(), damagedUnits: z.number(), amount: z.number() }),
  })
  .openapi("ReturnsReport");

const valuationGroup = z.enum(["branch", "category", "product"]);
const movementGroup = z.enum(["type", "product", "category", "branch"]);
const shiftGroup = z.enum(["shift", "cashier"]);

const valuationRow = z.object({
  key: z.string(),
  label: z.string(),
  skus: z.number().describe("Varian x cabang yang berstok"),
  units: z.number(),
  reserved: z.number().describe("Ter-reserve order online"),
  retailValue: z.number().describe("Stok × harga jual"),
  costValue: z.number().nullable().describe("Stok × HPP; null bila tidak boleh melihat HPP atau HPP kosong"),
  missingCost: z.number().describe("Jumlah SKU tanpa HPP"),
});
const valuationSchema = z
  .object({ groupBy: valuationGroup, showCost: z.boolean(), rows: z.array(valuationRow), totals: valuationRow.omit({ key: true, label: true }).extend({ potentialMargin: z.number().nullable() }) })
  .openapi("StockValuation");

const agingItem = z.object({
  branchId: z.string(),
  branchName: z.string(),
  variantId: z.string(),
  sku: z.string(),
  label: z.string(),
  units: z.number(),
  ageDays: z.number().describe("Hari sejak barang terakhir masuk"),
  daysSinceSale: z.number().nullable().describe("null = belum pernah terjual"),
  retailValue: z.number(),
  costValue: z.number().nullable(),
});
const agingSchema = z
  .object({
    showCost: z.boolean(),
    buckets: z.array(z.object({ key: z.string(), label: z.string(), skus: z.number(), units: z.number(), retailValue: z.number(), costValue: z.number().nullable() })),
    slowMoving: z.array(agingItem),
    items: z.array(agingItem),
  })
  .openapi("StockAging");

const movementsSchema = z
  .object({
    groupBy: movementGroup,
    rows: z.array(
      z.object({
        key: z.string(),
        label: z.string(),
        movements: z.number().optional(),
        skus: z.number().optional(),
        qty: z.number().optional(),
        opening: z.number().optional(),
        qtyIn: z.number().optional(),
        qtyOut: z.number().optional(),
        sold: z.number().optional(),
        closing: z.number().optional(),
        turnover: z.number().nullable().optional(),
      }),
    ),
    totals: z.record(z.string(), z.number()),
  })
  .openapi("StockMovementReport");

const shiftRow = z.object({
  id: z.string(),
  status: z.enum(["OPEN", "CLOSED"]),
  openedAt: z.string(),
  closedAt: z.string().nullable(),
  cashierId: z.string(),
  cashierName: z.string(),
  branchName: z.string(),
  openingCash: z.number(),
  cashIn: z.number(),
  cashRefund: z.number(),
  expectedCash: z.number(),
  countedCash: z.number().nullable(),
  difference: z.number().nullable().describe("Kas dihitung − kas seharusnya; negatif = kurang"),
  transactions: z.number(),
  voids: z.number(),
  revenue: z.number(),
  returns: z.number(),
  refundTotal: z.number(),
  manualDiscount: z.number(),
  note: z.string().nullable(),
});
const cashierRow = z.object({
  cashierId: z.string(),
  cashierName: z.string(),
  shifts: z.number(),
  closedShifts: z.number(),
  shortShifts: z.number(),
  transactions: z.number(),
  revenue: z.number(),
  difference: z.number(),
  shortage: z.number(),
  voids: z.number(),
  returns: z.number(),
  refundTotal: z.number(),
  manualDiscount: z.number(),
});
const shiftSchema = z
  .object({
    groupBy: shiftGroup,
    shifts: z.array(shiftRow),
    cashiers: z.array(cashierRow),
    totals: z.object({ shifts: z.number(), open: z.number(), revenue: z.number(), difference: z.number(), shortage: z.number(), surplus: z.number(), voids: z.number(), refundTotal: z.number() }),
  })
  .openapi("ShiftReport");

const csv = { 200: { description: "File CSV (UTF-8 dengan BOM)", content: { "text/csv": { schema: z.string() } } }, ...errorResponses };
const fileName = (kind: string, groupBy: string, from: string) => `laporan-${kind}-${groupBy}-${from.slice(0, 10)}.csv`;

export const reportRoutes = createRouter()
  .openapi(
    createRoute({
      method: "get",
      path: "/reports/sales",
      tags: ["Laporan"],
      summary: "Laporan penjualan per hari / cabang / kasir / kanal / kategori / produk / metode bayar",
      middleware: [requirePermission("report:read")] as const,
      request: { query: rangeQuery.extend({ groupBy: salesGroup }) },
      responses: { 200: json(dataOf(salesReportSchema)), ...errorResponses },
    }),
    async (c) => c.json({ data: await salesReport(c.get("actor"), c.req.valid("query")) }, 200),
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/reports/sales/export",
      tags: ["Laporan"],
      summary: "Export laporan penjualan (CSV)",
      middleware: [requirePermission("report:export")] as const,
      request: { query: rangeQuery.extend({ groupBy: salesGroup }) },
      responses: csv,
    }),
    async (c) => {
      const q = c.req.valid("query");
      const body = salesCsv(await salesReport(c.get("actor"), q));
      return c.body(body, 200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${fileName("penjualan", q.groupBy, q.from)}"` });
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/reports/returns",
      tags: ["Laporan"],
      summary: "Laporan retur per alasan / produk / pemroses / cabang",
      middleware: [requirePermission("report:read")] as const,
      request: { query: rangeQuery.extend({ groupBy: returnsGroup }) },
      responses: { 200: json(dataOf(returnsReportSchema)), ...errorResponses },
    }),
    async (c) => c.json({ data: await returnsReport(c.get("actor"), c.req.valid("query")) }, 200),
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/reports/returns/export",
      tags: ["Laporan"],
      summary: "Export laporan retur (CSV)",
      middleware: [requirePermission("report:export")] as const,
      request: { query: rangeQuery.extend({ groupBy: returnsGroup }) },
      responses: csv,
    }),
    async (c) => {
      const q = c.req.valid("query");
      const body = returnsCsv(await returnsReport(c.get("actor"), q));
      return c.body(body, 200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${fileName("retur", q.groupBy, q.from)}"` });
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/reports/stock-valuation",
      tags: ["Laporan"],
      summary: "Valuasi persediaan saat ini per cabang / kategori / produk (nilai modal hanya bila boleh melihat HPP)",
      middleware: [requirePermission("report:read")] as const,
      request: { query: z.object({ groupBy: valuationGroup, branchId: z.string().uuid().optional() }) },
      responses: { 200: json(dataOf(valuationSchema)), ...errorResponses },
    }),
    async (c) => c.json({ data: await stockValuation(c.get("actor"), c.req.valid("query")) }, 200),
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/reports/stock-aging",
      tags: ["Laporan"],
      summary: "Umur stok (hari sejak barang masuk) per kelompok umur + daftar barang lambat laku",
      middleware: [requirePermission("report:read")] as const,
      request: { query: z.object({ branchId: z.string().uuid().optional() }) },
      responses: { 200: json(dataOf(agingSchema)), ...errorResponses },
    }),
    async (c) => c.json({ data: await stockAging(c.get("actor"), c.req.valid("query")) }, 200),
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/reports/stock-movements",
      tags: ["Laporan"],
      summary: "Pergerakan stok periode: per jenis mutasi, atau saldo awal–masuk–keluar–saldo akhir per produk / kategori / cabang",
      middleware: [requirePermission("report:read")] as const,
      request: { query: rangeQuery.extend({ groupBy: movementGroup }) },
      responses: { 200: json(dataOf(movementsSchema)), ...errorResponses },
    }),
    async (c) => c.json({ data: await stockMovements(c.get("actor"), c.req.valid("query")) }, 200),
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/reports/shifts",
      tags: ["Laporan"],
      summary: "Rekap shift kasir & selisih kas, per shift atau per kasir",
      middleware: [requirePermission("report:read")] as const,
      request: { query: rangeQuery.extend({ groupBy: shiftGroup }) },
      responses: { 200: json(dataOf(shiftSchema)), ...errorResponses },
    }),
    async (c) => c.json({ data: await shiftReport(c.get("actor"), c.req.valid("query")) }, 200),
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/reports/inventory/export",
      tags: ["Laporan"],
      summary: "Export laporan stok / shift (CSV). kind: stock-valuation | stock-aging | stock-movements | shifts",
      middleware: [requirePermission("report:export")] as const,
      request: {
        query: z.object({
          kind: z.enum(["stock-valuation", "stock-aging", "stock-movements", "shifts"]),
          groupBy: z.string().max(20).optional(),
          from: z.string().datetime().optional().describe("Wajib untuk stock-movements & shifts"),
          to: z.string().datetime().optional(),
          branchId: z.string().uuid().optional(),
        }),
      },
      responses: csv,
    }),
    async (c) => {
      const q = c.req.valid("query");
      const actor = c.get("actor");
      const period = () => {
        if (!q.from || !q.to) throw badRequest("RANGE_REQUIRED", "Isi rentang tanggal (from & to).");
        return { from: q.from, to: q.to, branchId: q.branchId };
      };
      const group = <T extends z.ZodEnum>(schema: T, fallback: z.infer<T>): z.infer<T> => {
        const parsed = schema.safeParse(q.groupBy ?? fallback);
        if (!parsed.success) throw badRequest("INVALID_GROUP", "Pengelompokan tidak dikenal.");
        return parsed.data;
      };
      let body: string;
      let groupBy = "";
      if (q.kind === "stock-valuation") {
        groupBy = group(valuationGroup, "branch");
        body = valuationCsv(await stockValuation(actor, { groupBy: groupBy as z.infer<typeof valuationGroup>, branchId: q.branchId }));
      } else if (q.kind === "stock-aging") {
        groupBy = "barang";
        body = agingCsv(await stockAging(actor, { branchId: q.branchId }));
      } else if (q.kind === "stock-movements") {
        groupBy = group(movementGroup, "type");
        body = movementsCsv(await stockMovements(actor, { ...period(), groupBy: groupBy as z.infer<typeof movementGroup> }));
      } else {
        groupBy = group(shiftGroup, "shift");
        body = shiftsCsv(await shiftReport(actor, { ...period(), groupBy: groupBy as z.infer<typeof shiftGroup> }));
      }
      const name = fileName(q.kind, groupBy, q.from ?? new Date().toISOString());
      return c.body(body, 200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"` });
    },
  );
