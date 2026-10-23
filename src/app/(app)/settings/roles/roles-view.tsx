"use client";

import { RiAddLine, RiDeleteBinLine, RiFileCopyLine, RiLockLine, RiShieldUserLine } from "@remixicon/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { PageHeader, Panel, Skeleton } from "@/components/app/page-header";
import { useSession } from "@/components/app/session-context";
import { ConfirmDialog, Sheet } from "@/components/app/sheet";
import { useToast } from "@/components/app/toast";
import { api } from "@/lib/api-client";
import { readApiError } from "@/lib/form-errors";
import { formatNumber } from "@/lib/format";
import { cx } from "@/utils/cx";
import { SettingsNav } from "../settings-nav";

type Role = { id: string; name: string; description: string | null; isSystem: boolean; permissions: string[]; userCount: number };
type Catalog = { resources: { key: string; label: string; actions: { key: string; label: string }[] }[] };

/** Matriks resource × aksi. Permission yang tidak dimiliki user saat ini tidak bisa diberikan (anti-eskalasi). */
function PermissionMatrix({
  catalog,
  value,
  onChange,
  readOnly,
  grantable,
}: {
  catalog: Catalog;
  value: Set<string>;
  onChange: (next: Set<string>) => void;
  readOnly: boolean;
  grantable: Set<string>;
}) {
  const toggle = (perm: string, on: boolean) => {
    const next = new Set(value);
    if (on) next.add(perm);
    else next.delete(perm);
    onChange(next);
  };
  return (
    <div className="flex flex-col divide-y divide-separator-border">
      {catalog.resources.map((r) => {
        const perms = r.actions.map((a) => `${r.key}:${a.key}`);
        const allowed = perms.filter((p) => grantable.has(p));
        const checkedCount = perms.filter((p) => value.has(p)).length;
        const allOn = allowed.length > 0 && allowed.every((p) => value.has(p));
        return (
          <div key={r.key} className="grid gap-2 py-3 md:grid-cols-[200px_1fr] md:items-center">
            <div className="flex items-center justify-between gap-2 md:justify-start">
              <Checkbox
                size="sm"
                isSelected={allOn}
                isIndeterminate={!allOn && checkedCount > 0}
                isDisabled={readOnly || allowed.length === 0}
                onChange={(on) => {
                  const next = new Set(value);
                  for (const p of allowed) {
                    if (on) next.add(p);
                    else next.delete(p);
                  }
                  onChange(next);
                }}
              >
                <span className="text-body-medium text-text-primary">{r.label}</span>
              </Checkbox>
              <span className="text-caption-1-regular text-text-tertiary tabular-nums md:hidden">
                {checkedCount}/{perms.length}
              </span>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-2 ps-6 md:ps-0">
              {r.actions.map((a) => {
                const perm = `${r.key}:${a.key}`;
                const blocked = !grantable.has(perm);
                return (
                  <Checkbox
                    key={perm}
                    size="sm"
                    isSelected={value.has(perm)}
                    isDisabled={readOnly || blocked}
                    onChange={(on) => toggle(perm, on)}
                    aria-label={`${r.label}: ${a.label}`}
                  >
                    <span className={cx("text-body-2-medium", blocked ? "text-text-tertiary" : "text-text-secondary")}>{a.label}</span>
                  </Checkbox>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function NewRoleSheet({ isOpen, onClose, copyFrom, onCreated }: { isOpen: boolean; onClose: () => void; copyFrom: Role | null; onCreated: (r: Role) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { can } = useSession();

  const create = useMutation({
    mutationFn: () =>
      api<{ data: Role }>("/roles", {
        method: "POST",
        // Hanya salin permission yang boleh diberikan oleh user saat ini.
        body: { name: name.trim(), description: description.trim() || null, permissions: (copyFrom?.permissions ?? []).filter(can) },
      }),
    onSuccess: ({ data }) => {
      qc.invalidateQueries({ queryKey: ["roles"] });
      toast.show({ status: "success", title: `Role ${data.name} dibuat` });
      setName("");
      setDescription("");
      onCreated(data);
    },
    onError: (e) => setError(readApiError(e).message),
  });

  return (
    <Sheet
      isOpen={isOpen}
      onClose={onClose}
      title={copyFrom ? `Duplikat ${copyFrom.name}` : "Role baru"}
      description={copyFrom ? "Permission disalin; ubah setelah role dibuat." : "Permission diatur setelah role dibuat."}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          create.mutate();
        }}
      >
        <Input label="Nama role" placeholder="Supervisor gudang" value={name} onChange={setName} isRequired autoFocus />
        <Input label="Deskripsi" placeholder="Apa tugas role ini?" value={description} onChange={setDescription} />
        {error && (
          <p role="alert" className="text-body-medium text-text-error-primary">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Batal
          </Button>
          <Button type="submit" disabled={create.isPending || name.trim().length < 2}>
            {create.isPending ? "Membuat…" : "Buat role"}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}

function RoleMatrixEditor({ role, catalog, grantable, readOnly }: { role: Role; catalog: Catalog; grantable: Set<string>; readOnly: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState(() => new Set(role.permissions));
  const dirty = role.permissions.length !== draft.size || role.permissions.some((p) => !draft.has(p));

  const save = useMutation({
    mutationFn: () => api<{ data: Role }>(`/roles/${role.id}`, { method: "PATCH", body: { permissions: [...draft] } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["roles"] });
      toast.show({ status: "success", title: `Akses ${role.name} disimpan`, description: "Berlaku pada permintaan berikutnya dari pengguna dengan role ini." });
    },
    onError: (e) => toast.show({ status: "error", title: readApiError(e).message }),
  });

  return (
    <>
      <PermissionMatrix catalog={catalog} value={draft} onChange={setDraft} readOnly={readOnly} grantable={grantable} />
      {!readOnly && (
        <div className="sticky bottom-0 -mx-4 -mb-4 mt-2 flex items-center justify-between gap-3 rounded-b-2xl border-t border-separator-border bg-background-secondary-default px-4 py-3">
          <span className="text-body-2-medium text-text-secondary tabular-nums">{draft.size} akses dipilih</span>
          <div className="flex gap-2">
            <Button size="small" variant="secondary" disabled={!dirty} onClick={() => setDraft(new Set(role.permissions))}>
              Batalkan
            </Button>
            <Button size="small" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? "Menyimpan…" : "Simpan akses"}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

export function RolesView() {
  const { can, me } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const roles = useQuery({ queryKey: ["roles"], queryFn: () => api<{ data: Role[] }>("/roles").then((r) => r.data) });
  const catalog = useQuery({ queryKey: ["permissions"], queryFn: () => api<{ data: Catalog }>("/permissions").then((r) => r.data), staleTime: Infinity });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = roles.data?.find((r) => r.id === selectedId) ?? roles.data?.[0] ?? null;
  const [creating, setCreating] = useState<{ copyFrom: Role | null } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const grantable = useMemo(() => new Set(me.permissions), [me.permissions]);

  const remove = useMutation({
    mutationFn: () => api(`/roles/${selected!.id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["roles"] });
      toast.show({ status: "success", title: `Role ${selected!.name} dihapus` });
      setSelectedId(null);
      setConfirmDelete(false);
    },
    onError: (e) => {
      setConfirmDelete(false);
      toast.show({ status: "error", title: readApiError(e).message });
    },
  });

  return (
    <>
      <PageHeader
        title="Pengaturan"
        description="Cabang, pengguna, hak akses, dan integrasi."
        actions={
          can("role:create") && (
            <Button leadingIcon={RiAddLine} onClick={() => setCreating({ copyFrom: null })}>
              Role baru
            </Button>
          )
        }
      />
      <SettingsNav />

      {roles.isPending || catalog.isPending ? (
        <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
          <Skeleton className="h-80 rounded-2xl" />
          <Skeleton className="h-[480px] rounded-2xl" />
        </div>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
          <Panel title="Role" className="lg:sticky lg:top-2">
            <ul className="-mx-2 flex flex-col gap-1" role="listbox" aria-label="Pilih role">
              {roles.data?.map((r) => {
                const active = r.id === selected?.id;
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={active}
                      onClick={() => setSelectedId(r.id)}
                      className={cx(
                        "flex w-full cursor-pointer items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-start outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring",
                        active ? "bg-background-primary-default shadow-card" : "hover:bg-background-secondary-hover",
                      )}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        {r.isSystem ? (
                          <RiLockLine className="size-4 shrink-0 text-foreground-icon-tertiary" aria-label="Terkunci" />
                        ) : (
                          <RiShieldUserLine className="size-4 shrink-0 text-foreground-icon-tertiary" aria-hidden />
                        )}
                        <span className="truncate text-body-medium text-text-primary">{r.name}</span>
                      </span>
                      <span className="shrink-0 text-body-2-regular text-text-tertiary tabular-nums">{formatNumber(r.userCount)} orang</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Panel>

          {selected && catalog.data && (
            <Panel>
              <div className="mb-2 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <h2 className="text-title-3-semibold text-text-primary">{selected.name}</h2>
                  <p className="mt-0.5 max-w-[60ch] text-body-2-regular text-text-secondary">
                    {selected.isSystem ? "Role sistem: selalu memiliki semua akses dan tidak bisa diubah atau dihapus." : selected.description || "Tanpa deskripsi."}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  {can("role:create") && (
                    <Button size="small" variant="secondary" leadingIcon={RiFileCopyLine} onClick={() => setCreating({ copyFrom: selected })}>
                      Duplikat
                    </Button>
                  )}
                  {!selected.isSystem && can("role:delete") && (
                    <Button
                      size="small"
                      variant="ghost"
                      iconOnly
                      leadingIcon={RiDeleteBinLine}
                      aria-label={`Hapus role ${selected.name}`}
                      onClick={() => setConfirmDelete(true)}
                    />
                  )}
                </div>
              </div>
              {!selected.isSystem && grantable.size < (catalog.data.resources.reduce((s, r) => s + r.actions.length, 0)) && (
                <p className="mb-1 text-body-2-regular text-text-tertiary">Akses yang redup tidak Anda miliki, jadi tidak bisa Anda berikan.</p>
              )}
              {/* key: draf permission dimulai ulang setiap kali role atau data tersimpannya berubah */}
              <RoleMatrixEditor
                key={`${selected.id}:${selected.permissions.join(",")}`}
                role={selected}
                catalog={catalog.data}
                grantable={grantable}
                readOnly={selected.isSystem || !can("role:update")}
              />
            </Panel>
          )}
        </div>
      )}

      <NewRoleSheet
        isOpen={creating !== null}
        copyFrom={creating?.copyFrom ?? null}
        onClose={() => setCreating(null)}
        onCreated={(r) => {
          setCreating(null);
          setSelectedId(r.id);
        }}
      />
      <ConfirmDialog
        isOpen={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Hapus role ${selected?.name ?? ""}?`}
        description={
          selected && selected.userCount > 0
            ? `Role ini masih dipakai ${selected.userCount} pengguna. Pindahkan mereka ke role lain terlebih dahulu.`
            : "Role akan dihapus permanen. Tindakan ini tercatat di audit log."
        }
        confirmLabel="Hapus role"
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </>
  );
}
