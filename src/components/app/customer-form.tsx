"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Chip } from "@/components/base/badges/chip";
import { Button } from "@/components/base/buttons/button";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import { Input } from "@/components/base/input/input";
import { Textarea } from "@/components/base/textarea/textarea";
import { api } from "@/lib/api-client";
import { readApiError } from "@/lib/form-errors";

export type CustomerRow = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  isMember: boolean;
  memberNo: string | null;
  tierName: string | null;
  tierDiscountBps: number | null;
  points: number;
  totalSpent: number;
  visitCount: number;
  lastVisitAt: string | null;
};

export type CustomerDetail = CustomerRow & {
  birthDate: string | null;
  notes: string | null;
  consentAt: string | null;
  recentSales: { id: string; number: string; total: number; status: string; createdAt: string; branchName: string; voucherCode: string | null; pointsEarned: number }[];
  pointHistory: { id: string; type: string; change: number; balanceAfter: number; reason: string | null; createdAt: string }[];
};

/** 6281234567001 → 0812-3456-7001 untuk tampilan. */
export const displayPhone = (p: string) => {
  const local = p.startsWith("62") ? "0" + p.slice(2) : p;
  return local.replace(/^(\d{4})(\d{4})(\d+)$/, "$1-$2-$3");
};

export function MemberChip({ c }: { c: Pick<CustomerRow, "isMember" | "tierName"> }) {
  if (!c.isMember) return <span className="text-body-2-regular text-text-tertiary">Non-member</span>;
  return (
    <Chip variant="subtle" color="purple">
      {c.tierName ?? "Member"}
    </Chip>
  );
}

/** Form customer; dipakai juga oleh layar kasir untuk daftar cepat. */
export function CustomerForm({
  customer,
  onSaved,
  onCancel,
  compact = false,
}: {
  customer: CustomerDetail | null;
  onSaved: (c: CustomerDetail) => void;
  onCancel: () => void;
  compact?: boolean;
}) {
  const qc = useQueryClient();
  const [isMember, setIsMember] = useState(customer?.isMember ?? true);
  const [consent, setConsent] = useState(!!customer?.consentAt);
  const [error, setError] = useState<{ message: string; fields: Record<string, string> } | null>(null);
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      customer ? api<{ data: CustomerDetail }>(`/customers/${customer.id}`, { method: "PATCH", body }) : api<{ data: CustomerDetail }>("/customers", { method: "POST", body }),
    onSuccess: ({ data }) => {
      qc.invalidateQueries({ queryKey: ["customers"] });
      qc.setQueryData(["customer", data.id], data);
      onSaved(data);
    },
    onError: (e) => setError(readApiError(e)),
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    setError(null);
    save.mutate({
      name: String(f.get("name")).trim(),
      phone: String(f.get("phone")).trim(),
      email: String(f.get("email") ?? "").trim() || null,
      birthDate: String(f.get("birthDate") ?? "") || null,
      notes: compact ? undefined : String(f.get("notes") ?? "").trim() || null,
      isMember,
      consent,
    });
  }

  const fe = error?.fields ?? {};
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Input name="name" label="Nama" defaultValue={customer?.name} isRequired autoFocus isInvalid={!!fe.name} hint={fe.name} />
      <Input name="phone" label="No. HP" type="tel" placeholder="0812 3456 7890" defaultValue={customer ? displayPhone(customer.phone) : ""} isRequired isInvalid={!!fe.phone} hint={fe.phone ?? "Dipakai untuk mencari customer di kasir."} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Input name="email" type="email" label="Email" placeholder="Opsional" defaultValue={customer?.email ?? ""} isInvalid={!!fe.email} hint={fe.email} />
        <Input name="birthDate" type="date" label="Tanggal lahir" defaultValue={customer?.birthDate ?? ""} hint="Untuk voucher ulang tahun" />
      </div>
      {!compact && <Textarea name="notes" label="Catatan" defaultValue={customer?.notes ?? ""} rows={2} />}
      <div className="flex flex-col gap-3 rounded-2xl bg-background-secondary-default p-4">
        <Checkbox size="sm" isSelected={isMember} onChange={setIsMember} isDisabled={!!customer?.isMember}>
          <span className="text-body-medium text-text-primary">Daftarkan sebagai member</span>
        </Checkbox>
        {isMember && !customer?.consentAt && (
          <Checkbox size="sm" isSelected={consent} onChange={setConsent}>
            <span className="text-body-2-regular text-text-secondary">
              Customer setuju nama, nomor HP, dan riwayat belanjanya disimpan untuk program member.
            </span>
          </Checkbox>
        )}
      </div>
      {error && (
        <p role="alert" className="text-body-medium text-text-error-primary">
          {error.message}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Batal
        </Button>
        <Button type="submit" disabled={save.isPending || (isMember && !customer?.consentAt && !consent)}>
          {save.isPending ? "Menyimpan…" : customer ? "Simpan" : "Daftarkan"}
        </Button>
      </div>
    </form>
  );
}

