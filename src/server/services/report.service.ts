import "server-only";
import { and, desc, eq, gte, inArray, lt, sql, type SQL } from "drizzle-orm";
import { db } from "@/server/db";
import { branches, categories, productVariants, products, saleItems, salePayments, saleReturnItems, saleReturns, sales, user } from "@/server/db/schema";
import type { Actor } from "@/server/api/context";
import { badRequest } from "@/server/api/errors";
import { branchScope, can } from "@/server/rbac/access";

export type SalesGroup = "day" | "branch" | "cashier" | "channel" | "category" | "product" | "payment";
export type ReturnsGroup = "reason" | "product" | "cashier" | "branch";
export type ReportRange = { from: string; to: string; branchId?: string };

export type SalesRow = {
  key: string;
  label: string;
  transactions: number;
  units: number | null;
  gross: number;
  discount: number;
  revenue: number;
  refunds: number;
  net: number;
  grossProfit: number | null;
};

const MAX_DAYS = 366;

function range(params: ReportRange) {
  const from = new Date(params.from);
  const to = new Date(params.to);
  if (!(from < to)) throw badRequest("RANGE_INVALID", "Tanggal akhir harus setelah tanggal awal.");
  if ((to.getTime() - from.getTime()) / 86_400_000 > MAX_DAYS) throw badRequest("RANGE_TOO_LONG", "Rentang laporan maksimal 1 tahun.");
  return { from, to };
}

function scopeFilter(actor: Actor, column: typeof sales.branchId | typeof saleReturns.branchId, branchId?: string): (SQL | undefined)[] {
  const scope = branchScope(actor.access, "report:read");
  return [scope === "ALL" ? undefined : scope.length ? inArray(column, scope) : sql`false`, branchId ? eq(column, branchId) : undefined];
}

const num = (v: unknown) => Number(v ?? 0);
const day = sql`(${sales.createdAt} at time zone 'Asia/Jakarta')::date`;

/**
 * Laporan penjualan per dimensi, satu query agregat per permintaan (tanpa N+1).
 * - Dimensi transaksi (hari/cabang/kasir/kanal): angka dari header transaksi; ongkir tidak dihitung sebagai penjualan.
 * - Dimensi barang (kategori/produk): angka dari baris barang (sebelum PPN eksklusif); unit bersih = qty − diretur.
 * Penjualan bersih = penjualan − uang retur. Laba kotor hanya untuk yang boleh melihat HPP.
 */
