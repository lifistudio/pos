"use client";

import { RiArrowGoBackLine, RiSearchLine } from "@remixicon/react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { InputBase } from "@/components/base/input/input";
import { Select, SelectItem } from "@/components/base/select/select";
import { DataTable, type Column } from "@/components/app/data-table";
import { PageHeader } from "@/components/app/page-header";
import { useSession } from "@/components/app/session-context";
import { Sheet } from "@/components/app/sheet";
import { useDebounced, useUrlState } from "@/hooks/use-url-state";
import { api } from "@/lib/api-client";
import { formatDateTime, formatNumber, formatRupiah } from "@/lib/format";
import { PAYMENT_LABEL } from "@/lib/pricing";
import { RETURN_REASONS, type ReturnReason } from "@/components/app/return-form";
import { SalesNav } from "../sales-nav";
import { rangeOf, SaleDetailPanel } from "../sales-view";

type Row = {
  id: string;
  number: string;
  saleId: string;
  saleNumber: string;
  branchName: string;
  createdByName: string;
  refundMethod: string;
  refundAmount: number;
  reasonCode: ReturnReason;
  reason: string;
  createdAt: string;
  qty: number;
  damagedQty: number;
};

export function ReturnsView() {
  const { me, branchId: sessionBranch } = useSession();
  const qc = useQueryClient();
  const url = useUrlState();
  const [search, setSearch] = useState(url.get("q") ?? "");
  const q = useDebounced(search.trim());
  const page = Number(url.get("page") ?? 1);
  const period = url.get("period") ?? "30d";
  const branchId = url.get("branch") ?? sessionBranch ?? "all";
  const [saleId, setSaleId] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ["sale-returns", { q, page, period, branchId }],
    queryFn: () =>
      api<{ data: Row[]; meta: { total: number; pageCount: number } }>("/sale-returns", {
        query: { q, page, pageSize: 25, branchId: branchId === "all" ? undefined : branchId, ...rangeOf(period) },
      }),
    placeholderData: keepPreviousData,
  });

  const columns: Column<Row>[] = [
    {
      id: "number",
      header: "No. retur",
      isRowHeader: true,
      cell: (r) => (
        <span className="flex flex-col">
          <span className="font-mono text-body-2-medium text-text-primary">{r.number}</span>
          <span className="font-mono text-caption-1-regular text-text-tertiary">{r.saleNumber}</span>
        </span>
      ),
    },
    { id: "time", header: "Waktu", cell: (r) => <span className="whitespace-nowrap text-body-medium text-text-secondary">{formatDateTime(r.createdAt)}</span> },
    { id: "branch", header: "Cabang", cell: (r) => <span className="text-body-medium text-text-secondary">{r.branchName}</span> },
    { id: "by", header: "Diproses", cell: (r) => <span className="text-body-medium text-text-secondary">{r.createdByName}</span> },
    {
      id: "reason",
      header: "Alasan",
      cell: (r) => (
        <span className="flex max-w-[28ch] flex-col">
          <span className="text-body-medium text-text-primary">{RETURN_REASONS[r.reasonCode]}</span>
          <span className="line-clamp-1 text-caption-1-regular text-text-tertiary">{r.reason}</span>
        </span>
      ),
    },
    {
      id: "qty",
      header: "Barang",
      align: "end",
      cell: (r) => (
        <span className="whitespace-nowrap text-body-medium text-text-secondary tabular-nums">
          {formatNumber(r.qty)} pcs{r.damagedQty > 0 && <span className="text-status-rose-text"> · {r.damagedQty} rusak</span>}
        </span>
      ),
    },
    {
      id: "refund",
      header: "Refund",
      align: "end",
      cell: (r) => (
        <span className="flex flex-col items-end">
          <span className="text-body-medium text-text-primary tabular-nums">{formatRupiah(r.refundAmount)}</span>
          <span className="text-caption-1-regular text-text-tertiary">{PAYMENT_LABEL[r.refundMethod] ?? r.refundMethod}</span>
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader title="Transaksi" description="Retur dari pelanggan: uang yang dikembalikan, barang yang kembali ke stok, dan yang rusak." />
      <SalesNav />
      <DataTable
        label="Daftar retur"
        unit="retur"
        columns={columns}
        rows={list.data?.data}
        getRowId={(r) => r.id}
        isLoading={list.isFetching}
        total={list.data?.meta.total}
        page={page}
        pageCount={list.data?.meta.pageCount ?? 1}
        onPageChange={(p) => url.set({ page: p })}
        onRowAction={(r) => setSaleId(r.saleId)}
        toolbar={
          <>
            <Select aria-label="Periode" selectedKey={period} onSelectionChange={(k) => url.set({ period: k === "30d" ? null : String(k), page: null })} className="shrink-0" popoverClassName="min-w-40">
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
            <InputBase
              aria-label="Cari nomor retur atau struk"
              placeholder="Cari nomor retur/struk"
              leadingIcon={RiSearchLine}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                url.set({ q: e.target.value.trim() || null, page: null });
              }}
              fieldClassName="min-w-[180px] flex-1 rounded-full bg-background-secondary-default md:w-[220px] md:flex-none"
              className="text-body-medium"
            />
          </>
        }
        empty={
          <>
            <RiArrowGoBackLine className="size-6 text-foreground-icon-tertiary" aria-hidden />
            <p className="text-body-medium text-text-primary">Belum ada retur pada periode ini.</p>
            <p className="text-body-regular text-text-tertiary">Retur dibuat dari rincian transaksi atau tombol Retur di layar kasir.</p>
          </>
        }
        renderMobile={(r) => (
          <button type="button" className="flex w-full items-center justify-between gap-3 text-start" onClick={() => setSaleId(r.saleId)}>
            <span className="min-w-0">
              <span className="block truncate font-mono text-body-2-medium text-text-primary">{r.number}</span>
              <span className="block truncate text-body-2-regular text-text-tertiary">
                {formatDateTime(r.createdAt)} · {r.reason}
              </span>
            </span>
            <span className="shrink-0 text-body-medium text-text-primary tabular-nums">{formatRupiah(r.refundAmount)}</span>
          </button>
        )}
      />
      <Sheet isOpen={saleId !== null} onClose={() => setSaleId(null)} title="Rincian transaksi">
        {saleId && <SaleDetailPanel id={saleId} onChanged={() => qc.invalidateQueries({ queryKey: ["sale-returns"] })} />}
      </Sheet>
    </>
  );
}
