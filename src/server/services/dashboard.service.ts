import "server-only";
import { and, asc, eq, gt, inArray, lte, sql, type SQL } from "drizzle-orm";
import { db } from "@/server/db";
import { branches, inventoryLevels, products, productVariants, saleItems, salePayments, sales, stockMovements } from "@/server/db/schema";
import type { Actor } from "@/server/api/context";
import { branchScope, can } from "@/server/rbac/access";

/**
 * Ringkasan stok & katalog untuk dashboard. Modul penjualan belum ada, jadi KPI omzet ditambahkan di fase POS.
 * Semua agregasi di SQL; 4 query paralel berapa pun jumlah produk/cabang.
 */
export async function getInventorySummary(actor: Actor, params: { branchId?: string }) {
  const scope = branchScope(actor.access, "inventory:read");
  const filters: (SQL | undefined)[] = [
    scope === "ALL" ? undefined : scope.length ? inArray(inventoryLevels.branchId, scope) : sql`false`,
    params.branchId ? eq(inventoryLevels.branchId, params.branchId) : undefined,
  ];
  const where = and(...filters);
  const movementWhere = and(
    scope === "ALL" ? undefined : scope.length ? inArray(stockMovements.branchId, scope) : sql`false`,
    params.branchId ? eq(stockMovements.branchId, params.branchId) : undefined,
    sql`${stockMovements.createdAt} >= now() - interval '14 days'`,
  );
  const showCost = can(actor.access, "product:view_cost");

  const [[totals], byBranch, lowStock, movementTrend] = await Promise.all([
    db
      .select({
        activeProducts: sql<number>`count(distinct ${products.id}) filter (where ${products.status} = 'ACTIVE')::int`,
        variants: sql<number>`count(distinct ${productVariants.id})::int`,
        units: sql<number>`coalesce(sum(${inventoryLevels.onHand}), 0)::int`,
        stockValue: sql<number>`coalesce(sum(${inventoryLevels.onHand} * coalesce(${productVariants.costPrice}, 0)), 0)::bigint`.mapWith(Number),
        retailValue: sql<number>`coalesce(sum(${inventoryLevels.onHand} * ${productVariants.price}), 0)::bigint`.mapWith(Number),
        lowCount: sql<number>`count(*) filter (where ${inventoryLevels.onHand} > 0 and ${inventoryLevels.onHand} <= ${inventoryLevels.reorderPoint})::int`,
        outCount: sql<number>`count(*) filter (where ${inventoryLevels.onHand} <= 0)::int`,
      })
      .from(inventoryLevels)
      .innerJoin(productVariants, eq(productVariants.id, inventoryLevels.variantId))
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(where),
    db
      .select({
        branchId: branches.id,
        branchName: branches.name,
        units: sql<number>`coalesce(sum(${inventoryLevels.onHand}), 0)::int`,
        retailValue: sql<number>`coalesce(sum(${inventoryLevels.onHand} * ${productVariants.price}), 0)::bigint`.mapWith(Number),
      })
      .from(inventoryLevels)
      .innerJoin(productVariants, eq(productVariants.id, inventoryLevels.variantId))
      .innerJoin(branches, eq(branches.id, inventoryLevels.branchId))
      .where(where)
      .groupBy(branches.id, branches.name)
      .orderBy(asc(branches.name)),
    db
      .select({
        branchName: branches.name,
        productName: products.name,
        variantTitle: productVariants.title,
        sku: productVariants.sku,
        onHand: inventoryLevels.onHand,
        reorderPoint: inventoryLevels.reorderPoint,
      })
      .from(inventoryLevels)
      .innerJoin(productVariants, eq(productVariants.id, inventoryLevels.variantId))
      .innerJoin(products, eq(products.id, productVariants.productId))
      .innerJoin(branches, eq(branches.id, inventoryLevels.branchId))
      .where(and(where, gt(inventoryLevels.reorderPoint, 0), lte(inventoryLevels.onHand, inventoryLevels.reorderPoint)))
      .orderBy(asc(inventoryLevels.onHand))
      .limit(8),
    db
      .select({
        day: sql<string>`to_char(date_trunc('day', ${stockMovements.createdAt} at time zone 'Asia/Jakarta'), 'YYYY-MM-DD')`,
        inbound: sql<number>`coalesce(sum(${stockMovements.qtyChange}) filter (where ${stockMovements.qtyChange} > 0), 0)::int`,
        outbound: sql<number>`coalesce(-sum(${stockMovements.qtyChange}) filter (where ${stockMovements.qtyChange} < 0), 0)::int`,
      })
      .from(stockMovements)
      .where(movementWhere)
      .groupBy(sql`1`)
      .orderBy(sql`1`),
  ]);

  return {
    totals: { ...totals, stockValue: showCost ? totals.stockValue : null },
    byBranch,
    lowStock,
    movementTrend,
  };
}

