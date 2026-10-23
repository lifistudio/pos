"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Chip } from "@/components/base/badges/chip";
import { DataTable, type Column } from "@/components/app/data-table";
import { useSession } from "@/components/app/session-context";
import { api } from "@/lib/api-client";
import { formatDateTime, formatNumber, formatRupiah } from "@/lib/format";
import { MOVEMENT_LABEL } from "@/lib/stock-labels";
import { Kpi, Num, Share } from "./report-parts";

type PanelProps = {
  group: string;
  query: { from: string; to: string; branchId?: string };
  toolbar: ReactNode;
  empty: ReactNode;
};

export const STOCK_GROUPS = {
  branch: "Valuasi per cabang",
  category: "Valuasi per kategori",
  product: "Valuasi per produk",
  aging: "Umur stok",
  slow: "Barang lambat laku",
} as const;
export const MOVEMENT_GROUPS = {
  type: "Per jenis mutasi",
  product: "Per produk",
  category: "Per kategori",
  branch: "Per cabang",
} as const;
export const SHIFT_GROUPS = {
  shift: "Per shift",
  cashier: "Per kasir",
} as const;

const signed = (v: number) => (v < 0 ? `−${formatRupiah(-v)}` : v > 0 ? `+${formatRupiah(v)}` : formatRupiah(0));
const signedQty = (v: number) => (v > 0 ? `+${formatNumber(v)}` : v < 0 ? `−${formatNumber(-v)}` : "0");
const tableProps = {
  unit: "baris",
  page: 1,
  pageCount: 1,
  onPageChange: () => {},
};

// ── Stok: valuasi & umur ────────────────────────────────────────────────

type ValuationRow = {
  key: string;
  label: string;
  skus: number;
  units: number;
  reserved: number;
  retailValue: number;
  costValue: number | null;
  missingCost: number;
};
type Valuation = {
  showCost: boolean;
  rows: ValuationRow[];
  totals: Omit<ValuationRow, "key" | "label"> & {
    potentialMargin: number | null;
  };
};
type AgingItem = {
  branchId: string;
  branchName: string;
  variantId: string;
  sku: string;
  label: string;
  units: number;
  ageDays: number;
  daysSinceSale: number | null;
  retailValue: number;
  costValue: number | null;
};
type Aging = {
  showCost: boolean;
  buckets: {
    key: string;
    label: string;
    skus: number;
    units: number;
    retailValue: number;
    costValue: number | null;
  }[];
  slowMoving: AgingItem[];
  items: AgingItem[];
};

const VALUATION_HEADER: Record<string, string> = {
  branch: "Cabang",
  category: "Kategori",
  product: "Produk",
};

