"use client";

import { RiExchangeDollarLine, RiReceiptLine, RiShoppingBag3Line, RiWallet3Line } from "@remixicon/react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { StatCards, type Stat } from "@/components/application/dashboard/stat-cards";
import { Panel, Skeleton } from "@/components/app/page-header";
import { useCountUp } from "@/hooks/use-count-up";
import { api } from "@/lib/api-client";
import { formatNumber, formatRupiah } from "@/lib/format";
import { PAYMENT_LABEL } from "@/lib/pricing";

type SalesSummary = {
  days: number;
  today: { revenue: number; count: number; avg: number };
  yesterday: { revenue: number; count: number };
  period: { revenue: number; count: number };
  trend: { day: string; revenue: number; count: number }[];
  topProducts: { productName: string; variantTitle: string; sku: string; qty: number; revenue: number; grossProfit: number | null }[];
  paymentMix: { method: string; amount: number }[];
};

const compact = (v: number) =>
  v >= 1_000_000_000 ? `Rp${(v / 1_000_000_000).toFixed(1).replace(".", ",")} M` : v >= 1_000_000 ? `Rp${(v / 1_000_000).toFixed(1).replace(".", ",")} jt` : formatRupiah(v);

function delta(current: number, previous: number): Pick<Stat, "delta" | "deltaColor"> {
  if (previous === 0) return { delta: current > 0 ? "baru" : "0%", deltaColor: "neutral" };
  const pct = Math.round(((current - previous) / previous) * 1000) / 10;
  return { delta: `${pct > 0 ? "+" : ""}${pct.toLocaleString("id-ID")}%`, deltaColor: pct > 0 ? "lime" : pct < 0 ? "rose" : "neutral" };
}

function fillDays(trend: SalesSummary["trend"], days: number) {
  const byDay = new Map(trend.map((t) => [t.day, t]));
  const label = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", timeZone: "Asia/Jakarta" });
  const key = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" });
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(Date.now() - (days - 1 - i) * 86_400_000);
    const k = key.format(d);
    return { day: k, label: label.format(d), revenue: byDay.get(k)?.revenue ?? 0, count: byDay.get(k)?.count ?? 0 };
  });
}

function RevenueChart({ summary }: { summary: SalesSummary }) {
  const data = fillDays(summary.trend, summary.days);
  const [active, setActive] = useState<number | null>(null);
  const point = active !== null ? data[active] : null;
  const shown = useCountUp(point ? point.revenue : summary.period.revenue);
  return (
    <Panel className="h-[344px] lg:col-span-2">
      <div className="mb-5">
        <p className="text-body-medium text-text-secondary">{point ? point.label : `Omzet ${summary.days} hari terakhir`}</p>
        <p className="text-title-1-medium text-text-primary tabular-nums">{formatRupiah(shown)}</p>
        <p className="text-body-2-medium text-text-tertiary tabular-nums">{formatNumber(point ? point.count : summary.period.count)} transaksi</p>
      </div>
      <div className="min-h-0 flex-1" role="img" aria-label={`Omzet ${summary.days} hari terakhir ${formatRupiah(summary.period.revenue)}`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
            barCategoryGap="28%"
            onMouseMove={(s) => {
              const i = Number(s?.activeTooltipIndex);
              if (s?.isTooltipActive && Number.isFinite(i)) setActive(i);
            }}
            onMouseLeave={() => setActive(null)}
          >
            <YAxis width={52} tickCount={4} tickFormatter={(v: number) => (v >= 1_000_000 ? `${v / 1_000_000}jt` : v >= 1000 ? `${v / 1000}rb` : `${v}`)} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "var(--color-text-tertiary)" }} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={10} interval="preserveStartEnd" minTickGap={24} tick={{ fontSize: 12, fill: "var(--color-text-tertiary)" }} />
            <Tooltip content={() => null} cursor={{ fill: "var(--color-chart-track)", opacity: 0.5 }} />
            <Bar dataKey="revenue" fill="var(--color-chart-6-active)" radius={[4, 4, 0, 0]} animationDuration={450} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );
}

