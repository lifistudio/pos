"use client";

import { RiArchiveLine, RiBarcodeLine, RiCheckLine, RiEditLine, RiInboxUnarchiveLine, RiMagicLine, RiPrinterLine } from "@remixicon/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Chip } from "@/components/base/badges/chip";
import { Breadcrumb, BreadcrumbItem } from "@/components/base/breadcrumb/breadcrumb";
import { Button, ButtonLink } from "@/components/base/buttons/button";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import { Input } from "@/components/base/input/input";
import { Select, SelectItem } from "@/components/base/select/select";
import { Textarea } from "@/components/base/textarea/textarea";
import { BrandPicker } from "@/components/app/brand-picker";
import { CodeField } from "@/components/app/code-field";
import type { SearchOption } from "@/components/app/search-select";
import { PageHeader, Panel } from "@/components/app/page-header";
import { ThumbnailPicker, uploadThumbnail } from "@/components/app/thumbnail-picker";
import { useSession } from "@/components/app/session-context";
import { useToast } from "@/components/app/toast";
import { api, ApiClientError } from "@/lib/api-client";
import { formatDateTime, formatNumber, formatRupiah } from "@/lib/format";
import { STATUS_LABEL, type ProductStatus } from "../product-list";

export type ProductDetail = {
  id: string;
  name: string;
  description: string | null;
  brand: { id: string; name: string } | null;
  status: ProductStatus;
  hasVariants: boolean;
  weightGram: number | null;
  imageUrl: string | null;
  category: { id: string; name: string } | null;
  options: { id: string; name: string; values: { id: string; value: string }[] }[];
  variants: Variant[];
  updatedAt: string;
};

type Variant = {
  id: string;
  sku: string;
  barcode: string | null;
  title: string;
  price: number;
  compareAtPrice: number | null;
  costPrice?: number | null;
  isActive: boolean;
  inventory: { branchId: string; branchName: string; branchCode: string; onHand: number; reserved: number; reorderPoint: number }[];
};

const toNumber = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").replace(/[^\d]/g, "");
  return s === "" ? null : Number(s);
};