export function StockPanel({ group, query, toolbar, empty }: PanelProps) {
  const aging = group === "aging" || group === "slow";
  const showCost = useSession().can("product:view_cost");
  const branchId = query.branchId;
  const valuation = useQuery({
    queryKey: ["report-stock-valuation", group, branchId],
    queryFn: () =>
      api<{ data: Valuation }>("/reports/stock-valuation", {
        query: { groupBy: group, branchId },
      }).then((r) => r.data),
    enabled: !aging,
    placeholderData: keepPreviousData,
  });
  const agingQuery = useQuery({
    queryKey: ["report-stock-aging", branchId],
    queryFn: () =>
      api<{ data: Aging }>("/reports/stock-aging", {
        query: { branchId },
      }).then((r) => r.data),
    enabled: aging,
    placeholderData: keepPreviousData,
  });

  if (aging) {
    const a = agingQuery.data;
    const rows = group === "slow" ? a?.slowMoving : a?.items;
    const slow = new Set(a?.slowMoving.map((i) => `${i.branchId}:${i.variantId}`));
    const columns: Column<AgingItem>[] = [
      {
        id: "label",
        header: "Barang",
        isRowHeader: true,
        cell: (r) => (
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-body-medium text-text-primary">{r.label}</span>
            <span className="text-caption-1-regular text-text-tertiary">{r.sku}</span>
          </span>
        ),
      },
      {
        id: "branch",
        header: "Cabang",
        cell: (r) => <span className="text-body-regular text-text-secondary">{r.branchName}</span>,
      },
      {
        id: "units",
        header: "Unit",
        align: "end",
        cell: (r) => <Num>{formatNumber(r.units)}</Num>,
      },
      {
        id: "age",
        header: "Umur",
        align: "end",
        cell: (r) => <Num tone={r.ageDays > 90 ? "negative" : undefined}>{r.ageDays} hari</Num>,
      },
      {
        id: "sale",
        header: "Terakhir terjual",
        align: "end",
        cell: (r) => (
          <span className="inline-flex items-center justify-end gap-2">
            {slow.has(`${r.branchId}:${r.variantId}`) && group !== "slow" && (
              <Chip variant="subtle" color="orange">
                Lambat laku
              </Chip>
            )}
            <Num tone={r.daysSinceSale === null ? "muted" : undefined}>{r.daysSinceSale === null ? "Belum pernah" : (r.daysSinceSale === 0 ? "Hari ini" : `${r.daysSinceSale} hari lalu`)}</Num>
          </span>
        ),
      },
      {
        id: "value",
        header: "Nilai jual",
        align: "end",
        cell: (r) => <Num strong>{formatRupiah(r.retailValue)}</Num>,
      },
      ...(a?.showCost
        ? [
            {
              id: "cost",
              header: "Nilai modal",
              align: "end" as const,
              cell: (r: AgingItem) => <Num>{r.costValue === null ? "—" : formatRupiah(r.costValue)}</Num>,
            },
          ]
        : []),
    ];
    return (
      <>
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4" aria-busy={agingQuery.isFetching}>
          {(
            a?.buckets ?? [
              { key: "0-30", label: "0–30 hari" },
              { key: "31-60", label: "31–60 hari" },
              { key: "61-90", label: "61–90 hari" },
              { key: "90+", label: "> 90 hari" },
            ]
          ).map((b) => (
            <Kpi
              key={b.key}
              label={`Umur ${b.label}`}
              value={"retailValue" in b ? formatRupiah(b.retailValue) : "…"}
              hint={"skus" in b ? `${formatNumber(b.units)} unit · ${formatNumber(b.skus)} SKU` : undefined}
              tone={b.key === "90+" && "skus" in b && b.skus > 0 ? "negative" : undefined}
            />
          ))}
        </div>
        <DataTable
          {...tableProps}
          label={group === "slow" ? "Barang lambat laku" : "Umur stok per barang"}
          columns={columns}
          rows={rows}
          getRowId={(r) => `${r.branchId}:${r.variantId}`}
          isLoading={agingQuery.isFetching}
          total={rows?.length}
          toolbar={toolbar}
          empty={
            group === "slow" ? (
              <>
                <p className="text-body-medium text-text-primary">Tidak ada barang lambat laku.</p>
                <p className="text-body-regular text-text-tertiary">Semua barang yang masuk lebih dari 30 hari lalu masih terjual dalam 60 hari terakhir.</p>
              </>
            ) : (
              empty
            )
          }
          renderMobile={(r) => (
            <div className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-body-medium text-text-primary">{r.label}</span>
                <span className="shrink-0 text-body-medium text-text-primary tabular-nums">{formatRupiah(r.retailValue)}</span>
              </div>
              <span className="text-body-2-regular text-text-tertiary">
                {r.branchName} · {formatNumber(r.units)} unit · umur {r.ageDays} hari · {r.daysSinceSale === null ? "belum pernah terjual" : (r.daysSinceSale === 0 ? "terjual hari ini" : `terjual ${r.daysSinceSale} hari lalu`)}
              </span>
            </div>
          )}
        />
        <p className="mt-3 text-caption-1-regular text-text-tertiary">
          Umur dihitung dari barang terakhir masuk (stok awal, penerimaan, atau transfer masuk). Lambat laku: masuk lebih dari 30 hari lalu dan tidak terjual 60 hari terakhir.
        </p>
      </>
    );
  }

  const v = valuation.data;
  const maxValue = Math.max(0, ...(v?.rows.map((r) => r.retailValue) ?? []));
  const columns: Column<ValuationRow>[] = [
    {
      id: "label",
      header: VALUATION_HEADER[group] ?? "Dimensi",
      isRowHeader: true,
      cell: (r) => <span className="text-body-medium text-text-primary">{r.label}</span>,
    },
    ...(group === "product"
      ? []
      : [
          {
            id: "skus",
            header: "SKU",
            align: "end" as const,
            cell: (r: ValuationRow) => <Num>{formatNumber(r.skus)}</Num>,
          },
        ]),
    {
      id: "units",
      header: "Unit",
      align: "end",
      cell: (r) => <Num>{formatNumber(r.units)}</Num>,
    },
    {
      id: "reserved",
      header: "Ter-reserve",
      align: "end",
      cell: (r) => <Num tone={r.reserved ? undefined : "muted"}>{r.reserved ? formatNumber(r.reserved) : "—"}</Num>,
    },
    {
      id: "retail",
      header: "Nilai jual",
      align: "end",
      cell: (r) => <Num strong>{formatRupiah(r.retailValue)}</Num>,
    },
    ...(v?.showCost
      ? [
          {
            id: "cost",
            header: "Nilai modal",
            align: "end" as const,
            cell: (r: ValuationRow) => (
              <Num tone={r.costValue === null ? "muted" : undefined}>
                {r.costValue === null ? "HPP kosong" : formatRupiah(r.costValue)}
                {r.costValue !== null && r.missingCost > 0 && <span className="text-status-orange-text">*</span>}
              </Num>
            ),
          },
        ]
      : []),
    {
      id: "share",
      header: "Porsi",
      cell: (r) => <Share value={r.retailValue} max={maxValue} />,
    },
  ];
  const t = v?.totals;
  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4" aria-busy={valuation.isFetching}>
        <Kpi label="Nilai stok (harga jual)" value={t ? formatRupiah(t.retailValue) : "…"} />
        {showCost && (
          <Kpi
            label="Nilai modal"
            value={t?.costValue == null ? "—" : formatRupiah(t.costValue)}
            hint={t?.missingCost ? `${formatNumber(t.missingCost)} SKU tanpa HPP tidak dihitung` : "semua SKU ber-HPP"}
          />
        )}
        {showCost && (
          <Kpi
            label="Margin potensial"
            value={t?.potentialMargin == null ? "—" : formatRupiah(t.potentialMargin)}
            hint={t?.potentialMargin != null && t.costValue ? `${Math.round((t.potentialMargin / (t.potentialMargin + t.costValue)) * 100)}% dari nilai jual` : undefined}
          />
        )}
        <Kpi label="Unit di stok" value={t ? formatNumber(t.units) : "…"} hint={t ? `${formatNumber(t.skus)} SKU${t.reserved ? ` · ${formatNumber(t.reserved)} ter-reserve` : ""}` : undefined} />
      </div>
      <DataTable
        {...tableProps}
        label="Valuasi persediaan"
        columns={columns}
        rows={v?.rows}
        getRowId={(r) => r.key}
        isLoading={valuation.isFetching}
        total={v?.rows.length}
        toolbar={toolbar}
        empty={empty}
        renderMobile={(r) => (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate text-body-medium text-text-primary">{r.label}</span>
              <span className="shrink-0 text-body-medium text-text-primary tabular-nums">{formatRupiah(r.retailValue)}</span>
            </div>
            <span className="text-body-2-regular text-text-tertiary">
              {formatNumber(r.units)} unit
              {v?.showCost && r.costValue !== null ? ` · modal ${formatRupiah(r.costValue)}` : ""}
            </span>
            <Share value={r.retailValue} max={maxValue} />
          </div>
        )}
      />
      <p className="mt-3 text-caption-1-regular text-text-tertiary">
        Posisi stok saat ini, tidak terpengaruh pilihan periode. Nilai modal memakai HPP varian saat ini
        {v?.showCost && t?.missingCost ? "; tanda * berarti ada SKU tanpa HPP di baris itu" : ""}.
      </p>
    </>
  );
}

