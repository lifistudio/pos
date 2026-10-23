import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/server/db";
import type { Actor } from "@/server/api/context";
import { badRequest } from "@/server/api/errors";
import { branchScope, can } from "@/server/rbac/access";
import { MOVEMENT_LABEL } from "@/lib/stock-labels";
import { toCsv } from "./report.service";

/** Filter cakupan cabang (`report:read`) + cabang pilihan, untuk kolom branch_id pada alias tabel tertentu. */
function branchFilter(actor: Actor, column: SQL, branchId?: string) {
  const scope = branchScope(actor.access, "report:read");
  const parts: SQL[] = [];
  if (scope !== "ALL") parts.push(scope.length ? sql`${column} in (${sql.join(scope.map((id) => sql`${id}::uuid`), sql`, `)})` : sql`false`);
  if (branchId) parts.push(sql`${column} = ${branchId}::uuid`);
  return parts.length ? sql.join(parts, sql` and `) : sql`true`;
}

const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));

function range(from: string, to: string) {
  const f = new Date(from);
  const t = new Date(to);
  if (!(f < t)) throw badRequest("RANGE_INVALID", "Tanggal akhir harus setelah tanggal awal.");
  if ((t.getTime() - f.getTime()) / 86_400_000 > 366) throw badRequest("RANGE_TOO_LONG", "Rentang laporan maksimal 1 tahun.");
  return { f, t };
}

// ── Valuasi stok ────────────────────────────────────────────────────────

export type ValuationGroup = "branch" | "category" | "product";

/**
 * Nilai persediaan saat ini: unit, ter-reserve, nilai modal (on_hand × HPP varian saat ini) dan nilai jual
 * (on_hand × harga jual). Nilai modal hanya untuk yang boleh melihat HPP. Satu query agregat.
 */
export async function stockValuation(actor: Actor, params: { groupBy: ValuationGroup; branchId?: string }) {
  const showCost = can(actor.access, "product:view_cost");
  const dims = {
    branch: { key: sql`b.id::text`, label: sql`b.name` },
    category: { key: sql`coalesce(c.id::text, 'none')`, label: sql`coalesce(c.name, 'Tanpa kategori')` },
    product: { key: sql`v.id::text`, label: sql`p.name || case when v.title = 'Default' then '' else ' · ' || v.title end` },
  } as const;
  const dim = dims[params.groupBy];
  const rows = await db.execute<Record<string, unknown>>(sql`
    select ${dim.key} as key, ${dim.label} as label,
      count(distinct v.id) filter (where il.on_hand > 0)::int as skus,
      sum(il.on_hand)::int as units,
      sum(il.reserved)::int as reserved,
      sum(il.on_hand * v.price)::bigint as retail_value,
      sum(il.on_hand * v.cost_price) filter (where v.cost_price is not null)::bigint as cost_value,
      coalesce(sum(il.on_hand * v.price) filter (where v.cost_price is not null), 0)::bigint as costed_retail,
      count(*) filter (where il.on_hand > 0 and v.cost_price is null)::int as missing_cost
    from inventory_levels il
    join product_variants v on v.id = il.variant_id
    join products p on p.id = v.product_id
    join branches b on b.id = il.branch_id
    left join categories c on c.id = p.category_id
    where il.on_hand > 0 and ${branchFilter(actor, sql`il.branch_id`, params.branchId)}
    group by 1, 2
    order by sum(il.on_hand * v.price) desc
    limit ${params.groupBy === "product" ? 300 : 100}`);
  const data = rows.map((r) => ({
    key: String(r.key),
    label: String(r.label),
    skus: n(r.skus),
    units: n(r.units),
    reserved: n(r.reserved),
    retailValue: n(r.retail_value),
    costValue: showCost ? nn(r.cost_value) : null,
    missingCost: n(r.missing_cost),
    costedRetail: n(r.costed_retail),
  }));
  const sum = (k: "skus" | "units" | "reserved" | "retailValue" | "missingCost") => data.reduce((s, r) => s + r[k], 0);
  // Nilai modal = jumlah SKU yang ber-HPP; SKU tanpa HPP dihitung di missingCost. Margin potensial hanya dari SKU ber-HPP.
  const costValue = showCost ? data.reduce((s, r) => s + (r.costValue ?? 0), 0) : null;
  const costedRetail = data.reduce((s, r) => s + r.costedRetail, 0);
  return {
    groupBy: params.groupBy,
    showCost,
    rows: data.map((r) => ({ key: r.key, label: r.label, skus: r.skus, units: r.units, reserved: r.reserved, retailValue: r.retailValue, costValue: r.costValue, missingCost: r.missingCost })),
    totals: { skus: sum("skus"), units: sum("units"), reserved: sum("reserved"), retailValue: sum("retailValue"), costValue, missingCost: sum("missingCost"), potentialMargin: costValue === null ? null : costedRetail - costValue },
  };
}