/**
 * Ringkasan penjualan: KPI hari ini vs kemarin, tren harian, produk terlaris, dan porsi metode bayar.
 * Hari dihitung dalam WIB (Asia/Jakarta). 4 query agregat paralel.
 */
export async function getSalesSummary(actor: Actor, params: { branchId?: string; days: number }) {
  const scope = branchScope(actor.access, "dashboard:read");
  const branchFilter = and(
    scope === "ALL" ? undefined : scope.length ? inArray(sales.branchId, scope) : sql`false`,
    params.branchId ? eq(sales.branchId, params.branchId) : undefined,
    eq(sales.status, "PAID"),
  );
  const day = sql`(${sales.createdAt} at time zone 'Asia/Jakarta')::date`;
  const today = sql`(now() at time zone 'Asia/Jakarta')::date`;
  const since = sql`${today} - ${params.days - 1}::int`;
  const showCost = can(actor.access, "product:view_cost");
  // Omzet bersih: dikurangi uang retur, dihitung ke tanggal transaksi asal.
  const net = sql`(${sales.total} - ${sales.refundTotal})`;

  const [[kpi], trend, top, mix] = await Promise.all([
    db
      .select({
        todayRevenue: sql<number>`coalesce(sum(${net}) filter (where ${day} = ${today}), 0)::bigint`.mapWith(Number),
        todayCount: sql<number>`count(*) filter (where ${day} = ${today})::int`,
        yesterdayRevenue: sql<number>`coalesce(sum(${net}) filter (where ${day} = ${today} - 1), 0)::bigint`.mapWith(Number),
        yesterdayCount: sql<number>`count(*) filter (where ${day} = ${today} - 1)::int`,
        periodRevenue: sql<number>`coalesce(sum(${net}) filter (where ${day} >= ${since}), 0)::bigint`.mapWith(Number),
        periodCount: sql<number>`count(*) filter (where ${day} >= ${since})::int`,
      })
      .from(sales)
      .where(and(branchFilter, sql`${day} >= ${today} - greatest(${params.days}, 2)`)),
    db
      .select({
        day: sql<string>`to_char(${day}, 'YYYY-MM-DD')`,
        revenue: sql<number>`sum(${net})::bigint`.mapWith(Number),
        count: sql<number>`count(*)::int`,
      })
      .from(sales)
      .where(and(branchFilter, sql`${day} >= ${since}`))
      .groupBy(sql`1`)
      .orderBy(sql`1`),
    db
      .select({
        productName: saleItems.productName,
        variantTitle: saleItems.variantTitle,
        sku: saleItems.sku,
        qty: sql<number>`sum(${saleItems.qty} - ${saleItems.returnedQty})::int`,
        revenue: sql<number>`sum(${saleItems.lineTotal} * (${saleItems.qty} - ${saleItems.returnedQty}) / ${saleItems.qty})::bigint`.mapWith(Number),
        grossProfit: sql<number | null>`case when bool_and(${saleItems.costPrice} is not null) then sum((${saleItems.lineTotal} - ${saleItems.costPrice} * ${saleItems.qty}) * (${saleItems.qty} - ${saleItems.returnedQty}) / ${saleItems.qty}) end`.mapWith((v) => (v == null ? null : Number(v))),
      })
      .from(saleItems)
      .innerJoin(sales, eq(sales.id, saleItems.saleId))
      .where(and(branchFilter, sql`${day} >= ${since}`))
      .groupBy(saleItems.productName, saleItems.variantTitle, saleItems.sku)
      .orderBy(sql`sum(${saleItems.qty} - ${saleItems.returnedQty}) desc`)
      .limit(8),
    db
      .select({ method: salePayments.method, amount: sql<number>`sum(${salePayments.amount})::bigint`.mapWith(Number) })
      .from(salePayments)
      .innerJoin(sales, eq(sales.id, salePayments.saleId))
      .where(and(branchFilter, sql`${day} >= ${since}`))
      .groupBy(salePayments.method),
  ]);

  return {
    days: params.days,
    today: { revenue: kpi.todayRevenue, count: kpi.todayCount, avg: kpi.todayCount ? Math.round(kpi.todayRevenue / kpi.todayCount) : 0 },
    yesterday: { revenue: kpi.yesterdayRevenue, count: kpi.yesterdayCount },
    period: { revenue: kpi.periodRevenue, count: kpi.periodCount },
    trend,
    topProducts: top.map((t) => ({ ...t, grossProfit: showCost ? t.grossProfit : null })),
    paymentMix: mix,
  };
}
