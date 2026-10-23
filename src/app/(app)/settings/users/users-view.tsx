"use client";

import { RiAddLine, RiDeleteBinLine, RiEditLine, RiSearchLine, RiTeamLine } from "@remixicon/react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Avatar } from "@/components/base/avatar/avatar";
import { Chip } from "@/components/base/badges/chip";
import { Button } from "@/components/base/buttons/button";
import { Input, InputBase } from "@/components/base/input/input";
import { Select, SelectItem } from "@/components/base/select/select";
import { Switch } from "@/components/base/switch/switch";
import { DataTable, type Column } from "@/components/app/data-table";
import { PageHeader } from "@/components/app/page-header";
import { useSession } from "@/components/app/session-context";
import { Sheet } from "@/components/app/sheet";
import { useToast } from "@/components/app/toast";
import { useDebounced, useUrlState } from "@/hooks/use-url-state";
import { api } from "@/lib/api-client";
import { readApiError } from "@/lib/form-errors";
import { SettingsNav } from "../settings-nav";

type Assignment = { roleId: string; roleName: string; branchId: string | null; branchName: string | null };
type User = { id: string; name: string; email: string; phone: string | null; isActive: boolean; assignments: Assignment[] };
type Role = { id: string; name: string; isSystem: boolean };
type Branch = { id: string; name: string; code: string };
type AssignmentDraft = { key: number; roleId: string | null; branchId: string };

const ALL = "__all__";
const initials = (name: string) => name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

function AssignmentChips({ items }: { items: Assignment[] }) {
  if (items.length === 0) return <span className="text-body-medium text-text-tertiary">Tanpa role</span>;
  return (
    <span className="flex flex-wrap gap-1.5">
      {items.map((a) => (
        <Chip key={`${a.roleId}-${a.branchId}`} variant="subtle" color="gray">
          {a.roleName} · {a.branchName ?? "Semua cabang"}
        </Chip>
      ))}
    </span>
  );
}

/** Daftar penugasan role per cabang. Satu orang bisa punya role berbeda di cabang berbeda. */
function AssignmentEditor({
  value,
  onChange,
  roles,
  branches,
  error,
}: {
  value: AssignmentDraft[];
  onChange: (v: AssignmentDraft[]) => void;
  roles: Role[];
  branches: Branch[];
  error?: string;
}) {
  const update = (key: number, patch: Partial<AssignmentDraft>) => onChange(value.map((a) => (a.key === key ? { ...a, ...patch } : a)));
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1.5 text-body-medium text-text-secondary">Role & cabang</legend>
      {value.map((a) => (
        <div key={a.key} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
          <Select aria-label="Role" placeholder="Pilih role" selectedKey={a.roleId} onSelectionChange={(k) => update(a.key, { roleId: k ? String(k) : null })} triggerClassName="w-full" size="sm">
            {roles.map((r) => (
              <SelectItem key={r.id} id={r.id} textValue={r.name}>
                {r.name}
              </SelectItem>
            ))}
          </Select>
          <Select aria-label="Cabang" selectedKey={a.branchId} onSelectionChange={(k) => update(a.key, { branchId: String(k) })} triggerClassName="w-full" size="sm">
            <SelectItem id={ALL} textValue="Semua cabang">
              Semua cabang
            </SelectItem>
            {branches.map((b) => (
              <SelectItem key={b.id} id={b.id} textValue={b.name}>
                {b.name}
              </SelectItem>
            ))}
          </Select>
          <Button
            type="button"
            size="small"
            variant="ghost"
            iconOnly
            leadingIcon={RiDeleteBinLine}
            aria-label="Hapus penugasan"
            onClick={() => onChange(value.filter((x) => x.key !== a.key))}
          />
        </div>
      ))}
      <Button
        type="button"
        size="small"
        variant="secondary"
        leadingIcon={RiAddLine}
        className="w-fit"
        onClick={() => onChange([...value, { key: Date.now(), roleId: null, branchId: ALL }])}
      >
        Tambah penugasan
      </Button>
      {error && <p className="text-body-2-medium text-text-error-primary">{error}</p>}
      <p className="text-body-2-regular text-text-tertiary">
        “Semua cabang” berlaku di setiap cabang, termasuk cabang yang ditambahkan nanti.
      </p>
    </fieldset>
  );
}