// ── Umur stok ───────────────────────────────────────────────────────────

/**
 * Umur stok per varian per cabang = hari sejak barang terakhir MASUK (stok awal, penerimaan, transfer masuk),
 * plus hari sejak terjual terakhir (barang lambat laku). Dikelompokkan ke 0–30, 31–60, 61–90, >90 hari.
 */
export async function stockAging(actor: Actor, params: { branchId?: string }) {
  const showCost = can(actor.access, "product:view_cost");
  const rows = await db.execute<Record<string, unknown>>(sql`
    with last as (
      select m.branch_id, m.variant_id,
        max(m.created_at) filter (where m.type in ('INITIAL', 'RECEIPT', 'TRANSFER_IN') and m.qty_change > 0) as last_in,
        max(m.created_at) filter (where m.type = 'SALE') as last_sale
      from stock_movements m
      where ${branchFilter(actor, sql`m.branch_id`, params.branchId)}
      group by 1, 2
    )
    select il.branch_id, b.name as branch_name, v.id as variant_id, v.sku,
      p.name || case when v.title = 'Default' then '' else ' · ' || v.title end as label,
      il.on_hand, v.price, v.cost_price,
      floor(extract(epoch from now() - coalesce(l.last_in, il.updated_at)) / 86400)::int as age_days,
      case when l.last_sale is null then null else floor(extract(epoch from now() - l.last_sale) / 86400)::int end as days_since_sale
    from inventory_levels il
    join product_variants v on v.id = il.variant_id
    join products p on p.id = v.product_id
    join branches b on b.id = il.branch_id
    left join last l on l.branch_id = il.branch_id and l.variant_id = il.variant_id
    where il.on_hand > 0 and ${branchFilter(actor, sql`il.branch_id`, params.branchId)}
    order by age_days desc, il.on_hand desc
    limit 1000`);
  const buckets = [
    { key: "0-30", label: "0–30 hari", min: 0, max: 30 },
    { key: "31-60", label: "31–60 hari", min: 31, max: 60 },
    { key: "61-90", label: "61–90 hari", min: 61, max: 90 },
    { key: "90+", label: "> 90 hari", min: 91, max: Infinity },
  ].map((b) => ({ ...b, skus: 0, units: 0, retailValue: 0, costValue: showCost ? 0 : null as number | null }));
  const items = rows.map((r) => ({
    branchId: String(r.branch_id),
    branchName: String(r.branch_name),
    variantId: String(r.variant_id),
    sku: String(r.sku),
    label: String(r.label),
    units: n(r.on_hand),
    ageDays: n(r.age_days),
    daysSinceSale: nn(r.days_since_sale),
    retailValue: n(r.on_hand) * n(r.price),
    costValue: showCost && r.cost_price !== null ? n(r.on_hand) * n(r.cost_price) : null,
  }));
  for (const i of items) {
    const b = buckets.find((x) => i.ageDays >= x.min && i.ageDays <= x.max)!;
    b.skus++;
    b.units += i.units;
    b.retailValue += i.retailValue;
    if (b.costValue !== null) b.costValue += i.costValue ?? 0;
  }
  return {
    showCost,
    buckets: buckets.map((b) => ({ key: b.key, label: b.label, skus: b.skus, units: b.units, retailValue: b.retailValue, costValue: b.costValue })),
    // Barang lambat laku: berstok, masuk > 30 hari lalu, tidak terjual 60 hari terakhir (atau belum pernah).
    slowMoving: items.filter((i) => i.ageDays > 30 && (i.daysSinceSale === null || i.daysSinceSale > 60)).slice(0, 200),
    items: items.slice(0, 300),
  };
}

