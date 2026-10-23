"use client";

import { RiBarcodeLine, RiCheckLine, RiGridLine, RiImageLine, RiListCheck2, RiSearchLine } from "@remixicon/react";
import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useState, type RefObject } from "react";
import { Button } from "@/components/base/buttons/button";
import { Dropdown, DropdownDivider, DropdownGroup, DropdownItem, DropdownPopover, DropdownTrigger } from "@/components/base/dropdown/dropdown";
import { InputBase } from "@/components/base/input/input";
import { Switch } from "@/components/base/switch/switch";
import { Kbd } from "@/components/base/kbd/kbd";
import { Skeleton } from "@/components/app/page-header";
import { useSession } from "@/components/app/session-context";
import { useToast } from "@/components/app/toast";
import { useDebounced } from "@/hooks/use-url-state";
import { api } from "@/lib/api-client";
import { formatRupiah } from "@/lib/format";
import { cx } from "@/utils/cx";
import type { CatalogItem } from "./use-cart";
import { searchPack, type OfflinePack } from "./offline/pack";
import { GRID_CLASS, setPosLayout, usePosLayout, type PosLayout } from "./pos-layout";

type Page = { data: CatalogItem[]; meta: { page: number; pageCount: number; total: number } };
const PAGE_SIZE = 48;

/** Inisial nama produk sebagai pengganti gambar agar tile tetap seragam. */
function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

function Thumb({ item, className }: { item: CatalogItem; className?: string }) {
  return (
    <span className={cx("flex items-center justify-center overflow-hidden bg-background-tertiary-default", className)} aria-hidden>
      {item.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- thumbnail sudah diperkecil (Cloudinary/API), di-cache SW untuk offline
        <img src={item.imageUrl} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
      ) : (
        <span className="text-title-3-semibold text-text-tertiary">{initials(item.productName)}</span>
      )}
    </span>
  );
}

function stockLabel(item: CatalogItem) {
  const out = item.available <= 0;
  return (
    <span className={cx("text-caption-1-medium whitespace-nowrap tabular-nums", out ? "text-status-rose-text" : item.available <= 5 ? "text-status-yellow-text" : "text-text-tertiary")}>
      {out ? "Habis" : `Stok ${item.available}`}
    </span>
  );
}

function CartBadge({ qty, className }: { qty: number; className?: string }) {
  if (qty <= 0) return null;
  return (
    <span className={cx("flex min-w-6 items-center justify-center rounded-full bg-accent-500 px-1.5 text-caption-1-semibold text-white tabular-nums", className)}>
      {qty}
    </span>
  );
}

const tileBase =
  "relative cursor-pointer rounded-2xl border bg-background-primary-default text-start outline-none transition-[box-shadow,border-color,transform] duration-150 focus-visible:ring-2 focus-visible:ring-border-focus-ring active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50";

function Tile({ item, qtyInCart, onAdd, layout }: { item: CatalogItem; qtyInCart: number; onAdd: () => void; layout: PosLayout }) {
  const out = item.available <= 0;
  const label = `${item.productName}${item.title !== "Default" ? ` ${item.title}` : ""}, ${formatRupiah(item.price)}${out ? ", habis" : ""}${qtyInCart ? `, ${qtyInCart} di keranjang` : ""}`;
  const border = qtyInCart ? "border-accent-500 shadow-card" : "border-border-button-default hover:border-border-button-hover";

  if (layout.mode === "list") {
    return (
      <button type="button" onClick={onAdd} disabled={out} aria-label={label} className={cx(tileBase, border, "flex min-h-14 items-center gap-3 p-2 pe-3 active:scale-[0.99]")}>
        {layout.showImages && <Thumb item={item} className="size-12 shrink-0 rounded-xl" />}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-body-medium text-text-primary">{item.productName}</span>
          <span className="truncate text-body-2-regular text-text-secondary">
            {item.title !== "Default" ? `${item.title} · ` : ""}
            <span className="font-mono">{item.sku}</span>
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-0.5">
          <span className="text-headline-semibold text-text-primary tabular-nums">{formatRupiah(item.price)}</span>
          {stockLabel(item)}
        </span>
        <CartBadge qty={qtyInCart} />
      </button>
    );
  }

  return (
    <button type="button" onClick={onAdd} disabled={out} aria-label={label} className={cx(tileBase, border, "flex flex-col overflow-hidden", !layout.showImages && "min-h-[120px] justify-between gap-2 p-3")}>
      {layout.showImages && <Thumb item={item} className="aspect-[4/3] w-full" />}
      <CartBadge qty={qtyInCart} className="absolute end-2 top-2 shadow-card" />
      <span className={cx("flex min-w-0 flex-col gap-0.5", layout.showImages ? "px-3 pt-2" : "pe-6")}>
        <span className="line-clamp-2 text-body-medium text-text-primary">{item.productName}</span>
        {item.title !== "Default" && <span className="truncate text-body-2-regular text-text-secondary">{item.title}</span>}
      </span>
      <span className={cx("flex flex-wrap items-end justify-between gap-x-2 gap-y-0.5", layout.showImages && "mt-auto px-3 pt-1 pb-3")}>
        <span className="text-headline-semibold text-text-primary tabular-nums">{formatRupiah(item.price)}</span>
        {stockLabel(item)}
      </span>
    </button>
  );
}

