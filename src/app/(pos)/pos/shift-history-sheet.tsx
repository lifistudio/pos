"use client";

import { RiPrinterLine } from "@remixicon/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Chip } from "@/components/base/badges/chip";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { Skeleton } from "@/components/app/page-header";
import { useSession } from "@/components/app/session-context";
import { useApproval } from "@/components/app/approval-dialog";
import { useReceiptPrinter } from "@/components/app/printing/use-receipt-printer";
import { Sheet } from "@/components/app/sheet";
import { useToast } from "@/components/app/toast";
import { api } from "@/lib/api-client";
import { readApiError } from "@/lib/form-errors";
import { formatRupiah } from "@/lib/format";
import { PAYMENT_LABEL } from "@/lib/pricing";

type Row = { id: string; number: string; status: "PENDING" | "PAID" | "VOIDED"; total: number; createdAt: string; itemQty: number; methods: string[] | null };

const time = (v: string) => new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit" }).format(new Date(v));

/** Transaksi di shift berjalan: cetak ulang struk, dan void bagi yang berwenang (mis. kepala toko). */
export function ShiftHistorySheet({ isOpen, onClose, shiftId, branchId }: { isOpen: boolean; onClose: () => void; shiftId: string; branchId: string }) {
  const { can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const printer = useReceiptPrinter();
  const [voiding, setVoiding] = useState<Row | null>(null);
  const [reason, setReason] = useState("");

  const sales = useQuery({
    queryKey: ["shift-sales", shiftId],
    queryFn: () => api<{ data: Row[] }>("/sales", { query: { shiftId, pageSize: 100 } }).then((r) => r.data),
    enabled: isOpen,
  });

  const approval = useApproval();
  const voidSale = useMutation({
    mutationFn: async (id: string) => {
      let approvalId: string | null = null;
      if (!can("pos:void")) {
        approvalId = await approval.request("pos:void", branchId);
        if (!approvalId) return null;
      }
      return api(`/sales/${id}/void`, { method: "POST", headers: approvalId ? { "x-approval-id": approvalId } : undefined, body: { reason: reason.trim() } });
    },
    onSuccess: (r) => {
      if (r === null) return;
      toast.show({ status: "success", title: `Transaksi ${voiding?.number} dibatalkan`, description: "Stok sudah dikembalikan." });
      setVoiding(null);
      setReason("");
      qc.invalidateQueries({ queryKey: ["shift-sales", shiftId] });
      qc.invalidateQueries({ queryKey: ["pos-catalog"] });
    },
    onError: (e) => toast.show({ status: "error", title: readApiError(e).message }),
  });

  return (
    <Sheet isOpen={isOpen} onClose={onClose} title="Transaksi shift ini" description="Cetak ulang struk atau batalkan transaksi sebelum shift ditutup.">
      {sales.isPending ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      ) : !sales.data?.length ? (
        <p className="py-10 text-center text-body-regular text-text-tertiary">Belum ada transaksi di shift ini.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-separator-border">
          {sales.data.map((s) => (
            <li key={s.id} className="flex flex-col gap-2 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-body-2-medium text-text-primary">{s.number}</p>
                  <p className="text-body-2-regular text-text-tertiary">
                    {time(s.createdAt)} · {s.itemQty} item · {(s.methods ?? []).map((m) => PAYMENT_LABEL[m] ?? m).join(", ")}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className={`text-body-medium tabular-nums ${s.status === "VOIDED" ? "text-text-tertiary line-through" : "text-text-primary"}`}>
                    {formatRupiah(s.total)}
                  </span>
                  {s.status === "VOIDED" && (
                    <Chip variant="subtle" color="rose">
                      Dibatalkan
                    </Chip>
                  )}
                  {s.status === "PENDING" && (
                    <Chip variant="subtle" color="yellow">
                      Menunggu QRIS
                    </Chip>
                  )}
                </div>
              </div>
              {voiding?.id === s.id ? (
                <form
                  className="flex items-end gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    voidSale.mutate(s.id);
                  }}
                >
                  <Input label="Alasan pembatalan" placeholder="Salah input barang" value={reason} onChange={setReason} size="small" className="flex-1" autoFocus />
                  <Button type="submit" size="small" variant="danger" disabled={reason.trim().length < 3 || voidSale.isPending}>
                    Batalkan
                  </Button>
                  <Button type="button" size="small" variant="secondary" onClick={() => setVoiding(null)}>
                    Tidak
                  </Button>
                </form>
              ) : (
                <div className="flex gap-2">
                  <Button
                    size="xs"
                    variant="secondary"
                    leadingIcon={RiPrinterLine}
                    disabled={printer.busy}
                    onClick={() => printer.printSale(s.id)}
                  >
                    Struk
                  </Button>
                  {s.status === "PAID" && (
                    <Button size="xs" variant="ghost" onClick={() => setVoiding(s)}>
                      Batalkan transaksi
                    </Button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {approval.dialog}
    </Sheet>
  );
}