export async function salesReport(actor: Actor, params: ReportRange & { groupBy: SalesGroup }) {
  const { from, to } = range(params);
  const showCost = can(actor.access, "product:view_cost");
  const base = and(eq(sales.status, "PAID"), gte(sales.createdAt, from), lt(sales.createdAt, to), ...scopeFilter(actor, sales.branchId, params.branchId));
  let rows: SalesRow[];

  if (params.groupBy === "category" || params.groupBy === "product") {
    const keyCol = params.groupBy === "category" ? sql<string>`coalesce(${categories.id}::text, 'none')` : sql<string>`${saleItems.variantId}::text`;
    const labelCol =
      params.groupBy === "category"
        ? sql<string>`coalesce(${categories.name}, 'Tanpa kategori')`
        : sql<string>`${saleItems.productName} || case when ${saleItems.variantTitle} = 'Default' then '' else ' · ' || ${saleItems.variantTitle} end`;
    const kept = sql`(${saleItems.qty} - ${saleItems.returnedQty})::numeric / ${saleItems.qty}`;
    const data = await db
      .select({
        key: keyCol,
        label: labelCol,
        transactions: sql<number>`count(distinct ${saleItems.saleId})::int`,
        units: sql<number>`sum(${saleItems.qty} - ${saleItems.returnedQty})::int`,
        gross: sql<number>`sum(${saleItems.unitPrice} * ${saleItems.qty})::bigint`,
        discount: sql<number>`sum(${saleItems.discount})::bigint`,
        revenue: sql<number>`sum(${saleItems.lineTotal})::bigint`,
        refunds: sql<number>`round(sum(${saleItems.lineTotal} * ${saleItems.returnedQty}::numeric / ${saleItems.qty}))::bigint`,
        grossProfit: sql<number | null>`case when bool_and(${saleItems.costPrice} is not null) then round(sum((${saleItems.lineTotal} - ${saleItems.costPrice} * ${saleItems.qty}) * ${kept}))::bigint end`,
      })
      .from(saleItems)
      .innerJoin(sales, eq(sales.id, saleItems.saleId))
      .innerJoin(productVariants, eq(productVariants.id, saleItems.variantId))
      .innerJoin(products, eq(products.id, productVariants.productId))
      .leftJoin(categories, eq(categories.id, products.categoryId))
      .where(base)
      .groupBy(sql`1`, sql`2`)
      .orderBy(desc(sql`sum(${saleItems.lineTotal})`))
      .limit(params.groupBy === "product" ? 200 : 100);
    rows = data.map((r) => ({
      key: r.key,
      label: r.label,
      transactions: num(r.transactions),
      units: num(r.units),
      gross: num(r.gross),
      discount: num(r.discount),
      revenue: num(r.revenue),
      refunds: num(r.refunds),
      net: num(r.revenue) - num(r.refunds),
      grossProfit: showCost && r.grossProfit !== null ? num(r.grossProfit) : null,
    }));
  } else if (params.groupBy === "payment") {
    const [paid, refunded] = await Promise.all([
      db
        .select({ key: salePayments.method, transactions: sql<number>`count(distinct ${salePayments.saleId})::int`, amount: sql<number>`sum(${salePayments.amount})::bigint` })
        .from(salePayments)
        .innerJoin(sales, eq(sales.id, salePayments.saleId))
        .where(base)
        .groupBy(salePayments.method),
      db
        .select({ key: saleReturns.refundMethod, amount: sql<number>`sum(${saleReturns.refundAmount})::bigint` })
        .from(saleReturns)
        .innerJoin(sales, eq(sales.id, saleReturns.saleId))
        .where(base)
        .groupBy(saleReturns.refundMethod),
    ]);
    const refundOf = new Map(refunded.map((r) => [r.key, num(r.amount)]));
    rows = paid
      .map((r) => ({ key: r.key, label: r.key, transactions: num(r.transactions), units: null, gross: num(r.amount), discount: 0, revenue: num(r.amount), refunds: refundOf.get(r.key) ?? 0, net: num(r.amount) - (refundOf.get(r.key) ?? 0), grossProfit: null }))
      .sort((a, b) => b.revenue - a.revenue);
  } else {
    // Laba kotor per transaksi dihitung dari barang (dikurangi yang diretur) dalam satu subquery.
    const profit = db
      .select({
        saleId: saleItems.saleId,
        units: sql<number>`sum(${saleItems.qty} - ${saleItems.returnedQty})::int`.as("units"),
        gp: sql<number | null>`case when bool_and(${saleItems.costPrice} is not null) then round(sum((${saleItems.lineTotal} - ${saleItems.costPrice} * ${saleItems.qty}) * (${saleItems.qty} - ${saleItems.returnedQty})::numeric / ${saleItems.qty})) end`.as("gp"),
      })
      .from(saleItems)
      .groupBy(saleItems.saleId)
      .as("sale_profit");
    const dims = {
      day: { key: sql<string>`to_char(${day}, 'YYYY-MM-DD')`, label: sql<string>`to_char(${day}, 'YYYY-MM-DD')` },
      branch: { key: sql<string>`${sales.branchId}::text`, label: sql<string>`${branches.name}` },
      cashier: { key: sql<string>`${sales.cashierId}`, label: sql<string>`${user.name}` },
      channel: { key: sql<string>`${sales.channel}`, label: sql<string>`${sales.channel}` },
    } as const;
    const dim = dims[params.groupBy];
    const data = await db
      .select({
        key: dim.key,
        label: dim.label,
        transactions: sql<number>`count(*)::int`,
        units: sql<number>`coalesce(sum(${profit.units}), 0)::int`,
        gross: sql<number>`sum(${sales.subtotal} + ${sales.discountTotal})::bigint`,
        discount: sql<number>`sum(${sales.discountTotal})::bigint`,
        revenue: sql<number>`sum(${sales.total} - ${sales.shippingFee})::bigint`,
        refunds: sql<number>`sum(${sales.refundTotal})::bigint`,
        grossProfit: sql<number | null>`case when bool_and(${profit.gp} is not null) then sum(${profit.gp})::bigint end`,
      })
      .from(sales)
      .innerJoin(branches, eq(branches.id, sales.branchId))
      .innerJoin(user, eq(user.id, sales.cashierId))
      .leftJoin(profit, eq(profit.saleId, sales.id))
      .where(base)
      .groupBy(sql`1`, sql`2`)
      .orderBy(params.groupBy === "day" ? sql`1` : desc(sql`sum(${sales.total})`))
      .limit(400);
    rows = data.map((r) => ({
      key: r.key,
      label: r.label,
      transactions: num(r.transactions),
      units: num(r.units),
      gross: num(r.gross),
      discount: num(r.discount),
      revenue: num(r.revenue),
      refunds: num(r.refunds),
      net: num(r.revenue) - num(r.refunds),
      grossProfit: showCost && r.grossProfit !== null ? num(r.grossProfit) : null,
    }));
  }

  const sum = (k: "transactions" | "gross" | "discount" | "revenue" | "refunds" | "net") => rows.reduce((s, r) => s + r[k], 0);
  // Total transaksi tidak dijumlah dari baris barang (satu transaksi bisa muncul di banyak baris).
  const [{ txCount }] = await db.select({ txCount: sql<number>`count(*)::int` }).from(sales).where(base);
  return {
    groupBy: params.groupBy,
    from: from.toISOString(),
    to: to.toISOString(),
    showCost,
    rows,
    totals: {
      transactions: num(txCount),
      units: rows.every((r) => r.units !== null) ? rows.reduce((s, r) => s + (r.units ?? 0), 0) : null,
      gross: sum("gross"),
      discount: sum("discount"),
      revenue: sum("revenue"),
      refunds: sum("refunds"),
      net: sum("net"),
      grossProfit: showCost && rows.every((r) => r.grossProfit !== null) ? rows.reduce((s, r) => s + (r.grossProfit ?? 0), 0) : null,
      averageTicket: num(txCount) ? Math.round(sum("revenue") / num(txCount)) : 0,
    },
  };
}

