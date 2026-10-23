"use client";

import { RiAlertLine, RiArchiveStackLine, RiPriceTag3Line, RiWallet3Line } from "@remixicon/react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { StatCards, type Stat } from "@/components/application/dashboard/stat-cards";
import { Chip } from "@/components/base/badges/chip";
import { PageHeader, Panel, Skeleton } from "@/components/app/page-header";
import { useSession } from "@/components/app/session-context";
import { api } from "@/lib/api-client";
import { formatNumber, formatRupiah } from "@/lib/format";
import { useCountUp } from "@/hooks/use-count-up";
import { SalesSection } from "./sales-section";

type Summary = {
  totals: {
    activeProducts: number;
    variants: number;
    units: number;
    stockValue: number | null;
    retailValue: number;
    lowCount: number;
    outCount: number;
  };
  byBranch: { branchId: string; branchName: string; units: number; retailValue: number }[];
  lowStock: { branchName: string; productName: string; variantTitle: string; sku: string; onHand: number; reorderPoint: number }[];
  movementTrend: { day: string; inbound: number; outbound: number }[];
};

const compactRupiah = (v: number) =>
  v >= 1_000_000_000 ? `Rp${(v / 1_000_000_000).toFixed(1).replace(".", ",")} M` : v >= 1_000_000 ? `Rp${(v / 1_000_000).toFixed(1).replace(".", ",")} jt` : formatRupiah(v);

/** 14 hari terakhir lengkap (hari tanpa pergerakan tetap tampil sebagai 0). */
function fillDays(trend: Summary["movementTrend"]) {
  const byDay = new Map(trend.map((t) => [t.day, t]));
  const out: { day: string; label: string; inbound: number; outbound: number }[] = [];
  const fmt = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", timeZone: "Asia/Jakarta" });
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000);
    const key = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(d);
    const hit = byDay.get(key);
    out.push({ day: key, label: fmt.format(d), inbound: hit?.inbound ?? 0, outbound: hit?.outbound ?? 0 });
  }
  return out;
}

function MovementChart({ trend }: { trend: Summary["movementTrend"] }) {
  const data = fillDays(trend);
  const [active, setActive] = useState<number | null>(null);
  const point = active !== null ? data[active] : null;
  const totalIn = data.reduce((s, d) => s + d.inbound, 0);
  const totalOut = data.reduce((s, d) => s + d.outbound, 0);
  const shownIn = useCountUp(point ? point.inbound : totalIn);
  const shownOut = useCountUp(point ? point.outbound : totalOut);

  return (
    <Panel className="h-[344px] gap-0 lg:col-span-2">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-body-medium text-text-secondary">{point ? point.label : "Pergerakan stok, 14 hari"}</p>
          <div className="mt-0.5 flex items-baseline gap-4">
            <p className="text-title-1-medium text-text-primary tabular-nums">
              {shownIn > 0 ? "+" : ""}{formatNumber(shownIn)} <span className="text-body-medium text-text-tertiary">masuk</span>
            </p>
            <p className="text-title-1-medium text-text-primary tabular-nums">
              {shownOut > 0 ? "−" : ""}{formatNumber(shownOut)} <span className="text-body-medium text-text-tertiary">keluar</span>
            </p>
          </div>
        </div>
        <dl className="flex shrink-0 items-center gap-4 text-body-2-medium text-text-secondary">
          <div className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-chart-6-active" aria-hidden />
            <dt>Masuk</dt>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-chart-neutral" aria-hidden />
            <dt>Keluar</dt>
          </div>
        </dl>
      </div>
      <div className="min-h-0 flex-1" role="img" aria-label={`Stok masuk ${totalIn} unit dan keluar ${totalOut} unit dalam 14 hari terakhir`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
            barCategoryGap="24%"
            barGap={2}
            onMouseMove={(s) => {
              const i = Number(s?.activeTooltipIndex);
              if (s?.isTooltipActive && Number.isFinite(i)) setActive(i);
            }}
            onMouseLeave={() => setActive(null)}
          >
            <YAxis width={36} tickCount={4} allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "var(--color-text-tertiary)" }} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={10} interval="preserveStartEnd" minTickGap={24} tick={{ fontSize: 12, fill: "var(--color-text-tertiary)" }} />
            <Tooltip content={() => null} cursor={{ fill: "var(--color-chart-track)", opacity: 0.5 }} />
            <Bar dataKey="inbound" fill="var(--color-chart-6-active)" radius={[4, 4, 0, 0]} animationDuration={450} />
            <Bar dataKey="outbound" fill="var(--color-chart-neutral)" radius={[4, 4, 0, 0]} animationDuration={450} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );
}

