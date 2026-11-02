"use client";

import { RiAddLine, RiSubtractLine } from "@remixicon/react";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/base/buttons/button";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import { Input } from "@/components/base/input/input";
import { Select, SelectItem } from "@/components/base/select/select";
import { useApproval } from "@/components/app/approval-dialog";
import { useSession } from "@/components/app/session-context";
import { api } from "@/lib/api-client";
import { readApiError } from "@/lib/form-errors";
import { formatNumber, formatRupiah } from "@/lib/format";
import { PAYMENT_LABEL } from "@/lib/pricing";
import { computeReturn } from "@/lib/returns";

export type ReturnableSale = {
  id: string;
  branchId: string;
  number: string;
  subtotal: number;
  total: number;
  /** Ongkir order online — tidak ikut dikembalikan. */
  shippingFee?: number;
  refundTotal: number;
  pointsEarned: number;
  pointsRedeemed: number;
  customer: { name: string } | null;
  items: { id: string; productName: string; variantTitle: string; sku: string; qty: number; returnedQty: number; unitPrice: number; lineTotal: number }[];
  payments: { method: string }[];
};

export const RETURN_REASONS = {
  SIZE: "Ukuran tidak pas",
  DEFECT: "Cacat/rusak",
  WRONG_ITEM: "Salah barang",
  NOT_AS_DESCRIBED: "Tidak sesuai deskripsi",
  CHANGED_MIND: "Berubah pikiran",
  OTHER: "Lainnya",
} as const;
export type ReturnReason = keyof typeof RETURN_REASONS;

export type CreatedReturn = { id: string; number: string; refundAmount: number; refundMethod: string };

/**
 * Form retur atas satu struk. Pratinjau uang kembali & poin memakai rumus yang sama dengan server
 * (lib/returns); server tetap menghitung ulang dan menjadi sumber kebenaran.
 */