function VariantEditor({ variant, onDone }: { variant: Variant; onDone: () => void }) {
  const { can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [active, setActive] = useState(variant.isActive);
  const [sku, setSku] = useState(variant.sku);
  const [barcode, setBarcode] = useState(variant.barcode ?? "");
  const [autoSku, setAutoSku] = useState(false);
  const [autoBarcode, setAutoBarcode] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api<{ data: ProductDetail }>(`/variants/${variant.id}`, { method: "PATCH", body }),
    onSuccess: ({ data }) => {
      qc.setQueryData(["product", data.id], data);
      qc.invalidateQueries({ queryKey: ["products"] });
      toast.show({ status: "success", title: `Varian ${variant.title === "Default" ? "" : variant.title} tersimpan` });
      onDone();
    },
    onError: (e) => setError(e instanceof ApiClientError ? e.message : "Gagal menyimpan. Coba lagi."),
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const price = toNumber(f.get("price"));
    if (price === null) return setError("Harga jual wajib diisi.");
    setError(null);
    if (!autoSku && sku.trim().length < 2) return setError("SKU minimal 2 karakter, atau pilih buat otomatis.");
    if (!autoSku && !autoBarcode && barcode.trim() && barcode.trim().toUpperCase() === sku.trim().toUpperCase()) return setError("SKU dan barcode tidak boleh sama.");
    save.mutate({
      ...(autoSku ? { generateSku: true } : { sku: sku.trim() }),
      ...(autoBarcode ? { generateBarcode: true } : { barcode: barcode.trim() || null }),
      price,
      compareAtPrice: toNumber(f.get("compareAtPrice")),
      ...(can("product:view_cost") ? { costPrice: toNumber(f.get("costPrice")) } : {}),
      isActive: active,
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-3 rounded-2xl bg-background-primary-default p-4 shadow-card sm:grid-cols-2 lg:grid-cols-3">
      <div className="flex flex-col gap-1">
        {autoSku ? (
          <Input label="SKU" value="" placeholder="Dibuat otomatis saat disimpan" isDisabled size="small" />
        ) : (
          <CodeField kind="SKU" value={sku} onChange={setSku} excludeVariantId={variant.id} placeholder="Wajib diisi" isRequired />
        )}
        <Button type="button" size="xs" variant="ghost" leadingIcon={RiMagicLine} className="w-fit" onClick={() => setAutoSku((x) => !x)}>
          {autoSku ? "Isi sendiri" : "Buat SKU otomatis"}
        </Button>
      </div>
      <div className="flex flex-col gap-1">
        {autoBarcode ? (
          <Input label="Barcode" value="" placeholder="Dibuat otomatis saat disimpan" isDisabled size="small" />
        ) : (
          <CodeField kind="BARCODE" value={barcode} onChange={setBarcode} excludeVariantId={variant.id} placeholder="Kosong = tanpa barcode" />
        )}
        <Button type="button" size="xs" variant="ghost" leadingIcon={RiMagicLine} className="w-fit" onClick={() => setAutoBarcode((x) => !x)}>
          {autoBarcode ? "Isi sendiri" : "Buat barcode otomatis"}
        </Button>
      </div>
      <Input name="price" label="Harga jual (Rp)" defaultValue={String(variant.price)} inputMode="numeric" isRequired size="small" />
      <Input name="compareAtPrice" label="Harga coret (Rp)" defaultValue={variant.compareAtPrice?.toString() ?? ""} inputMode="numeric" size="small" />
      {can("product:view_cost") && (
        <Input name="costPrice" label="Harga modal (Rp)" defaultValue={variant.costPrice?.toString() ?? ""} inputMode="numeric" size="small" />
      )}
      <div className="flex items-end pb-2">
        <Checkbox isSelected={active} onChange={setActive} size="sm">
          Varian aktif (tampil di kasir)
        </Checkbox>
      </div>
      {error && (
        <p role="alert" className="text-body-medium text-text-error-primary sm:col-span-2 lg:col-span-3">
          {error}
        </p>
      )}
      <div className="flex gap-2 sm:col-span-2 lg:col-span-3">
        <Button type="submit" size="small" leadingIcon={RiCheckLine} disabled={save.isPending}>
          {save.isPending ? "Menyimpan…" : "Simpan varian"}
        </Button>
        <Button type="button" size="small" variant="secondary" onClick={onDone}>
          Batal
        </Button>
      </div>
    </form>
  );
}

/** Informasi umum produk + thumbnail (tampil di kasir & daftar). */
function ProductInfoPanel({ product }: { product: ProductDetail }) {
  const { can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const canEdit = can("product:update");
  const [editing, setEditing] = useState(false);
  const [categoryId, setCategoryId] = useState<string | null>(product.category?.id ?? null);
  const [brand, setBrand] = useState<SearchOption | null>(product.brand);
  const [error, setError] = useState<string | null>(null);

  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: () => api<{ data: { id: string; name: string; parentId: string | null }[] }>("/categories").then((r) => r.data),
    enabled: editing && can("category:read"),
  });

  const refresh = (data?: ProductDetail) => {
    if (data) qc.setQueryData(["product", data.id], data);
    else qc.invalidateQueries({ queryKey: ["product", product.id] });
    qc.invalidateQueries({ queryKey: ["products"] });
  };

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api<{ data: ProductDetail }>(`/products/${product.id}`, { method: "PATCH", body }),
    onSuccess: ({ data }) => {
      refresh(data);
      toast.show({ status: "success", title: "Informasi produk tersimpan" });
      setEditing(false);
    },
    onError: (e) => setError(e instanceof ApiClientError ? e.message : "Gagal menyimpan. Coba lagi."),
  });
  const image = useMutation({
    mutationFn: async (blob: Blob | null) => {
      if (blob) await uploadThumbnail(product.id, blob);
      else await api(`/products/${product.id}/thumbnail`, { method: "DELETE" });
    },
    onSuccess: (_, blob) => {
      refresh();
      toast.show({ status: "success", title: blob ? "Gambar produk diperbarui" : "Gambar produk dihapus" });
    },
    onError: (e) => toast.show({ status: "error", title: e instanceof Error ? e.message : "Gagal memperbarui gambar." }),
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const name = String(f.get("name")).trim();
    if (name.length < 2) return setError("Nama produk minimal 2 karakter.");
    setError(null);
    save.mutate({
      name,
      ...(can("brand:read") ? { brandId: brand?.id ?? null } : {}),
      description: String(f.get("description")).trim() || null,
      weightGram: toNumber(f.get("weightGram")),
      ...(can("category:read") ? { categoryId } : {}),
    });
  }

  const facts: [string, string][] = [
    ["Kategori", product.category?.name ?? "—"],
    ["Merek", product.brand?.name ?? "—"],
    ["Berat", product.weightGram ? `${formatNumber(product.weightGram)} gram` : "—"],
    ...product.options.map((o): [string, string] => [o.name, o.values.map((x) => x.value).join(", ")]),
    ["Terakhir diubah", formatDateTime(product.updatedAt)],
  ];

  return (
    <Panel
      title="Informasi produk"
      action={
        canEdit &&
        !editing && (
          <Button size="small" variant="secondary" leadingIcon={RiEditLine} onClick={() => setEditing(true)}>
            Ubah informasi
          </Button>
        )
      }
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        {canEdit ? (
          <ThumbnailPicker src={product.imageUrl} alt={`Gambar ${product.name}`} onPick={(b) => image.mutateAsync(b)} onRemove={() => image.mutate(null)} busy={image.isPending} />
        ) : (
          <div className="size-28 overflow-hidden rounded-xl bg-background-tertiary-default">
            {/* eslint-disable-next-line @next/next/no-img-element -- thumbnail dari API/Cloudinary */}
            {product.imageUrl && <img src={product.imageUrl} alt={`Gambar ${product.name}`} className="size-full object-cover" />}
          </div>
        )}
        {editing ? (
          <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
            <Input name="name" label="Nama produk" defaultValue={product.name} isRequired size="small" className="sm:col-span-2" />
            {can("category:read") && (
              <div className="flex flex-col gap-1.5">
                <span className="text-body-medium text-text-secondary">Kategori</span>
                <Select
                  aria-label="Kategori"
                  placeholder="Tanpa kategori"
                  selectedKey={categoryId}
                  onSelectionChange={(k) => setCategoryId(k ? String(k) : null)}
                  triggerClassName="w-full"
                  popoverClassName="min-w-56"
                >
                  {(categories.data ?? (product.category ? [{ ...product.category, parentId: null }] : [])).map((c) => (
                    <SelectItem key={c.id} id={c.id} textValue={c.name}>
                      {c.parentId ? `— ${c.name}` : c.name}
                    </SelectItem>
                  ))}
                </Select>
              </div>
            )}
            {can("brand:read") && <BrandPicker value={brand} onChange={setBrand} />}
            <Input name="weightGram" label="Berat (gram)" defaultValue={product.weightGram?.toString() ?? ""} inputMode="numeric" size="small" />
            <Textarea name="description" label="Deskripsi" defaultValue={product.description ?? ""} rows={3} autoResize maxRows={8} className="sm:col-span-2" />
            {error && (
              <p role="alert" className="text-body-medium text-text-error-primary sm:col-span-2">
                {error}
              </p>
            )}
            <div className="flex gap-2 sm:col-span-2">
              <Button type="submit" size="small" leadingIcon={RiCheckLine} disabled={save.isPending}>
                {save.isPending ? "Menyimpan…" : "Simpan informasi"}
              </Button>
              <Button type="button" size="small" variant="secondary" onClick={() => setEditing(false)}>
                Batal
              </Button>
            </div>
          </form>
        ) : (
          <dl className="grid content-start gap-x-6 gap-y-3 sm:grid-cols-2">
            {facts.map(([k, v]) => (
              <div key={k}>
                <dt className="text-body-2-regular text-text-tertiary">{k}</dt>
                <dd className="text-body-medium text-text-primary">{v}</dd>
              </div>
            ))}
            <div className="sm:col-span-2">
              <dt className="text-body-2-regular text-text-tertiary">Deskripsi</dt>
              <dd className="max-w-[65ch] whitespace-pre-line text-body-regular text-text-secondary">{product.description || "Belum ada deskripsi."}</dd>
            </div>
          </dl>
        )}
      </div>
    </Panel>
  );
}