// ── Pergerakan stok ─────────────────────────────────────────────────────

export type MovementGroup = "type" | "product" | "category" | "branch";
const MOVEMENT_TYPES = ["INITIAL", "RECEIPT", "SALE", "RETURN", "TRANSFER_OUT", "TRANSFER_IN", "ADJUSTMENT", "OPNAME"] as const;

/**
 * Mutasi stok dalam periode: saldo awal, masuk, keluar per jenis, saldo akhir.
 * Saldo akhir = stok sekarang − mutasi setelah akhir periode; saldo awal = saldo akhir − mutasi periode.
 */
export async function stockMovements(actor: Actor, params: { from: string; to: string; groupBy: MovementGroup; branchId?: string }) {
  const { f, t } = range(params.from, params.to);
  const scope = branchFilter(actor, sql`m.branch_id`, params.branchId);
  if (params.groupBy === "type") {
    const rows = await db.execute<Record<string, unknown>>(sql`
      select m.type, count(*)::int as movements, sum(m.qty_change)::int as qty,
        count(distinct m.variant_id)::int as skus
      from stock_movements m
      where m.created_at >= ${f.toISOString()}::timestamptz and m.created_at < ${t.toISOString()}::timestamptz and ${scope}
      group by 1 order by 1`);
    const data = MOVEMENT_TYPES.map((type) => {
      const r = rows.find((x) => x.type === type);
      return { key: type, label: type, movements: n(r?.movements), skus: n(r?.skus), qty: n(r?.qty) };
    }).filter((r) => r.movements > 0);
    return { groupBy: params.groupBy, rows: data, totals: { movements: data.reduce((s, r) => s + r.movements, 0), in: data.filter((r) => r.qty > 0).reduce((s, r) => s + r.qty, 0), out: data.filter((r) => r.qty < 0).reduce((s, r) => s + r.qty, 0) } };
  }
  const dims = {
    product: { key: sql`v.id::text`, label: sql`p.name || case when v.title = 'Default' then '' else ' · ' || v.title end` },
    category: { key: sql`coalesce(c.id::text, 'none')`, label: sql`coalesce(c.name, 'Tanpa kategori')` },
    branch: { key: sql`b.id::text`, label: sql`b.name` },
  } as const;
  const dim = dims[params.groupBy];
  const ilScope = branchFilter(actor, sql`il.branch_id`, params.branchId);
  // Satu baris per (cabang, varian): stok sekarang + mutasi periode per arah + mutasi sesudah periode.
  const rows = await db.execute<Record<string, unknown>>(sql`
    with mv as (
      select m.branch_id, m.variant_id,
        sum(m.qty_change) filter (where m.created_at >= ${f.toISOString()}::timestamptz and m.created_at < ${t.toISOString()}::timestamptz) as net,
        sum(m.qty_change) filter (where m.created_at >= ${f.toISOString()}::timestamptz and m.created_at < ${t.toISOString()}::timestamptz and m.qty_change > 0) as qty_in,
        sum(-m.qty_change) filter (where m.created_at >= ${f.toISOString()}::timestamptz and m.created_at < ${t.toISOString()}::timestamptz and m.qty_change < 0) as qty_out,
        sum(-m.qty_change) filter (where m.created_at >= ${f.toISOString()}::timestamptz and m.created_at < ${t.toISOString()}::timestamptz and m.type = 'SALE') as sold,
        sum(m.qty_change) filter (where m.created_at >= ${t.toISOString()}::timestamptz) as after
      from stock_movements m
      where m.created_at >= ${f.toISOString()}::timestamptz and ${scope}
      group by 1, 2
    )
    select ${dim.key} as key, ${dim.label} as label,
      sum(il.on_hand - coalesce(mv.after, 0) - coalesce(mv.net, 0))::int as opening,
      sum(coalesce(mv.qty_in, 0))::int as qty_in,
      sum(coalesce(mv.qty_out, 0))::int as qty_out,
      sum(coalesce(mv.sold, 0))::int as sold,
      sum(il.on_hand - coalesce(mv.after, 0))::int as closing
    from inventory_levels il
    join product_variants v on v.id = il.variant_id
    join products p on p.id = v.product_id
    join branches b on b.id = il.branch_id
    left join categories c on c.id = p.category_id
    left join mv on mv.branch_id = il.branch_id and mv.variant_id = il.variant_id
    where ${ilScope} and (mv.variant_id is not null or il.on_hand > 0)
    group by 1, 2
    order by sum(coalesce(mv.qty_in, 0) + coalesce(mv.qty_out, 0)) desc, 2
    limit ${params.groupBy === "product" ? 300 : 100}`);
  const data = rows.map((r) => {
    const opening = n(r.opening);
    const closing = n(r.closing);
    const sold = n(r.sold);
    // Perputaran: terjual ÷ rata-rata stok (indikasi kecepatan laku di periode ini).
    const avg = (opening + closing) / 2;
    return { key: String(r.key), label: String(r.label), opening, qtyIn: n(r.qty_in), qtyOut: n(r.qty_out), sold, closing, turnover: avg > 0 ? Math.round((sold / avg) * 100) / 100 : null };
  });
  const sum = (k: "opening" | "qtyIn" | "qtyOut" | "sold" | "closing") => data.reduce((s, r) => s + r[k], 0);
  return { groupBy: params.groupBy, rows: data, totals: { opening: sum("opening"), qtyIn: sum("qtyIn"), qtyOut: sum("qtyOut"), sold: sum("sold"), closing: sum("closing") } };
}

