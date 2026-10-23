"use client";

import { RiAddLine, RiEditLine, RiStore2Line } from "@remixicon/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Chip } from "@/components/base/badges/chip";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { Select, SelectItem } from "@/components/base/select/select";
import { Switch } from "@/components/base/switch/switch";
import { Textarea } from "@/components/base/textarea/textarea";
import { DataTable, type Column } from "@/components/app/data-table";
import { PageHeader } from "@/components/app/page-header";
import { useSession } from "@/components/app/session-context";
import { Sheet } from "@/components/app/sheet";
import { useToast } from "@/components/app/toast";
import { api } from "@/lib/api-client";
import { readApiError } from "@/lib/form-errors";
import { SettingsNav } from "../settings-nav";

type BranchType = "STORE" | "WAREHOUSE" | "ONLINE";
type Branch = {
  id: string;
  code: string;
  name: string;
  type: BranchType;
  address: string | null;
  phone: string | null;
  timezone: string;
  settings: { taxEnabled?: boolean; taxRateBps?: number; taxInclusive?: boolean; receiptHeader?: string; receiptFooter?: string };
  isActive: boolean;
};

export const BRANCH_TYPE: Record<BranchType, string> = { STORE: "Toko", WAREHOUSE: "Gudang", ONLINE: "Online" };
const TIMEZONES = [
  { id: "Asia/Jakarta", label: "WIB (Asia/Jakarta)" },
  { id: "Asia/Makassar", label: "WITA (Asia/Makassar)" },
  { id: "Asia/Jayapura", label: "WIT (Asia/Jayapura)" },
];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-body-medium text-text-secondary">{label}</span>
      {children}
    </div>
  );
}

function BranchForm({ branch, onDone }: { branch: Branch | null; onDone: () => void }) {
  const qc = useQueryClient();
  const router = useRouter();
  const toast = useToast();
  const [type, setType] = useState<BranchType>(branch?.type ?? "STORE");
  const [timezone, setTimezone] = useState(branch?.timezone ?? "Asia/Jakarta");
  const [active, setActive] = useState(branch?.isActive ?? true);
  const [taxEnabled, setTaxEnabled] = useState(branch?.settings.taxEnabled ?? false);
  const [taxInclusive, setTaxInclusive] = useState(branch?.settings.taxInclusive ?? true);
  const [error, setError] = useState<{ message: string; fields: Record<string, string> } | null>(null);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      branch ? api(`/branches/${branch.id}`, { method: "PATCH", body }) : api("/branches", { method: "POST", body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["branches"] });
      router.refresh(); // muat ulang daftar cabang di pemilih cabang
      toast.show({ status: "success", title: branch ? "Cabang diperbarui" : "Cabang ditambahkan" });
      onDone();
    },
    onError: (e) => setError(readApiError(e)),
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const rate = Number(String(f.get("taxRate") ?? "").replace(",", "."));
    setError(null);
    save.mutate({
      code: String(f.get("code")).trim(),
      name: String(f.get("name")).trim(),
      type,
      address: String(f.get("address") ?? "").trim() || null,
      phone: String(f.get("phone") ?? "").trim() || null,
      timezone,
      isActive: active,
      settings: {
        taxEnabled,
        taxInclusive,
        taxRateBps: taxEnabled && Number.isFinite(rate) ? Math.round(rate * 100) : 0,
        receiptHeader: String(f.get("receiptHeader") ?? ""),
        receiptFooter: String(f.get("receiptFooter") ?? ""),
      },
    });
  }

  const fe = error?.fields ?? {};
  return (
    <form id="branch-form" onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid grid-cols-[120px_1fr] gap-3">
        <Input name="code" label="Kode" placeholder="BDG" defaultValue={branch?.code} isRequired isInvalid={!!fe.code} hint={fe.code ?? "Muncul di nomor transaksi"} inputClassName="font-mono uppercase" />
        <Input name="name" label="Nama cabang" placeholder="Bandung — Dago" defaultValue={branch?.name} isRequired isInvalid={!!fe.name} hint={fe.name} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Tipe lokasi">
          <Select aria-label="Tipe lokasi" selectedKey={type} onSelectionChange={(k) => setType(k as BranchType)} triggerClassName="w-full">
            <SelectItem id="STORE" textValue="Toko">Toko (berjualan langsung)</SelectItem>
            <SelectItem id="WAREHOUSE" textValue="Gudang">Gudang (tidak berjualan)</SelectItem>
            <SelectItem id="ONLINE" textValue="Online">Online (stok kanal online)</SelectItem>
          </Select>
        </Field>
        <Field label="Zona waktu">
          <Select aria-label="Zona waktu" selectedKey={timezone} onSelectionChange={(k) => setTimezone(String(k))} triggerClassName="w-full">
            {TIMEZONES.map((t) => (
              <SelectItem key={t.id} id={t.id} textValue={t.label}>
                {t.label}
              </SelectItem>
            ))}
          </Select>
        </Field>
      </div>
      <Textarea name="address" label="Alamat" defaultValue={branch?.address ?? ""} rows={2} autoResize maxRows={4} />
      <Input name="phone" label="Telepon" type="tel" placeholder="0812…" defaultValue={branch?.phone ?? ""} />

      <fieldset className="flex flex-col gap-3 rounded-2xl bg-background-secondary-default p-4">
        <legend className="sr-only">Pajak</legend>
        <Switch isSelected={taxEnabled} onChange={setTaxEnabled} size="sm">
          <span className="text-body-medium text-text-primary">Kenakan PPN di cabang ini</span>
        </Switch>
        {taxEnabled && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Input name="taxRate" label="Tarif PPN (%)" inputMode="decimal" defaultValue={String((branch?.settings.taxRateBps ?? 1100) / 100)} />
            <Field label="Harga jual">
              <Select aria-label="Harga jual" selectedKey={taxInclusive ? "inc" : "exc"} onSelectionChange={(k) => setTaxInclusive(k === "inc")} triggerClassName="w-full">
                <SelectItem id="inc" textValue="Sudah termasuk PPN">Sudah termasuk PPN</SelectItem>
                <SelectItem id="exc" textValue="Belum termasuk PPN">Belum termasuk PPN</SelectItem>
              </Select>
            </Field>
          </div>
        )}
      </fieldset>

      <Textarea name="receiptHeader" label="Kepala struk" placeholder="Nama toko, alamat, NPWP" defaultValue={branch?.settings.receiptHeader ?? ""} rows={2} maxLength={500} />
      <Textarea name="receiptFooter" label="Kaki struk" placeholder="Terima kasih telah berbelanja" defaultValue={branch?.settings.receiptFooter ?? ""} rows={2} maxLength={500} />

      {branch && (
        <Switch isSelected={active} onChange={setActive} size="sm">
          <span className="text-body-medium text-text-primary">Cabang aktif</span>
        </Switch>
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
          {save.isPending ? "Menyimpan…" : branch ? "Simpan perubahan" : "Tambah cabang"}
        </Button>
      </div>
    </form>
  );
}

