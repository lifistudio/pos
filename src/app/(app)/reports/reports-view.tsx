"use client";

import { RiBarChartBoxLine, RiDownload2Line } from "@remixicon/react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/base/buttons/button";
import { SegmentedControl, SegmentedControlItem } from "@/components/base/segmented-control/segmented-control";
import { Select, SelectItem } from "@/components/base/select/select";
import { DataTable, type Column } from "@/components/app/data-table";
import { PageHeader } from "@/components/app/page-header";
import { RETURN_REASONS } from "@/components/app/return-form";
import { useSession } from "@/components/app/session-context";
import { useToast } from "@/components/app/toast";
import { useUrlState } from "@/hooks/use-url-state";
import { api, buildQuery } from "@/lib/api-client";
import { formatNumber, formatRupiah } from "@/lib/format";
import { PAYMENT_LABEL } from "@/lib/pricing";
import { cx } from "@/utils/cx";
import { CHANNEL_LABEL } from "../orders/order-labels";
import { MOVEMENT_GROUPS, MovementsPanel, SHIFT_GROUPS, ShiftsPanel, STOCK_GROUPS, StockPanel } from "./inventory-reports";
import { Kpi, Share } from "./report-parts";

type Tab = "sales" | "returns" | "stock" | "movements" | "shifts";
type SalesRow = {
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
type SalesReport = {
  showCost: boolean;
  rows: SalesRow[];
  totals: Omit<SalesRow, "key" | "label"> & { averageTicket: number };
};
type ReturnsRow = {
  key: string;
  label: string;
  returns: number;
  units: number;
  damagedUnits: number;
  amount: number;
};
type ReturnsReport = {
  rows: ReturnsRow[];
  totals: {
    returns: number | null;
    units: number;
    damagedUnits: number;
    amount: number;
  };
};

const SALES_GROUPS = {
  day: "Per hari",
  branch: "Per cabang",
  cashier: "Per kasir",
  channel: "Per kanal",
  category: "Per kategori",
  product: "Per produk",
  payment: "Per metode bayar",
} as const;
const RETURNS_GROUPS = {
  reason: "Per alasan",
  product: "Per produk",
  cashier: "Per pemroses",
  branch: "Per cabang",
} as const;
const GROUPS = {
  sales: SALES_GROUPS,
  returns: RETURNS_GROUPS,
  stock: STOCK_GROUPS,
  movements: MOVEMENT_GROUPS,
  shifts: SHIFT_GROUPS,
} as const;
const DEFAULT_GROUP: Record<Tab, string> = {
  sales: "day",
  returns: "reason",
  stock: "branch",
  movements: "type",
  shifts: "shift",
};
const TAB_LABEL: Record<Tab, string> = {
  sales: "Penjualan",
  returns: "Retur",
  stock: "Stok",
  movements: "Pergerakan",
  shifts: "Shift kasir",
};
const DESCRIPTION: Record<Tab, string> = {
  sales: "Penjualan bersih setelah retur, per dimensi yang Anda pilih. Angka dihitung dari transaksi lunas; ongkir order online tidak dihitung sebagai penjualan.",
  returns: "Retur per alasan, produk, pemroses, atau cabang, termasuk unit rusak yang tidak kembali ke stok.",
  stock: "Nilai persediaan saat ini, umur stok, dan barang yang lama tidak terjual.",
  movements: "Arus barang pada periode: saldo awal, masuk, keluar, terjual, saldo akhir.",
  shifts: "Kas awal, tunai masuk, kas seharusnya vs kas dihitung, dan selisih per shift atau per kasir.",
};
/** Laporan stok/shift diekspor lewat satu endpoint dengan parameter `kind`. */
const EXPORT_KIND: Partial<Record<Tab, string>> = {
  movements: "stock-movements",
  shifts: "shifts",
};

const DIMENSION_HEADER: Record<string, string> = {
  day: "Tanggal",
  branch: "Cabang",
  cashier: "Kasir",
  channel: "Kanal",
  category: "Kategori",
  product: "Produk",
  payment: "Metode bayar",
  reason: "Alasan",
};
const PERIODS = {
  today: "Hari ini",
  "7d": "7 hari terakhir",
  "30d": "30 hari terakhir",
  month: "Bulan ini",
  lastMonth: "Bulan lalu",
} as const;
type Period = keyof typeof PERIODS;

/** Rentang dalam zona waktu perangkat → ISO (akhir eksklusif). */
function periodRange(p: Period) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  if (p === "7d") start.setDate(start.getDate() - 6);
  if (p === "30d") start.setDate(start.getDate() - 29);
  if (p === "month") start.setDate(1);
  if (p === "lastMonth") {
    start.setDate(1);
    start.setMonth(start.getMonth() - 1);
    end.setTime(new Date(start.getFullYear(), start.getMonth() + 1, 1).getTime());
  }
  return { from: start.toISOString(), to: end.toISOString() };
}