/** Retur per alasan / produk / pemroses / cabang. */
export async function returnsReport(actor: Actor, params: ReportRange & { groupBy: ReturnsGroup }) {
  const { from, to } = range(params);
  const base = and(gte(saleReturns.createdAt, from), lt(saleReturns.createdAt, to), ...scopeFilter(actor, saleReturns.branchId, params.branchId));

  let rows: { key: string; label: string; returns: number; units: number; damagedUnits: number; amount: number }[];
  if (params.groupBy === "product") {
    const data = await db
      .select({
        key: sql<string>`${saleReturnItems.variantId}::text`,
        label: sql<string>`${saleItems.productName} || case when ${saleItems.variantTitle} = 'Default' then '' else ' · ' || ${saleItems.variantTitle} end`,
        returns: sql<number>`count(distinct ${saleReturnItems.returnId})::int`,
        units: sql<number>`sum(${saleReturnItems.qty})::int`,
        damagedUnits: sql<number>`coalesce(sum(${saleReturnItems.qty}) filter (where not ${saleReturnItems.restock}), 0)::int`,
        amount: sql<number>`sum(${saleReturnItems.amount})::bigint`,
      })
      .from(saleReturnItems)
      .innerJoin(saleReturns, eq(saleReturns.id, saleReturnItems.returnId))
      .innerJoin(saleItems, eq(saleItems.id, saleReturnItems.saleItemId))
      .where(base)
      .groupBy(sql`1`, sql`2`)
      .orderBy(desc(sql`sum(${saleReturnItems.qty})`))
      .limit(200);
    rows = data.map((r) => ({ ...r, returns: num(r.returns), units: num(r.units), damagedUnits: num(r.damagedUnits), amount: num(r.amount) }));
  } else {
    const items = db
      .select({
        returnId: saleReturnItems.returnId,
        units: sql<number>`sum(${saleReturnItems.qty})::int`.as("units"),
        damaged: sql<number>`coalesce(sum(${saleReturnItems.qty}) filter (where not ${saleReturnItems.restock}), 0)::int`.as("damaged"),
      })
      .from(saleReturnItems)
      .groupBy(saleReturnItems.returnId)
      .as("ret_items");
    const dims = {
      reason: { key: sql<string>`${saleReturns.reasonCode}::text`, label: sql<string>`${saleReturns.reasonCode}::text` },
      cashier: { key: sql<string>`${saleReturns.createdBy}`, label: sql<string>`${user.name}` },
      branch: { key: sql<string>`${saleReturns.branchId}::text`, label: sql<string>`${branches.name}` },
    } as const;
    const dim = dims[params.groupBy];
    const data = await db
      .select({
        key: dim.key,
        label: dim.label,
        returns: sql<number>`count(*)::int`,
        units: sql<number>`coalesce(sum(${items.units}), 0)::int`,
        damagedUnits: sql<number>`coalesce(sum(${items.damaged}), 0)::int`,
        amount: sql<number>`sum(${saleReturns.refundAmount})::bigint`,
      })
      .from(saleReturns)
      .innerJoin(user, eq(user.id, saleReturns.createdBy))
      .innerJoin(branches, eq(branches.id, saleReturns.branchId))
      .leftJoin(items, eq(items.returnId, saleReturns.id))
      .where(base)
      .groupBy(sql`1`, sql`2`)
      .orderBy(desc(sql`count(*)`));
    rows = data.map((r) => ({ ...r, returns: num(r.returns), units: num(r.units), damagedUnits: num(r.damagedUnits), amount: num(r.amount) }));
  }
  const total = (k: "returns" | "units" | "damagedUnits" | "amount") => rows.reduce((s, r) => s + r[k], 0);
  return {
    groupBy: params.groupBy,
    from: from.toISOString(),
    to: to.toISOString(),
    rows,
    totals: { returns: params.groupBy === "product" ? null : total("returns"), units: total("units"), damagedUnits: total("damagedUnits"), amount: total("amount") },
  };
}

