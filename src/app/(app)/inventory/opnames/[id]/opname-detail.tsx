"use client";

import { RiCheckboxCircleLine, RiDeleteBinLine, RiErrorWarningLine } from "@remixicon/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Chip } from "@/components/base/badges/chip";
import { Breadcrumb, BreadcrumbItem } from "@/components/base/breadcrumb/breadcrumb";
import { Button } from "@/components/base/buttons/button";
import { InputBase } from "@/components/base/input/input";
import { SegmentedControl, SegmentedControlItem } from "@/components/base/segmented-control/segmented-control";
import { PageHeader, Panel, Skeleton } from "@/components/app/page-header";
import { ScanInput } from "@/components/app/scan-input";
import { useSession } from "@/components/app/session-context";
import { ConfirmDialog } from "@/components/app/sheet";
import { useToast } from "@/components/app/toast";
import { VariantChoices } from "@/components/app/variant-choices";
import { lookupVariant, type VariantHit } from "@/components/app/variant-lookup";
import { api } from "@/lib/api-client";
import { readApiError } from "@/lib/form-errors";
import { formatDateTime, formatNumber, formatRupiah } from "@/lib/format";
import { cx } from "@/utils/cx";
import { OPNAME_STATUS, type OpnameStatus } from "../opname-list";

type Item = {
  variantId: string;
  sku: string;
  barcode: string | null;
  variantTitle: string;
  productName: string;
  countedQty: number;
  systemQty: number;
  difference: number;
  valueDifference: number | null;
};
type Opname = {
  id: string;
  number: string;
  status: OpnameStatus;
  mode: "PARTIAL" | "FULL";
  branchName: string;
  note: string | null;
  createdByName: string | null;
  createdAt: string;
  postedAt: string | null;
  items: Item[];
  summary: { lines: number; counted: number; plus: number; minus: number; matched: number; valueDifference: number | null; uncountedVariants: number; uncountedUnits: number };
};

function DiffChip({ d }: { d: number }) {
  if (d === 0)
    return (
      <Chip variant="subtle" color="gray">
        Cocok
      </Chip>
    );
  return (
    <Chip variant="subtle" color={d > 0 ? "lime" : "rose"}>
      {d > 0 ? "+" : "−"}
      {formatNumber(Math.abs(d))}
    </Chip>
  );
}

