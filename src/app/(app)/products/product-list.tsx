"use client";

import { RiAddLine, RiCloseLine, RiPriceTag3Line, RiSearchLine } from "@remixicon/react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Chip } from "@/components/base/badges/chip";
import { ButtonLink } from "@/components/base/buttons/button";
import { InputBase } from "@/components/base/input/input";
import { Select, SelectItem } from "@/components/base/select/select";
import { DataTable, type Column } from "@/components/app/data-table";
import { PageHeader } from "@/components/app/page-header";
import { ProductsNav } from "./products-nav";
import { useSession } from "@/components/app/session-context";
import { useDebounced, useUrlState } from "@/hooks/use-url-state";
import { api } from "@/lib/api-client";
import { formatDate, formatNumber, formatRupiah } from "@/lib/format";

export type ProductStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";

type ProductRow = {
  id: string;
  name: string;
  status: ProductStatus;
  brand: string | null;
  imageUrl: string | null;
  categoryName: string | null;
  variantCount: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  stockOnHand: number;
  updatedAt: string;
};

type Category = { id: string; name: string; parentId: string | null };

export const STATUS_LABEL: Record<ProductStatus, { label: string; color: "lime" | "gray" | "neutral" }> = {
  ACTIVE: { label: "Aktif", color: "lime" },
  DRAFT: { label: "Draf", color: "gray" },
  ARCHIVED: { label: "Diarsipkan", color: "neutral" },
};

function priceRange(min: number | null, max: number | null) {
  if (min === null) return "—";
  return min === max ? formatRupiah(min) : `${formatRupiah(min)} – ${formatRupiah(max)}`;
}