/** Pilihan tampilan katalog: grid (jumlah kolom) atau daftar, dengan/tanpa gambar. Disimpan per perangkat. */
function LayoutMenu({ layout }: { layout: PosLayout }) {
  const columns: { id: PosLayout["columns"]; label: string }[] = [
    { id: "auto", label: "Otomatis" },
    { id: 3, label: "3 kolom" },
    { id: 4, label: "4 kolom" },
    { id: 5, label: "5 kolom" },
    { id: 6, label: "6 kolom" },
  ];
  return (
    <Dropdown>
      <DropdownTrigger
        aria-label="Atur tampilan katalog"
        className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-border-button-default bg-background-primary-default text-foreground-icon-secondary hover:bg-background-primary-hover"
      >
        {layout.mode === "list" ? <RiListCheck2 className="size-5" aria-hidden /> : <RiGridLine className="size-5" aria-hidden />}
      </DropdownTrigger>
      <DropdownPopover aria-label="Tampilan katalog" placement="bottom end" className="min-w-60">
        <DropdownGroup label="Tampilan">
          <DropdownItem selected={layout.mode === "grid"} onSelect={() => setPosLayout({ mode: "grid" })}>
            <RiGridLine className="size-4 text-foreground-icon-secondary" aria-hidden />
            <span className="flex-1">Grid (kotak)</span>
            {layout.mode === "grid" && <RiCheckLine className="size-4 text-foreground-icon-primary" aria-hidden />}
          </DropdownItem>
          <DropdownItem selected={layout.mode === "list"} onSelect={() => setPosLayout({ mode: "list" })}>
            <RiListCheck2 className="size-4 text-foreground-icon-secondary" aria-hidden />
            <span className="flex-1">Daftar (per baris)</span>
            {layout.mode === "list" && <RiCheckLine className="size-4 text-foreground-icon-primary" aria-hidden />}
          </DropdownItem>
        </DropdownGroup>
        {layout.mode === "grid" && (
          <>
            <DropdownDivider />
            <DropdownGroup label="Kolom grid">
              {columns.map((c) => (
                <DropdownItem key={c.id} selected={layout.columns === c.id} onSelect={() => setPosLayout({ columns: c.id })} className="px-2 py-1.5">
                  <span className="flex-1">{c.label}</span>
                  {layout.columns === c.id && <RiCheckLine className="size-4 text-foreground-icon-primary" aria-hidden />}
                </DropdownItem>
              ))}
            </DropdownGroup>
            <p className="px-2 text-caption-1-regular text-text-tertiary">Di HP selalu 2 kolom agar nama & harga tetap terbaca.</p>
          </>
        )}
        <DropdownDivider />
        <div className="flex items-center gap-2 px-2 py-1.5">
          <RiImageLine className="size-4 text-foreground-icon-secondary" aria-hidden />
          <Switch isSelected={layout.showImages} onChange={(showImages) => setPosLayout({ showImages })} size="sm">
            <span className="text-body-medium text-text-primary">Tampilkan gambar</span>
          </Switch>
        </div>
        <p className="px-2 text-caption-1-regular text-text-tertiary">Gambar muncul bila produk punya foto (atur di halaman produk).</p>
      </DropdownPopover>
    </Dropdown>
  );
}