// ── Pergerakan stok ─────────────────────────────────────────────────────

type TypeRow = {
  key: string;
  label: string;
  movements: number;
  skus: number;
  qty: number;
};
type FlowRow = {
  key: string;
  label: string;
  opening: number;
  qtyIn: number;
  qtyOut: number;
  sold: number;
  closing: number;
  turnover: number | null;
};
type Movements = {
  groupBy: string;
  rows: (TypeRow | FlowRow)[];
  totals: Record<string, number>;
};

export function MovementsPanel({ group, query, toolbar, empty }: PanelProps) {
  const q = { ...query, groupBy: group };
  const report = useQuery({
    queryKey: ["report-stock-movements", q],
    queryFn: () => api<{ data: Movements }>("/reports/stock-movements", { query: q }).then((r) => r.data),
    placeholderData: keepPreviousData,
  });
  const m = report.data?.groupBy === group ? report.data : undefined;
  const t = m?.totals;

  if (group === "type") {
    const rows = m?.rows as TypeRow[] | undefined;
    const columns: Column<TypeRow>[] = [
      {
        id: "label",
        header: "Jenis mutasi",
        isRowHeader: true,
        cell: (r) => (
          <Chip variant="subtle" color={r.qty > 0 ? "lime" : r.qty < 0 ? "rose" : "neutral"}>
            {MOVEMENT_LABEL[r.label] ?? r.label}
          </Chip>
        ),
      },
      {
        id: "movements",
        header: "Mutasi",
        align: "end",
        cell: (r) => <Num>{formatNumber(r.movements)}</Num>,
      },
      {
        id: "skus",
        header: "SKU",
        align: "end",
        cell: (r) => <Num>{formatNumber(r.skus)}</Num>,
      },
      {
        id: "qty",
        header: "Qty",
        align: "end",
        cell: (r) => (
          <Num strong tone={r.qty < 0 ? "negative" : undefined}>
            {signedQty(r.qty)}
          </Num>
        ),
      },
    ];
    return (
      <>
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3" aria-busy={report.isFetching}>
          <Kpi label="Unit masuk" value={t ? signedQty(t.in) : "…"} />
          <Kpi label="Unit keluar" value={t ? signedQty(t.out) : "…"} tone={t?.out ? "negative" : undefined} />
          <Kpi label="Jumlah mutasi" value={t ? formatNumber(t.movements) : "…"} hint={t ? `bersih ${signedQty(t.in + t.out)} unit` : undefined} />
        </div>
        <DataTable
          {...tableProps}
          label="Pergerakan stok per jenis"
          columns={columns}
          rows={rows}
          getRowId={(r) => r.key}
          isLoading={report.isFetching}
          total={rows?.length}
          toolbar={toolbar}
          empty={empty}
          renderMobile={(r) => (
            <div className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 flex-col gap-1">
                <span className="truncate text-body-medium text-text-primary">{MOVEMENT_LABEL[r.label] ?? r.label}</span>
                <span className="text-body-2-regular text-text-tertiary">
                  {formatNumber(r.movements)} mutasi · {formatNumber(r.skus)} SKU
                </span>
              </span>
              <span className={r.qty < 0 ? "text-body-medium text-status-rose-text tabular-nums" : "text-body-medium text-text-primary tabular-nums"}>{signedQty(r.qty)}</span>
            </div>
          )}
        />
      </>
    );
  }

  const rows = m?.rows as FlowRow[] | undefined;
  const header = { product: "Produk", category: "Kategori", branch: "Cabang" }[group] ?? "Dimensi";
  const columns: Column<FlowRow>[] = [
    {
      id: "label",
      header,
      isRowHeader: true,
      cell: (r) => <span className="text-body-medium text-text-primary">{r.label}</span>,
    },
    {
      id: "opening",
      header: "Saldo awal",
      align: "end",
      cell: (r) => <Num>{formatNumber(r.opening)}</Num>,
    },
    {
      id: "in",
      header: "Masuk",
      align: "end",
      cell: (r) => <Num tone={r.qtyIn ? undefined : "muted"}>{r.qtyIn ? `+${formatNumber(r.qtyIn)}` : "—"}</Num>,
    },
    {
      id: "out",
      header: "Keluar",
      align: "end",
      cell: (r) => <Num tone={r.qtyOut ? "negative" : "muted"}>{r.qtyOut ? `−${formatNumber(r.qtyOut)}` : "—"}</Num>,
    },
    {
      id: "sold",
      header: "Terjual",
      align: "end",
      cell: (r) => <Num>{formatNumber(r.sold)}</Num>,
    },
    {
      id: "closing",
      header: "Saldo akhir",
      align: "end",
      cell: (r) => <Num strong>{formatNumber(r.closing)}</Num>,
    },
    {
      id: "turnover",
      header: "Perputaran",
      align: "end",
      cell: (r) => <Num tone={r.turnover === null ? "muted" : undefined}>{r.turnover === null ? "—" : `${r.turnover.toLocaleString("id-ID")}×`}</Num>,
    },
  ];
  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5" aria-busy={report.isFetching}>
        <Kpi label="Saldo awal" value={t ? formatNumber(t.opening) : "…"} hint="unit" />
        <Kpi label="Masuk" value={t ? `+${formatNumber(t.qtyIn)}` : "…"} />
        <Kpi label="Keluar" value={t ? `−${formatNumber(t.qtyOut)}` : "…"} tone={t?.qtyOut ? "negative" : undefined} />
        <Kpi
          label="Terjual"
          value={t ? formatNumber(t.sold) : "…"}
          hint={t && t.opening + t.closing > 0 ? `perputaran ${(Math.round((t.sold / ((t.opening + t.closing) / 2)) * 100) / 100).toLocaleString("id-ID")}×` : undefined}
        />
        <Kpi label="Saldo akhir" value={t ? formatNumber(t.closing) : "…"} hint="unit" />
      </div>
      <DataTable
        {...tableProps}
        label="Pergerakan stok"
        columns={columns}
        rows={rows}
        getRowId={(r) => r.key}
        isLoading={report.isFetching}
        total={rows?.length}
        toolbar={toolbar}
        empty={empty}
        renderMobile={(r) => (
          <div className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate text-body-medium text-text-primary">{r.label}</span>
              <span className="shrink-0 text-body-medium text-text-primary tabular-nums">{formatNumber(r.closing)}</span>
            </div>
            <span className="text-body-2-regular text-text-tertiary tabular-nums">
              {formatNumber(r.opening)} awal · +{formatNumber(r.qtyIn)} · −{formatNumber(r.qtyOut)} · {formatNumber(r.sold)} terjual
            </span>
          </div>
        )}
      />
      <p className="mt-3 text-caption-1-regular text-text-tertiary">Saldo dalam unit. Perputaran = unit terjual ÷ rata-rata saldo awal dan akhir pada periode ini.</p>
    </>
  );
}

