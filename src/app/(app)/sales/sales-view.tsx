"use client";

import { RiArrowGoBackLine, RiPrinterLine, RiReceiptLine, RiSearchLine } from "@remixicon/react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Chip } from "@/components/base/badges/chip";
import { Button } from "@/components/base/buttons/button";
import { Input, InputBase } from "@/components/base/input/input";
import { Select, SelectItem } from "@/components/base/select/select";
import { DataTable, type Column } from "@/components/app/data-table";
import { PageHeader, Skeleton } from "@/components/app/page-header";
import { useApproval } from "@/components/app/approval-dialog";
import { RETURN_REASONS, ReturnForm, type ReturnReason } from "@/components/app/return-form";
import { useSession } from "@/components/app/session-context";
import { Sheet } from "@/components/app/sheet";
import { useToast } from "@/components/app/toast";
import { useDebounced, useUrlState } from "@/hooks/use-url-state";
import { api } from "@/lib/api-client";
import { readApiError } from "@/lib/form-errors";
import { formatDateTime, formatNumber, formatRupiah } from "@/lib/format";
import { PAYMENT_LABEL } from "@/lib/pricing";
import { SalesNav } from "./sales-nav";

type SaleRow = {
  id: string;
  number: string;
  status: "PENDING" | "PAID" | "VOIDED";
  total: number;
  refundTotal: number;
  createdAt: string;
  branchName: string;
  cashierName: string;
  itemQty: number;
  methods: string[] | null;
};

type SaleDetail = {
  id: string;
  branchId: string;
  number: string;
  status: "PENDING" | "PAID" | "VOIDED";
  subtotal: number;
  discountTotal: number;
  memberDiscount: number;
  voucherCode: string | null;
  voucherDiscount: number;
  pointsEarned: number;
  pointsRedeemed: number;
  pointsDiscount: number;
  refundTotal: number;
  shippingFee: number;
  channel: string;
  offlineRef: string | null;
  syncedAt: string | null;
  offlineShortfall: { variantId: string; sku: string; qty: number }[] | null;
  taxTotal: number;
  total: number;
  createdAt: string;
  voidedAt: string | null;
  customer: { id: string; name: string; memberNo: string | null } | null;
  voidReason: string | null;
  items: { id: string; productName: string; variantTitle: string; sku: string; qty: number; returnedQty: number; unitPrice: number; lineTotal: number; costPrice?: number | null }[];
  payments: { id: string; method: string; amount: number; tendered: number | null; change: number; reference: string | null }[];
  branch: { name: string };
  cashier: { name: string };
  returns: {
    id: string;
    number: string;
    refundMethod: string;
    refundAmount: number;
    reasonCode: ReturnReason;
    pointsReversed: number;
    pointsRestored: number;
    reason: string;
    createdAt: string;
    createdByUser: { name: string };
    items: { saleItemId: string; qty: number; restock: boolean }[];
  }[];
};

/** Rentang tanggal dalam zona waktu perangkat → ISO untuk API. */
export function rangeOf(period: string): { from?: string; to?: string } {
  if (period === "all") return {};
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (period === "7d") start.setDate(start.getDate() - 6);
  if (period === "30d") start.setDate(start.getDate() - 29);
  return { from: start.toISOString() };
}

function StatusChip({ status, refundTotal = 0, total = 0 }: { status: SaleRow["status"]; refundTotal?: number; total?: number }) {
  if (status === "PENDING") {
    return (
      <Chip variant="bold" color="yellow">
        Menunggu QRIS
      </Chip>
    );
  }
  if (status === "PAID" && refundTotal > 0) {
    return (
      <Chip variant="bold" color="yellow">
        {refundTotal >= total ? "Diretur" : "Retur sebagian"}
      </Chip>
    );
  }
  return status === "PAID" ? (
    <Chip variant="bold" color="lime">
      Lunas
    </Chip>
  ) : (
    <Chip variant="bold" color="rose">
      Dibatalkan
    </Chip>
  );
}

