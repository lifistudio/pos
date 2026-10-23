"use client";

import { RiAddLine, RiDeleteBinLine, RiEditLine, RiGitMergeLine, RiPriceTag3Line, RiSearchLine } from "@remixicon/react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/base/buttons/button";
import { Input, InputBase } from "@/components/base/input/input";
import { DataTable, type Column } from "@/components/app/data-table";
import { PageHeader } from "@/components/app/page-header";
import { SearchSelect, type SearchOption } from "@/components/app/search-select";
import { useSession } from "@/components/app/session-context";
import { ConfirmDialog, Sheet } from "@/components/app/sheet";
import { useToast } from "@/components/app/toast";
import { useDebounced, useUrlState } from "@/hooks/use-url-state";
import { api, ApiClientError } from "@/lib/api-client";
import { readApiError } from "@/lib/form-errors";
import { formatNumber } from "@/lib/format";
import { ProductsNav } from "../products-nav";

type Brand = { id: string; name: string; productCount: number; exact?: boolean };
type Page = { data: Brand[]; meta: { page: number; pageCount: number; total: number } };

const PAGE_SIZE = 25;

function BrandForm({ brand, onDone }: { brand: Brand | null; onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(brand?.name ?? "");
  const [error, setError] = useState<{ message: string; existing?: { brandId: string; name: string } } | null>(null);
  const term = useDebounced(name.trim(), 300);
  // Saran ejaan mirip saat mengetik — cegah "Samsung" vs "Samsng" vs "SAMSUNG".
  const similar = useQuery({
    queryKey: ["brands", "similar", term],
    queryFn: () => api<Page>("/brands", { query: { q: term, pageSize: 5 } }).then((r) => r.data.filter((b) => b.id !== brand?.id)),
    enabled: term.length >= 2,
  });

  const save = useMutation({
    mutationFn: () => (brand ? api(`/brands/${brand.id}`, { method: "PATCH", body: { name } }) : api("/brands", { method: "POST", body: { name } })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["brands"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      toast.show({ status: "success", title: brand ? "Merek diperbarui" : "Merek ditambahkan" });
      onDone();
    },
    onError: (e) =>
      setError({
        message: readApiError(e).message,
        existing: e instanceof ApiClientError && e.code === "BRAND_EXISTS" ? (e.details as { brandId: string; name: string }) : undefined,
      }),
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!name.trim()) return setError({ message: "Nama merek wajib diisi." });
    save.mutate();
  }

  const matches = (similar.data ?? []).slice(0, 5);
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Input label="Nama merek" placeholder="Samsung, Wardah, Indomie…" value={name} onChange={setName} isRequired autoFocus maxLength={60} />
      {matches.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-xl bg-background-secondary-default p-3">
          <p className="text-body-2-medium text-text-secondary">{matches.some((m) => m.exact) ? "Merek ini sudah ada:" : "Merek dengan nama mirip:"}</p>
          <ul className="flex flex-col gap-1">
            {matches.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 text-body-2-regular">
                <span className="truncate text-text-primary">{m.name}</span>
                <span className="shrink-0 text-text-tertiary">{formatNumber(m.productCount)} produk</span>
              </li>
            ))}
          </ul>
          <p className="text-caption-1-regular text-text-tertiary">Pastikan bukan merek yang sama dengan ejaan lain sebelum menyimpan.</p>
        </div>
      )}
      {error && (
        <p role="alert" className="text-body-medium text-text-error-primary">
          {error.message}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>
          Batal
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? "Menyimpan…" : brand ? "Simpan" : "Tambah merek"}
        </Button>
      </div>
    </form>
  );
}