function UserForm({ user, roles, branches, onDone }: { user: User | null; roles: Role[]; branches: Branch[]; onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { me } = useSession();
  const [active, setActive] = useState(user?.isActive ?? true);
  const [assignments, setAssignments] = useState<AssignmentDraft[]>(
    user?.assignments.map((a, i) => ({ key: i, roleId: a.roleId, branchId: a.branchId ?? ALL })) ?? [{ key: 0, roleId: null, branchId: ALL }],
  );
  const [error, setError] = useState<{ message: string; fields: Record<string, string> } | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");

  const done = (title: string) => {
    qc.invalidateQueries({ queryKey: ["users"] });
    toast.show({ status: "success", title });
    onDone();
  };

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      user ? api(`/users/${user.id}`, { method: "PATCH", body }) : api("/users", { method: "POST", body }),
    onSuccess: () => done(user ? "Pengguna diperbarui" : "Pengguna ditambahkan"),
    onError: (e) => setError(readApiError(e)),
  });

  const reset = useMutation({
    mutationFn: (password: string) => api(`/users/${user!.id}/reset-password`, { method: "POST", body: { password } }),
    onSuccess: () => done("Password diatur ulang. Sampaikan password baru secara langsung ke pengguna."),
    onError: (e) => setError(readApiError(e)),
  });

  const resetPin = useMutation({
    mutationFn: () => api(`/users/${user!.id}/approval-pin`, { method: "DELETE" }),
    onSuccess: () => done("PIN persetujuan dihapus. Pengguna bisa mengatur PIN baru dari menu akun."),
    onError: (e) => setError(readApiError(e)),
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    setError(null);
    const valid = assignments.filter((a) => a.roleId);
    if (valid.length === 0) return setError({ message: "Pilih minimal satu role.", fields: {} });
    const unique = new Map(valid.map((a) => [`${a.roleId}:${a.branchId}`, { roleId: a.roleId!, branchId: a.branchId === ALL ? null : a.branchId }]));
    const common = {
      name: String(f.get("name")).trim(),
      phone: String(f.get("phone") ?? "").trim() || null,
      assignments: [...unique.values()],
    };
    save.mutate(user ? { ...common, isActive: active } : { ...common, email: String(f.get("email")).trim(), password: String(f.get("password")) });
  }

  const fe = error?.fields ?? {};
  const isSelf = user?.id === me.id;
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Input name="name" label="Nama" defaultValue={user?.name} isRequired isInvalid={!!fe.name} hint={fe.name} />
      {user ? (
        <div className="flex flex-col gap-1">
          <span className="text-body-medium text-text-secondary">Email</span>
          <span className="text-body-medium text-text-primary">{user.email}</span>
        </div>
      ) : (
        <Input name="email" type="email" label="Email" placeholder="nama@toko.com" isRequired isInvalid={!!fe.email} hint={fe.email ?? "Dipakai untuk masuk"} />
      )}
      <Input name="phone" type="tel" label="No. HP" placeholder="Opsional" defaultValue={user?.phone ?? ""} />
      {!user && (
        <Input
          name="password"
          type="password"
          label="Password awal"
          autoComplete="new-password"
          isRequired
          isInvalid={!!fe.password}
          hint={fe.password ?? "Minimal 10 karakter. Sampaikan langsung ke pengguna, jangan lewat chat grup."}
        />
      )}
      <AssignmentEditor value={assignments} onChange={setAssignments} roles={roles} branches={branches} error={fe.assignments} />

      {user && (
        <div className="flex flex-col gap-3 rounded-2xl bg-background-secondary-default p-4">
          <Switch isSelected={active} onChange={setActive} isDisabled={isSelf} size="sm">
            <span className="text-body-medium text-text-primary">Akun aktif</span>
          </Switch>
          <p className="text-body-2-regular text-text-tertiary">
            {isSelf ? "Anda tidak bisa menonaktifkan akun sendiri." : "Menonaktifkan akun langsung mengeluarkan pengguna dari semua perangkat."}
          </p>
          {!resetOpen ? (
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="small" variant="secondary" onClick={() => setResetOpen(true)}>
                Atur ulang password
              </Button>
              <Button type="button" size="small" variant="ghost" onClick={() => resetPin.mutate()} disabled={resetPin.isPending}>
                Hapus PIN persetujuan
              </Button>
            </div>
          ) : (
            <div className="flex items-end gap-2">
              <Input
                label="Password baru"
                type="password"
                autoComplete="new-password"
                size="small"
                className="flex-1"
                value={newPassword}
                onChange={setNewPassword}
                hint="Minimal 10 karakter"
              />
              <Button type="button" size="small" disabled={reset.isPending || newPassword.length < 10} onClick={() => reset.mutate(newPassword)}>
                Simpan password
              </Button>
            </div>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="text-body-medium text-text-error-primary">
          {error.message}
        </p>
      )}
      <div className="sticky -bottom-5 -mx-5 mt-2 flex justify-end gap-2 border-t border-separator-border bg-background-primary-default px-5 py-3">
        <Button type="button" variant="secondary" onClick={onDone}>
          Batal
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? "Menyimpan…" : user ? "Simpan perubahan" : "Tambah pengguna"}
        </Button>
      </div>
    </form>
  );
}