function TopProducts({ summary }: { summary: SalesSummary }) {
  const totalMix = summary.paymentMix.reduce((s, p) => s + p.amount, 0);
  return (
    <Panel title="Terlaris" className="min-h-[344px]" action={<span className="text-body-2-regular text-text-tertiary">{summary.days} hari</span>}>
      {summary.topProducts.length === 0 ? (
        <p className="text-body-regular text-text-tertiary">Belum ada penjualan pada periode ini.</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {summary.topProducts.slice(0, 5).map((p, i) => (
            <li key={p.sku} className="flex items-center gap-3">
              <span className="w-4 text-body-2-medium text-text-tertiary tabular-nums">{i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body-medium text-text-primary">{p.productName}</span>
                <span className="block truncate text-body-2-regular text-text-tertiary">
                  {p.variantTitle !== "Default" ? `${p.variantTitle} · ` : ""}
                  {formatRupiah(p.revenue)}
                  {p.grossProfit !== null && ` · laba ${compact(p.grossProfit)}`}
                </span>
              </span>
              <span className="shrink-0 text-body-medium text-text-primary tabular-nums">{formatNumber(p.qty)}</span>
            </li>
          ))}
        </ol>
      )}
      {totalMix > 0 && (
        <div className="mt-auto pt-5">
          <p className="mb-2 text-body-2-medium text-text-tertiary">Metode bayar</p>
          <div className="flex h-2 overflow-hidden rounded-full bg-chart-track" aria-hidden>
            {summary.paymentMix.map((p, i) => (
              <div key={p.method} className="h-full" style={{ width: `${(p.amount / totalMix) * 100}%`, background: `var(--color-chart-${[6, 1, 5, 8, 3, 7][i % 6]}-active)` }} />
            ))}
          </div>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-body-2-regular text-text-secondary">
            {summary.paymentMix.map((p, i) => (
              <li key={p.method} className="flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ background: `var(--color-chart-${[6, 1, 5, 8, 3, 7][i % 6]}-active)` }} aria-hidden />
                {PAYMENT_LABEL[p.method] ?? p.method} {Math.round((p.amount / totalMix) * 100)}%
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

/** Bagian penjualan di dashboard. */
export function SalesSection({ branchId }: { branchId: string | null }) {
  const { data, isPending } = useQuery({
    queryKey: ["dashboard", "sales-summary", branchId],
    queryFn: () => api<{ data: SalesSummary }>("/dashboard/sales-summary", { query: { branchId, days: 14 } }).then((r) => r.data),
  });

  if (isPending || !data) {
    return (
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[132px] rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-[344px] rounded-2xl" />
      </div>
    );
  }

  const stats: Stat[] = [
    { icon: RiWallet3Line, label: "Omzet hari ini", value: compact(data.today.revenue), ...delta(data.today.revenue, data.yesterday.revenue) },
    { icon: RiReceiptLine, label: "Transaksi hari ini", value: formatNumber(data.today.count), ...delta(data.today.count, data.yesterday.count) },
    { icon: RiShoppingBag3Line, label: "Rata-rata transaksi", value: compact(data.today.avg), delta: "hari ini", deltaColor: "neutral" },
    { icon: RiExchangeDollarLine, label: `Omzet ${data.days} hari`, value: compact(data.period.revenue), delta: `${formatNumber(data.period.count)} trx`, deltaColor: "neutral" },
  ];

  return (
    <section aria-labelledby="sales-heading" className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <h2 id="sales-heading" className="text-headline-medium text-text-primary">
          Penjualan
        </h2>
        <Link href="/sales" className="text-body-medium text-accent-600 hover:underline dark:text-accent-400">
          Semua transaksi
        </Link>
      </div>
      <StatCards stats={stats} />
      <div className="grid gap-4 lg:grid-cols-3">
        <RevenueChart summary={data} />
        <TopProducts summary={data} />
      </div>
    </section>
  );
}