function ProductThumb({ row }: { row: ProductRow }) {
  return row.imageUrl ? (
    // eslint-disable-next-line @next/next/no-img-element -- URL dari storage eksternal; next/image dikonfigurasi saat storage dipilih
    <img src={row.imageUrl} alt="" className="size-9 shrink-0 rounded-lg object-cover" />
  ) : (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-background-tertiary-default text-body-medium text-text-secondary">
      {row.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function StockChip({ value }: { value: number }) {
  return (
    <Chip variant="subtle" color={value === 0 ? "rose" : "gray"}>
      {value === 0 ? "Habis" : formatNumber(value)}
    </Chip>
  );
}

export function ProductList() {
  const router = useRouter();
  const { can } = useSession();
  const url = useUrlState();
  const [search, setSearch] = useState(url.get("q") ?? "");
  const q = useDebounced(search.trim());
  const page = Number(url.get("page") ?? 1);
  const status = url.get("status") ?? "all";
  const categoryId = url.get("category") ?? "all";
  // Filter merek datang dari halaman Merek (tautan jumlah produk).
  const brandId = url.get("brand");
  const brandName = url.get("brandName");

  const products = useQuery({
    queryKey: ["products", { q, page, status, categoryId, brandId }],
    queryFn: () =>
      api<{ data: ProductRow[]; meta: { total: number; pageCount: number } }>("/products", {
        query: { q, page, pageSize: 20, status: status === "all" ? undefined : status, categoryId: categoryId === "all" ? undefined : categoryId, brandId: brandId ?? undefined },
      }),
    placeholderData: keepPreviousData,
  });

  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: () => api<{ data: Category[] }>("/categories").then((r) => r.data),
    enabled: can("category:read"),
    staleTime: 5 * 60_000,
  });

  const columns: Column<ProductRow>[] = [
    {
      id: "name",
      header: "Produk",
      isRowHeader: true,
      className: "w-[34%]",
      cell: (r) => (
        <Link href={`/products/${r.id}`} className="flex min-w-0 items-center gap-3 outline-none">
          <ProductThumb row={r} />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-body-medium text-text-primary">{r.name}</span>
            {r.brand && <span className="truncate text-body-2-regular text-text-tertiary">{r.brand}</span>}
          </span>
        </Link>
      ),
    },
    { id: "category", header: "Kategori", cell: (r) => <span className="text-body-medium text-text-secondary">{r.categoryName ?? "—"}</span> },
    { id: "variants", header: "Varian", align: "end", cell: (r) => <span className="text-body-medium text-text-secondary tabular-nums">{r.variantCount ?? 0}</span> },
    { id: "price", header: "Harga", cell: (r) => <span className="whitespace-nowrap text-body-medium text-text-primary tabular-nums">{priceRange(r.minPrice, r.maxPrice)}</span> },
    { id: "stock", header: "Stok", align: "end", cell: (r) => <StockChip value={r.stockOnHand} /> },
    {
      id: "status",
      header: "Status",
      cell: (r) => (
        <Chip variant="bold" color={STATUS_LABEL[r.status].color}>
          {STATUS_LABEL[r.status].label}
        </Chip>
      ),
    },
    { id: "updated", header: "Diperbarui", cell: (r) => <span className="whitespace-nowrap text-body-medium text-text-secondary">{formatDate(r.updatedAt)}</span> },
  ];

  const filtered = q || status !== "all" || categoryId !== "all" || !!brandId;

  return (
    <>
      <PageHeader
        title="Produk"
        description="Katalog produk dan varian untuk semua cabang. Cari dengan nama, SKU, atau scan barcode."
        actions={
          can("product:create") && (
            <ButtonLink href="/products/new" leadingIcon={RiAddLine}>
              Tambah produk
            </ButtonLink>
          )
        }
      />
      <ProductsNav />
      <DataTable
        label="Daftar produk"
        unit="produk"
        columns={columns}
        rows={products.data?.data}
        getRowId={(r) => r.id}
        isLoading={products.isFetching}
        total={products.data?.meta.total}
        page={page}
        pageCount={products.data?.meta.pageCount ?? 1}
        onPageChange={(p) => url.set({ page: p })}
        onRowAction={(r) => router.push(`/products/${r.id}`)}
        toolbar={
          <>
            <Select
              aria-label="Filter status"
              className="shrink-0"
              popoverClassName="min-w-40"
              selectedKey={status}
              onSelectionChange={(k) => url.set({ status: k === "all" ? null : String(k), page: null })}
            >
              <SelectItem id="all" textValue="Semua status">Semua status</SelectItem>
              <SelectItem id="ACTIVE" textValue="Aktif">Aktif</SelectItem>
              <SelectItem id="DRAFT" textValue="Draf">Draf</SelectItem>
              <SelectItem id="ARCHIVED" textValue="Diarsipkan">Diarsipkan</SelectItem>
            </Select>
            {can("category:read") && (
              <Select
                aria-label="Filter kategori"
                className="shrink-0"
                popoverClassName="min-w-48"
                selectedKey={categoryId}
                onSelectionChange={(k) => url.set({ category: k === "all" ? null : String(k), page: null })}
              >
                <SelectItem id="all" textValue="Semua kategori">Semua kategori</SelectItem>
                {(categories.data ?? []).map((c) => (
                  <SelectItem key={c.id} id={c.id} textValue={c.name}>
                    {c.parentId ? `— ${c.name}` : c.name}
                  </SelectItem>
                ))}
              </Select>
            )}
            {brandId && (
              <button
                type="button"
                onClick={() => url.set({ brand: null, brandName: null, page: null })}
                className="flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-background-secondary-default ps-3 pe-2 text-body-2-medium text-text-primary hover:bg-background-secondary-hover"
                aria-label={`Hapus filter merek ${brandName ?? ""}`}
              >
                Merek: {brandName ?? "terpilih"}
                <RiCloseLine className="size-4 text-foreground-icon-tertiary" aria-hidden />
              </button>
            )}
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
          filtered ? (
            <>
              <p className="text-body-medium text-text-primary">Tidak ada produk yang cocok.</p>
              <p className="text-body-regular text-text-tertiary">Ubah kata kunci atau hapus filter.</p>
            </>
          ) : (
            <>
              <RiPriceTag3Line className="size-6 text-foreground-icon-tertiary" aria-hidden />
              <p className="text-body-medium text-text-primary">Belum ada produk.</p>
              <p className="text-body-regular text-text-tertiary">Tambahkan produk pertama beserta varian dan stok awalnya.</p>
            </>
          )
        }
        renderMobile={(r) => (
          <Link href={`/products/${r.id}`} className="flex items-center gap-3">
            <ProductThumb row={r} />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-body-medium text-text-primary">{r.name}</span>
              <span className="text-body-2-regular text-text-tertiary tabular-nums">
                {priceRange(r.minPrice, r.maxPrice)} · {r.variantCount ?? 0} varian
              </span>
            </span>
            <span className="flex shrink-0 flex-col items-end gap-1">
              <StockChip value={r.stockOnHand} />
              <span className="text-caption-1-regular text-text-tertiary">{STATUS_LABEL[r.status].label}</span>
            </span>
          </Link>
        )}
      />
    </>
  );
}
