"use client";

import { RiAddLine, RiDeleteBinLine, RiEditLine, RiFolder3Line, RiFolderOpenLine } from "@remixicon/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { Select, SelectItem } from "@/components/base/select/select";
import { PageHeader, Skeleton } from "@/components/app/page-header";
import { useSession } from "@/components/app/session-context";
import { ConfirmDialog, Sheet } from "@/components/app/sheet";
import { useToast } from "@/components/app/toast";
import { api } from "@/lib/api-client";
import { readApiError } from "@/lib/form-errors";
import { formatNumber } from "@/lib/format";
import { ProductsNav } from "../products-nav";

type Category = { id: string; parentId: string | null; name: string; sortOrder: number; productCount: number };
type Node = Category & { depth: number; children: Node[] };

const MAX_DEPTH = 3;
const ROOT = "__root__";

/** Susun daftar flat dari API menjadi pohon (data kategori kecil, jadi diproses di client). */
function buildTree(rows: Category[]): Node[] {
  const byParent = new Map<string | null, Category[]>();
  for (const r of rows) byParent.set(r.parentId, [...(byParent.get(r.parentId) ?? []), r]);
  const walk = (parentId: string | null, depth: number): Node[] =>
    (byParent.get(parentId) ?? []).map((c) => ({ ...c, depth, children: walk(c.id, depth + 1) }));
  return walk(null, 1);
}

function flatten(nodes: Node[]): Node[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)]);
}

function CategoryForm({
  category,
  defaultParentId,
  options,
  onDone,
}: {
  category: Category | null;
  defaultParentId: string | null;
  options: Node[];
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [parentId, setParentId] = useState<string>(category?.parentId ?? defaultParentId ?? ROOT);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      category ? api(`/categories/${category.id}`, { method: "PATCH", body }) : api("/categories", { method: "POST", body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["categories"] });
      toast.show({ status: "success", title: category ? "Kategori diperbarui" : "Kategori ditambahkan" });
      onDone();
    },
    onError: (e) => setError(readApiError(e).message),
  });

  // Induk yang valid: tingkat < 3, dan bukan kategori ini sendiri atau turunannya.
  const blocked = new Set<string>();
  if (category) {
    const mark = (id: string) => {
      blocked.add(id);
      options.filter((o) => o.parentId === id).forEach((o) => mark(o.id));
    };
    mark(category.id);
  }
  const parents = options.filter((o) => o.depth < MAX_DEPTH && !blocked.has(o.id));

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    setError(null);
    save.mutate({ name: String(f.get("name")).trim(), parentId: parentId === ROOT ? null : parentId });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Input name="name" label="Nama kategori" placeholder="Atasan, Minuman dingin, Skincare…" defaultValue={category?.name} isRequired autoFocus />
      <div className="flex flex-col gap-1.5">
        <span className="text-body-medium text-text-secondary">Induk</span>
        <Select aria-label="Induk kategori" selectedKey={parentId} onSelectionChange={(k) => setParentId(String(k))} triggerClassName="w-full">
          <SelectItem id={ROOT} textValue="Tanpa induk">
            Tanpa induk (kategori utama)
          </SelectItem>
          {parents.map((p) => (
            <SelectItem key={p.id} id={p.id} textValue={p.name}>
              {"— ".repeat(p.depth - 1)}
              {p.name}
            </SelectItem>
          ))}
        </Select>
        <span className="text-body-2-regular text-text-tertiary">Maksimal {MAX_DEPTH} tingkat, misal Pakaian › Atasan › Kaos.</span>
      </div>
      {error && (
        <p role="alert" className="text-body-medium text-text-error-primary">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>
          Batal
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? "Menyimpan…" : category ? "Simpan" : "Tambah kategori"}
        </Button>
      </div>
    </form>
  );
}

