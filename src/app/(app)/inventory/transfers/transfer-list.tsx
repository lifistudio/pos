"use client";

import { RiAddLine, RiArrowRightLine, RiTruckLine } from "@remixicon/react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Chip } from "@/components/base/badges/chip";
import { ButtonLink } from "@/components/base/buttons/button";
import { Select, SelectItem } from "@/components/base/select/select";
import { DataTable, type Column } from "@/components/app/data-table";
import { PageHeader } from "@/components/app/page-header";
import { useSession } from "@/components/app/session-context";
import { useUrlState } from "@/hooks/use-url-state";
import { api } from "@/lib/api-client";
import { formatDate, formatNumber } from "@/lib/format";
import { InventoryNav } from "../inventory-nav";

export type TransferStatus = "DRAFT" | "IN_TRANSIT" | "RECEIVED" | "CANCELLED";
type Row = {
  id: string;
  number: string;
  status: TransferStatus;
  fromBranchName: string;
  toBranchName: string;
  toBranchId: string;
  note: string | null;
  createdAt: string;
  sentAt: string | null;
  receivedAt: string | null;
  lines: number;
  qtySent: number;
  qtyReceived: number | null;
};

export const TRANSFER_STATUS: Record<TransferStatus, { label: string; color: "gray" | "yellow" | "lime" | "neutral" }> = {
  DRAFT: { label: "Draf", color: "gray" },
  IN_TRANSIT: { label: "Dalam perjalanan", color: "yellow" },
  RECEIVED: { label: "Diterima", color: "lime" },
  CANCELLED: { label: "Dibatalkan", color: "neutral" },
};

export function TransferList() {
  const { can, me, branchId: sessionBranch } = useSession();
  const router = useRouter();
  const url = useUrlState();
  const page = Number(url.get("page") ?? 1);
  const status = url.get("status") ?? "all";
  const direction = url.get("dir") ?? "all";
  const branchId = url.get("branch") ?? sessionBranch ?? undefined;

  const list = useQuery({
    queryKey: ["transfers", { page, status, direction, branchId }],
    queryFn: () =>
      api<{ data: Row[]; meta: { total: number; pageCount: number } }>("/stock-transfers", {
        query: { page, pageSize: 25, status: status === "all" ? undefined : status, branchId, direction: branchId && direction !== "all" ? direction : undefined },
      }),
    placeholderData: keepPreviousData,
  });

  const columns: Column<Row>[] = [
    {
      id: "number",
      header: "No. transfer",
      isRowHeader: true,
      cell: (r) => (
        <Link href={`/inventory/transfers/${r.id}`} className="font-mono text-body-2-medium text-text-primary">
          {r.number}
        </Link>
      ),
    },
    {
      id: "route",
      header: "Rute",
      cell: (r) => (
        <span className="flex items-center gap-1.5 text-body-medium text-text-secondary">
          {r.fromBranchName}
          <RiArrowRightLine className="size-4 text-foreground-icon-tertiary" aria-label="ke" />
          {r.toBranchName}
        </span>
      ),
    },
    {
      id: "qty",
      header: "Barang",
      align: "end",
      cell: (r) => (
        <span className="text-body-medium text-text-secondary tabular-nums">
          {r.status === "RECEIVED" && r.qtyReceived !== null && r.qtyReceived !== r.qtySent ? (
            <span className="text-status-yellow-text">
              {formatNumber(r.qtyReceived)}/{formatNumber(r.qtySent)}
            </span>
          ) : (
            formatNumber(r.qtySent)
          )}{" "}
          unit · {r.lines} SKU
        </span>
      ),
    },
    { id: "date", header: "Tanggal", cell: (r) => <span className="whitespace-nowrap text-body-medium text-text-secondary">{formatDate(r.receivedAt ?? r.sentAt ?? r.createdAt)}</span> },
    {
      id: "status",
      header: "Status",
      cell: (r) => (
        <Chip variant="bold" color={TRANSFER_STATUS[r.status].color}>
          {TRANSFER_STATUS[r.status].label}
        </Chip>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Stok"
        description="Pindahkan stok antar toko dan gudang. Stok asal berkurang saat dikirim; stok tujuan bertambah saat penerimaan dikonfirmasi."
        actions={
          can("stock_transfer:create") && (
            <ButtonLink href="/inventory/transfers/new" leadingIcon={RiAddLine}>
              Buat transfer
            </ButtonLink>
          )
        }
      />
      <InventoryNav />
      <DataTable
        label="Daftar transfer"
        unit="transfer"
        columns={columns}
        rows={list.data?.data}
        getRowId={(r) => r.id}
        isLoading={list.isFetching}
        total={list.data?.meta.total}
        page={page}
        pageCount={list.data?.meta.pageCount ?? 1}
        onPageChange={(p) => url.set({ page: p })}
        onRowAction={(r) => router.push(`/inventory/transfers/${r.id}`)}
        toolbar={
          <>
            {me.branches.length > 1 && (
              <Select aria-label="Cabang" selectedKey={branchId ?? "all"} onSelectionChange={(k) => url.set({ branch: k === "all" ? null : String(k), page: null })} className="shrink-0" popoverClassName="min-w-52">
                <SelectItem id="all" textValue="Semua cabang">Semua cabang</SelectItem>
                {me.branches.map((b) => (
                  <SelectItem key={b.id} id={b.id} textValue={b.name}>
                    {b.name}
                  </SelectItem>
                ))}
              </Select>
            )}
            {branchId && (
              <Select aria-label="Arah" selectedKey={direction} onSelectionChange={(k) => url.set({ dir: k === "all" ? null : String(k), page: null })} className="shrink-0" popoverClassName="min-w-40">
                <SelectItem id="all" textValue="Masuk & keluar">Masuk & keluar</SelectItem>
                <SelectItem id="in" textValue="Masuk">Masuk ke cabang ini</SelectItem>
                <SelectItem id="out" textValue="Keluar">Keluar dari cabang ini</SelectItem>
              </Select>
            )}
            <Select aria-label="Status" selectedKey={status} onSelectionChange={(k) => url.set({ status: k === "all" ? null : String(k), page: null })} className="shrink-0" popoverClassName="min-w-44">
              <SelectItem id="all" textValue="Semua status">Semua status</SelectItem>
              {Object.entries(TRANSFER_STATUS).map(([k, s]) => (
                <SelectItem key={k} id={k} textValue={s.label}>
                  {s.label}
                </SelectItem>
              ))}
            </Select>
          </>
        }
        empty={
          <>
            <RiTruckLine className="size-6 text-foreground-icon-tertiary" aria-hidden />
            <p className="text-body-medium text-text-primary">Belum ada transfer.</p>
            <p className="text-body-regular text-text-tertiary">Buat transfer untuk memindahkan stok dari gudang ke toko atau antar toko.</p>
          </>
        }
        renderMobile={(r) => (
          <Link href={`/inventory/transfers/${r.id}`} className="flex items-start justify-between gap-3">
            <span className="min-w-0">
              <span className="block font-mono text-body-2-medium text-text-primary">{r.number}</span>
              <span className="block truncate text-body-2-regular text-text-tertiary">
                {r.fromBranchName} → {r.toBranchName} · {formatNumber(r.qtySent)} unit
              </span>
            </span>
            <Chip variant="bold" color={TRANSFER_STATUS[r.status].color}>
              {TRANSFER_STATUS[r.status].label}
            </Chip>
          </Link>
        )}
      />
    </>
  );
}