const dayLabel = (iso: string) =>
  new Intl.DateTimeFormat("id-ID", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(`${iso}T00:00:00`));

function labelFor(group: string, label: string) {
  if (group === "channel") return label === "POS" ? "Kasir (toko)" : (CHANNEL_LABEL[label as keyof typeof CHANNEL_LABEL] ?? label);
  if (group === "payment") return PAYMENT_LABEL[label] ?? label;
  if (group === "reason") return RETURN_REASONS[label as keyof typeof RETURN_REASONS] ?? label;
  if (group === "day") return dayLabel(label);
  return label;
}

export function ReportsView() {
  const { can, me, branchId: sessionBranch } = useSession();
  const toast = useToast();
  const url = useUrlState();
  const period = (url.get("period") ?? "30d") as Period;
  const branchId = url.get("branch") ?? sessionBranch ?? "all";
  const tab = (Object.hasOwn(GROUPS, url.get("tab") ?? "") ? url.get("tab") : "sales") as Tab;
  const groupParam = url.get("group");
  const group = groupParam && Object.hasOwn(GROUPS[tab], groupParam) ? groupParam : DEFAULT_GROUP[tab];
  const [exporting, setExporting] = useState(false);
  const query = {
    ...periodRange(period),
    branchId: branchId === "all" ? undefined : branchId,
    groupBy: group,
  };

  const sales = useQuery({
    queryKey: ["report-sales", query],
    queryFn: () => api<{ data: SalesReport }>("/reports/sales", { query }).then((r) => r.data),
    enabled: tab === "sales",
    placeholderData: keepPreviousData,
  });
  const returns = useQuery({
    queryKey: ["report-returns", query],
    queryFn: () => api<{ data: ReturnsReport }>("/reports/returns", { query }).then((r) => r.data),
    enabled: tab === "returns",
    placeholderData: keepPreviousData,
  });

  async function exportCsv() {
    setExporting(true);
    try {
      const kind = tab === "stock" ? (group === "aging" || group === "slow" ? "stock-aging" : "stock-valuation") : EXPORT_KIND[tab];
      const path = kind
        ? `/api/v1/reports/inventory/export${buildQuery({ ...(tab === "stock" ? {} : periodRange(period)), branchId: query.branchId, groupBy: tab === "stock" && kind === "stock-aging" ? undefined : group, kind })}`
        : `/api/v1/reports/${tab}/export${buildQuery(query)}`;
      const res = await fetch(path, { credentials: "same-origin" });
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "laporan.csv";
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = name;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch {
      toast.show({ status: "error", title: "Export gagal. Coba lagi." });
    } finally {
      setExporting(false);
    }
  }

  const s = sales.data;
  const maxNet = Math.max(0, ...(s?.rows.map((r) => r.net) ?? []));
  const salesColumns: Column<SalesRow>[] = [
    {
      id: "label",
      header: DIMENSION_HEADER[group] ?? "Dimensi",
      isRowHeader: true,
      cell: (r) => <span className="text-body-medium text-text-primary">{labelFor(group, r.label)}</span>,
    },
    {
      id: "tx",
      header: "Transaksi",
      align: "end",
      cell: (r) => <span className="text-body-medium text-text-secondary tabular-nums">{formatNumber(r.transactions)}</span>,
    },
    ...(group === "payment"
      ? []
      : [
          {
            id: "units",
            header: "Unit",
            align: "end" as const,
            cell: (r: SalesRow) => <span className="text-body-medium text-text-secondary tabular-nums">{r.units === null ? "—" : formatNumber(r.units)}</span>,
          },
        ]),
    ...(group === "payment"
      ? []
      : [
          {
            id: "discount",
            header: "Diskon",
            align: "end" as const,
            cell: (r: SalesRow) => <span className="text-body-medium text-text-secondary tabular-nums">{formatRupiah(r.discount)}</span>,
          },
        ]),
    {
      id: "revenue",
      header: group === "payment" ? "Diterima" : "Penjualan",
      align: "end",
      cell: (r) => <span className="text-body-medium text-text-secondary tabular-nums">{formatRupiah(r.revenue)}</span>,
    },
    {
      id: "refunds",
      header: "Retur",
      align: "end",
      cell: (r) => <span className={cx("text-body-medium tabular-nums", r.refunds ? "text-status-rose-text" : "text-text-tertiary")}>{r.refunds ? `−${formatRupiah(r.refunds)}` : "—"}</span>,
    },
    {
      id: "net",
      header: "Bersih",
      align: "end",
      cell: (r) => <span className="text-body-medium text-text-primary tabular-nums">{formatRupiah(r.net)}</span>,
    },
    ...(s?.showCost && group !== "payment"
      ? [
          {
            id: "gp",
            header: "Laba kotor",
            align: "end" as const,
            cell: (r: SalesRow) => <span className="text-body-medium text-text-secondary tabular-nums">{r.grossProfit === null ? "—" : formatRupiah(r.grossProfit)}</span>,
          },
        ]
      : []),
    {
      id: "share",
      header: "Porsi",
      cell: (r) => <Share value={r.net} max={maxNet} />,
    },
  ];

  const rt = returns.data;
  const maxUnits = Math.max(0, ...(rt?.rows.map((r) => r.units) ?? []));
  const returnColumns: Column<ReturnsRow>[] = [
    {
      id: "label",
      header: group === "cashier" ? "Diproses oleh" : (DIMENSION_HEADER[group] ?? "Dimensi"),
      isRowHeader: true,
      cell: (r) => <span className="text-body-medium text-text-primary">{labelFor(group, r.label)}</span>,
    },
    {
      id: "returns",
      header: "Retur",
      align: "end",
      cell: (r) => <span className="text-body-medium text-text-secondary tabular-nums">{formatNumber(r.returns)}</span>,
    },
    {
      id: "units",
      header: "Unit",
      align: "end",
      cell: (r) => <span className="text-body-medium text-text-secondary tabular-nums">{formatNumber(r.units)}</span>,
    },
    {
      id: "damaged",
      header: "Rusak",
      align: "end",
      cell: (r) => <span className={cx("text-body-medium tabular-nums", r.damagedUnits ? "text-status-rose-text" : "text-text-tertiary")}>{r.damagedUnits ? formatNumber(r.damagedUnits) : "—"}</span>,
    },
    {
      id: "amount",
      header: "Uang kembali",
      align: "end",
      cell: (r) => <span className="text-body-medium text-text-primary tabular-nums">{formatRupiah(r.amount)}</span>,
    },
    {
      id: "share",
      header: "Porsi",
      cell: (r) => <Share value={r.units} max={maxUnits} />,
    },
  ];

  const groups: Record<string, string> = GROUPS[tab];
  const toolbar = (
    <>
      <Select aria-label="Dimensi" selectedKey={group} onSelectionChange={(k) => url.set({ group: String(k) })} className="shrink-0" popoverClassName="min-w-48">
        {Object.entries(groups).map(([k, label]) => (
          <SelectItem key={k} id={k} textValue={label}>
            {label}
          </SelectItem>
        ))}
      </Select>
      {tab !== "stock" && (
        <Select aria-label="Periode" selectedKey={period} onSelectionChange={(k) => url.set({ period: k === "30d" ? null : String(k) })} className="shrink-0" popoverClassName="min-w-44">
          {Object.entries(PERIODS).map(([k, label]) => (
            <SelectItem key={k} id={k} textValue={label}>
              {label}
            </SelectItem>
          ))}
        </Select>
      )}
      {me.branches.length > 1 && (
        <Select aria-label="Cabang" selectedKey={branchId} onSelectionChange={(k) => url.set({ branch: k === "all" ? null : String(k) })} className="shrink-0" popoverClassName="min-w-52">
          <SelectItem id="all" textValue="Semua cabang">
            Semua cabang
          </SelectItem>
          {me.branches.map((b) => (
            <SelectItem key={b.id} id={b.id} textValue={b.name}>
              {b.name}
            </SelectItem>
          ))}
        </Select>
      )}
    </>
  );
  const empty = (
    <>
      <RiBarChartBoxLine className="size-6 text-foreground-icon-tertiary" aria-hidden />
      <p className="text-body-medium text-text-primary">Belum ada data pada periode ini.</p>
      <p className="text-body-regular text-text-tertiary">Ubah periode atau cabang.</p>
    </>
  );

  return (
    <>
      <PageHeader
        title="Laporan"
        description={DESCRIPTION[tab]}
        actions={
          can("report:export") && (
            <Button variant="secondary" leadingIcon={RiDownload2Line} onClick={exportCsv} disabled={exporting}>
              {exporting ? "Menyiapkan…" : "Export CSV"}
            </Button>
          )
        }
      />
      <div className="-mx-4 mb-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
        <SegmentedControl
          aria-label="Jenis laporan"
          selectedKeys={new Set([tab])}
          onSelectionChange={(k) => {
            const next = [...k][0];
            if (next)
              url.set({
                tab: next === "sales" ? null : String(next),
                group: null,
              });
          }}
        >
          {(Object.keys(TAB_LABEL) as Tab[]).map((k) => (
            <SegmentedControlItem key={k} id={k}>
              {TAB_LABEL[k]}
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
      </div>

      {tab === "stock" ? (
        <StockPanel group={group} query={query} toolbar={toolbar} empty={empty} />
      ) : tab === "movements" ? (
        <MovementsPanel group={group} query={query} toolbar={toolbar} empty={empty} />
      ) : tab === "shifts" ? (
        <ShiftsPanel group={group} query={query} toolbar={toolbar} empty={empty} />
      ) : tab === "sales" ? (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5" aria-busy={sales.isFetching}>
            <Kpi label="Transaksi" value={s ? formatNumber(s.totals.transactions) : "…"} hint={s ? `rata-rata ${formatRupiah(s.totals.averageTicket)}` : undefined} />
            <Kpi label="Penjualan" value={s ? formatRupiah(s.totals.revenue) : "…"} hint={s && s.totals.discount ? `diskon ${formatRupiah(s.totals.discount)}` : undefined} />
            <Kpi label="Retur" value={s ? (s.totals.refunds ? `−${formatRupiah(s.totals.refunds)}` : "Rp0") : "…"} tone={s?.totals.refunds ? "negative" : undefined} />
            <Kpi label="Penjualan bersih" value={s ? formatRupiah(s.totals.net) : "…"} />
            {s?.showCost && (
              <Kpi
                label="Laba kotor"
                value={s.totals.grossProfit === null ? "—" : formatRupiah(s.totals.grossProfit)}
                hint={s.totals.grossProfit !== null && s.totals.net ? `margin ${Math.round((s.totals.grossProfit / s.totals.net) * 100)}%` : undefined}
              />
            )}
          </div>
          <DataTable
            label="Laporan penjualan"
            unit="baris"
            columns={salesColumns}
            rows={s?.rows}
            getRowId={(r) => r.key}
            isLoading={sales.isFetching}
            total={s?.rows.length}
            page={1}
            pageCount={1}
            onPageChange={() => {}}
            toolbar={toolbar}
            empty={empty}
            renderMobile={(r) => (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-body-medium text-text-primary">{labelFor(group, r.label)}</span>
                  <span className="shrink-0 text-body-medium text-text-primary tabular-nums">{formatRupiah(r.net)}</span>
                </div>
                <span className="text-body-2-regular text-text-tertiary">
                  {formatNumber(r.transactions)} transaksi
                  {r.refunds ? ` · retur −${formatRupiah(r.refunds)}` : ""}
                </span>
                <Share value={r.net} max={maxNet} />
              </div>
            )}
          />
        </>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4" aria-busy={returns.isFetching}>
            <Kpi label="Jumlah retur" value={rt ? formatNumber(rt.totals.returns ?? rt.rows.reduce((n, r) => n + r.returns, 0)) : "…"} />
            <Kpi label="Unit diretur" value={rt ? formatNumber(rt.totals.units) : "…"} />
            <Kpi label="Unit rusak" value={rt ? formatNumber(rt.totals.damagedUnits) : "…"} tone={rt?.totals.damagedUnits ? "negative" : undefined} hint="tidak kembali ke stok" />
            <Kpi label="Uang dikembalikan" value={rt ? formatRupiah(rt.totals.amount) : "…"} />
          </div>
          <DataTable
            label="Laporan retur"
            unit="baris"
            columns={returnColumns}
            rows={rt?.rows}
            getRowId={(r) => r.key}
            isLoading={returns.isFetching}
            total={rt?.rows.length}
            page={1}
            pageCount={1}
            onPageChange={() => {}}
            toolbar={toolbar}
            empty={empty}
            renderMobile={(r) => (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-body-medium text-text-primary">{labelFor(group, r.label)}</span>
                  <span className="shrink-0 text-body-medium text-text-primary tabular-nums">{formatRupiah(r.amount)}</span>
                </div>
                <span className="text-body-2-regular text-text-tertiary">
                  {formatNumber(r.units)} unit
                  {r.damagedUnits ? ` · ${r.damagedUnits} rusak` : ""}
                </span>
                <Share value={r.units} max={maxUnits} />
              </div>
            )}
          />
        </>
      )}
    </>
  );
}