function StockCell({ level }: { level?: Variant["inventory"][number] }) {
  // Belum pernah ada stok di cabang ini: tampil 0 redup, bukan tanda bahaya.
  if (!level) return <span className="text-body-medium text-text-tertiary tabular-nums">0</span>;
  const tone = level.onHand === 0 ? "rose" : level.reorderPoint > 0 && level.onHand <= level.reorderPoint ? "yellow" : null;
  return tone ? (
    <Chip variant="subtle" color={tone}>
      {level.onHand === 0 ? "Habis" : formatNumber(level.onHand)}
    </Chip>
  ) : (
    <span className="text-body-medium text-text-primary tabular-nums">{formatNumber(level.onHand)}</span>
  );
}

export function ProductDetailView({ initial }: { initial: ProductDetail }) {
  const { can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<string | null>(null);

  const { data: product } = useQuery({
    queryKey: ["product", initial.id],
    queryFn: () => api<{ data: ProductDetail }>(`/products/${initial.id}`).then((r) => r.data),
    initialData: initial,
  });

  const setStatus = useMutation({
    mutationFn: (status: ProductStatus) => api<{ data: ProductDetail }>(`/products/${product.id}`, { method: "PATCH", body: { status } }),
    onSuccess: ({ data }) => {
      qc.setQueryData(["product", data.id], data);
      qc.invalidateQueries({ queryKey: ["products"] });
      toast.show({ status: "success", title: `Status produk: ${STATUS_LABEL[data.status].label}` });
    },
    onError: (e) => toast.show({ status: "error", title: e instanceof ApiClientError ? e.message : "Gagal mengubah status." }),
  });

  // Kolom cabang = gabungan semua cabang yang punya catatan stok untuk produk ini.
  const branches = [...new Map(product.variants.flatMap((v) => v.inventory.map((i) => [i.branchId, i]))).values()].sort((a, b) =>
    a.branchName.localeCompare(b.branchName),
  );
  const totalUnits = product.variants.reduce((s, v) => s + v.inventory.reduce((t, i) => t + i.onHand, 0), 0);
  const showCost = can("product:view_cost");

  return (
    <>
      <Breadcrumb className="mb-3">
        <BreadcrumbItem href="/products">Produk</BreadcrumbItem>
        <BreadcrumbItem current>{product.name}</BreadcrumbItem>
      </Breadcrumb>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {product.name}
            <Chip variant="bold" color={STATUS_LABEL[product.status].color}>
              {STATUS_LABEL[product.status].label}
            </Chip>
          </span>
        }
        description={[product.category?.name, product.brand?.name, `${product.variants.length} varian`, `${formatNumber(totalUnits)} unit di ${branches.length} lokasi`]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <>
          <ButtonLink href={`/labels/${product.id}`} variant="secondary" leadingIcon={RiPrinterLine}>
            Cetak label
          </ButtonLink>
          {can("product:update") &&
          (product.status === "ARCHIVED" ? (
            <Button variant="secondary" leadingIcon={RiInboxUnarchiveLine} onClick={() => setStatus.mutate("DRAFT")} disabled={setStatus.isPending}>
              Pulihkan dari arsip
            </Button>
          ) : (
            <>
              {product.status === "DRAFT" && (
                <Button leadingIcon={RiCheckLine} onClick={() => setStatus.mutate("ACTIVE")} disabled={setStatus.isPending}>
                  Aktifkan
                </Button>
              )}
              <Button variant="secondary" leadingIcon={RiArchiveLine} onClick={() => setStatus.mutate("ARCHIVED")} disabled={setStatus.isPending}>
                Arsipkan
              </Button>
            </>
          ))}
          </>
        }
      />

      <div className="flex flex-col gap-4">
        <ProductInfoPanel product={product} />
        <Panel title="Varian & stok per cabang">
          <div className="-mx-4 hidden overflow-x-auto md:block">
            <table className="w-full min-w-[720px]">
              <thead>
                <tr className="border-b border-separator-border text-body-2-medium text-text-tertiary">
                  <th className="px-4 pb-2.5 text-start font-medium">Varian</th>
                  <th className="px-3 pb-2.5 text-start font-medium">SKU / barcode</th>
                  <th className="px-3 pb-2.5 text-end font-medium">Harga</th>
                  {showCost && <th className="px-3 pb-2.5 text-end font-medium">Modal</th>}
                  {branches.map((b) => (
                    <th key={b.branchId} className="px-3 pb-2.5 text-end font-medium" title={b.branchName}>
                      {b.branchCode}
                    </th>
                  ))}
                  <th className="w-12 px-4 pb-2.5" />
                </tr>
              </thead>
              <tbody>
                {product.variants.map((v) => (
                  <VariantRows
                    key={v.id}
                    v={v}
                    branches={branches}
                    showCost={showCost}
                    editing={editing === v.id}
                    canEdit={can("product:update")}
                    onEdit={() => setEditing(editing === v.id ? null : v.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {/* HP: kartu per varian */}
          <ul className="flex flex-col gap-3 md:hidden">
            {product.variants.map((v) => (
              <li key={v.id} className="rounded-xl bg-background-primary-default p-3 shadow-card">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-body-medium text-text-primary">{v.title === "Default" ? product.name : v.title}</p>
                    <p className="font-mono text-body-2-regular text-text-tertiary">{v.sku}</p>
                  </div>
                  <p className="shrink-0 text-body-medium text-text-primary tabular-nums">{formatRupiah(v.price)}</p>
                </div>
                <dl className="mt-3 grid grid-cols-3 gap-2">
                  {branches.map((b) => (
                    <div key={b.branchId} className="rounded-lg bg-background-secondary-default px-2 py-1.5">
                      <dt className="truncate text-caption-1-regular text-text-tertiary">{b.branchName}</dt>
                      <dd>
                        <StockCell level={v.inventory.find((i) => i.branchId === b.branchId)} />
                      </dd>
                    </div>
                  ))}
                </dl>
                {can("product:update") && (
                  <div className="mt-3">
                    {editing === v.id ? (
                      <VariantEditor variant={v} onDone={() => setEditing(null)} />
                    ) : (
                      <Button size="small" variant="secondary" leadingIcon={RiEditLine} onClick={() => setEditing(v.id)}>
                        Ubah varian
                      </Button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </>
  );
}

function VariantRows({
  v,
  branches,
  showCost,
  editing,
  canEdit,
  onEdit,
}: {
  v: Variant;
  branches: { branchId: string }[];
  showCost: boolean;
  editing: boolean;
  canEdit: boolean;
  onEdit: () => void;
}) {
  return (
    <>
      <tr className="border-b border-separator-border text-body-medium last:border-0">
        <td className="px-4 py-3">
          <span className={v.isActive ? "text-text-primary" : "text-text-tertiary line-through"}>{v.title}</span>
          {!v.isActive && <span className="ms-2 text-body-2-regular text-text-tertiary">nonaktif</span>}
        </td>
        <td className="px-3 py-3">
          <span className="block font-mono text-body-2-medium text-text-primary">{v.sku}</span>
          {v.barcode && (
            <span className="flex items-center gap-1 font-mono text-caption-1-regular text-text-tertiary">
              <RiBarcodeLine className="size-3.5" aria-hidden />
              {v.barcode}
            </span>
          )}
        </td>
        <td className="px-3 py-3 text-end whitespace-nowrap tabular-nums">
          <span className="text-text-primary">{formatRupiah(v.price)}</span>
          {v.compareAtPrice && <span className="block text-body-2-regular text-text-tertiary line-through">{formatRupiah(v.compareAtPrice)}</span>}
        </td>
        {showCost && <td className="px-3 py-3 text-end whitespace-nowrap text-text-secondary tabular-nums">{formatRupiah(v.costPrice)}</td>}
        {branches.map((b) => (
          <td key={b.branchId} className="px-3 py-3 text-end">
            <StockCell level={v.inventory.find((i) => i.branchId === b.branchId)} />
          </td>
        ))}
        <td className="px-4 py-3 text-end">
          {canEdit && (
            <Button size="xs" variant="ghost" iconOnly leadingIcon={RiEditLine} aria-label={`Ubah varian ${v.title}`} onClick={onEdit} />
          )}
        </td>
      </tr>
      {editing && (
        <tr>
          <td colSpan={99} className="px-4 py-3">
            <VariantEditor variant={v} onDone={onEdit} />
          </td>
        </tr>
      )}
    </>
  );
}