export function BranchesView() {
  const { can } = useSession();
  const [editing, setEditing] = useState<Branch | "new" | null>(null);
  const branches = useQuery({ queryKey: ["branches"], queryFn: () => api<{ data: Branch[] }>("/branches").then((r) => r.data) });

  const columns: Column<Branch>[] = [
    { id: "code", header: "Kode", className: "w-24", cell: (b) => <span className="font-mono text-body-medium text-text-primary">{b.code}</span> },
    {
      id: "name",
      header: "Cabang",
      isRowHeader: true,
      cell: (b) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-body-medium text-text-primary">{b.name}</span>
          {b.address && <span className="truncate text-body-2-regular text-text-tertiary">{b.address}</span>}
        </span>
      ),
    },
    { id: "type", header: "Tipe", cell: (b) => <span className="text-body-medium text-text-secondary">{BRANCH_TYPE[b.type]}</span> },
    { id: "tax", header: "PPN", cell: (b) => <span className="text-body-medium text-text-secondary">{b.settings.taxEnabled ? `${(b.settings.taxRateBps ?? 0) / 100}%` : "—"}</span> },
    {
      id: "status",
      header: "Status",
      cell: (b) => (
        <Chip variant="bold" color={b.isActive ? "lime" : "gray"}>
          {b.isActive ? "Aktif" : "Nonaktif"}
        </Chip>
      ),
    },
    {
      id: "actions",
      header: "",
      align: "end",
      className: "w-16",
      cell: (b) =>
        can("branch:update") && (
          <Button size="xs" variant="ghost" iconOnly leadingIcon={RiEditLine} aria-label={`Ubah ${b.name}`} onClick={() => setEditing(b)} />
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Pengaturan"
        description="Cabang, pengguna, hak akses, dan integrasi."
        actions={
          can("branch:create") && (
            <Button leadingIcon={RiAddLine} onClick={() => setEditing("new")}>
              Tambah cabang
            </Button>
          )
        }
      />
      <SettingsNav />
      <DataTable
        label="Daftar cabang"
        unit="cabang"
        columns={columns}
        rows={branches.data}
        getRowId={(b) => b.id}
        isLoading={branches.isFetching}
        total={branches.data?.length}
        page={1}
        pageCount={1}
        onPageChange={() => {}}
        onRowAction={can("branch:update") ? (b) => setEditing(b) : undefined}
        empty={
          <>
            <RiStore2Line className="size-6 text-foreground-icon-tertiary" aria-hidden />
            <p className="text-body-medium text-text-primary">Belum ada cabang.</p>
            <p className="text-body-regular text-text-tertiary">Tambahkan toko atau gudang pertama untuk mulai mencatat stok.</p>
          </>
        }
        renderMobile={(b) => (
          <button type="button" className="flex w-full items-center justify-between gap-3 text-start" onClick={() => can("branch:update") && setEditing(b)}>
            <span className="min-w-0">
              <span className="block truncate text-body-medium text-text-primary">{b.name}</span>
              <span className="text-body-2-regular text-text-tertiary">
                <span className="font-mono">{b.code}</span> · {BRANCH_TYPE[b.type]}
              </span>
            </span>
            <Chip variant="bold" color={b.isActive ? "lime" : "gray"}>
              {b.isActive ? "Aktif" : "Nonaktif"}
            </Chip>
          </button>
        )}
      />
      <Sheet
        isOpen={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "Tambah cabang" : "Ubah cabang"}
        description="Toko, gudang, atau lokasi stok kanal online."
      >
        {editing !== null && <BranchForm branch={editing === "new" ? null : editing} onDone={() => setEditing(null)} />}
      </Sheet>
    </>
  );
}
