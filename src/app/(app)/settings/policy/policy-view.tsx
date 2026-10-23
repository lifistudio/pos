"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { PageHeader, Panel, Skeleton } from "@/components/app/page-header";
import { useSession } from "@/components/app/session-context";
import { useToast } from "@/components/app/toast";
import { api } from "@/lib/api-client";
import { readApiError } from "@/lib/form-errors";
import { formatNumber, formatRupiah } from "@/lib/format";
import { SettingsNav } from "../settings-nav";

type Policy = { pointValue: number; minRedeemPoints: number; maxRedeemBps: number; returnWindowDays: number; maxManualDiscountBps: number };
const digits = (v: string) => v.replace(/[^\d]/g, "");

function PolicyForm({ initial }: { initial: Policy }) {
  const { can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const editable = can("setting:update");
  const [form, setForm] = useState({
    pointValue: String(initial.pointValue),
    minRedeemPoints: String(initial.minRedeemPoints),
    maxRedeemPercent: String(initial.maxRedeemBps / 100),
    returnWindowDays: String(initial.returnWindowDays),
    maxManualPercent: String(initial.maxManualDiscountBps / 100),
  });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: digits(v) }));
  const value = {
    pointValue: Number(form.pointValue || 0),
    minRedeemPoints: Number(form.minRedeemPoints || 0),
    maxRedeemBps: Math.round(Number(form.maxRedeemPercent || 0) * 100),
    returnWindowDays: Number(form.returnWindowDays || 0),
    maxManualDiscountBps: Math.round(Number(form.maxManualPercent || 0) * 100),
  };
  const save = useMutation({
    mutationFn: () => api<{ data: Policy }>("/settings/store-policy", { method: "PUT", body: value }),
    onSuccess: ({ data }) => {
      qc.setQueryData(["store-policy"], data);
      toast.show({ status: "success", title: "Kebijakan disimpan", description: "Berlaku untuk transaksi berikutnya di semua cabang." });
    },
    onError: (e) => setError(readApiError(e).message),
  });
  const exampleSpend = 200_000;
  const examplePoints = Math.floor(Math.floor((exampleSpend * value.maxRedeemBps) / 10_000) / Math.max(1, value.pointValue));

  return (
    <form
      className="grid items-start gap-4 lg:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        save.mutate();
      }}
    >
      <Panel title="Tukar poin member">
        <div className="flex flex-col gap-4">
          <Input label="Nilai 1 poin (Rp)" inputMode="numeric" value={form.pointValue} onChange={set("pointValue")} isDisabled={!editable} isRequired />
          <Input label="Minimal poin sekali tukar" inputMode="numeric" value={form.minRedeemPoints} onChange={set("minRedeemPoints")} isDisabled={!editable} isRequired />
          <Input
            label="Maksimal porsi tagihan yang dibayar poin (%)"
            hint="1–90%. Sisa tagihan tetap dibayar dengan uang agar setiap transaksi punya pembayaran tercatat."
            inputMode="numeric"
            value={form.maxRedeemPercent}
            onChange={set("maxRedeemPercent")}
            isDisabled={!editable}
            isRequired
          />
          <p className="rounded-xl bg-background-primary-default p-3 text-body-2-regular text-text-secondary shadow-card">
            Contoh: belanja {formatRupiah(exampleSpend)} → member bisa menukar sampai {formatNumber(examplePoints)} poin (potongan {formatRupiah(examplePoints * value.pointValue)}).
          </p>
        </div>
      </Panel>
      <Panel title="Diskon manual kasir">
        <div className="flex flex-col gap-4">
          <Input
            label="Maksimal diskon manual (%)"
            hint="0–90% dari tagihan setelah voucher. Kasir tanpa hak diskon manual butuh PIN kepala toko."
            inputMode="numeric"
            value={form.maxManualPercent}
            onChange={set("maxManualPercent")}
            isDisabled={!editable}
            isRequired
          />
        </div>
      </Panel>
      <Panel title="Retur penjualan">
        <div className="flex flex-col gap-4">
          <Input
            label="Batas retur (hari sejak transaksi)"
            hint="0 = retur tidak diizinkan. Retur butuh hak Kasir › Retur/refund."
            inputMode="numeric"
            value={form.returnWindowDays}
            onChange={set("returnWindowDays")}
            isDisabled={!editable}
            isRequired
          />
          <p className="text-body-2-regular text-text-tertiary">
            Uang kembali dihitung dari harga yang benar-benar dibayar (setelah diskon member, voucher, dan tukar poin). Poin dari transaksi ditarik dan poin yang ditukar dikembalikan sebanding.
          </p>
        </div>
      </Panel>
      {editable && (
        <div className="flex items-center justify-end gap-3 lg:col-span-2">
          {error && (
            <p role="alert" className="text-body-medium text-text-error-primary">
              {error}
            </p>
          )}
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? "Menyimpan…" : "Simpan kebijakan"}
          </Button>
        </div>
      )}
    </form>
  );
}

export function PolicyView() {
  const policy = useQuery({ queryKey: ["store-policy"], queryFn: () => api<{ data: Policy }>("/settings/store-policy").then((r) => r.data) });
  return (
    <>
      <PageHeader title="Pengaturan" description="Cabang, pengguna, hak akses, kebijakan toko, dan integrasi." />
      <SettingsNav />
      {policy.data ? (
        <PolicyForm initial={policy.data} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-80 rounded-2xl" />
          <Skeleton className="h-80 rounded-2xl" />
        </div>
      )}
    </>
  );
}