function QtyEditor({ item, onSave }: { item: Item; onSave: (qty: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <InputBase
      aria-label={`Jumlah hitung ${item.productName}`}
      inputMode="numeric"
      value={draft ?? String(item.countedQty)}
      onChange={(e) => setDraft(e.target.value.replace(/\D/g, ""))}
      onBlur={() => {
        if (draft !== null && draft !== "" && Number(draft) !== item.countedQty) onSave(Number(draft));
        setDraft(null);
      }}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      fieldClassName="w-20"
      className="text-center tabular-nums"
    />
  );
}

export function OpnameDetail({ id }: { id: string }) {
  const { can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [filter, setFilter] = useState<"all" | "diff" | "match">("all");
  const [choices, setChoices] = useState<VariantHit[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"post" | "cancel" | null>(null);
  const key = ["opname", id];
  const q = useQuery({ queryKey: key, queryFn: () => api<{ data: Opname }>(`/stock-opnames/${id}`).then((r) => r.data) });

  const count = useMutation({
    mutationFn: (body: { variantId: string; delta?: number; qty?: number }) => api(`/stock-opnames/${id}/count`, { method: "POST", body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e) => toast.show({ status: "error", title: readApiError(e).message }),
  });
  const remove = useMutation({
    mutationFn: (variantId: string) => api(`/stock-opnames/${id}/items/${variantId}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });
  const finish = useMutation({
    mutationFn: (action: "post" | "cancel") => api(`/stock-opnames/${id}/${action}`, { method: "POST", body: {} }),
    onSuccess: (_d, action) => {
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ["opnames"] });
      qc.invalidateQueries({ queryKey: ["inventory"] });
      setConfirm(null);
      toast.show({ status: "success", title: action === "post" ? "Opname diposting" : "Opname dibatalkan", description: action === "post" ? "Selisih sudah dibukukan ke kartu stok." : undefined });
    },
    onError: (e) => {
      setConfirm(null);
      toast.show({ status: "error", title: readApiError(e).message });
    },
  });

  function addCount(v: VariantHit) {
    setChoices(null);
    setNotice(null);
    setLastScanned(v.id);
    count.mutate({ variantId: v.id, delta: 1 });
  }

  async function onScan(code: string) {
    try {
      const r = await lookupVariant(code);
      if (r.kind === "hit") addCount(r.variant);
      else if (r.kind === "choices") setChoices(r.options);
      else setNotice(`Tidak ada barang dengan kode "${code}".`);
    } catch {
      setNotice("Pencarian gagal. Periksa koneksi lalu scan ulang.");
    }
  }

  if (!q.data) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-72 rounded-2xl" />
      </div>
    );
  }
  const o = q.data;
  const counting = o.status === "COUNTING";
  const s = o.summary;
  const items = o.items.filter((i) => (filter === "all" ? true : filter === "diff" ? i.difference !== 0 : i.difference === 0));
  const last = o.items.find((i) => i.variantId === lastScanned);

  return (
    <>
      <Breadcrumb className="mb-3">
        <BreadcrumbItem href="/inventory/opnames">Stok opname</BreadcrumbItem>
        <BreadcrumbItem current>{o.number}</BreadcrumbItem>
      </Breadcrumb>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="font-mono">{o.number}</span>
            <Chip variant="bold" color={OPNAME_STATUS[o.status].color}>
              {OPNAME_STATUS[o.status].label}
            </Chip>
          </span>
        }
        description={`${o.branchName} · ${o.mode === "FULL" ? "seluruh toko" : "sebagian"}${o.note ? ` · ${o.note}` : ""}${o.postedAt ? ` · diposting ${formatDateTime(o.postedAt)}` : ""}`}
        actions={
          counting && (
            <>
              {can("stock_opname:approve") && (
                <Button onClick={() => setConfirm("post")} disabled={s.lines === 0 && o.mode === "PARTIAL"}>
                  Posting selisih
                </Button>
              )}
              <Button variant="secondary" onClick={() => setConfirm("cancel")}>
                Batalkan
              </Button>
            </>
          )
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-4">
          {counting && (
            <Panel>
              <ScanInput onScan={onScan} autoFocus placeholder="Scan barcode barang yang dihitung (setiap scan = +1)" />
              {notice && (
                <p className="mt-2 text-body-medium text-text-error-primary" role="status">
                  {notice}
                </p>
              )}
              {choices && (
                <div className="mt-3">
                  <VariantChoices options={choices} onPick={addCount} />
                </div>
              )}
              {last && (
                <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-background-primary-default px-3 py-2.5 shadow-card" aria-live="polite">
                  <span className="min-w-0">
                    <span className="block truncate text-body-medium text-text-primary">{last.productName}</span>
                    <span className="block truncate text-body-2-regular text-text-tertiary">
                      {last.variantTitle !== "Default" ? `${last.variantTitle} · ` : ""}
                      <span className="font-mono">{last.sku}</span>
                    </span>
                  </span>
                  <span className="shrink-0 text-end">
                    <span className="block text-title-2-medium text-text-primary tabular-nums">{formatNumber(last.countedQty)}</span>
                    <span className="text-caption-1-regular text-text-tertiary">sistem {formatNumber(last.systemQty)}</span>
                  </span>
                </div>
              )}
            </Panel>
          )}

          <Panel
            title={`${s.lines} SKU dihitung`}
            action={
              <SegmentedControl aria-label="Filter" selectedKeys={new Set([filter])} onSelectionChange={(k) => { const n = [...k][0]; if (n) setFilter(n as typeof filter); }}>
                <SegmentedControlItem id="all">Semua</SegmentedControlItem>
                <SegmentedControlItem id="diff">Selisih</SegmentedControlItem>
                <SegmentedControlItem id="match">Cocok</SegmentedControlItem>
              </SegmentedControl>
            }
          >
            {items.length === 0 ? (
              <p className="py-8 text-center text-body-regular text-text-tertiary">{s.lines === 0 ? "Belum ada barang yang dihitung." : "Tidak ada baris untuk filter ini."}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-separator-border">
                {items.map((i) => (
                  <li key={i.variantId} className={cx("flex flex-wrap items-center gap-3 py-2.5", i.variantId === lastScanned && "rounded-lg bg-background-primary-default/60")}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body-medium text-text-primary">{i.productName}</span>
                      <span className="block truncate text-body-2-regular text-text-tertiary">
                        {i.variantTitle !== "Default" ? `${i.variantTitle} · ` : ""}
                        <span className="font-mono">{i.sku}</span> · sistem {formatNumber(i.systemQty)}
                      </span>
                    </span>
                    {counting ? (
                      <QtyEditor item={i} onSave={(qty) => count.mutate({ variantId: i.variantId, qty })} />
                    ) : (
                      <span className="w-20 text-center text-body-medium text-text-primary tabular-nums">{formatNumber(i.countedQty)}</span>
                    )}
                    <span className="w-16 text-end">
                      <DiffChip d={i.difference} />
                    </span>
                    {counting && (
                      <Button size="xs" variant="ghost" iconOnly leadingIcon={RiDeleteBinLine} aria-label={`Hapus ${i.productName} dari hitungan`} onClick={() => remove.mutate(i.variantId)} />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <Panel title="Ringkasan" className="h-fit lg:sticky lg:top-2">
          <dl className="grid grid-cols-2 gap-2">
            {[
              ["Dihitung", `${formatNumber(s.counted)} unit`],
              ["Cocok", `${s.matched} SKU`],
              ["Lebih", s.plus ? `+${formatNumber(s.plus)}` : "0"],
              ["Kurang", s.minus ? `−${formatNumber(s.minus)}` : "0"],
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl bg-background-primary-default px-3 py-2 shadow-card">
                <dt className="text-caption-1-regular text-text-tertiary">{k}</dt>
                <dd className="text-body-medium text-text-primary tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
          {s.valueDifference !== null && (
            <p className="mt-3 flex justify-between text-body-medium">
              <span className="text-text-secondary">Nilai selisih (modal)</span>
              <span className={cx("tabular-nums", s.valueDifference < 0 ? "text-status-rose-text" : "text-text-primary")}>
                {s.valueDifference < 0 ? "−" : ""}
                {formatRupiah(Math.abs(s.valueDifference))}
              </span>
            </p>
          )}
          {counting && s.uncountedVariants > 0 && (
            <p className={cx("mt-3 flex gap-2 rounded-xl p-3 text-body-2-regular", o.mode === "FULL" ? "bg-status-yellow-background text-status-yellow-text" : "bg-background-primary-default text-text-secondary")}>
              <RiErrorWarningLine className="mt-0.5 size-4 shrink-0" aria-hidden />
              {o.mode === "FULL"
                ? `${s.uncountedVariants} barang berstok (${formatNumber(s.uncountedUnits)} unit) belum dihitung dan akan dianggap 0 saat posting.`
                : `${s.uncountedVariants} barang berstok belum dihitung; stoknya tidak diubah.`}
            </p>
          )}
          {!counting && o.status === "POSTED" && (
            <p className="mt-3 flex gap-2 text-body-2-regular text-status-lime-text">
              <RiCheckboxCircleLine className="mt-0.5 size-4 shrink-0" aria-hidden />
              Selisih sudah tercatat di kartu stok sebagai pergerakan Stok opname.
            </p>
          )}
          {counting && (
          <p className="mt-3 text-caption-1-regular text-text-tertiary">
            Selisih dihitung terhadap stok sistem saat ini. Sebaiknya hentikan penjualan barang yang sedang dihitung sampai posting.
          </p>
          )}
        </Panel>
      </div>

      <ConfirmDialog
        isOpen={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm === "post" ? `Posting ${o.number}?` : `Batalkan ${o.number}?`}
        description={
          confirm === "post"
            ? `Stok ${o.branchName} akan disesuaikan: +${formatNumber(s.plus)} / −${formatNumber(s.minus)} unit${o.mode === "FULL" && s.uncountedVariants ? `, dan ${s.uncountedVariants} barang belum dihitung menjadi 0` : ""}. Tindakan ini tidak bisa dibatalkan.`
            : "Hasil hitung dibuang dan stok tidak berubah."
        }
        confirmLabel={confirm === "post" ? "Posting sekarang" : "Batalkan opname"}
        pending={finish.isPending}
        tone={confirm === "post" ? "primary" : "danger"}
        onConfirm={() => confirm && finish.mutate(confirm)}
      />
    </>
  );
}
