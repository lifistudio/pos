"use client";

import { RiAddLine, RiCloseLine, RiDeleteBinLine } from "@remixicon/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Breadcrumb, BreadcrumbItem } from "@/components/base/breadcrumb/breadcrumb";
import { Button } from "@/components/base/buttons/button";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import { Input, InputBase } from "@/components/base/input/input";
import { SegmentedControl, SegmentedControlItem } from "@/components/base/segmented-control/segmented-control";
import { Select, SelectItem } from "@/components/base/select/select";
import { Switch } from "@/components/base/switch/switch";
import { Textarea } from "@/components/base/textarea/textarea";
import { BrandPicker } from "@/components/app/brand-picker";
import { CodeField } from "@/components/app/code-field";
import { SearchSelect, type SearchOption } from "@/components/app/search-select";
import { PageHeader, Panel } from "@/components/app/page-header";
import { ThumbnailPicker, uploadThumbnail, useObjectUrl } from "@/components/app/thumbnail-picker";
import { useSession } from "@/components/app/session-context";
import { useToast } from "@/components/app/toast";
import { api, ApiClientError } from "@/lib/api-client";
import { formatNumber } from "@/lib/format";

type Option = { name: string; values: string[]; draft: string };
type VariantDraft = {
  key: string;
  optionValues: string[];
  sku: string;
  barcode: string;
  price: string;
  compareAtPrice: string;
  costPrice: string;
  isActive: boolean;
  stock: Record<string, string>;
};

const MAX_OPTIONS = 3;
const digits = (v: string) => v.replace(/[^\d]/g, "");
const toInt = (v: string) => (digits(v) === "" ? null : Number(digits(v)));

/** Semua kombinasi nilai opsi: [["Hitam","Putih"],["S","M"]] → [["Hitam","S"],["Hitam","M"],...] */
function combinations(options: Option[]): string[][] {
  const filled = options.filter((o) => o.name.trim() && o.values.length);
  if (filled.length === 0) return [[]];
  return filled.reduce<string[][]>((acc, o) => acc.flatMap((combo) => o.values.map((v) => [...combo, v])), [[]]);
}

function emptyVariant(optionValues: string[]): VariantDraft {
  return { key: optionValues.join("\u0000"), optionValues, sku: "", barcode: "", price: "", compareAtPrice: "", costPrice: "", isActive: true, stock: {} };
}

function OptionEditor({ option, onChange, onRemove }: { option: Option; onChange: (o: Option) => void; onRemove: () => void }) {
  function commit() {
    const parts = option.draft.split(",").map((s) => s.trim()).filter(Boolean);
    const values = [...option.values];
    for (const p of parts) if (!values.some((v) => v.toLowerCase() === p.toLowerCase())) values.push(p);
    onChange({ ...option, values, draft: "" });
  }
  return (
    <div className="flex flex-col gap-3 rounded-xl bg-background-primary-default p-3 shadow-card">
      <div className="flex items-end gap-2">
        <SearchSelect
          label="Nama variasi"
          placeholder="Warna, Ukuran, Rasa…"
          queryKey={["option-names"]}
          value={option.name ? { id: option.name, name: option.name } : null}
          onChange={(v) => onChange({ ...option, name: v?.name ?? "" })}
          search={async (q) =>
            (await api<{ data: { name: string; uses: number }[] }>("/products/option-names", { query: { q: q || undefined } })).data.map((o) => ({
              id: o.name,
              name: o.name,
              hint: `${o.uses} produk`,
              exact: o.name.toLowerCase() === q.trim().toLowerCase(),
            }))
          }
          createLabel="Pakai"
          onCreate={async (name) => ({ id: name.trim(), name: name.trim() })}
          className="flex-1"
        />
        <Button type="button" variant="ghost" iconOnly leadingIcon={RiDeleteBinLine} aria-label={`Hapus variasi ${option.name || ""}`} onClick={onRemove} />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-body-medium text-text-secondary">Nilai</span>
        <div className="flex flex-wrap items-center gap-1.5">
          {option.values.map((v) => (
            <span key={v} className="flex items-center gap-1 rounded-full bg-background-secondary-default py-1 ps-3 pe-1.5 text-body-medium text-text-primary">
              {v}
              <button
                type="button"
                aria-label={`Hapus nilai ${v}`}
                onClick={() => onChange({ ...option, values: option.values.filter((x) => x !== v) })}
                className="flex size-5 cursor-pointer items-center justify-center rounded-full text-foreground-icon-tertiary hover:bg-background-tertiary-hover"
              >
                <RiCloseLine className="size-3.5" aria-hidden />
              </button>
            </span>
          ))}
          <InputBase
            aria-label="Tambah nilai variasi"
            placeholder={option.values.length ? "Tambah nilai" : "Ketik nilai, pisahkan dengan koma, lalu Enter"}
            value={option.draft}
            onChange={(e) => onChange({ ...option, draft: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                commit();
              }
            }}
            onBlur={commit}
            fieldClassName="min-w-[180px] flex-1"
            size="small"
          />
        </div>
      </div>
    </div>
  );
}