function MergeForm({ brand, onDone }: { brand: Brand; onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [target, setTarget] = useState<SearchOption | null>(null);
  const [error, setError] = useState<string | null>(null);
  const merge = useMutation({
    mutationFn: () => api<{ data: { into: { name: string }; movedProducts: number } }>(`/brands/${brand.id}/merge`, { method: "POST", body: { intoId: target!.id } }),
    onSuccess: ({ data }) => {
      qc.invalidateQueries({ queryKey: ["brands"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      toast.show({ status: "success", title: `${brand.name} digabung ke ${data.into.name} · ${data.movedProducts} produk dipindah` });
      onDone();
    },
    onError: (e) => setError(readApiError(e).message),
  });
  return (
    <div className="flex flex-col gap-4">
      <p className="text-body-regular text-text-secondary">
        Semua produk bermerek <strong className="text-text-primary">{brand.name}</strong> ({formatNumber(brand.productCount)}) dipindah ke merek tujuan, lalu {brand.name} dihapus. Pakai untuk merapikan merek ganda atau salah ketik.
      </p>
      <SearchSelect
        label="Gabungkan ke merek"
        placeholder="Cari merek tujuan"
        queryKey={["brands", "merge", brand.id]}
        value={target}
        onChange={setTarget}
        search={async (q) =>
          (await api<Page>("/brands", { query: { q: q || undefined, pageSize: 20 } })).data
            .filter((b) => b.id !== brand.id)
            .map((b) => ({ id: b.id, name: b.name, hint: `${b.productCount} produk` }))
        }
      />
      {error && (
        <p role="alert" className="text-body-medium text-text-error-primary">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>
          Batal
        </Button>
        <Button type="button" onClick={() => merge.mutate()} disabled={!target || merge.isPending}>
          {merge.isPending ? "Menggabungkan…" : "Gabungkan"}
        </Button>
      </div>
    </div>
  );
}

export function BrandsView() {
  const { can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const url = useUrlState();
  const page = Number(url.get("page") ?? "1") || 1;
  const [search, setSearch] = useState(url.get("q") ?? "");
  const q = useDebounced(search.trim());
  const [editing, setEditing] = useState<{ brand: Brand | null } | null>(null);
  const [merging, setMerging] = useState<Brand | null>(null);
  const [deleting, setDeleting] = useState<Brand | null>(null);

  const list = useQuery({
    queryKey: ["brands", "list", q, page],
    queryFn: () => api<Page>("/brands", { query: { q: q || undefined, page, pageSize: PAGE_SIZE } }),
    placeholderData: keepPreviousData,
  });
  const remove = useMutation({
    mutationFn: (b: Brand) => api(`/brands/${b.id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["brands"] });
      toast.show({ status: "success", title: "Merek dihapus" });
      setDeleting(null);
    },
    onError: (e) => {
      toast.show({ status: "error", title: readApiError(e).message });
      setDeleting(null);
    },
  });

  const actions = (b: Brand) => (
    <span className="flex justify-end gap-1">
      {can("brand:update") && <Button size="xs" variant="ghost" iconOnly leadingIcon={RiEditLine} aria-label={`Ubah ${b.name}`} onClick={() => setEditing({ brand: b })} />}
      {can("brand:delete") && (
        <>
          <Button size="xs" variant="ghost" iconOnly leadingIcon={RiGitMergeLine} aria-label={`Gabungkan ${b.name}`} onClick={() => setMerging(b)} />
          <Button size="xs" variant="ghost" iconOnly leadingIcon={RiDeleteBinLine} aria-label={`Hapus ${b.name}`} onClick={() => setDeleting(b)} />
        </>
      )}
    </span>
  );

  const columns: Column<Brand>[] = [
    { id: "name", header: "Merek", isRowHeader: true, cell: (b) => <span className="text-body-medium text-text-primary">{b.name}</span> },
    {
      id: "products",
      header: "Produk",
      align: "end",
      cell: (b) =>
        b.productCount ? (
          <Link href={`/products?brand=${b.id}&brandName=${encodeURIComponent(b.name)}`} className="text-body-medium text-accent-600 tabular-nums hover:underline">
            {formatNumber(b.productCount)}
          </Link>
        ) : (
          <span className="text-body-medium text-text-tertiary">—</span>
        ),
    },
    { id: "actions", header: "", align: "end", cell: actions },
  ];

  return (
    <>
      <PageHeader
        title="Produk"
        description="Master merek dipakai semua kategori. Nama yang sama dengan beda huruf besar/kecil, spasi, atau tanda baca dianggap satu merek."
        actions={
          can("brand:create") && (
            <Button leadingIcon={RiAddLine} onClick={() => setEditing({ brand: null })}>
              Tambah merek
            </Button>
          )
        }
      />
      <ProductsNav />
      <DataTable
        label="Daftar merek"
        unit="merek"
        columns={columns}
        rows={list.data?.data}
        getRowId={(b) => b.id}
        isLoading={list.isFetching}
        total={list.data?.meta.total}
        page={page}
        pageCount={list.data?.meta.pageCount ?? 1}
        onPageChange={(p) => url.set({ page: p === 1 ? null : String(p) })}
        toolbar={
          <InputBase
            aria-label="Cari merek"
            placeholder="Cari merek"
            leadingIcon={RiSearchLine}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              url.set({ q: e.target.value || null, page: null });
            }}
            fieldClassName="w-full sm:w-64"
            size="small"
          />
        }
        empty={
          <>
            <RiPriceTag3Line className="size-6 text-foreground-icon-tertiary" aria-hidden />
            <p className="text-body-medium text-text-primary">{q ? `Tidak ada merek yang cocok dengan “${q}”.` : "Belum ada merek."}</p>
            <p className="text-body-regular text-text-tertiary">{q ? "Periksa ejaannya atau tambahkan merek baru." : "Tambahkan merek agar produk bisa difilter dan dilaporkan per merek."}</p>
          </>
        }
        renderMobile={(b) => (
          <div className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-body-medium text-text-primary">{b.name}</span>
              <span className="text-body-2-regular text-text-tertiary">{formatNumber(b.productCount)} produk</span>
            </span>
            {actions(b)}
          </div>
        )}
      />

      <Sheet isOpen={editing !== null} onClose={() => setEditing(null)} title={editing?.brand ? "Ubah merek" : "Tambah merek"}>
        {editing && <BrandForm key={editing.brand?.id ?? "new"} brand={editing.brand} onDone={() => setEditing(null)} />}
      </Sheet>
      <Sheet isOpen={merging !== null} onClose={() => setMerging(null)} title="Gabungkan merek">
        {merging && <MergeForm brand={merging} onDone={() => setMerging(null)} />}
      </Sheet>
      <ConfirmDialog
        isOpen={deleting !== null}
        onClose={() => setDeleting(null)}
        title={`Hapus merek ${deleting?.name ?? ""}?`}
        description={deleting?.productCount ? `Merek ini dipakai ${deleting.productCount} produk sehingga tidak bisa dihapus. Gunakan Gabungkan untuk memindahkan produknya.` : "Merek akan hilang dari pilihan. Tindakan ini tidak bisa dibatalkan."}
        confirmLabel="Hapus merek"
        onConfirm={() => deleting && remove.mutate(deleting)}
        pending={remove.isPending}
      />
    </>
  );
}