export function ReturnForm({ sale, onDone, onCancel }: { sale: ReturnableSale; onDone: (ret: CreatedReturn) => void; onCancel: () => void }) {
  const open = sale.items.filter((i) => i.qty > i.returnedQty);
  const [qty, setQty] = useState<Record<string, number>>(() => (open.length === 1 && open[0].qty - open[0].returnedQty === 1 ? { [open[0].id]: 1 } : {}));
  const [damaged, setDamaged] = useState<Record<string, boolean>>({});
  const methods = ["CASH", ...new Set(sale.payments.map((p) => p.method).filter((m) => m !== "CASH"))];
  const [method, setMethod] = useState(methods.includes(sale.payments[0]?.method) ? sale.payments[0].method : "CASH");
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [reasonCode, setReasonCode] = useState<ReturnReason | null>(null);
  const { can } = useSession();
  const approval = useApproval();
  const [error, setError] = useState<string | null>(null);

  const picks = Object.entries(qty)
    .filter(([, n]) => n > 0)
    .map(([saleItemId, n]) => ({ saleItemId, qty: n }));
  const calc = computeReturn({ ...sale, total: sale.total - (sale.shippingFee ?? 0) }, sale.items, picks);

  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const submit = useMutation({
    mutationFn: async () => {
      // Tanpa hak retur: kepala toko menyetujui dengan PIN di perangkat ini.
      let approvalId: string | null = null;
      if (!can("pos:refund")) {
        approvalId = await approval.request("pos:refund", sale.branchId);
        if (!approvalId) return null;
      }
      return api<{ data: CreatedReturn }>(`/sales/${sale.id}/returns`, {
        method: "POST",
        headers: { "idempotency-key": idempotencyKey, ...(approvalId ? { "x-approval-id": approvalId } : {}) },
        body: {
          items: picks.map((p) => ({ ...p, restock: !damaged[p.saleItemId] })),
          refundMethod: method,
          reasonCode,
          reason: reason.trim(),
          reference: method === "CASH" ? null : reference.trim() || null,
        },
      });
    },
    onSuccess: (r) => r && onDone(r.data),
    onError: (e) => setError(readApiError(e).message),
  });

  if (open.length === 0) return <p className="text-body-regular text-text-secondary">Semua barang di struk ini sudah diretur.</p>;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        submit.mutate();
      }}
    >
      <ul className="flex flex-col divide-y divide-separator-border">
        {open.map((i) => {
          const left = i.qty - i.returnedQty;
          const n = qty[i.id] ?? 0;
          const set = (v: number) => setQty((q) => ({ ...q, [i.id]: Math.max(0, Math.min(left, v)) }));
          return (
            <li key={i.id} className="flex flex-col gap-2 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-body-medium text-text-primary">
                    {i.productName}
                    {i.variantTitle !== "Default" && <span className="text-text-tertiary"> · {i.variantTitle}</span>}
                  </p>
                  <p className="text-body-2-regular text-text-tertiary">
                    Dibeli {i.qty}
                    {i.returnedQty > 0 && `, sudah diretur ${i.returnedQty}`} · {formatRupiah(Math.floor(i.lineTotal / i.qty))}/pcs setelah diskon
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button type="button" size="small" variant="secondary" iconOnly leadingIcon={RiSubtractLine} aria-label={`Kurangi retur ${i.productName}`} disabled={n === 0} onClick={() => set(n - 1)} />
                  <span className="min-w-8 text-center text-body-medium text-text-primary tabular-nums" aria-label={`Retur ${n} dari ${left}`}>
                    {n}
                  </span>
                  <Button type="button" size="small" variant="secondary" iconOnly leadingIcon={RiAddLine} aria-label={`Tambah retur ${i.productName}`} disabled={n >= left} onClick={() => set(n + 1)} />
                </div>
              </div>
              {n > 0 && (
                <Checkbox size="sm" isSelected={!!damaged[i.id]} onChange={(v) => setDamaged((d) => ({ ...d, [i.id]: v }))}>
                  <span className="text-body-2-regular text-text-secondary">Rusak/cacat — tidak dikembalikan ke stok</span>
                </Checkbox>
              )}
            </li>
          );
        })}
      </ul>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <span className="text-body-medium text-text-secondary">Uang dikembalikan lewat</span>
          <Select aria-label="Metode refund" selectedKey={method} onSelectionChange={(k) => setMethod(String(k))} triggerClassName="w-full">
            {methods.map((m) => (
              <SelectItem key={m} id={m} textValue={PAYMENT_LABEL[m] ?? m}>
                {PAYMENT_LABEL[m] ?? m}
              </SelectItem>
            ))}
          </Select>
        </div>
        {method !== "CASH" && <Input label="No. referensi refund" placeholder="Opsional" value={reference} onChange={setReference} />}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <span className="text-body-medium text-text-secondary">Alasan</span>
          <Select aria-label="Alasan retur" placeholder="Pilih alasan" selectedKey={reasonCode} onSelectionChange={(k) => setReasonCode(k as ReturnReason)} triggerClassName="w-full">
            {(Object.keys(RETURN_REASONS) as ReturnReason[]).map((k) => (
              <SelectItem key={k} id={k} textValue={RETURN_REASONS[k]}>
                {RETURN_REASONS[k]}
              </SelectItem>
            ))}
          </Select>
        </div>
        <Input label="Keterangan" placeholder="Mis. kekecilan, jahitan lepas…" value={reason} onChange={setReason} isRequired />
      </div>

      <dl className="flex flex-col gap-1.5 rounded-2xl bg-background-secondary-default p-4 text-body-medium">
        <div className="flex items-baseline justify-between">
          <dt className="text-text-primary">Uang kembali</dt>
          <dd className="text-title-3-semibold text-text-primary tabular-nums">{formatRupiah(calc.refund)}</dd>
        </div>
        {sale.customer && (calc.pointsReversed > 0 || calc.pointsRestored > 0) && (
          <p className="text-body-2-regular text-text-tertiary">
            {[calc.pointsRestored > 0 && `${formatNumber(calc.pointsRestored)} poin yang ditukar dikembalikan`, calc.pointsReversed > 0 && `${formatNumber(calc.pointsReversed)} poin dari transaksi ditarik`]
              .filter(Boolean)
              .join(" · ")}
          </p>
        )}
        {method === "CASH" && calc.refund > 0 && <p className="text-body-2-regular text-text-tertiary">Diambil dari laci kasir shift Anda yang sedang buka.</p>}
        {calc.isFull && <p className="text-body-2-regular text-text-tertiary">Retur penuh: kuota voucher (bila ada) dikembalikan.</p>}
      </dl>

      {error && (
        <p role="alert" className="text-body-medium text-text-error-primary">
          {error}
        </p>
      )}
      {!can("pos:refund") && <p className="text-caption-1-regular text-text-tertiary">Retur butuh persetujuan PIN kepala toko.</p>}
      {approval.dialog}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Batal
        </Button>
        <Button type="submit" disabled={picks.length === 0 || !reasonCode || reason.trim().length < 3 || submit.isPending}>
          {submit.isPending ? "Memproses…" : `Proses retur ${formatRupiah(calc.refund)}`}
        </Button>
      </div>
    </form>
  );
}