// ── Shift & selisih kas ─────────────────────────────────────────────────

export type ShiftGroup = "shift" | "cashier";

/**
 * Rekap shift kasir: kas awal, tunai masuk, refund tunai, kas seharusnya, kas dihitung, selisih,
 * transaksi, omzet, void, retur, diskon manual. Per shift atau diringkas per kasir.
 * Agregat penjualan/retur dihitung per shift dalam subquery (tanpa N+1).
 */
export async function shiftReport(actor: Actor, params: { from: string; to: string; groupBy: ShiftGroup; branchId?: string }) {
  const { f, t } = range(params.from, params.to);
  const rows = await db.execute<Record<string, unknown>>(sql`
    with sel as (
      select sh.id from shifts sh
      where sh.opened_at >= ${f.toISOString()}::timestamptz and sh.opened_at < ${t.toISOString()}::timestamptz
        and ${branchFilter(actor, sql`sh.branch_id`, params.branchId)}
      order by sh.opened_at desc
      limit 500
    ),
    s as (
      select sa.shift_id,
        count(*) filter (where sa.status = 'PAID')::int as paid_count,
        count(*) filter (where sa.status = 'VOIDED')::int as void_count,
        coalesce(sum(sa.total) filter (where sa.status = 'PAID'), 0)::bigint as revenue,
        coalesce(sum(sa.manual_discount) filter (where sa.status = 'PAID'), 0)::bigint as manual_discount
      from sales sa where sa.shift_id in (select id from sel) group by 1
    ),
    cash as (
      select sa.shift_id, coalesce(sum(sp.amount), 0)::bigint as cash_in
      from sale_payments sp join sales sa on sa.id = sp.sale_id
      where sp.method = 'CASH' and sa.status = 'PAID' and sa.shift_id in (select id from sel) group by 1
    ),
    r as (
      select shift_id, count(*)::int as return_count, coalesce(sum(refund_amount), 0)::bigint as refund_total,
        coalesce(sum(refund_amount) filter (where refund_method = 'CASH'), 0)::bigint as cash_refund
      from sale_returns where shift_id in (select id from sel) group by 1
    )
    select sh.id, sh.status, sh.opened_at, sh.closed_at, sh.opening_cash, sh.expected_cash, sh.counted_cash, sh.note,
      u.id as cashier_id, u.name as cashier_name, b.name as branch_name,
      coalesce(s.paid_count, 0) as paid_count, coalesce(s.void_count, 0) as void_count, coalesce(s.revenue, 0) as revenue,
      coalesce(s.manual_discount, 0) as manual_discount, coalesce(cash.cash_in, 0) as cash_in,
      coalesce(r.return_count, 0) as return_count, coalesce(r.refund_total, 0) as refund_total, coalesce(r.cash_refund, 0) as cash_refund
    from sel
    join shifts sh on sh.id = sel.id
    join "user" u on u.id = sh.user_id
    join branches b on b.id = sh.branch_id
    left join s on s.shift_id = sh.id
    left join cash on cash.shift_id = sh.id
    left join r on r.shift_id = sh.id
    order by sh.opened_at desc`);
  const shifts = rows.map((r) => {
    const expected = r.expected_cash !== null ? n(r.expected_cash) : n(r.opening_cash) + n(r.cash_in) - n(r.cash_refund);
    const counted = nn(r.counted_cash);
    return {
      id: String(r.id),
      status: String(r.status) as "OPEN" | "CLOSED",
      openedAt: new Date(String(r.opened_at)).toISOString(),
      closedAt: r.closed_at ? new Date(String(r.closed_at)).toISOString() : null,
      cashierId: String(r.cashier_id),
      cashierName: String(r.cashier_name),
      branchName: String(r.branch_name),
      openingCash: n(r.opening_cash),
      cashIn: n(r.cash_in),
      cashRefund: n(r.cash_refund),
      expectedCash: expected,
      countedCash: counted,
      difference: counted === null ? null : counted - expected,
      transactions: n(r.paid_count),
      voids: n(r.void_count),
      revenue: n(r.revenue),
      returns: n(r.return_count),
      refundTotal: n(r.refund_total),
      manualDiscount: n(r.manual_discount),
      note: (r.note as string | null) ?? null,
    };
  });
  const closed = shifts.filter((s) => s.difference !== null);
  const totals = {
    shifts: shifts.length,
    open: shifts.filter((s) => s.status === "OPEN").length,
    revenue: shifts.reduce((a, s) => a + s.revenue, 0),
    difference: closed.reduce((a, s) => a + (s.difference ?? 0), 0),
    shortage: closed.filter((s) => (s.difference ?? 0) < 0).reduce((a, s) => a + (s.difference ?? 0), 0),
    surplus: closed.filter((s) => (s.difference ?? 0) > 0).reduce((a, s) => a + (s.difference ?? 0), 0),
    voids: shifts.reduce((a, s) => a + s.voids, 0),
    refundTotal: shifts.reduce((a, s) => a + s.refundTotal, 0),
  };
  if (params.groupBy === "shift") return { groupBy: params.groupBy, shifts, cashiers: [], totals };

  const byCashier = new Map<string, { cashierId: string; cashierName: string; shifts: number; closedShifts: number; shortShifts: number; transactions: number; revenue: number; difference: number; shortage: number; voids: number; returns: number; refundTotal: number; manualDiscount: number }>();
  for (const s of shifts) {
    const c = byCashier.get(s.cashierId) ?? { cashierId: s.cashierId, cashierName: s.cashierName, shifts: 0, closedShifts: 0, shortShifts: 0, transactions: 0, revenue: 0, difference: 0, shortage: 0, voids: 0, returns: 0, refundTotal: 0, manualDiscount: 0 };
    c.shifts++;
    c.transactions += s.transactions;
    c.revenue += s.revenue;
    c.voids += s.voids;
    c.returns += s.returns;
    c.refundTotal += s.refundTotal;
    c.manualDiscount += s.manualDiscount;
    if (s.difference !== null) {
      c.closedShifts++;
      c.difference += s.difference;
      if (s.difference < 0) {
        c.shortShifts++;
        c.shortage += s.difference;
      }
    }
    byCashier.set(s.cashierId, c);
  }
  return { groupBy: params.groupBy, shifts: [], cashiers: [...byCashier.values()].sort((a, b) => a.shortage - b.shortage || b.revenue - a.revenue), totals };
}

