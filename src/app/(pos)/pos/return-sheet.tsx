"use client";

import { RiArrowLeftSLine, RiSearchLine } from "@remixicon/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/base/buttons/button";
import { InputBase } from "@/components/base/input/input";
import { ReturnForm, type ReturnableSale } from "@/components/app/return-form";
import { Sheet } from "@/components/app/sheet";
import { useToast } from "@/components/app/toast";
import { api } from "@/lib/api-client";
import { readApiError } from "@/lib/form-errors";
import { formatDateTime, formatRupiah } from "@/lib/format";
import { PAYMENT_LABEL } from "@/lib/pricing";

type FoundSale = ReturnableSale & { status: "PENDING" | "PAID" | "VOIDED"; createdAt: string; branchId: string; branch: { name: string } };

/** Retur di kasir: cari struk lewat nomor (ketik atau scan), pilih barang, uang tunai keluar dari laci shift ini. */
export function ReturnSheet({ isOpen, onClose, branchId, shiftId }: { isOpen: boolean; onClose: () => void; branchId: string; shiftId: string }) {
  return (
    <Sheet isOpen={isOpen} onClose={onClose} title="Retur barang" description="Cari struk pelanggan, pilih barang yang dikembalikan, lalu serahkan uangnya.">
      {isOpen && <ReturnFlow onClose={onClose} branchId={branchId} shiftId={shiftId} />}
    </Sheet>
  );
}

function ReturnFlow({ onClose, branchId, shiftId }: { onClose: () => void; branchId: string; shiftId: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [number, setNumber] = useState("");
  const [sale, setSale] = useState<FoundSale | null>(null);
  const [error, setError] = useState<string | null>(null);

  const find = useMutation({
    mutationFn: (n: string) => api<{ data: FoundSale }>("/sales/lookup", { query: { number: n } }).then((r) => r.data),
    onSuccess: (s) => {
      if (s.status !== "PAID") return setError(s.status === "PENDING" ? "Transaksi ini masih menunggu pembayaran QRIS." : "Transaksi ini sudah dibatalkan (void), tidak bisa diretur.");
      if (s.branchId !== branchId) return setError(`Struk ini dari ${s.branch.name}. Retur diproses di cabang tempat membeli.`);
      setSale(s);
    },
    onError: (e) => setError(readApiError(e, "Struk tidak ditemukan.").message),
  });

  if (sale) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-2">
          <Button size="small" variant="ghost" iconOnly leadingIcon={RiArrowLeftSLine} aria-label="Cari struk lain" onClick={() => setSale(null)} />
          <div className="min-w-0">
            <p className="font-mono text-body-medium text-text-primary">{sale.number}</p>
            <p className="text-body-2-regular text-text-tertiary">
              {formatDateTime(sale.createdAt)} · {formatRupiah(sale.total)} · {sale.payments.map((p) => PAYMENT_LABEL[p.method] ?? p.method).join(", ")}
              {sale.customer && ` · ${sale.customer.name}`}
              {sale.refundTotal > 0 && ` · sudah dikembalikan ${formatRupiah(sale.refundTotal)}`}
            </p>
          </div>
        </div>
        <ReturnForm
          sale={sale}
          onCancel={() => setSale(null)}
          onDone={(ret) => {
            qc.invalidateQueries({ queryKey: ["pos-catalog"] });
            qc.invalidateQueries({ queryKey: ["shift-sales", shiftId] });
            toast.show({ status: "success", title: `${ret.number} tersimpan`, description: `Serahkan ${formatRupiah(ret.refundAmount)} (${PAYMENT_LABEL[ret.refundMethod] ?? ret.refundMethod}) ke pelanggan.` });
            onClose();
          }}
        />
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        if (number.trim()) find.mutate(number.trim());
      }}
    >
      <div className="flex gap-2">
        <InputBase
          aria-label="Nomor struk"
          placeholder="INV/BDG/261018/0001"
          leadingIcon={RiSearchLine}
          value={number}
          onChange={(e) => setNumber(e.target.value.toUpperCase())}
          autoFocus
          fieldClassName="flex-1"
          className="font-mono placeholder:font-sans"
        />
        <Button type="submit" disabled={!number.trim() || find.isPending}>
          {find.isPending ? "Mencari…" : "Cari"}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-body-medium text-text-error-primary">
          {error}
        </p>
      )}
      <p className="text-body-2-regular text-text-tertiary">Nomor struk tercetak di bagian atas struk. Retur tunai mengurangi kas seharusnya di shift ini.</p>
    </form>
  );
}