// ── Shift & selisih kas ─────────────────────────────────────────────────

type ShiftRow = {
  id: string;
  status: "OPEN" | "CLOSED";
  openedAt: string;
  closedAt: string | null;
  cashierName: string;
  branchName: string;
  openingCash: number;
  cashIn: number;
  cashRefund: number;
  expectedCash: number;
  countedCash: number | null;
  difference: number | null;
  transactions: number;
  voids: number;
  revenue: number;
  returns: number;
  refundTotal: number;
  manualDiscount: number;
  note: string | null;
};
type CashierRow = {
  cashierId: string;
  cashierName: string;
  shifts: number;
  closedShifts: number;
  shortShifts: number;
  transactions: number;
  revenue: number;
  difference: number;
  shortage: number;
  voids: number;
  returns: number;
  refundTotal: number;
  manualDiscount: number;
};
type Shifts = {
  groupBy: string;
  shifts: ShiftRow[];
  cashiers: CashierRow[];
  totals: {
    shifts: number;
    open: number;
    revenue: number;
    difference: number;
    shortage: number;
    surplus: number;
    voids: number;
    refundTotal: number;
  };
};

function Difference({ value, open }: { value: number | null; open?: boolean }) {
  if (value === null)
    return open ? (
      <Chip variant="subtle" color="blue">
        Masih buka
      </Chip>
    ) : (
      <Num tone="muted">—</Num>
    );
  if (value === 0)
    return (
      <Chip variant="subtle" color="lime">
        Pas
      </Chip>
    );
  return (
    <Num strong tone={value < 0 ? "negative" : "positive"}>
      {signed(value)}
    </Num>
  );
}