function BranchStock({ rows }: { rows: Summary["byBranch"] }) {
  const max = Math.max(1, ...rows.map((r) => r.units));
  const total = rows.reduce((s, r) => s + r.units, 0);
  return (
    <Panel title="Stok per cabang" className="min-h-[344px]">
      {rows.length === 0 ? (
        <p className="text-body-regular text-text-tertiary">Belum ada stok di cabang mana pun.</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {rows.map((r) => (
            <li key={r.branchId} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-body-medium text-text-primary">{r.branchName}</span>
                <span className="shrink-0 text-body-medium text-text-primary tabular-nums">{formatNumber(r.units)}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-chart-track" aria-hidden>
                <div className="h-full rounded-full bg-chart-6-active transition-[width] duration-500 ease-out" style={{ width: `${(r.units / max) * 100}%` }} />
              </div>
              <span className="text-body-2-regular text-text-tertiary">
                {total ? Math.round((r.units / total) * 100) : 0}% dari total · nilai jual {compactRupiah(r.retailValue)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function RestockList({ rows }: { rows: Summary["lowStock"] }) {
  return (
    <Panel
      title="Perlu restock"
      action={
        <Link href="/inventory?status=low" className="text-body-medium text-accent-600 hover:underline dark:text-accent-400">
          Lihat semua
        </Link>
      }
      className="lg:col-span-3"
    >
      {rows.length === 0 ? (
        <p className="py-6 text-center text-body-regular text-text-tertiary">
          Semua varian masih di atas batas minimum. Atur batas minimum di halaman Stok.
        </p>
      ) : (
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full min-w-[560px] text-start">
            <thead>
              <tr className="text-body-2-medium text-text-tertiary">
                <th className="px-1 pb-2 text-start font-medium">Produk</th>
                <th className="px-1 pb-2 text-start font-medium">SKU</th>
                <th className="px-1 pb-2 text-start font-medium">Cabang</th>
                <th className="px-1 pb-2 text-end font-medium">Stok</th>
                <th className="px-1 pb-2 text-end font-medium">Minimum</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.sku}-${r.branchName}`} className="border-t border-separator-border text-body-medium">
                  <td className="px-1 py-2.5 text-text-primary">
                    {r.productName}
                    {r.variantTitle !== "Default" && <span className="text-text-tertiary"> · {r.variantTitle}</span>}
                  </td>
                  <td className="px-1 py-2.5 font-mono text-body-2-regular text-text-secondary">{r.sku}</td>
                  <td className="px-1 py-2.5 text-text-secondary">{r.branchName}</td>
                  <td className="px-1 py-2.5 text-end">
                    <Chip variant="subtle" color={r.onHand === 0 ? "rose" : "yellow"}>
                      {r.onHand === 0 ? "Habis" : formatNumber(r.onHand)}
                    </Chip>
                  </td>
                  <td className="px-1 py-2.5 text-end text-text-secondary tabular-nums">{formatNumber(r.reorderPoint)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Memuat dashboard">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[132px] rounded-2xl" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-[344px] rounded-2xl lg:col-span-2" />
        <Skeleton className="h-[344px] rounded-2xl" />
      </div>
    </div>
  );
}

export function DashboardView() {
  const { me, branchId, can } = useSession();
  const branch = me.branches.find((b) => b.id === branchId);
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["dashboard", "inventory-summary", branchId],
    queryFn: () => api<{ data: Summary }>("/dashboard/inventory-summary", { query: { branchId } }).then((r) => r.data),
  });

  const t = data?.totals;
  const stats: Stat[] = t
    ? [
        { icon: RiPriceTag3Line, label: "Produk aktif", value: formatNumber(t.activeProducts), delta: `${formatNumber(t.variants)} varian`, deltaColor: "neutral" },
        { icon: RiArchiveStackLine, label: "Total stok", value: `${formatNumber(t.units)} unit`, delta: `${data.byBranch.length} lokasi`, deltaColor: "neutral" },
        can("product:view_cost") && t.stockValue !== null
          ? { icon: RiWallet3Line, label: "Nilai stok (modal)", value: compactRupiah(t.stockValue), delta: `jual ${compactRupiah(t.retailValue)}`, deltaColor: "neutral" }
          : { icon: RiWallet3Line, label: "Nilai stok (harga jual)", value: compactRupiah(t.retailValue), delta: "harga jual", deltaColor: "neutral" },
        {
          icon: RiAlertLine,
          label: "Perlu restock",
          value: formatNumber(t.lowCount + t.outCount),
          delta: `${formatNumber(t.outCount)} habis`,
          deltaColor: t.outCount > 0 ? "rose" : "neutral",
        },
      ]
    : [];

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`Penjualan dan kondisi stok ${branch ? `di ${branch.name}` : "di semua cabang"}.`}
      />
      {isPending ? (
        <DashboardSkeleton />
      ) : isError ? (
        <Panel>
          <p className="text-body-regular text-text-secondary">
            Data dashboard gagal dimuat.{" "}
            <button type="button" onClick={() => refetch()} className="cursor-pointer text-accent-600 underline dark:text-accent-400">
              Coba lagi
            </button>
          </p>
        </Panel>
      ) : (
        <div className="flex flex-col gap-8">
          {can("sale:read") && <SalesSection branchId={branchId} />}
          <section aria-labelledby="stock-heading" className="flex flex-col gap-4">
            <h2 id="stock-heading" className="text-headline-medium text-text-primary">
              Stok
            </h2>
            <StatCards stats={stats} />
            <div className="grid gap-4 lg:grid-cols-3">
              <MovementChart trend={data.movementTrend} />
              <BranchStock rows={data.byBranch} />
              <RestockList rows={data.lowStock} />
            </div>
          </section>
        </div>
      )}
    </>
  );
}
