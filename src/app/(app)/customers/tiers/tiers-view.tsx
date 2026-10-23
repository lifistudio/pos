"use client";

import { RiAddLine, RiDeleteBinLine, RiEditLine, RiVipCrown2Line } from "@remixicon/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { PageHeader, Skeleton } from "@/components/app/page-header";
import { useSession } from "@/components/app/session-context";
import { ConfirmDialog, Sheet } from "@/components/app/sheet";
import { useToast } from "@/components/app/toast";
import { api } from "@/lib/api-client";
import { readApiError } from "@/lib/form-errors";
import { formatNumber, formatRupiah } from "@/lib/format";
import { CustomersNav } from "../customers-nav";

type Tier = { id: string; name: string; minSpend: number; discountBps: number; pointsPer10k: number; memberCount: number };
const digits = (v: string) => v.replace(/[^\d]/g, "");

function TierForm({ tier, onDone }: { tier: Tier | null; onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [minSpend, setMinSpend] = useState(tier ? String(tier.minSpend) : "");
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => (tier ? api(`/membership-tiers/${tier.id}`, { method: "PATCH", body }) : api("/membership-tiers", { method: "POST", body })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tiers"] });
      qc.invalidateQueries({ queryKey: ["customers"] });
      toast.show({ status: "success", title: tier ? "Tier diperbarui" : "Tier ditambahkan", description: "Member otomatis ditempatkan ulang sesuai total belanja." });
      onDone();
    },
    onError: (e) => setError(readApiError(e).message),
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const pct = Number(String(f.get("discount") ?? "0").replace(",", "."));
    setError(null);
    save.mutate({ name: String(f.get("name")).trim(), minSpend: Number(minSpend || 0), discountBps: Math.round(pct * 100), pointsPer10k: Number(f.get("points") || 0) });
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Input name="name" label="Nama tier" placeholder="Gold" defaultValue={tier?.name} isRequired autoFocus />
      <Input
        label="Syarat total belanja (Rp)"
        inputMode="numeric"
        value={minSpend ? Number(minSpend).toLocaleString("id-ID") : ""}
        onChange={(v) => setMinSpend(digits(v))}
        placeholder="0"
        hint="Total belanja seumur hidup untuk masuk tier ini. Tier awal: 0."
      />
      <div className="grid grid-cols-2 gap-3">
        <Input name="discount" label="Diskon otomatis (%)" inputMode="decimal" defaultValue={tier ? String(tier.discountBps / 100) : "0"} hint="Maks 50%" />
        <Input name="points" label="Poin per Rp10.000" inputMode="numeric" defaultValue={tier ? String(tier.pointsPer10k) : "1"} />
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
          {save.isPending ? "Menyimpan…" : tier ? "Simpan" : "Tambah tier"}
        </Button>
      </div>
    </form>
  );
}

export function TiersView() {
  const { can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const tiers = useQuery({ queryKey: ["tiers"], queryFn: () => api<{ data: Tier[] }>("/membership-tiers").then((r) => r.data) });
  const [editing, setEditing] = useState<Tier | "new" | null>(null);
  const [deleting, setDeleting] = useState<Tier | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => api(`/membership-tiers/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tiers"] });
      toast.show({ status: "success", title: `Tier ${deleting?.name} dihapus` });
      setDeleting(null);
    },
    onError: (e) => {
      toast.show({ status: "error", title: readApiError(e).message });
      setDeleting(null);
    },
  });
  const canEdit = can("customer:update");

  return (
    <>
      <PageHeader
        title="Customer"
        description="Member naik tier otomatis saat total belanjanya melewati syarat. Diskon tier berlaku otomatis di kasir dan bisa digabung dengan voucher."
        actions={
          canEdit && (
            <Button leadingIcon={RiAddLine} onClick={() => setEditing("new")}>
              Tambah tier
            </Button>
          )
        }
      />
      <CustomersNav />
      {tiers.isPending ? (
        <Skeleton className="h-48 rounded-2xl" />
      ) : !tiers.data?.length ? (
        <div className="flex min-h-48 flex-col items-center justify-center gap-2 rounded-2xl border border-border-table px-6 py-10 text-center">
          <RiVipCrown2Line className="size-6 text-foreground-icon-tertiary" aria-hidden />
          <p className="text-body-medium text-text-primary">Belum ada tier member.</p>
          <p className="max-w-[48ch] text-body-regular text-text-tertiary">Buat tier awal dengan syarat Rp0 agar setiap member baru langsung mendapat poin.</p>
        </div>
      ) : (
        <ol className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {tiers.data.map((t, i) => (
            <li key={t.id} className="flex flex-col gap-4 rounded-2xl bg-background-secondary-default p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-caption-1-medium text-text-tertiary">Tingkat {i + 1}</p>
                  <p className="text-title-3-semibold text-text-primary">{t.name}</p>
                </div>
                {canEdit && (
                  <span className="flex gap-1">
                    <Button size="xs" variant="ghost" iconOnly leadingIcon={RiEditLine} aria-label={`Ubah ${t.name}`} onClick={() => setEditing(t)} />
                    <Button size="xs" variant="ghost" iconOnly leadingIcon={RiDeleteBinLine} aria-label={`Hapus ${t.name}`} onClick={() => setDeleting(t)} />
                  </span>
                )}
              </div>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-body-2-regular">
                <dt className="text-text-tertiary">Syarat belanja</dt>
                <dd className="text-end text-text-primary tabular-nums">{t.minSpend ? formatRupiah(t.minSpend) : "Langsung"}</dd>
                <dt className="text-text-tertiary">Diskon otomatis</dt>
                <dd className="text-end text-text-primary tabular-nums">{t.discountBps ? `${t.discountBps / 100}%` : "—"}</dd>
                <dt className="text-text-tertiary">Poin per Rp10.000</dt>
                <dd className="text-end text-text-primary tabular-nums">{t.pointsPer10k}</dd>
                <dt className="text-text-tertiary">Anggota</dt>
                <dd className="text-end text-text-primary tabular-nums">{formatNumber(t.memberCount)}</dd>
              </dl>
            </li>
          ))}
        </ol>
      )}
      <Sheet isOpen={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Tambah tier" : "Ubah tier"}>
        {editing !== null && <TierForm tier={editing === "new" ? null : editing} onDone={() => setEditing(null)} />}
      </Sheet>
      <ConfirmDialog
        isOpen={deleting !== null}
        onClose={() => setDeleting(null)}
        title={`Hapus tier ${deleting?.name ?? ""}?`}
        description={`${formatNumber(deleting?.memberCount ?? 0)} member akan dipindah ke tier lain sesuai total belanja mereka.`}
        confirmLabel="Hapus tier"
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </>
  );
}