export function ShiftsPanel({ group, query, toolbar, empty }: PanelProps) {
  const q = { ...query, groupBy: group };
  const report = useQuery({
    queryKey: ["report-shifts", q],
    queryFn: () => api<{ data: Shifts }>("/reports/shifts", { query: q }).then((r) => r.data),
    placeholderData: keepPreviousData,
  });
  const d = report.data?.groupBy === group ? report.data : undefined;
  const t = d?.totals;

  const kpis = (
    <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5" aria-busy={report.isFetching}>
      <Kpi label="Shift" value={t ? formatNumber(t.shifts) : "…"} hint={t?.open ? `${formatNumber(t.open)} masih buka` : undefined} />
      <Kpi label="Omzet" value={t ? formatRupiah(t.revenue) : "…"} />
      <Kpi label="Selisih kas bersih" value={t ? signed(t.difference) : "…"} tone={t && t.difference < 0 ? "negative" : undefined} hint="shift yang sudah ditutup" />
      <Kpi label="Total kurang" value={t ? signed(t.shortage) : "…"} tone={t?.shortage ? "negative" : undefined} hint={t?.surplus ? `lebih ${formatRupiah(t.surplus)}` : undefined} />
      <Kpi label="Void" value={t ? formatNumber(t.voids) : "…"} hint={t?.refundTotal ? `refund ${formatRupiah(t.refundTotal)}` : undefined} />
    </div>
  );

  if (group === "cashier") {
    const columns: Column<CashierRow>[] = [
      {
        id: "name",
        header: "Kasir",
        isRowHeader: true,
        cell: (r) => <span className="text-body-medium text-text-primary">{r.cashierName}</span>,
      },
      {
        id: "shifts",
        header: "Shift",
        align: "end",
        cell: (r) => <Num>{r.closedShifts === r.shifts ? formatNumber(r.shifts) : `${formatNumber(r.closedShifts)}/${formatNumber(r.shifts)}`}</Num>,
      },
      {
        id: "short",
        header: "Shift kurang",
        align: "end",
        cell: (r) => <Num tone={r.shortShifts ? "negative" : "muted"}>{r.shortShifts ? formatNumber(r.shortShifts) : "—"}</Num>,
      },
      {
        id: "diff",
        header: "Selisih bersih",
        align: "end",
        cell: (r) => <Difference value={r.closedShifts ? r.difference : null} />,
      },
      {
        id: "shortage",
        header: "Total kurang",
        align: "end",
        cell: (r) => <Num tone={r.shortage ? "negative" : "muted"}>{r.shortage ? signed(r.shortage) : "—"}</Num>,
      },
      {
        id: "tx",
        header: "Transaksi",
        align: "end",
        cell: (r) => <Num>{formatNumber(r.transactions)}</Num>,
      },
      {
        id: "revenue",
        header: "Omzet",
        align: "end",
        cell: (r) => <Num strong>{formatRupiah(r.revenue)}</Num>,
      },
      {
        id: "voids",
        header: "Void",
        align: "end",
        cell: (r) => <Num tone={r.voids ? undefined : "muted"}>{r.voids ? formatNumber(r.voids) : "—"}</Num>,
      },
      {
        id: "refund",
        header: "Refund",
        align: "end",
        cell: (r) => <Num tone={r.refundTotal ? undefined : "muted"}>{r.refundTotal ? formatRupiah(r.refundTotal) : "—"}</Num>,
      },
    ];
    return (
      <>
        {kpis}
        <DataTable
          {...tableProps}
          label="Rekap shift per kasir"
          columns={columns}
          rows={d?.cashiers}
          getRowId={(r) => r.cashierId}
          isLoading={report.isFetching}
          total={d?.cashiers.length}
          toolbar={toolbar}
          empty={empty}
          renderMobile={(r) => (
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-3">
                <span className="truncate text-body-medium text-text-primary">{r.cashierName}</span>
                <Difference value={r.closedShifts ? r.difference : null} />
              </div>
              <span className="text-body-2-regular text-text-tertiary">
                {formatNumber(r.shifts)} shift
                {r.shortShifts ? ` · ${r.shortShifts} kurang` : ""} · {formatNumber(r.transactions)} transaksi · {formatRupiah(r.revenue)}
              </span>
            </div>
          )}
        />
        <p className="mt-3 text-caption-1-regular text-text-tertiary">Diurutkan dari kekurangan kas terbesar. Kolom Shift menampilkan shift ditutup/seluruh shift bila ada yang masih buka.</p>
      </>
    );
  }

  const columns: Column<ShiftRow>[] = [
    {
      id: "opened",
      header: "Shift",
      isRowHeader: true,
      cell: (r) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-body-medium text-text-primary">{r.cashierName}</span>
          <span className="text-caption-1-regular text-text-tertiary">
            {formatDateTime(r.openedAt)} · {r.branchName}
          </span>
        </span>
      ),
    },
    {
      id: "opening",
      header: "Kas awal",
      align: "end",
      cell: (r) => <Num>{formatRupiah(r.openingCash)}</Num>,
    },
    {
      id: "cash",
      header: "Tunai masuk",
      align: "end",
      cell: (r) => <Num>{formatRupiah(r.cashIn)}</Num>,
    },
    {
      id: "refund",
      header: "Refund tunai",
      align: "end",
      cell: (r) => <Num tone={r.cashRefund ? "negative" : "muted"}>{r.cashRefund ? `−${formatRupiah(r.cashRefund)}` : "—"}</Num>,
    },
    {
      id: "expected",
      header: "Seharusnya",
      align: "end",
      cell: (r) => <Num>{formatRupiah(r.expectedCash)}</Num>,
    },
    {
      id: "counted",
      header: "Dihitung",
      align: "end",
      cell: (r) => <Num tone={r.countedCash === null ? "muted" : undefined}>{r.countedCash === null ? "—" : formatRupiah(r.countedCash)}</Num>,
    },
    {
      id: "diff",
      header: "Selisih",
      align: "end",
      cell: (r) => <Difference value={r.difference} open={r.status === "OPEN"} />,
    },
    {
      id: "revenue",
      header: "Omzet",
      align: "end",
      cell: (r) => (
        <span className="flex flex-col items-end">
          <Num strong>{formatRupiah(r.revenue)}</Num>
          <span className="whitespace-nowrap text-caption-1-regular text-text-tertiary">
            {formatNumber(r.transactions)} transaksi{r.voids ? ` · ${r.voids} void` : ""}
          </span>
        </span>
      ),
    },
  ];
  return (
    <>
      {kpis}
      <DataTable
        {...tableProps}
        label="Rekap shift"
        columns={columns}
        rows={d?.shifts}
        getRowId={(r) => r.id}
        isLoading={report.isFetching}
        total={d?.shifts.length}
        toolbar={toolbar}
        empty={empty}
        renderMobile={(r) => (
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-3">
              <span className="truncate text-body-medium text-text-primary">{r.cashierName}</span>
              <Difference value={r.difference} open={r.status === "OPEN"} />
            </div>
            <span className="text-body-2-regular text-text-tertiary">
              {formatDateTime(r.openedAt)} · {r.branchName}
            </span>
            <span className="text-body-2-regular text-text-tertiary tabular-nums">
              Seharusnya {formatRupiah(r.expectedCash)}
              {r.countedCash !== null ? ` · dihitung ${formatRupiah(r.countedCash)}` : ""} · {formatNumber(r.transactions)} transaksi
            </span>
            {r.note && <span className="text-body-2-regular text-text-secondary">“{r.note}”</span>}
          </div>
        )}
      />
      <p className="mt-3 text-caption-1-regular text-text-tertiary">Kas seharusnya = kas awal + tunai masuk − refund tunai. Selisih negatif berarti kas kurang.</p>
    </>
  );
}
