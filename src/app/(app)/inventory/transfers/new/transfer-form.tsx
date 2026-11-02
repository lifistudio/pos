"use client";

import { RiAddLine, RiArrowRightLine, RiDeleteBinLine, RiSendPlaneLine, RiSubtractLine } from "@remixicon/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Breadcrumb, BreadcrumbItem } from "@/components/base/breadcrumb/breadcrumb";
import { Button } from "@/components/base/buttons/button";
import { Input, InputBase } from "@/components/base/input/input";
import { Select, SelectItem } from "@/components/base/select/select";
import { PageHeader, Panel } from "@/components/app/page-header";
import { ScanInput } from "@/components/app/scan-input";
import { useSession } from "@/components/app/session-context";
import { useToast } from "@/components/app/toast";
import { VariantChoices } from "@/components/app/variant-choices";
import { lookupVariant, type VariantHit } from "@/components/app/variant-lookup";
import { api } from "@/lib/api-client";
import { readApiError } from "@/lib/form-errors";
import { formatNumber } from "@/lib/format";

type Line = VariantHit & { qty: number; available: number | null };

export function TransferForm() {
  const { me, branchId: sessionBranch } = useSession();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const branches = me.branches;
  const defaultFrom = branches.find((b) => b.type === "WAREHOUSE")?.id ?? sessionBranch ?? branches[0]?.id ?? null;
  const [fromId, setFromId] = useState<string | null>(defaultFrom);
  const [toId, setToId] = useState<string | null>(branches.find((b) => b.id !== defaultFrom)?.id ?? null);
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [choices, setChoices] = useState<VariantHit[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function availabilityOf(variant: VariantHit) {
    if (!fromId) return null;
    const { data } = await api<{ data: { variantId: string; available: number }[] }>("/inventory", { query: { branchId: fromId, q: variant.sku, pageSize: 5 } });
    return data.find((d) => d.variantId === variant.id)?.available ?? 0;
  }

  async function addLine(v: VariantHit) {
    setChoices(null);
    setNotice(null);
    const existing = lines.find((l) => l.id === v.id);
    if (existing) return setLines((all) => all.map((l) => (l.id === v.id ? { ...l, qty: l.qty + 1 } : l)));
    const available = await availabilityOf(v);
    setLines((all) => [{ ...v, qty: 1, available }, ...all]);
  }

  async function onScan(code: string) {
    try {
      const r = await lookupVariant(code);
      if (r.kind === "hit") await addLine(r.variant);
      else if (r.kind === "choices") setChoices(r.options);
      else setNotice(`Tidak ada barang dengan kode "${code}".`);
    } catch {
      setNotice("Pencarian gagal. Periksa koneksi lalu scan ulang.");
    }
  }

  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const save = useMutation({
    mutationFn: async (send: boolean) => {
      const { data } = await api<{ data: { id: string; number: string } }>("/stock-transfers", {
        method: "POST",
        headers: { "idempotency-key": idempotencyKey },
        body: { fromBranchId: fromId, toBranchId: toId, note: note.trim() || null, items: lines.map((l) => ({ variantId: l.id, qty: l.qty })) },
      });
      if (send) await api(`/stock-transfers/${data.id}/send`, { method: "POST", body: {} });
      return { ...data, sent: send };
    },
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["transfers"] });
      qc.invalidateQueries({ queryKey: ["inventory"] });
      toast.show({ status: "success", title: d.sent ? `${d.number} dikirim` : `Draf ${d.number} disimpan` });
      router.push(`/inventory/transfers/${d.id}`);
    },
    onError: (e) => setError(readApiError(e).message),
  });

  function submit(send: boolean) {
    setError(null);
    if (!fromId || !toId) return setError("Pilih cabang asal dan tujuan.");
    if (fromId === toId) return setError("Cabang asal dan tujuan harus berbeda.");
    if (!lines.length) return setError("Scan atau cari minimal satu barang.");
    const over = lines.filter((l) => l.available !== null && l.qty > l.available);
    if (send && over.length) return setError(`Stok asal tidak cukup untuk ${over.map((l) => l.productName).join(", ")}. Kurangi jumlahnya atau simpan sebagai draf.`);
    save.mutate(send);
  }

  const units = lines.reduce((s, l) => s + l.qty, 0);

  return (
    <>
      <Breadcrumb className="mb-3">
        <BreadcrumbItem href="/inventory/transfers">Transfer</BreadcrumbItem>
        <BreadcrumbItem current>Buat transfer</BreadcrumbItem>
      </Breadcrumb>
      <PageHeader title="Buat transfer" description="Scan setiap barang yang dimasukkan ke kardus. Scan ulang menambah jumlahnya." />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Panel title="Barang">
          <ScanInput onScan={onScan} autoFocus />
          {notice && (
            <p className="mt-3 text-body-medium text-text-error-primary" role="status">
              {notice}
            </p>
          )}
          {choices && (
            <div className="mt-3">
              <VariantChoices options={choices} onPick={addLine} />
            </div>
          )}
          {lines.length === 0 ? (
            <p className="mt-6 rounded-xl border border-dashed border-border-button-default px-4 py-10 text-center text-body-regular text-text-tertiary">
              Belum ada barang. Arahkan scanner ke barcode, atau ketik SKU lalu tekan Enter.
            </p>
          ) : (
            <ul className="mt-4 flex flex-col divide-y divide-separator-border">
              {lines.map((l) => {
                const over = l.available !== null && l.qty > l.available;
                return (
                  <li key={l.id} className="flex flex-wrap items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-body-medium text-text-primary">{l.productName}</p>
                      <p className="truncate text-body-2-regular text-text-tertiary">
                        {l.title !== "Default" ? `${l.title} · ` : ""}
                        <span className="font-mono">{l.sku}</span>
                        {l.available !== null && <span className={over ? "text-status-rose-text" : undefined}> · tersedia {formatNumber(l.available)}</span>}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Button type="button" size="small" variant="secondary" iconOnly leadingIcon={RiSubtractLine} aria-label={`Kurangi ${l.productName}`} onClick={() => setLines((all) => all.map((x) => (x.id === l.id ? { ...x, qty: Math.max(1, x.qty - 1) } : x)))} />
                      <InputBase
                        aria-label={`Jumlah ${l.productName}`}
                        inputMode="numeric"
                        value={String(l.qty)}
                        onChange={(e) => {
                          const n = Number(e.target.value.replace(/\D/g, ""));
                          setLines((all) => all.map((x) => (x.id === l.id ? { ...x, qty: Math.max(1, n || 1) } : x)));
                        }}
                        fieldClassName="w-20"
                        className={`text-center tabular-nums ${over ? "text-status-rose-text" : ""}`}
                      />
                      <Button type="button" size="small" variant="secondary" iconOnly leadingIcon={RiAddLine} aria-label={`Tambah ${l.productName}`} onClick={() => setLines((all) => all.map((x) => (x.id === l.id ? { ...x, qty: x.qty + 1 } : x)))} />
                      <Button type="button" size="small" variant="ghost" iconOnly leadingIcon={RiDeleteBinLine} aria-label={`Hapus ${l.productName}`} onClick={() => setLines((all) => all.filter((x) => x.id !== l.id))} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel title="Rute" className="h-fit lg:sticky lg:top-2">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <span className="text-body-medium text-text-secondary">Dari</span>
              <Select
                aria-label="Cabang asal"
                selectedKey={fromId}
                onSelectionChange={async (k) => {
                  const id = String(k);
                  setFromId(id);
                  if (id === toId) setToId(null);
                  setLines((all) => all.map((l) => ({ ...l, available: null })));
                }}
                triggerClassName="w-full"
                isDisabled={lines.length > 0}
              >
                {branches.map((b) => (
                  <SelectItem key={b.id} id={b.id} textValue={b.name}>
                    {b.name}
                  </SelectItem>
                ))}
              </Select>
              {lines.length > 0 && <span className="text-body-2-regular text-text-tertiary">Kosongkan barang untuk mengganti cabang asal.</span>}
            </div>
            <RiArrowRightLine className="mx-auto size-5 rotate-90 text-foreground-icon-tertiary" aria-hidden />
            <div className="flex flex-col gap-1.5">
              <span className="text-body-medium text-text-secondary">Ke</span>
              <Select aria-label="Cabang tujuan" placeholder="Pilih tujuan" selectedKey={toId} onSelectionChange={(k) => setToId(String(k))} triggerClassName="w-full">
                {branches
                  .filter((b) => b.id !== fromId)
                  .map((b) => (
                    <SelectItem key={b.id} id={b.id} textValue={b.name}>
                      {b.name}
                    </SelectItem>
                  ))}
              </Select>
            </div>
            <Input label="Catatan" placeholder="Restock mingguan, no. kardus…" value={note} onChange={setNote} />
            <dl className="flex items-center justify-between rounded-xl bg-background-primary-default px-3 py-2.5 shadow-card">
              <dt className="text-body-medium text-text-secondary">{lines.length} SKU</dt>
              <dd className="text-headline-semibold text-text-primary tabular-nums">{formatNumber(units)} unit</dd>
            </dl>
            {error && (
              <p role="alert" className="text-body-medium text-text-error-primary">
                {error}
              </p>
            )}
            <Button type="button" leadingIcon={RiSendPlaneLine} className="w-full" disabled={save.isPending} onClick={() => submit(true)}>
              {save.isPending ? "Memproses…" : "Simpan & kirim"}
            </Button>
            <Button type="button" variant="secondary" className="w-full" disabled={save.isPending} onClick={() => submit(false)}>
              Simpan sebagai draf
            </Button>
          </div>
        </Panel>
      </div>
    </>
  );
}