export function SaleDetailPanel({ id, onChanged }: { id: string; onChanged: () => void }) {
  const { can } = useSession();
  const toast = useToast();
  const qc = useQueryClient();
  const [voidOpen, setVoidOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [reason, setReason] = useState("");
  const sale = useQuery({ queryKey: ["sale", id], queryFn: () => api<{ data: SaleDetail }>(`/sales/${id}`).then((r) => r.data) });

  const approval = useApproval();
  const voidSale = useMutation({
    mutationFn: async () => {
      let approvalId: string | null = null;
      if (!can("pos:void")) {
        approvalId = await approval.request("pos:void", sale.data!.branchId);
        if (!approvalId) return null;
      }
      return api<{ data: SaleDetail }>(`/sales/${id}/void`, { method: "POST", headers: approvalId ? { "x-approval-id": approvalId } : undefined, body: { reason: reason.trim() } });
    },
    onSuccess: (r) => {
      if (!r) return;
      const { data } = r;
      qc.setQueryData(["sale", id], data);
      toast.show({ status: "success", title: `${data.number} dibatalkan`, description: "Stok sudah dikembalikan ke cabang." });
      setVoidOpen(false);
      onChanged();
    },
    onError: (e) => toast.show({ status: "error", title: readApiError(e).message }),
  });

  if (!sale.data) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-16 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }
  const s = sale.data;
  // Laba kotor hanya atas barang yang tidak diretur (proporsional per baris).
  const margin = s.items.every((i) => i.costPrice != null)
    ? Math.round(s.items.reduce((m, i) => m + ((i.lineTotal - (i.costPrice ?? 0) * i.qty) * (i.qty - i.returnedQty)) / i.qty, 0))
    : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-body-medium text-text-primary">{s.number}</p>
          <p className="text-body-2-regular text-text-tertiary">
            {formatDateTime(s.createdAt)} · {s.branch.name} · {s.cashier.name}
            {s.channel !== "POS" && ` · order online ${s.channel.toLowerCase()}`}
          </p>
          {s.customer && (
            <p className="text-body-2-regular text-text-secondary">
              Customer: {s.customer.name}
              {s.customer.memberNo && <span className="font-mono"> · {s.customer.memberNo}</span>}
              {s.pointsEarned > 0 && ` · +${s.pointsEarned} poin`}
            </p>
          )}
        </div>
        <StatusChip status={s.status} refundTotal={s.refundTotal} total={s.total} />
      </div>
      {s.offlineRef && (
        <p className="rounded-xl bg-background-secondary-default p-3 text-body-2-regular text-text-secondary">
          Dibuat saat kasir offline (struk sementara <span className="font-mono">{s.offlineRef}</span>){s.syncedAt && `, disinkronkan ${formatDateTime(s.syncedAt)}`}.
          {!!s.offlineShortfall?.length && (
            <span className="mt-1 block text-status-yellow-text">
              Stok sistem kurang saat sinkron: {s.offlineShortfall.map((x) => `${x.sku} ${x.qty} pcs`).join(", ")} — cek fisik/opname barang ini.
            </span>
          )}
        </p>
      )}
      {s.status === "VOIDED" && (
        <p className="rounded-xl bg-status-rose-background p-3 text-body-2-medium text-status-rose-text">
          Dibatalkan {s.voidedAt && formatDateTime(s.voidedAt)}
          {s.voidReason && ` — ${s.voidReason}`}
        </p>
      )}
      <ul className="flex flex-col divide-y divide-separator-border">
        {s.items.map((i) => (
          <li key={i.id} className="flex justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-body-medium text-text-primary">
                {i.productName}
                {i.variantTitle !== "Default" && <span className="text-text-tertiary"> · {i.variantTitle}</span>}
              </p>
              <p className="text-body-2-regular text-text-tertiary">
                {i.qty} × {formatRupiah(i.unitPrice)} · <span className="font-mono">{i.sku}</span>
                {i.returnedQty > 0 && <span className="text-status-yellow-text"> · diretur {i.returnedQty}</span>}
              </p>
            </div>
            <p className="shrink-0 text-body-medium text-text-primary tabular-nums">{formatRupiah(i.unitPrice * i.qty)}</p>
          </li>
        ))}
      </ul>
      <dl className="flex flex-col gap-1.5 rounded-2xl bg-background-secondary-default p-4 text-body-medium">
        <div className="flex justify-between text-text-secondary">
          <dt>Subtotal</dt>
          <dd className="tabular-nums">{formatRupiah(s.subtotal + s.discountTotal)}</dd>
        </div>
        {s.memberDiscount > 0 && (
          <div className="flex justify-between text-status-purple-text">
            <dt>Diskon member</dt>
            <dd className="tabular-nums">−{formatRupiah(s.memberDiscount)}</dd>
          </div>
        )}
        {s.voucherDiscount > 0 && (
          <div className="flex justify-between text-status-lime-text">
            <dt>
              Voucher <span className="font-mono">{s.voucherCode}</span>
            </dt>
            <dd className="tabular-nums">−{formatRupiah(s.voucherDiscount)}</dd>
          </div>
        )}
        {s.pointsDiscount > 0 && (
          <div className="flex justify-between text-status-yellow-text">
            <dt>Tukar {formatNumber(s.pointsRedeemed)} poin</dt>
            <dd className="tabular-nums">−{formatRupiah(s.pointsDiscount)}</dd>
          </div>
        )}
        {s.taxTotal > 0 && (
          <div className="flex justify-between text-text-secondary">
            <dt>PPN</dt>
            <dd className="tabular-nums">{formatRupiah(s.taxTotal)}</dd>
          </div>
        )}
        {s.shippingFee > 0 && (
          <div className="flex justify-between text-text-secondary">
            <dt>Ongkir</dt>
            <dd className="tabular-nums">{formatRupiah(s.shippingFee)}</dd>
          </div>
        )}
        <div className="flex justify-between text-text-primary">
          <dt className="text-headline-medium">Total</dt>
          <dd className="text-headline-semibold tabular-nums">{formatRupiah(s.total)}</dd>
        </div>
        {s.payments.map((p) => (
          <div key={p.id} className="flex justify-between text-text-secondary">
            <dt>
              {PAYMENT_LABEL[p.method] ?? p.method}
              {p.reference && <span className="font-mono"> · {p.reference}</span>}
            </dt>
            <dd className="tabular-nums">
              {formatRupiah(p.tendered ?? p.amount)}
              {p.change > 0 && ` (kembali ${formatRupiah(p.change)})`}
            </dd>
          </div>
        ))}
        {s.refundTotal > 0 && (
          <div className="flex justify-between text-status-yellow-text">
            <dt>Dikembalikan (retur)</dt>
            <dd className="tabular-nums">−{formatRupiah(s.refundTotal)}</dd>
          </div>
        )}
        {margin !== null && (
          <div className="mt-1 flex justify-between border-t border-separator-border pt-2 text-text-secondary">
            <dt>Laba kotor</dt>
            <dd className="tabular-nums">{formatRupiah(margin)}</dd>
          </div>
        )}
      </dl>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" leadingIcon={RiPrinterLine} onClick={() => window.open(`/pos/receipt/${s.id}`, "_blank", "noopener,width=420,height=720")}>
          Lihat / cetak struk
        </Button>
        {s.status === "PAID" && s.refundTotal < s.total && (can("pos:refund") || can("pos:access")) && !returnOpen && !voidOpen && (
          <Button variant="secondary" leadingIcon={RiArrowGoBackLine} onClick={() => setReturnOpen(true)}>
            Retur barang
          </Button>
        )}
        {s.status === "PAID" && s.refundTotal === 0 && (can("pos:void") || can("pos:access")) && !voidOpen && !returnOpen && (
          <Button variant="ghost" onClick={() => setVoidOpen(true)}>
            Batalkan transaksi
          </Button>
        )}
      </div>
      {approval.dialog}
      {returnOpen && (
        <div className="rounded-2xl border border-border-button-default p-4">
          <h3 className="mb-1 text-headline-medium text-text-primary">Retur barang</h3>
          <p className="text-body-2-regular text-text-tertiary">Pilih barang dan jumlah yang dikembalikan pelanggan.</p>
          <ReturnForm
            sale={s}
            onCancel={() => setReturnOpen(false)}
            onDone={(ret) => {
              setReturnOpen(false);
              qc.invalidateQueries({ queryKey: ["sale", id] });
              qc.invalidateQueries({ queryKey: ["sale-returns"] });
              toast.show({ status: "success", title: `${ret.number} tersimpan`, description: `Kembalikan ${formatRupiah(ret.refundAmount)} ke pelanggan (${PAYMENT_LABEL[ret.refundMethod] ?? ret.refundMethod}).` });
              onChanged();
            }}
          />
        </div>
      )}
      {s.returns.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-headline-medium text-text-primary">Riwayat retur</h3>
          <ul className="flex flex-col gap-2">
            {s.returns.map((r) => (
              <li key={r.id} className="rounded-xl bg-background-secondary-default p-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-mono text-body-2-medium text-text-primary">{r.number}</span>
                  <span className="text-body-medium text-text-primary tabular-nums">{formatRupiah(r.refundAmount)}</span>
                </div>
                <p className="text-body-2-regular text-text-tertiary">
                  {formatDateTime(r.createdAt)} · {r.createdByUser.name} · {PAYMENT_LABEL[r.refundMethod] ?? r.refundMethod} · {r.items.reduce((n, i) => n + i.qty, 0)} pcs
                  {r.items.some((i) => !i.restock) && " (ada yang rusak)"}
                </p>
                <p className="text-body-2-regular text-text-secondary">
                  {RETURN_REASONS[r.reasonCode]} — {r.reason}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
      {voidOpen && (
        <form
          className="flex flex-col gap-3 rounded-2xl border border-border-button-default p-4"
          onSubmit={(e) => {
            e.preventDefault();
            voidSale.mutate();
          }}
        >
          <p className="text-body-2-regular text-text-secondary">
            Pembatalan hanya bisa sebelum shift kasir ditutup dan belum ada retur. Stok dikembalikan ke cabang dan tercatat di kartu stok.
          </p>
          <Input label="Alasan pembatalan" value={reason} onChange={setReason} isRequired autoFocus />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setVoidOpen(false)}>
              Batal
            </Button>
            <Button type="submit" variant="danger" disabled={reason.trim().length < 3 || voidSale.isPending}>
              {voidSale.isPending ? "Memproses…" : "Batalkan transaksi"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

export function SalesView() {
  const { me, branchId: sessionBranch } = useSession();
  const qc = useQueryClient();
  const url = useUrlState();
  const [search, setSearch] = useState(url.get("q") ?? "");
  const q = useDebounced(search.trim());
  const page = Number(url.get("page") ?? 1);
  const status = url.get("status") ?? "all";
  const period = url.get("period") ?? "today";
  const branchId = url.get("branch") ?? sessionBranch ?? "all";
  const [selected, setSelected] = useState<string | null>(null);

  const sales = useQuery({
    queryKey: ["sales", { q, page, status, period, branchId }],
    queryFn: () =>
      api<{ data: SaleRow[]; meta: { total: number; pageCount: number } }>("/sales", {
        query: {
          q,
          page,
          pageSize: 25,
          status: status === "all" ? undefined : status,
          branchId: branchId === "all" ? undefined : branchId,
          ...rangeOf(period),
        },
      }),
    placeholderData: keepPreviousData,
  });

  const columns: Column<SaleRow>[] = [
    { id: "number", header: "No. transaksi", isRowHeader: true, cell: (s) => <span className="font-mono text-body-2-medium text-text-primary">{s.number}</span> },
    { id: "time", header: "Waktu", cell: (s) => <span className="whitespace-nowrap text-body-medium text-text-secondary">{formatDateTime(s.createdAt)}</span> },
    { id: "branch", header: "Cabang", cell: (s) => <span className="text-body-medium text-text-secondary">{s.branchName}</span> },
    { id: "cashier", header: "Kasir", cell: (s) => <span className="text-body-medium text-text-secondary">{s.cashierName}</span> },
    {
      id: "method",
      header: "Bayar",
      cell: (s) => <span className="text-body-medium text-text-secondary">{(s.methods ?? []).map((m) => PAYMENT_LABEL[m] ?? m).join(", ")}</span>,
    },
    { id: "qty", header: "Item", align: "end", cell: (s) => <span className="text-body-medium text-text-secondary tabular-nums">{formatNumber(s.itemQty)}</span> },
    {
      id: "total",
      header: "Total",
      align: "end",
      cell: (s) => (
        <span className={`whitespace-nowrap text-body-medium tabular-nums ${s.status === "VOIDED" ? "text-text-tertiary line-through" : "text-text-primary"}`}>
          {formatRupiah(s.total)}
        </span>
      ),
    },
    { id: "status", header: "Status", cell: (s) => <StatusChip status={s.status} refundTotal={s.refundTotal} total={s.total} /> },
  ];

  return (
    <>
      <PageHeader title="Transaksi" description="Semua penjualan dari kasir. Pilih transaksi untuk melihat rincian, mencetak ulang struk, meretur, atau membatalkannya." />
      <SalesNav />
      <DataTable
        label="Daftar transaksi"
        unit="transaksi"
        columns={columns}
        rows={sales.data?.data}
        getRowId={(s) => s.id}
        isLoading={sales.isFetching}
        total={sales.data?.meta.total}
        page={page}
        pageCount={sales.data?.meta.pageCount ?? 1}
        onPageChange={(p) => url.set({ page: p })}
        onRowAction={(s) => setSelected(s.id)}
        toolbar={
          <>
            <Select aria-label="Periode" selectedKey={period} onSelectionChange={(k) => url.set({ period: k === "today" ? null : String(k), page: null })} className="shrink-0" popoverClassName="min-w-40">
              <SelectItem id="today" textValue="Hari ini">Hari ini</SelectItem>
              <SelectItem id="7d" textValue="7 hari">7 hari terakhir</SelectItem>
              <SelectItem id="30d" textValue="30 hari">30 hari terakhir</SelectItem>
              <SelectItem id="all" textValue="Semua">Semua waktu</SelectItem>
            </Select>
            {me.branches.length > 1 && (
              <Select aria-label="Cabang" selectedKey={branchId} onSelectionChange={(k) => url.set({ branch: k === "all" ? null : String(k), page: null })} className="shrink-0" popoverClassName="min-w-52">
                <SelectItem id="all" textValue="Semua cabang">Semua cabang</SelectItem>
                {me.branches.map((b) => (
                  <SelectItem key={b.id} id={b.id} textValue={b.name}>
                    {b.name}
                  </SelectItem>
                ))}
              </Select>
            )}
            <Select aria-label="Status" selectedKey={status} onSelectionChange={(k) => url.set({ status: k === "all" ? null : String(k), page: null })} className="shrink-0" popoverClassName="min-w-36">
              <SelectItem id="all" textValue="Semua status">Semua status</SelectItem>
              <SelectItem id="PAID" textValue="Lunas">Lunas</SelectItem>
              <SelectItem id="VOIDED" textValue="Dibatalkan">Dibatalkan</SelectItem>
            </Select>
            <InputBase
              aria-label="Cari nomor transaksi"
              placeholder="Cari nomor"
              leadingIcon={RiSearchLine}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                url.set({ q: e.target.value.trim() || null, page: null });
              }}
              fieldClassName="min-w-[180px] flex-1 rounded-full bg-background-secondary-default md:w-[200px] md:flex-none"
              className="text-body-medium"
            />
          </>
        }
        empty={
          <>
            <RiReceiptLine className="size-6 text-foreground-icon-tertiary" aria-hidden />
            <p className="text-body-medium text-text-primary">Belum ada transaksi pada periode ini.</p>
            <p className="text-body-regular text-text-tertiary">Transaksi dari layar kasir akan muncul di sini.</p>
          </>
        }
        renderMobile={(s) => (
          <button type="button" className="flex w-full items-center justify-between gap-3 text-start" onClick={() => setSelected(s.id)}>
            <span className="min-w-0">
              <span className="block truncate font-mono text-body-2-medium text-text-primary">{s.number}</span>
              <span className="text-body-2-regular text-text-tertiary">
                {formatDateTime(s.createdAt)} · {s.cashierName}
              </span>
            </span>
            <span className="flex shrink-0 flex-col items-end gap-1">
              <span className={`text-body-medium tabular-nums ${s.status === "VOIDED" ? "text-text-tertiary line-through" : "text-text-primary"}`}>{formatRupiah(s.total)}</span>
              {s.status === "VOIDED" && <span className="text-caption-1-regular text-status-rose-text">Dibatalkan</span>}
            </span>
          </button>
        )}
      />
      <Sheet isOpen={selected !== null} onClose={() => setSelected(null)} title="Rincian transaksi">
        {selected && <SaleDetailPanel id={selected} onChanged={() => qc.invalidateQueries({ queryKey: ["sales"] })} />}
      </Sheet>
    </>
  );
}