export function UsersView() {
  const { can } = useSession();
  const url = useUrlState();
  const [search, setSearch] = useState(url.get("q") ?? "");
  const q = useDebounced(search.trim());
  const page = Number(url.get("page") ?? 1);
  const [editing, setEditing] = useState<User | "new" | null>(null);

  const users = useQuery({
    queryKey: ["users", { q, page }],
    queryFn: () => api<{ data: User[]; meta: { total: number; pageCount: number } }>("/users", { query: { q, page, pageSize: 25 } }),
    placeholderData: keepPreviousData,
  });
  const roles = useQuery({ queryKey: ["roles"], queryFn: () => api<{ data: Role[] }>("/roles").then((r) => r.data), enabled: can("role:read") });
  const branches = useQuery({ queryKey: ["branches"], queryFn: () => api<{ data: Branch[] }>("/branches").then((r) => r.data) });
  const canEdit = can("user:update");

  const columns: Column<User>[] = [
    {
      id: "name",
      header: "Pengguna",
      isRowHeader: true,
      className: "w-[32%]",
      cell: (u) => (
        <span className="flex min-w-0 items-center gap-3">
          <Avatar size="sm" color="neutral" initials={initials(u.name)} />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-body-medium text-text-primary">{u.name}</span>
            <span className="truncate text-body-2-regular text-text-tertiary">{u.email}</span>
          </span>
        </span>
      ),
    },
    { id: "roles", header: "Role & cabang", cell: (u) => <AssignmentChips items={u.assignments} /> },
    {
      id: "status",
      header: "Status",
      className: "w-28",
      cell: (u) => (
        <Chip variant="bold" color={u.isActive ? "lime" : "gray"}>
          {u.isActive ? "Aktif" : "Nonaktif"}
        </Chip>
      ),
    },
    {
      id: "actions",
      header: "",
      align: "end",
      className: "w-16",
      cell: (u) => canEdit && <Button size="xs" variant="ghost" iconOnly leadingIcon={RiEditLine} aria-label={`Ubah ${u.name}`} onClick={() => setEditing(u)} />,
    },
  ];

  return (
    <>
      <PageHeader
        title="Pengaturan"
        description="Cabang, pengguna, hak akses, dan integrasi."
        actions={
          can("user:create") && (
            <Button leadingIcon={RiAddLine} onClick={() => setEditing("new")} disabled={!roles.data}>
              Tambah pengguna
            </Button>
          )
        }
      />
      <SettingsNav />
      <DataTable
        label="Daftar pengguna"
        unit="pengguna"
        columns={columns}
        rows={users.data?.data}
        getRowId={(u) => u.id}
        isLoading={users.isFetching}
        total={users.data?.meta.total}
        page={page}
        pageCount={users.data?.meta.pageCount ?? 1}
        onPageChange={(p) => url.set({ page: p })}
        onRowAction={canEdit ? (u) => setEditing(u) : undefined}
        toolbar={
          <InputBase
            aria-label="Cari nama atau email"
            placeholder="Cari nama atau email"
            leadingIcon={RiSearchLine}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              url.set({ q: e.target.value.trim() || null, page: null });
            }}
            fieldClassName="min-w-[220px] flex-1 rounded-full bg-background-secondary-default md:w-[260px] md:flex-none"
            className="text-body-medium"
          />
        }
        empty={
          q ? (
            <p className="text-body-medium text-text-primary">Tidak ada pengguna yang cocok dengan “{q}”.</p>
          ) : (
            <>
              <RiTeamLine className="size-6 text-foreground-icon-tertiary" aria-hidden />
              <p className="text-body-medium text-text-primary">Belum ada pengguna lain.</p>
              <p className="text-body-regular text-text-tertiary">Tambahkan kasir, kepala toko, atau tim stok dan tentukan cabangnya.</p>
            </>
          )
        }
        renderMobile={(u) => (
          <button type="button" className="flex w-full items-start gap-3 text-start" onClick={() => canEdit && setEditing(u)}>
            <Avatar size="sm" color="neutral" initials={initials(u.name)} />
            <span className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="flex items-center justify-between gap-2">
                <span className="truncate text-body-medium text-text-primary">{u.name}</span>
                {!u.isActive && <span className="text-caption-1-regular text-text-tertiary">Nonaktif</span>}
              </span>
              <AssignmentChips items={u.assignments} />
            </span>
          </button>
        )}
      />
      <Sheet
        isOpen={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "Tambah pengguna" : "Ubah pengguna"}
        description="Hak akses mengikuti role di tiap cabang."
      >
        {editing !== null && roles.data && branches.data && (
          <UserForm user={editing === "new" ? null : editing} roles={roles.data} branches={branches.data} onDone={() => setEditing(null)} />
        )}
      </Sheet>
    </>
  );
}
