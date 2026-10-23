"use client";

import { RiArchiveStackLine, RiEqualizerLine, RiSearchLine } from "@remixicon/react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Chip } from "@/components/base/badges/chip";
import { ButtonLink } from "@/components/base/buttons/button";
import { InputBase } from "@/components/base/input/input";
import { Select, SelectItem } from "@/components/base/select/select";
import { DataTable, type Column } from "@/components/app/data-table";
import { PageHeader } from "@/components/app/page-header";
import { useSession } from "@/components/app/session-context";
import { useDebounced, useUrlState } from "@/hooks/use-url-state";
import { api } from "@/lib/api-client";
import { formatNumber } from "@/lib/format";
import { InventoryNav } from "./inventory-nav";

type Level = {
  branchId: string;
  branchName: string;
  variantId: string;
  sku: string;
  barcode: string | null;
  variantTitle: string;
  productId: string;
  productName: string;
  onHand: number;
  reserved: number;
  available: number;
  reorderPoint: number;
};

function StatusChip({ l }: { l: Level }) {
  if (l.onHand <= 0) return <Chip variant="subtle" color="rose">Habis</Chip>;
  if (l.reorderPoint > 0 && l.onHand <= l.reorderPoint) return <Chip variant="subtle" color="yellow">Menipis</Chip>;
  return <Chip variant="subtle" color="gray">Aman</Chip>;
}

export function InventoryList() {
  const { can, branchId: sessionBranch, me } = useSession();
  const url = useUrlState();
  const [search, setSearch] = useState(url.get("q") ?? "");
  const q = useDebounced(search.trim());
  const page = Number(url.get("page") ?? 1);
  const status = url.get("status") ?? "all";
  const branchId = url.get("branch") ?? sessionBranch ?? "all";

  const levels = useQuery({
    queryKey: ["inventory", { q, page, status, branchId }],
    queryFn: () =>
      api<{ data: Level[]; meta: { total: number; pageCount: number } }>("/inventory", {
        query: {
          q,
          page,
          pageSize: 25,
          status: status === "all" ? undefined : status,
          branchId: branchId === "all" ? undefined : branchId,
        },
      }),
    placeholderData: keepPreviousData,
  });

  const columns: Column<Level>[] = [
    {
      id: "product",
      header: "Produk",
      isRowHeader: true,
      className: "w-[30%]",
      cell: (l) => (
        <Link href={`/products/${l.productId}`} className="flex min-w-0 flex-col">
          <span className="truncate text-body-medium text-text-primary">{l.productName}</span>
          <span className="truncate text-body-2-regular text-text-tertiary">
            {l.variantTitle === "Default" ? "Tanpa varian" : l.variantTitle}
          </span>
        </Link>
      ),
    },
    { id: "sku", header: "SKU", cell: (l) => <span className="font-mono text-body-2-medium text-text-secondary">{l.sku}</span> },
    { id: "branch", header: "Cabang", cell: (l) => <span className="text-body-medium text-text-secondary">{l.branchName}</span> },
    {
      id: "onHand",
      header: "Fisik",
      align: "end",
      cell: (l) => <span className="text-body-medium text-text-primary tabular-nums">{formatNumber(l.onHand)}</span>,
    },
    {
      id: "reserved",
      header: "Dipesan",
      align: "end",
      cell: (l) => <span className="text-body-medium text-text-tertiary tabular-nums">{formatNumber(l.reserved)}</span>,
    },
    {
      id: "available",
      header: "Tersedia",
      align: "end",
      cell: (l) => <span className="text-body-medium text-text-primary tabular-nums">{formatNumber(l.available)}</span>,
    },
    {
      id: "min",
      header: "Minimum",
      align: "end",
      cell: (l) => <span className="text-body-medium text-text-tertiary tabular-nums">{formatNumber(l.reorderPoint)}</span>,
    },
    { id: "status", header: "Status", cell: (l) => <StatusChip l={l} /> },
  ];

  return (
    <>
      <PageHeader
        title="Stok"
        description="Stok fisik, yang sudah dipesan, dan yang tersedia untuk dijual di tiap cabang. Semua perubahan tercatat di kartu stok."
        actions={
          can("inventory:adjust") && (
            <ButtonLink href="/inventory/adjust" leadingIcon={RiEqualizerLine}>
              Terima / sesuaikan stok
            </ButtonLink>
          )
        }
      />
      <InventoryNav />
      <DataTable
        label="Stok per cabang"
        unit="baris stok"
        columns={columns}
        rows={levels.data?.data}
        getRowId={(l) => `${l.branchId}:${l.variantId}`}
        isLoading={levels.isFetching}
        total={levels.data?.meta.total}
        page={page}
        pageCount={levels.data?.meta.pageCount ?? 1}
        onPageChange={(p) => url.set({ page: p })}
        toolbar={
          <>
            {me.branches.length > 1 && (
              <Select
                aria-label="Filter cabang"
                className="shrink-0"
                popoverClassName="min-w-52"
                selectedKey={branchId}
                onSelectionChange={(k) => url.set({ branch: k === "all" ? null : String(k), page: null })}
              >
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
            <Select
              aria-label="Filter status stok"
              className="shrink-0"
              popoverClassName="min-w-40"
              selectedKey={status}
              onSelectionChange={(k) => url.set({ status: k === "all" ? null : String(k), page: null })}
            >
              <SelectItem id="all" textValue="Semua status">
                Semua status
              </SelectItem>
              <SelectItem id="low" textValue="Menipis">
                Menipis
              </SelectItem>
              <SelectItem id="out" textValue="Habis">
                Habis
              </SelectItem>
            </Select>
            <InputBase
              aria-label="Cari produk, SKU, atau barcode"
              placeholder="Cari atau scan barcode"
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
          q || status !== "all" ? (
            <>
              <p className="text-body-medium text-text-primary">Tidak ada stok yang cocok.</p>
              <p className="text-body-regular text-text-tertiary">Ubah kata kunci, cabang, atau status.</p>
            </>
          ) : (
            <>
              <RiArchiveStackLine className="size-6 text-foreground-icon-tertiary" aria-hidden />
              <p className="text-body-medium text-text-primary">Belum ada stok tercatat.</p>
              <p className="text-body-regular text-text-tertiary">Catat penerimaan barang untuk mulai mengisi stok cabang.</p>
            </>
          )
        }
        renderMobile={(l) => (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-body-medium text-text-primary">{l.productName}</p>
              <p className="truncate text-body-2-regular text-text-tertiary">
                {l.variantTitle === "Default" ? "Tanpa varian" : l.variantTitle} · {l.branchName}
              </p>
              <p className="font-mono text-caption-1-regular text-text-tertiary">{l.sku}</p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <span className="text-headline-semibold text-text-primary tabular-nums">{formatNumber(l.available)}</span>
              <StatusChip l={l} />
            </div>
          </div>
        )}
      />
    </>
  );
}