export function CategoriesView() {
  const { can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const categories = useQuery({ queryKey: ["categories"], queryFn: () => api<{ data: Category[] }>("/categories").then((r) => r.data) });
  const tree = useMemo(() => buildTree(categories.data ?? []), [categories.data]);
  const flat = useMemo(() => flatten(tree), [tree]);
  const [editing, setEditing] = useState<{ category: Category | null; parentId: string | null } | null>(null);
  const [deleting, setDeleting] = useState<Node | null>(null);

  const remove = useMutation({
    mutationFn: (id: string) => api(`/categories/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["categories"] });
      toast.show({ status: "success", title: `Kategori ${deleting?.name} dihapus` });
      setDeleting(null);
    },
    onError: (e) => {
      toast.show({ status: "error", title: readApiError(e).message });
      setDeleting(null);
    },
  });

  return (
    <>
      <PageHeader
        title="Produk"
        description="Kelompokkan produk agar mudah dicari di kasir, difilter, dan dipakai sebagai syarat voucher."
        actions={
          can("category:create") && (
            <Button leadingIcon={RiAddLine} onClick={() => setEditing({ category: null, parentId: null })}>
              Tambah kategori
            </Button>
          )
        }
      />
      <ProductsNav />

      <section className="rounded-2xl border border-border-table">
        {categories.isPending ? (
          <div className="flex flex-col gap-2 p-3">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-11" />
            ))}
          </div>
        ) : flat.length === 0 ? (
          <div className="flex min-h-48 flex-col items-center justify-center gap-2 px-6 py-10 text-center">
            <RiFolder3Line className="size-6 text-foreground-icon-tertiary" aria-hidden />
            <p className="text-body-medium text-text-primary">Belum ada kategori.</p>
            <p className="text-body-regular text-text-tertiary">Mulai dari kelompok besar, misal Pakaian atau Minuman.</p>
          </div>
        ) : (
          <ul role="tree" aria-label="Kategori produk" className="divide-y divide-separator-border">
            {flat.map((n) => (
              <li key={n.id} role="treeitem" aria-level={n.depth} aria-selected={false} className="flex items-center gap-3 px-3 py-2.5">
                <span className="flex min-w-0 flex-1 items-center gap-2" style={{ paddingInlineStart: `${(n.depth - 1) * 24}px` }}>
                  {n.children.length ? (
                    <RiFolderOpenLine className="size-[18px] shrink-0 text-foreground-icon-tertiary" aria-hidden />
                  ) : (
                    <RiFolder3Line className="size-[18px] shrink-0 text-foreground-icon-tertiary" aria-hidden />
                  )}
                  <span className="truncate text-body-medium text-text-primary">{n.name}</span>
                </span>
                <Link
                  href={`/products?category=${n.id}`}
                  className="shrink-0 text-body-2-medium text-text-tertiary tabular-nums hover:text-text-secondary hover:underline"
                >
                  {formatNumber(n.productCount)} produk
                </Link>
                <span className="flex shrink-0 items-center gap-1">
                  {can("category:create") && n.depth < MAX_DEPTH && (
                    <Button
                      size="xs"
                      variant="ghost"
                      iconOnly
                      leadingIcon={RiAddLine}
                      aria-label={`Tambah sub-kategori di ${n.name}`}
                      onClick={() => setEditing({ category: null, parentId: n.id })}
                    />
                  )}
                  {can("category:update") && (
                    <Button size="xs" variant="ghost" iconOnly leadingIcon={RiEditLine} aria-label={`Ubah ${n.name}`} onClick={() => setEditing({ category: n, parentId: n.parentId })} />
                  )}
                  {can("category:delete") && (
                    <Button size="xs" variant="ghost" iconOnly leadingIcon={RiDeleteBinLine} aria-label={`Hapus ${n.name}`} onClick={() => setDeleting(n)} />
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Sheet isOpen={editing !== null} onClose={() => setEditing(null)} title={editing?.category ? "Ubah kategori" : "Tambah kategori"}>
        {editing && <CategoryForm category={editing.category} defaultParentId={editing.parentId} options={flat} onDone={() => setEditing(null)} />}
      </Sheet>
      <ConfirmDialog
        isOpen={deleting !== null}
        onClose={() => setDeleting(null)}
        title={`Hapus kategori ${deleting?.name ?? ""}?`}
        description={
          deleting && (deleting.children.length > 0 || deleting.productCount > 0)
            ? "Kategori ini masih punya sub-kategori atau produk. Pindahkan dulu, lalu hapus."
            : "Kategori kosong ini akan dihapus permanen."
        }
        confirmLabel="Hapus kategori"
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </>
  );
}
