"use client";

import { RiAddLine, RiCoupon3Line, RiPauseLine, RiPlayLine, RiSearchLine } from "@remixicon/react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Chip } from "@/components/base/badges/chip";
import { Button } from "@/components/base/buttons/button";
import { InputBase } from "@/components/base/input/input";
import { SegmentedControl, SegmentedControlItem } from "@/components/base/segmented-control/segmented-control";
import { Select, SelectItem } from "@/components/base/select/select";
import { DataTable, type Column } from "@/components/app/data-table";
import { PageHeader, Skeleton } from "@/components/app/page-header";
import { useSession } from "@/components/app/session-context";
import { Sheet } from "@/components/app/sheet";
import { useToast } from "@/components/app/toast";
import { useDebounced, useUrlState } from "@/hooks/use-url-state";
import { api } from "@/lib/api-client";
import { readApiError } from "@/lib/form-errors";
import { formatDate, formatDateTime, formatNumber, formatRupiah } from "@/lib/format";
import { VoucherForm, type VoucherDetail } from "./voucher-form";

type State = VoucherDetail["state"];
type VoucherRow = {
  id: string;
  code: string;
  name: string;
  valueType: "NOMINAL" | "PERCENT";
  value: number;
  maxDiscount: number | null;
  minSpend: number;
  startsAt: string;
  endsAt: string | null;
  quotaTotal: number | null;
  quotaUsed: number;
  productScope: string;
  customerScope: string;
  state: State;
  totalDiscount: number;
  revenue: number;
};

const STATE: Record<State, { label: string; color: "lime" | "gray" | "yellow" | "rose" | "neutral" }> = {
  ACTIVE: { label: "Aktif", color: "lime" },
  SCHEDULED: { label: "Terjadwal", color: "yellow" },
  PAUSED: { label: "Dijeda", color: "gray" },
  EXHAUSTED: { label: "Kuota habis", color: "rose" },
  EXPIRED: { label: "Berakhir", color: "neutral" },
};

export const valueLabel = (v: Pick<VoucherRow, "valueType" | "value" | "maxDiscount">) =>
  v.valueType === "PERCENT" ? `${v.value / 100}%${v.maxDiscount ? ` maks ${formatRupiah(v.maxDiscount)}` : ""}` : formatRupiah(v.value);

function QuotaBar({ used, total }: { used: number; total: number | null }) {
  if (total === null) return <span className="text-body-2-regular text-text-tertiary tabular-nums">{formatNumber(used)} terpakai</span>;
  const pct = Math.min(100, (used / total) * 100);
  return (
    <span className="flex min-w-[120px] flex-col gap-1">
      <span className="text-body-2-regular text-text-secondary tabular-nums">
        {formatNumber(used)} / {formatNumber(total)}
      </span>
      <span className="h-1.5 overflow-hidden rounded-full bg-chart-track" aria-hidden>
        <span className={`block h-full rounded-full ${pct >= 100 ? "bg-status-rose-text" : "bg-chart-6-active"}`} style={{ width: `${pct}%` }} />
      </span>
    </span>
  );
}

/** Ringkasan aturan voucher dalam kalimat, agar kasir/admin cepat paham. */
function RuleSummary({ v }: { v: VoucherDetail }) {
  const products = v.targets.filter((t) => ["CATEGORY", "PRODUCT", "VARIANT"].includes(t.type) && !t.isExclusion).map((t) => t.label);
  const excluded = v.targets.filter((t) => t.isExclusion).map((t) => t.label);
  const people = v.targets.filter((t) => t.type === "TIER" || t.type === "CUSTOMER").map((t) => t.label);
  const branchList = v.targets.filter((t) => t.type === "BRANCH").map((t) => t.label);
  const rows: [string, string][] = [
    ["Potongan", valueLabel(v)],
    ["Belanja", `${v.minSpend ? `min ${formatRupiah(v.minSpend)}` : "tanpa minimum"}${v.maxSpend ? `, maks ${formatRupiah(v.maxSpend)}` : ""}`],
    ["Periode", `${formatDateTime(v.startsAt)} – ${v.endsAt ? formatDateTime(v.endsAt) : "tanpa batas"}`],
    ["Kuota", `${v.quotaTotal ? `${v.quotaUsed}/${v.quotaTotal}` : `${v.quotaUsed} terpakai, tanpa batas`}${v.quotaPerCustomer ? ` · ${v.quotaPerCustomer}× per customer` : ""}`],
    ["Produk", v.productScope === "ALL" ? "Semua produk" : products.join(", ")],
    ...(excluded.length ? ([["Kecuali", excluded.join(", ")]] as [string, string][]) : []),
    ["Pembeli", v.customerScope === "ALL" ? "Semua pembeli" : v.customerScope === "MEMBER" ? "Khusus member" : people.join(", ")],
    ["Cabang", branchList.length ? branchList.join(", ") : "Semua cabang"],
  ];
  return (
    <dl className="grid grid-cols-[96px_1fr] gap-x-3 gap-y-2 text-body-2-regular">
      {rows.map(([k, val]) => (
        <div key={k} className="contents">
          <dt className="text-text-tertiary">{k}</dt>
          <dd className="text-text-primary">{val}</dd>
        </div>
      ))}
    </dl>
  );
}

