"use client";

import { RiPrinterLine } from "@remixicon/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { Textarea } from "@/components/base/textarea/textarea";
import { Skeleton } from "@/components/app/page-header";
import { Sheet } from "@/components/app/sheet";
import { useToast } from "@/components/app/toast";
import { api } from "@/lib/api-client";
import { readApiError } from "@/lib/form-errors";
import { formatDateTime, formatNumber, formatRupiah } from "@/lib/format";
import { PAYMENT_LABEL } from "@/lib/pricing";

type Summary = {
  shift: { id: string; openingCash: number; openedAt: string; closedAt: string | null; countedCash: number | null };
  cashierName: string;
  branchName: string;
  paidCount: number;
  voidCount: number;
  revenue: number;
  taxTotal: number;
  payments: { method: string; amount: number; count: number }[];
  refundCount: number;
  refundTotal: number;
  cashRefund: number;
  expectedCash: number;
  difference?: number;
};

const digits = (v: string) => v.replace(/[^\d]/g, "");

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className={strong ? "text-body-medium text-text-primary" : "text-body-medium text-text-secondary"}>{label}</dt>
      <dd className={`tabular-nums ${strong ? "text-headline-semibold text-text-primary" : "text-body-medium text-text-primary"}`}>{value}</dd>
    </div>
  );
}

export function CloseShiftSheet({ isOpen, onClose, shiftId, branchId }: { isOpen: boolean; onClose: () => void; shiftId: string; branchId: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [closed, setClosed] = useState<Summary | null>(null);

  const summary = useQuery({
    queryKey: ["shift-summary", shiftId],
    queryFn: () => api<{ data: Summary }>(`/pos/shifts/${shiftId}`).then((r) => r.data),
    enabled: isOpen && !closed,
  });

  const close = useMutation({
    mutationFn: () => api<{ data: Summary }>(`/pos/shifts/${shiftId}/close`, { method: "POST", body: { countedCash: Number(counted || 0), note: note.trim() || null } }),
    onSuccess: ({ data }) => {
      setClosed(data);
      toast.show({ status: "success", title: "Shift ditutup" });
    },
    onError: (e) => setError(readApiError(e).message),
  });

  const s = closed ?? summary.data;
  const diff = closed ? (closed.difference ?? 0) : counted ? Number(counted) - (s?.expectedCash ?? 0) : null;

  return (
    <Sheet
      isOpen={isOpen}
      onClose={() => {
        if (closed) qc.invalidateQueries({ queryKey: ["pos-session", branchId] });
        onClose();
      }}
      title={closed ? "Shift selesai" : "Tutup shift"}
      description={s ? `${s.cashierName} · ${s.branchName} · mulai ${formatDateTime(s.shift.openedAt)}` : undefined}
    >
      {!s ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-40 rounded-2xl" />
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <dl className="flex flex-col gap-2 rounded-2xl bg-background-secondary-default p-4">
            <Row label="Transaksi berhasil" value={formatNumber(s.paidCount)} />
            {s.voidCount > 0 && <Row label="Transaksi dibatalkan" value={formatNumber(s.voidCount)} />}
            <Row label="Omzet" value={formatRupiah(s.revenue)} strong />
            {s.taxTotal > 0 && <Row label="Termasuk PPN" value={formatRupiah(s.taxTotal)} />}
            {s.refundCount > 0 && <Row label={`Retur · ${s.refundCount}×`} value={`−${formatRupiah(s.refundTotal)}`} />}
          </dl>

          <div>
            <h3 className="mb-2 text-body-medium text-text-secondary">Per metode bayar</h3>
            {s.payments.length === 0 ? (
              <p className="text-body-regular text-text-tertiary">Belum ada pembayaran di shift ini.</p>
            ) : (
              <dl className="flex flex-col gap-1.5">
                {s.payments.map((p) => (
                  <Row key={p.method} label={`${PAYMENT_LABEL[p.method] ?? p.method} · ${p.count}×`} value={formatRupiah(p.amount)} />
                ))}
              </dl>
            )}
          </div>

          <dl className="flex flex-col gap-1.5 border-t border-separator-border pt-4">
            <Row label="Kas awal" value={formatRupiah(s.shift.openingCash)} />
            {s.cashRefund > 0 && <Row label="Refund tunai keluar" value={`−${formatRupiah(s.cashRefund)}`} />}
            <Row label="Kas seharusnya di laci" value={formatRupiah(s.expectedCash)} strong />
          </dl>

          {closed ? (
            <div className="flex flex-col gap-3">
              <dl className="flex flex-col gap-1.5 rounded-2xl bg-background-secondary-default p-4">
                <Row label="Kas dihitung" value={formatRupiah(closed.shift.countedCash ?? 0)} />
                <Row label={diff === 0 ? "Selisih" : (diff ?? 0) > 0 ? "Lebih" : "Kurang"} value={formatRupiah(Math.abs(diff ?? 0))} strong />
              </dl>
              <Button variant="secondary" leadingIcon={RiPrinterLine} onClick={() => window.print()}>
                Cetak ringkasan
              </Button>
            </div>
          ) : (
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                setError(null);
                close.mutate();
              }}
            >
              <Input
                label="Kas yang dihitung di laci (Rp)"
                inputMode="numeric"
                placeholder="0"
                value={counted ? Number(counted).toLocaleString("id-ID") : ""}
                onChange={(v) => setCounted(digits(v))}
                isRequired
                inputClassName="text-title-3-semibold tabular-nums"
                hint={
                  diff === null
                    ? "Hitung semua uang tunai, termasuk kas awal."
                    : diff === 0
                      ? "Pas, tidak ada selisih."
                      : `${diff > 0 ? "Lebih" : "Kurang"} ${formatRupiah(Math.abs(diff))} dari seharusnya.`
                }
              />
              {diff !== null && diff !== 0 && (
                <Textarea label="Catatan selisih" placeholder="Misal: kembalian salah hitung" value={note} onChange={setNote} rows={2} />
              )}
              {error && (
                <p role="alert" className="text-body-medium text-text-error-primary">
                  {error}
                </p>
              )}
              <Button type="submit" disabled={!counted || close.isPending}>
                {close.isPending ? "Menutup…" : "Tutup shift"}
              </Button>
            </form>
          )}
        </div>
      )}
    </Sheet>
  );
}