// ── Export CSV ──────────────────────────────────────────────────────────

export function valuationCsv(r: Awaited<ReturnType<typeof stockValuation>>) {
  const cost = (v: number | null) => (r.showCost ? [v ?? ""] : []);
  const body: unknown[][] = r.rows.map((x) => [x.label, x.skus, x.units, x.reserved, x.retailValue, ...cost(x.costValue)]);
  body.push(["TOTAL", r.totals.skus, r.totals.units, r.totals.reserved, r.totals.retailValue, ...cost(r.totals.costValue)]);
  return toCsv(["Dimensi", "SKU berstok", "Unit", "Ter-reserve", "Nilai jual", ...(r.showCost ? ["Nilai modal"] : [])], body);
}

export function agingCsv(r: Awaited<ReturnType<typeof stockAging>>) {
  return toCsv(
    ["Cabang", "SKU", "Barang", "Unit", "Umur (hari sejak masuk)", "Hari sejak terjual", "Nilai jual", ...(r.showCost ? ["Nilai modal"] : [])],
    r.items.map((i) => [i.branchName, i.sku, i.label, i.units, i.ageDays, i.daysSinceSale ?? "belum pernah", i.retailValue, ...(r.showCost ? [i.costValue ?? ""] : [])]),
  );
}

export function movementsCsv(r: Awaited<ReturnType<typeof stockMovements>>) {
  const rows = r.rows as Record<string, unknown>[];
  if (r.groupBy === "type") return toCsv(["Jenis", "Mutasi", "SKU", "Qty"], rows.map((x) => [MOVEMENT_LABEL[String(x.label)] ?? x.label, x.movements, x.skus, x.qty]));
  return toCsv(
    ["Dimensi", "Saldo awal", "Masuk", "Keluar", "Terjual", "Saldo akhir", "Perputaran"],
    rows.map((x) => [x.label, x.opening, x.qtyIn, x.qtyOut, x.sold, x.closing, x.turnover ?? ""]),
  );
}

export function shiftsCsv(r: Awaited<ReturnType<typeof shiftReport>>) {
  if (r.groupBy === "cashier") {
    return toCsv(
      ["Kasir", "Shift", "Shift ditutup", "Transaksi", "Omzet", "Selisih kas", "Total kurang", "Shift kurang", "Void", "Retur", "Refund", "Diskon manual"],
      r.cashiers.map((c) => [c.cashierName, c.shifts, c.closedShifts, c.transactions, c.revenue, c.difference, c.shortage, c.shortShifts, c.voids, c.returns, c.refundTotal, c.manualDiscount]),
    );
  }
  return toCsv(
    ["Buka", "Tutup", "Kasir", "Cabang", "Kas awal", "Tunai masuk", "Refund tunai", "Kas seharusnya", "Kas dihitung", "Selisih", "Transaksi", "Omzet", "Void", "Retur", "Catatan"],
    r.shifts.map((s) => [s.openedAt, s.closedAt ?? "masih buka", s.cashierName, s.branchName, s.openingCash, s.cashIn, s.cashRefund, s.expectedCash, s.countedCash ?? "", s.difference ?? "", s.transactions, s.revenue, s.voids, s.returns, s.note ?? ""]),
  );
}