// ── Export CSV ──────────────────────────────────────────────────────────

const LABELS: Record<string, string> = {
  SIZE: "Ukuran tidak pas",
  DEFECT: "Cacat/rusak",
  WRONG_ITEM: "Salah barang",
  NOT_AS_DESCRIBED: "Tidak sesuai deskripsi",
  CHANGED_MIND: "Berubah pikiran",
  OTHER: "Lainnya",
  POS: "Kasir",
  CASH: "Tunai",
  QRIS: "QRIS",
  DEBIT: "Kartu debit",
  CREDIT: "Kartu kredit",
  TRANSFER: "Transfer",
  EWALLET: "E-wallet",
};
export const displayLabel = (v: string) => LABELS[v] ?? v;

function csvCell(v: unknown) {
  const s = v === null || v === undefined ? "" : String(v);
  // Cegah formula injection di Excel/Sheets (=, +, -, @ di awal sel teks).
  const safe = /^[=+\-@\t\r]/.test(s) && Number.isNaN(Number(s)) ? `'${s}` : s;
  return /[",\n;]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function toCsv(header: string[], rows: unknown[][]) {
  // BOM agar Excel membaca UTF-8 (nama produk beraksen, simbol).
  return "﻿" + [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function salesCsv(report: Awaited<ReturnType<typeof salesReport>>) {
  const header = ["Dimensi", "Transaksi", "Unit bersih", "Harga jual", "Diskon", "Penjualan", "Retur", "Penjualan bersih", ...(report.showCost ? ["Laba kotor"] : [])];
  const body = report.rows.map((r) => [displayLabel(r.label), r.transactions, r.units ?? "", r.gross, r.discount, r.revenue, r.refunds, r.net, ...(report.showCost ? [r.grossProfit ?? ""] : [])]);
  const t = report.totals;
  body.push(["TOTAL", t.transactions, t.units ?? "", t.gross, t.discount, t.revenue, t.refunds, t.net, ...(report.showCost ? [t.grossProfit ?? ""] : [])]);
  return toCsv(header, body);
}

export function returnsCsv(report: Awaited<ReturnType<typeof returnsReport>>) {
  const body: unknown[][] = report.rows.map((r) => [displayLabel(r.label), r.returns, r.units, r.damagedUnits, r.amount]);
  body.push(["TOTAL", report.totals.returns ?? "", report.totals.units, report.totals.damagedUnits, report.totals.amount]);
  return toCsv(["Dimensi", "Jumlah retur", "Unit", "Unit rusak", "Uang dikembalikan"], body);
}