export function ProductForm() {
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const { me, can } = useSession();
  const showCost = can("product:view_cost");
  const stockBranches = me.branches;

  const [name, setName] = useState("");
  const [brand, setBrand] = useState<SearchOption | null>(null);
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [status, setStatus] = useState<"DRAFT" | "ACTIVE">("ACTIVE");
  const [weight, setWeight] = useState("");
  const [hasVariants, setHasVariants] = useState(false);
  const [options, setOptions] = useState<Option[]>([{ name: "", values: [], draft: "" }]);
  const [drafts, setDrafts] = useState<Record<string, VariantDraft>>({});
  const [bulkPrice, setBulkPrice] = useState("");
  // Default: SKU & barcode dibuat otomatis (unik di seluruh katalog). Matikan untuk mengisi sendiri.
  const [autoCodes, setAutoCodes] = useState(true);
  const [thumbnail, setThumbnail] = useState<Blob | null>(null);
  const thumbnailPreview = useObjectUrl(thumbnail);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: () => api<{ data: { id: string; name: string; parentId: string | null }[] }>("/categories").then((r) => r.data),
    enabled: can("category:read"),
  });

  // Daftar varian mengikuti kombinasi opsi; isian yang sudah diketik dipertahankan per kombinasi.
  const variants = useMemo(() => {
    const combos = hasVariants ? combinations(options) : [[]];
    return combos.map((c) => drafts[c.join("\u0000")] ?? emptyVariant(c));
  }, [hasVariants, options, drafts]);

  const update = (v: VariantDraft, patch: Partial<VariantDraft>) => setDrafts((all) => ({ ...all, [v.key]: { ...v, ...patch } }));

  // Kode yang muncul lebih dari sekali di form (SKU & barcode satu ruang nama).
  const duplicateCodes = useMemo(() => {
    const counts = new Map<string, number>();
    if (!autoCodes) for (const v of variants) for (const c of [v.sku, v.barcode]) if (c.trim()) counts.set(c.trim().toUpperCase(), (counts.get(c.trim().toUpperCase()) ?? 0) + 1);
    return new Set([...counts].filter(([, n]) => n > 1).map(([c]) => c));
  }, [autoCodes, variants]);

  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const create = useMutation({
    mutationFn: async (body: unknown) => {
      const created = await api<{ data: { id: string; name: string } }>("/products", { method: "POST", headers: { "idempotency-key": idempotencyKey }, body });
      let imageError: string | null = null;
      if (thumbnail) await uploadThumbnail(created.data.id, thumbnail).catch((e: Error) => (imageError = e.message));
      return { ...created, imageError };
    },
    onSuccess: ({ data, imageError }) => {
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.show({ status: "success", title: `${data.name} ditambahkan` });
      if (imageError) toast.show({ status: "error", title: `Gambar belum tersimpan: ${imageError} Coba unggah lagi dari halaman produk.` });
      router.push(`/products/${data.id}`);
    },
    onError: (e) => {
      if (e instanceof ApiClientError && Array.isArray(e.details)) {
        const details = e.details as { path: string; message: string }[];
        setFieldErrors(Object.fromEntries(details.map((d) => [d.path, d.message])));
        // Sebut lokasi kesalahan pertama dengan bahasa toko, bukan path teknis.
        const first = details[0];
        const where = first.path.match(/^variants\.(\d+)\.(\w+)/);
        const field: Record<string, string> = { price: "harga jual", compareAtPrice: "harga coret", costPrice: "harga modal", sku: "SKU", barcode: "barcode", initialStock: "stok awal" };
        return setError(
          where ? `Varian ke-${Number(where[1]) + 1}, ${field[where[2]] ?? where[2]}: ${first.message}` : `${e.message} ${first.message}`,
        );
      }
      setError(e instanceof ApiClientError ? e.message : "Gagal menyimpan produk. Coba lagi.");
    },
  });

  function submit() {
    setError(null);
    setFieldErrors({});
    if (name.trim().length < 2) return setFieldErrors({ name: "Nama produk minimal 2 karakter." });
    const usedOptions = hasVariants ? options.filter((o) => o.name.trim() && o.values.length) : [];
    if (hasVariants && usedOptions.length === 0) return setError("Isi minimal satu variasi beserta nilainya, atau matikan variasi.");
    const missingPrice = variants.filter((v) => v.isActive && toInt(v.price) === null);
    if (missingPrice.length) return setError(`Harga jual belum diisi untuk ${missingPrice.length} varian.`);
    if (duplicateCodes.size) return setError(`Kode ${[...duplicateCodes].join(", ")} dipakai lebih dari sekali. SKU dan barcode harus unik.`);

    create.mutate({
      name: name.trim(),
      brandId: brand?.id ?? null,
      description: description.trim() || null,
      categoryId,
      status,
      weightGram: toInt(weight),
      options: usedOptions.map((o) => ({ name: o.name.trim(), values: o.values })),
      variants: variants.map((v) => ({
        optionValues: v.optionValues,
        sku: autoCodes ? null : v.sku.trim() || null,
        barcode: autoCodes ? null : v.barcode.trim() || null,
        price: toInt(v.price) ?? 0,
        compareAtPrice: toInt(v.compareAtPrice),
        costPrice: showCost ? toInt(v.costPrice) : undefined,
        isActive: v.isActive,
        initialStock: can("inventory:adjust")
          ? stockBranches.map((b) => ({ branchId: b.id, qty: toInt(v.stock[b.id] ?? "") ?? 0 })).filter((s) => s.qty > 0)
          : undefined,
      })),
    });
  }

  return (
    <>
      <Breadcrumb className="mb-3">
        <BreadcrumbItem href="/products">Produk</BreadcrumbItem>
        <BreadcrumbItem current>Tambah produk</BreadcrumbItem>
      </Breadcrumb>
      <PageHeader title="Tambah produk" description="SKU dan barcode unik dibuat otomatis, atau isi sendiri. Stok awal tercatat di kartu stok tiap cabang." />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Panel title="Informasi produk">
            <div className="grid gap-4 sm:grid-cols-2">
              <ThumbnailPicker
                src={thumbnailPreview}
                alt={name ? `Gambar ${name}` : "Gambar produk"}
                onPick={setThumbnail}
                onRemove={() => setThumbnail(null)}
                className="sm:col-span-2"
              />
              <Input
                label="Nama produk"
                placeholder="Kaos Essential Cotton"
                value={name}
                onChange={setName}
                isRequired
                isInvalid={!!fieldErrors.name}
                hint={fieldErrors.name}
                className="sm:col-span-2"
              />
              {can("category:read") && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-body-medium text-text-secondary">Kategori</span>
                  <Select
                    aria-label="Kategori"
                    placeholder="Pilih kategori"
                    selectedKey={categoryId}
                    onSelectionChange={(k) => setCategoryId(k ? String(k) : null)}
                    triggerClassName="w-full"
                    popoverClassName="min-w-56"
                  >
                    {(categories.data ?? []).map((c) => (
                      <SelectItem key={c.id} id={c.id} textValue={c.name}>
                        {c.parentId ? `— ${c.name}` : c.name}
                      </SelectItem>
                    ))}
                  </Select>
                </div>
              )}
              {can("brand:read") && <BrandPicker value={brand} onChange={setBrand} />}
              <Input label="Berat (gram)" placeholder="Untuk ongkir online" inputMode="numeric" value={weight} onChange={(v) => setWeight(digits(v))} />
              <Textarea
                label="Deskripsi"
                placeholder="Bahan, ukuran, cara perawatan…"
                value={description}
                onChange={setDescription}
                rows={3}
                autoResize
                maxRows={8}
                className="sm:col-span-2"
              />
            </div>
          </Panel>

          <Panel
            title="Variasi"
            action={
              <Switch isSelected={hasVariants} onChange={setHasVariants} size="sm">
                <span className="text-body-medium text-text-secondary">Produk punya variasi</span>
              </Switch>
            }
          >
            {hasVariants ? (
              <div className="flex flex-col gap-3">
                {options.map((o, i) => (
                  <OptionEditor
                    key={i}
                    option={o}
                    onChange={(next) => setOptions((all) => all.map((x, j) => (j === i ? next : x)))}
                    onRemove={() => setOptions((all) => (all.length === 1 ? [{ name: "", values: [], draft: "" }] : all.filter((_, j) => j !== i)))}
                  />
                ))}
                {options.length < MAX_OPTIONS && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="small"
                    leadingIcon={RiAddLine}
                    className="w-fit"
                    onClick={() => setOptions((all) => [...all, { name: "", values: [], draft: "" }])}
                  >
                    Tambah variasi
                  </Button>
                )}
              </div>
            ) : (
              <p className="text-body-regular text-text-tertiary">
                Aktifkan bila produk punya pilihan seperti warna, ukuran, atau rasa. Maksimal {MAX_OPTIONS} jenis variasi.
              </p>
            )}
          </Panel>

          <Panel
            title={hasVariants ? `Harga & stok · ${variants.length} varian` : "Harga & stok"}
            action={
              variants.length > 1 && (
                <div className="flex items-center gap-2">
                  <InputBase
                    aria-label="Harga untuk semua varian"
                    placeholder="Harga semua varian"
                    inputMode="numeric"
                    value={bulkPrice}
                    onChange={(e) => setBulkPrice(digits(e.target.value))}
                    fieldClassName="w-44"
                    size="small"
                  />
                  <Button
                    type="button"
                    size="small"
                    variant="secondary"
                    disabled={!bulkPrice}
                    onClick={() => setDrafts((all) => Object.fromEntries(variants.map((v) => [v.key, { ...(all[v.key] ?? v), price: bulkPrice }])))}
                  >
                    Terapkan
                  </Button>
                </div>
              )
            }
          >
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1 rounded-xl bg-background-primary-default p-3 shadow-card">
                <Switch isSelected={autoCodes} onChange={setAutoCodes} size="sm">
                  <span className="text-body-medium text-text-primary">SKU & barcode otomatis</span>
                </Switch>
                <p className="text-body-2-regular text-text-tertiary">
                  {autoCodes
                    ? "Dibuat saat disimpan dan dijamin tidak sama dengan produk lain: SKU seperti KSEC-00042-HTM-L, barcode EAN-13 siap dicetak."
                    : "Isi sendiri sesuai label pabrik atau sistem lama. Kolom yang dikosongkan tetap dibuat otomatis. Kode yang sudah dipakai produk lain langsung ditandai."}
                </p>
              </div>
              {variants.map((v) => (
                <div key={v.key || "default"} className="rounded-xl bg-background-primary-default p-3 shadow-card">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="text-body-medium text-text-primary">{v.optionValues.length ? v.optionValues.join(" / ") : name || "Produk"}</p>
                    {hasVariants && (
                      <Checkbox size="sm" isSelected={v.isActive} onChange={(isActive) => update(v, { isActive })}>
                        Aktif
                      </Checkbox>
                    )}
                  </div>
                  <div className="grid grid-cols-2 items-end gap-3 sm:grid-cols-3">
                    <Input size="small" label="Harga jual (Rp)" inputMode="numeric" value={v.price} onChange={(x) => update(v, { price: digits(x) })} isRequired />
                    <Input size="small" label="Harga coret" inputMode="numeric" value={v.compareAtPrice} onChange={(x) => update(v, { compareAtPrice: digits(x) })} />
                    {showCost && <Input size="small" label="Harga modal" inputMode="numeric" value={v.costPrice} onChange={(x) => update(v, { costPrice: digits(x) })} />}
                  </div>
                  {!autoCodes && (
                    <div className="mt-3 grid items-start gap-3 sm:grid-cols-2">
                      <CodeField kind="SKU" value={v.sku} onChange={(sku) => update(v, { sku })} duplicateInForm={duplicateCodes.has(v.sku.trim().toUpperCase())} />
                      <CodeField kind="BARCODE" value={v.barcode} onChange={(barcode) => update(v, { barcode })} duplicateInForm={duplicateCodes.has(v.barcode.trim().toUpperCase())} />
                    </div>
                  )}
                  {can("inventory:adjust") && stockBranches.length > 0 && (
                    <div className="mt-3 border-t border-separator-border pt-3">
                      <p className="mb-2 text-body-2-medium text-text-tertiary">Stok awal per cabang</p>
                      <div className="grid grid-cols-2 items-end gap-3 sm:grid-cols-3 lg:grid-cols-4">
                        {stockBranches.map((b) => (
                          <Input
                            key={b.id}
                            size="small"
                            label={b.name}
                            placeholder="0"
                            inputMode="numeric"
                            value={v.stock[b.id] ?? ""}
                            onChange={(x) => update(v, { stock: { ...v.stock, [b.id]: digits(x) } })}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Panel>
        </div>

        <Panel title="Publikasi" className="h-fit xl:sticky xl:top-2">
          <div className="flex flex-col gap-4">
            <SegmentedControl
              aria-label="Status produk"
              selectedKeys={new Set([status])}
              onSelectionChange={(keys) => {
                const next = [...keys][0];
                if (next) setStatus(next as "DRAFT" | "ACTIVE");
              }}
            >
              <SegmentedControlItem id="ACTIVE">Aktif</SegmentedControlItem>
              <SegmentedControlItem id="DRAFT">Draf</SegmentedControlItem>
            </SegmentedControl>
            <p className="text-body-2-regular text-text-tertiary">
              {status === "ACTIVE" ? "Langsung bisa dijual di kasir dan kanal online." : "Disimpan tanpa tampil di kasir sampai diaktifkan."}
            </p>
            <dl className="grid grid-cols-2 gap-2 text-body-2-medium">
              <div className="rounded-xl bg-background-primary-default px-3 py-2 shadow-card">
                <dt className="text-text-tertiary">Varian</dt>
                <dd className="text-headline-semibold text-text-primary tabular-nums">{variants.filter((v) => v.isActive).length}</dd>
              </div>
              <div className="rounded-xl bg-background-primary-default px-3 py-2 shadow-card">
                <dt className="text-text-tertiary">Stok awal</dt>
                <dd className="text-headline-semibold text-text-primary tabular-nums">
                  {formatNumber(variants.reduce((s, v) => s + Object.values(v.stock).reduce((t, q) => t + (toInt(q) ?? 0), 0), 0))}
                </dd>
              </div>
            </dl>
            {error && (
              <p role="alert" className="text-body-medium text-text-error-primary">
                {error}
              </p>
            )}
            <Button type="button" className="w-full" onClick={submit} disabled={create.isPending}>
              {create.isPending ? "Menyimpan…" : "Simpan produk"}
            </Button>
          </div>
        </Panel>
      </div>
    </>
  );
}