export function CatalogPanel({
  branchId,
  offline,
  pack,
  pendingQty,
  searchRef,
  inCart,
  onAdd,
}: {
  branchId: string;
  offline: boolean;
  pack: OfflinePack | null;
  pendingQty: Map<string, number>;
  searchRef: RefObject<HTMLInputElement | null>;
  inCart: Map<string, number>;
  onAdd: (item: CatalogItem) => void;
}) {
  const { can } = useSession();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim(), 250);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const layout = usePosLayout();
  const gridClass = layout.mode === "list" ? "grid grid-cols-1 gap-2" : cx("grid gap-3", GRID_CLASS[layout.columns]);

  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: () => api<{ data: { id: string; name: string; parentId: string | null }[] }>("/categories").then((r) => r.data),
    enabled: can("category:read") && !offline,
    staleTime: 5 * 60_000,
  });

  const catalog = useInfiniteQuery({
    queryKey: ["pos-catalog", branchId, q, categoryId],
    queryFn: ({ pageParam }) =>
      api<Page>("/pos/catalog", { query: { branchId, q, categoryId: categoryId ?? undefined, page: pageParam, pageSize: PAGE_SIZE } }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.meta.page < last.meta.pageCount ? last.meta.page + 1 : undefined),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    enabled: !offline,
  });
  // Stok tampilan dikurangi barang di antrean offline yang belum tersinkron.
  const adjust = (i: CatalogItem) => (pendingQty.has(i.variantId) ? { ...i, available: Math.max(0, i.available - pendingQty.get(i.variantId)!) } : i);
  const items = (offline ? (pack ? searchPack(pack, q, categoryId) : []) : (catalog.data?.pages.flatMap((p) => p.data) ?? [])).map(adjust);

  /** Enter: scanner mengetik kode lalu Enter → langsung masuk keranjang bila barcode/SKU cocok persis. */
  async function onEnter() {
    const code = search.trim();
    if (!code) return;
    const data = offline ? (pack ? searchPack(pack, code, null).slice(0, 5) : []) : (await api<Page>("/pos/catalog", { query: { branchId, q: code, page: 1, pageSize: 5 } })).data;
    const exact = data.find((i) => i.barcode === code || i.sku.toUpperCase() === code.toUpperCase());
    const hit = exact ?? (data.length === 1 ? data[0] : null);
    if (hit) {
      onAdd(adjust(hit));
      setSearch("");
    } else if (data.length === 0) {
      toast.show({ status: "error", title: `Kode "${code}" tidak ditemukan` });
      setSearch("");
    }
    // Lebih dari satu hasil: biarkan grid menampilkan pilihan.
  }

  const roots = ((offline ? pack?.categories : categories.data) ?? []).filter((c) => !c.parentId);
  // Toko tanpa foto produk tidak perlu tile besar berisi placeholder: gambar tampil hanya bila ada yang bergambar.
  const tileLayout = layout.showImages && !items.some((i) => i.imageUrl) ? { ...layout, showImages: false } : layout;

  return (
    <section className="flex min-w-0 flex-1 flex-col gap-3 p-3 sm:p-4" aria-label="Katalog">
      <div className="flex items-center gap-2">
        <InputBase
          ref={searchRef}
          aria-label="Scan barcode atau cari produk"
          placeholder="Scan barcode, ketik SKU atau nama produk"
          leadingIcon={search ? RiSearchLine : RiBarcodeLine}
          value={search}
          autoFocus
          autoComplete="off"
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void onEnter();
            }
            if (e.key === "Escape") setSearch("");
          }}
          fieldClassName="h-12 flex-1 rounded-2xl"
          className="text-body-medium"
        />
        <Kbd className="hidden lg:inline-flex">F2</Kbd>
        <LayoutMenu layout={layout} />
      </div>

      {roots.length > 0 && (
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]" role="tablist" aria-label="Kategori">
          {[{ id: null as string | null, name: "Semua" }, ...roots].map((c) => {
            const active = categoryId === c.id;
            return (
              <button
                key={c.id ?? "all"}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setCategoryId(c.id)}
                className={cx(
                  "h-10 shrink-0 cursor-pointer rounded-full px-4 text-body-medium whitespace-nowrap outline-none transition-colors focus-visible:ring-2 focus-visible:ring-border-focus-ring",
                  active ? "bg-text-primary text-background-full" : "bg-background-secondary-default text-text-secondary hover:bg-background-secondary-hover",
                )}
              >
                {c.name}
              </button>
            );
          })}
        </div>
      )}

      <div className="relative min-h-0 flex-1 overflow-y-auto pb-24 lg:pb-2">
        {offline && !pack ? (
          <p className="py-16 text-center text-body-regular text-text-tertiary">Katalog offline belum tersedia di perangkat ini. Sambungkan internet sekali agar katalog terunduh.</p>
        ) : !offline && catalog.isPending ? (
          <div className={gridClass}>
            {Array.from({ length: 12 }, (_, i) => (
              <Skeleton key={i} className={cx("rounded-2xl", layout.mode === "list" ? "h-16" : "h-[120px]")} />
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="py-16 text-center text-body-regular text-text-tertiary">
            {q ? `Tidak ada produk yang cocok dengan “${q}”.` : "Belum ada produk aktif untuk dijual."}
          </p>
        ) : (
          <>
            <div className={gridClass}>
              {items.map((item) => (
                <Tile key={item.variantId} item={item} layout={tileLayout} qtyInCart={inCart.get(item.variantId) ?? 0} onAdd={() => onAdd(item)} />
              ))}
            </div>
            {!offline && catalog.hasNextPage && (
              <div className="mt-4 text-center">
                <Button variant="secondary" size="small" onClick={() => catalog.fetchNextPage()} disabled={catalog.isFetchingNextPage}>
                  {catalog.isFetchingNextPage ? "Memuat…" : "Tampilkan lebih banyak"}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