type Performance = { days: number; vouchers: { uses: number; uniqueCustomers: number; totalDiscount: number; revenue: number; avgOrder: number }[] };
type Usage = { saleId: string; number: string; discount: number; saleTotal: number; status: string; createdAt: string; customerName: string | null; branchName: string };

function VoucherDetailPanel({ id, onEdit }: { id: string; onEdit: (v: VoucherDetail) => void }) {
  const { can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [days, setDays] = useState("30");
  const voucher = useQuery({ queryKey: ["voucher", id], queryFn: () => api<{ data: VoucherDetail }>(`/vouchers/${id}`).then((r) => r.data) });
  const perf = useQuery({ queryKey: ["voucher-perf", id, days], queryFn: () => api<{ data: Performance }>("/vouchers/performance", { query: { voucherId: id, days } }).then((r) => r.data) });
  const usages = useQuery({ queryKey: ["voucher-usages", id], queryFn: () => api<{ data: Usage[] }>(`/vouchers/${id}/usages`).then((r) => r.data) });
  const toggle = useMutation({
    mutationFn: (status: "ACTIVE" | "PAUSED") => api<{ data: VoucherDetail }>(`/vouchers/${id}/status`, { method: "POST", body: { status } }),
    onSuccess: ({ data }) => {
      qc.setQueryData(["voucher", id], data);
      qc.invalidateQueries({ queryKey: ["vouchers"] });
      toast.show({ status: "success", title: data.status === "PAUSED" ? `${data.code} dijeda` : `${data.code} aktif kembali` });
    },
    onError: (e) => toast.show({ status: "error", title: readApiError(e).message }),
  });

  if (!voucher.data) return <Skeleton className="h-72 rounded-2xl" />;
  const v = voucher.data;
  const p = perf.data?.vouchers[0];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-title-3-semibold text-text-primary">{v.code}</p>
          <p className="text-body-2-regular text-text-secondary">{v.name}</p>
        </div>
        <Chip variant="bold" color={STATE[v.state].color}>
          {STATE[v.state].label}
        </Chip>
      </div>
      <RuleSummary v={v} />
      {can("voucher:update") && (
        <div className="flex flex-wrap gap-2">
          <Button size="small" variant="secondary" onClick={() => onEdit(v)}>
            Ubah voucher
          </Button>
          <Button
            size="small"
            variant="ghost"
            leadingIcon={v.status === "PAUSED" ? RiPlayLine : RiPauseLine}
            disabled={toggle.isPending}
            onClick={() => toggle.mutate(v.status === "PAUSED" ? "ACTIVE" : "PAUSED")}
          >
            {v.status === "PAUSED" ? "Aktifkan lagi" : "Jeda"}
          </Button>
        </div>
      )}

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-headline-medium text-text-primary">Performa</h3>
          <SegmentedControl aria-label="Periode performa" selectedKeys={new Set([days])} onSelectionChange={(k) => { const n = [...k][0]; if (n) setDays(String(n)); }}>
            <SegmentedControlItem id="7">7 hari</SegmentedControlItem>
            <SegmentedControlItem id="30">30 hari</SegmentedControlItem>
            <SegmentedControlItem id="365">1 tahun</SegmentedControlItem>
          </SegmentedControl>
        </div>
        <dl className="grid grid-cols-2 gap-2">
          {[
            ["Dipakai", p ? `${formatNumber(p.uses)}×` : "0×"],
            ["Customer unik", formatNumber(p?.uniqueCustomers ?? 0)],
            ["Total potongan", formatRupiah(p?.totalDiscount ?? 0)],
            ["Omzet dari voucher", formatRupiah(p?.revenue ?? 0)],
            ["Rata-rata transaksi", formatRupiah(p?.avgOrder ?? 0)],
            ["Biaya per Rp1 omzet", p && p.revenue ? `Rp${(p.totalDiscount / p.revenue).toFixed(2).replace(".", ",")}` : "—"],
          ].map(([k, val]) => (
            <div key={k} className="rounded-xl bg-background-secondary-default px-3 py-2">
              <dt className="text-caption-1-regular text-text-tertiary">{k}</dt>
              <dd className="text-body-medium text-text-primary tabular-nums">{val}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section>
        <h3 className="mb-2 text-headline-medium text-text-primary">Pemakaian terakhir</h3>
        {!usages.data?.length ? (
          <p className="text-body-regular text-text-tertiary">Belum pernah dipakai.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-separator-border">
            {usages.data.map((u) => (
              <li key={u.saleId} className="flex justify-between gap-3 py-2">
                <span className="min-w-0">
                  <span className="block font-mono text-body-2-medium text-text-primary">{u.number}</span>
                  <span className="text-caption-1-regular text-text-tertiary">
                    {formatDateTime(u.createdAt)} · {u.branchName}
                    {u.customerName && ` · ${u.customerName}`}
                  </span>
                </span>
                <span className="shrink-0 text-end">
                  <span className={`block text-body-2-medium tabular-nums ${u.status === "REVERSED" ? "text-text-tertiary line-through" : "text-text-primary"}`}>−{formatRupiah(u.discount)}</span>
                  <span className="text-caption-1-regular text-text-tertiary tabular-nums">{u.status === "REVERSED" ? "dibatalkan" : formatRupiah(u.saleTotal)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export function VouchersView() {
  const { can } = useSession();
  const toast = useToast();
  const url = useUrlState();
  const [search, setSearch] = useState(url.get("q") ?? "");
  const q = useDebounced(search.trim());
  const page = Number(url.get("page") ?? 1);
  const state = url.get("state") ?? "all";
  const [sheet, setSheet] = useState<{ mode: "view"; id: string } | { mode: "edit"; voucher: VoucherDetail | null } | null>(null);

  const list = useQuery({
    queryKey: ["vouchers", { q, page, state }],
    queryFn: () => api<{ data: VoucherRow[]; meta: { total: number; pageCount: number } }>("/vouchers", { query: { q, page, pageSize: 25, state: state === "all" ? undefined : state } }),
    placeholderData: keepPreviousData,
  });

  const columns: Column<VoucherRow>[] = [
    {
      id: "code",
      header: "Voucher",
      isRowHeader: true,
      className: "w-[26%]",
      cell: (v) => (
        <span className="flex min-w-0 flex-col">
          <span className="font-mono text-body-medium text-text-primary">{v.code}</span>
          <span className="truncate text-body-2-regular text-text-tertiary">{v.name}</span>
        </span>
      ),
    },
    { id: "value", header: "Potongan", cell: (v) => <span className="whitespace-nowrap text-body-medium text-text-primary">{valueLabel(v)}</span> },
    {
      id: "period",
      header: "Periode",
      cell: (v) => (
        <span className="whitespace-nowrap text-body-2-regular text-text-secondary">
          {formatDate(v.startsAt)} – {v.endsAt ? formatDate(v.endsAt) : "∞"}
        </span>
      ),
    },
    { id: "quota", header: "Kuota", cell: (v) => <QuotaBar used={v.quotaUsed} total={v.quotaTotal} /> },
    { id: "discount", header: "Total potongan", align: "end", cell: (v) => <span className="text-body-medium text-text-secondary tabular-nums">{formatRupiah(v.totalDiscount)}</span> },
    { id: "revenue", header: "Omzet", align: "end", cell: (v) => <span className="text-body-medium text-text-primary tabular-nums">{formatRupiah(v.revenue)}</span> },
    {
      id: "state",
      header: "Status",
      cell: (v) => (
        <Chip variant="bold" color={STATE[v.state].color}>
          {STATE[v.state].label}
        </Chip>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Voucher"
        description="Kode promo untuk kasir: nominal atau persen, dengan kuota, minimal belanja, dan target produk, member, customer, atau cabang."
        actions={
          can("voucher:create") && (
            <Button leadingIcon={RiAddLine} onClick={() => setSheet({ mode: "edit", voucher: null })}>
              Buat voucher
            </Button>
          )
        }
      />
      <DataTable
        label="Daftar voucher"
        unit="voucher"
        columns={columns}
        rows={list.data?.data}
        getRowId={(v) => v.id}
        isLoading={list.isFetching}
        total={list.data?.meta.total}
        page={page}
        pageCount={list.data?.meta.pageCount ?? 1}
        onPageChange={(p) => url.set({ page: p })}
        onRowAction={(v) => setSheet({ mode: "view", id: v.id })}
        toolbar={
          <>
            <Select aria-label="Filter status" selectedKey={state} onSelectionChange={(k) => url.set({ state: k === "all" ? null : String(k), page: null })} className="shrink-0" popoverClassName="min-w-40">
              <SelectItem id="all" textValue="Semua status">Semua status</SelectItem>
              {Object.entries(STATE).map(([k, s]) => (
                <SelectItem key={k} id={k} textValue={s.label}>
                  {s.label}
                </SelectItem>
              ))}
            </Select>
            <InputBase
              aria-label="Cari kode atau nama voucher"
              placeholder="Cari kode atau nama"
              leadingIcon={RiSearchLine}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                url.set({ q: e.target.value.trim() || null, page: null });
              }}
              fieldClassName="min-w-[200px] flex-1 rounded-full bg-background-secondary-default md:w-[240px] md:flex-none"
              className="text-body-medium"
            />
          </>
        }
        empty={
          q || state !== "all" ? (
            <p className="text-body-medium text-text-primary">Tidak ada voucher yang cocok.</p>
          ) : (
            <>
              <RiCoupon3Line className="size-6 text-foreground-icon-tertiary" aria-hidden />
              <p className="text-body-medium text-text-primary">Belum ada voucher.</p>
              <p className="text-body-regular text-text-tertiary">Buat voucher pertama untuk mulai promosi.</p>
            </>
          )
        }
        renderMobile={(v) => (
          <button type="button" className="flex w-full items-start justify-between gap-3 text-start" onClick={() => setSheet({ mode: "view", id: v.id })}>
            <span className="min-w-0">
              <span className="block font-mono text-body-medium text-text-primary">{v.code}</span>
              <span className="block truncate text-body-2-regular text-text-tertiary">
                {valueLabel(v)} · {v.quotaTotal ? `${v.quotaUsed}/${v.quotaTotal}` : `${v.quotaUsed}×`}
              </span>
            </span>
            <Chip variant="bold" color={STATE[v.state].color}>
              {STATE[v.state].label}
            </Chip>
          </button>
        )}
      />
      <Sheet
        isOpen={sheet !== null}
        onClose={() => setSheet(null)}
        wide={sheet?.mode === "edit"}
        title={sheet?.mode === "view" ? "Detail voucher" : sheet?.voucher ? "Ubah voucher" : "Buat voucher"}
      >
        {sheet?.mode === "view" && <VoucherDetailPanel id={sheet.id} onEdit={(v) => setSheet({ mode: "edit", voucher: v })} />}
        {sheet?.mode === "edit" && (
          <VoucherForm
            voucher={sheet.voucher}
            onCancel={() => setSheet(sheet.voucher ? { mode: "view", id: sheet.voucher.id } : null)}
            onSaved={(v) => {
              toast.show({ status: "success", title: sheet.voucher ? `Voucher ${v.code} diperbarui` : `Voucher ${v.code} dibuat` });
              setSheet({ mode: "view", id: v.id });
            }}
          />
        )}
      </Sheet>
    </>
  );
}
