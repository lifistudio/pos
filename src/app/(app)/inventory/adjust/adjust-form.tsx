"use client";

import { RiAddLine, RiDeleteBinLine, RiSubtractLine } from "@remixicon/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Breadcrumb, BreadcrumbItem } from "@/components/base/breadcrumb/breadcrumb";
import { Button } from "@/components/base/buttons/button";
import { Input, InputBase } from "@/components/base/input/input";
import { SegmentedControl, SegmentedControlItem } from "@/components/base/segmented-control/segmented-control";
import { Select, SelectItem } from "@/components/base/select/select";
import { PageHeader, Panel } from "@/components/app/page-header";
import { ScanInput } from "@/components/app/scan-input";
import { useSession } from "@/components/app/session-context";
import { useToast } from "@/components/app/toast";
import { api, ApiClientError } from "@/lib/api-client";
import { formatNumber } from "@/lib/format";

type Hit = { id: string; sku: string; barcode: string | null; title: string; productName: string };
type Line = Hit & { qty: number };
type Mode = "RECEIPT" | "ADJUSTMENT";

export function AdjustStockForm() {
  const { me, branchId: sessionBranch } = useSession();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const [mode, setMode] = useState<Mode>("RECEIPT");
  const [branchId, setBranchId] = useState<string | null>(sessionBranch ?? me.branches[0]?.id ?? null);
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [choices, setChoices] = useState<Hit[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function addLine(hit: Hit) {
    setChoices(null);
    setNotice(null);
    setLines((all) => {
      const existing = all.find((l) => l.id === hit.id);
      if (existing) return all.map((l) => (l.id === hit.id ? { ...l, qty: l.qty + (l.qty < 0 ? -1 : 1) } : l));
      return [{ ...hit, qty: 1 }, ...all];
    });
  }

  async function onScan(code: string) {
    try {
      const { data } = await api<{ data: Hit[] }>("/variants/search", { query: { q: code, limit: 8 } });
      const exact = data.find((h) => h.barcode === code || h.sku.toUpperCase() === code.toUpperCase());
      if (exact) return addLine(exact);
      if (data.length === 1) return addLine(data[0]);
      if (data.length === 0) return setNotice(`Tidak ada varian dengan kode "${code}".`);
      setChoices(data);
    } catch {
      setNotice("Pencarian gagal. Periksa koneksi lalu scan ulang.");
    }
  }

  const submit = useMutation({
    mutationFn: () =>
      api("/inventory/adjustments", {
        method: "POST",
        body: { branchId, type: mode, reason: reason.trim(), items: lines.map((l) => ({ variantId: l.id, qtyChange: l.qty })) },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inventory"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      toast.show({
        status: "success",
        title: mode === "RECEIPT" ? "Penerimaan barang tercatat" : "Penyesuaian stok tercatat",
        description: `${lines.length} varian di ${me.branches.find((b) => b.id === branchId)?.name ?? "cabang"}.`,
      });
      router.push("/inventory/movements");
    },
    onError: (e) => setError(e instanceof ApiClientError ? e.message : "Gagal menyimpan. Coba lagi."),
  });

  function onSubmit() {
    setError(null);
    if (!branchId) return setError("Pilih cabang terlebih dahulu.");
    if (lines.length === 0) return setError("Scan atau cari minimal satu barang.");
    if (lines.some((l) => l.qty === 0)) return setError("Jumlah tidak boleh 0. Hapus baris yang tidak dipakai.");
    if (mode === "RECEIPT" && lines.some((l) => l.qty < 0)) return setError("Penerimaan barang hanya untuk jumlah positif.");
    if (reason.trim().length < 3) return setError(mode === "RECEIPT" ? "Isi nomor surat jalan atau keterangan penerimaan." : "Tuliskan alasan penyesuaian.");
    submit.mutate();
  }

  const totalUnits = lines.reduce((s, l) => s + l.qty, 0);

  return (
    <>
      <Breadcrumb className="mb-3">
        <BreadcrumbItem href="/inventory">Stok</BreadcrumbItem>
        <BreadcrumbItem current>Terima / sesuaikan</BreadcrumbItem>
      </Breadcrumb>
      <PageHeader
        title={mode === "RECEIPT" ? "Terima barang" : "Sesuaikan stok"}
        description={
          mode === "RECEIPT"
            ? "Catat barang yang masuk dari supplier atau produksi. Scan tiap barang; scan ulang menambah jumlahnya."
            : "Koreksi stok karena rusak, hilang, atau selisih hitung. Gunakan angka minus untuk mengurangi."
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Panel title="Barang">
          <ScanInput onScan={onScan} autoFocus />
          {notice && <p className="mt-3 text-body-medium text-text-error-primary" role="status">{notice}</p>}
          {choices && (
            <div className="mt-3 rounded-xl border border-border-button-default bg-background-primary-default p-1.5" role="listbox" aria-label="Pilih varian">
              <p className="px-2 py-1 text-body-2-medium text-text-tertiary">Beberapa barang cocok, pilih salah satu:</p>
              {choices.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => addLine(h)}
                  className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg px-2 py-2 text-start hover:bg-background-primary-hover"
                >
                  <span className="min-w-0 truncate text-body-medium text-text-primary">
                    {h.productName}
                    {h.title !== "Default" && <span className="text-text-tertiary"> · {h.title}</span>}
                  </span>
                  <span className="shrink-0 font-mono text-body-2-regular text-text-tertiary">{h.sku}</span>
                </button>
              ))}
            </div>
          )}

          {lines.length === 0 ? (
            <p className="mt-6 rounded-xl border border-dashed border-border-button-default px-4 py-10 text-center text-body-regular text-text-tertiary">
              Belum ada barang. Arahkan scanner ke barcode, atau ketik SKU lalu tekan Enter.
            </p>
          ) : (
            <ul className="mt-4 flex flex-col divide-y divide-separator-border">
              {lines.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body-medium text-text-primary">{l.productName}</p>
                    <p className="truncate text-body-2-regular text-text-tertiary">
                      {l.title !== "Default" ? `${l.title} · ` : ""}
                      <span className="font-mono">{l.sku}</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button
                      type="button"
                      size="small"
                      variant="secondary"
                      iconOnly
                      leadingIcon={RiSubtractLine}
                      aria-label={`Kurangi ${l.productName}`}
                      onClick={() => setLines((all) => all.map((x) => (x.id === l.id ? { ...x, qty: x.qty - 1 } : x)))}
                    />
                    <InputBase
                      aria-label={`Jumlah ${l.productName}`}
                      inputMode="numeric"
                      value={String(l.qty)}
                      onChange={(e) => {
                        const n = Number(e.target.value.replace(/[^\d-]/g, ""));
                        setLines((all) => all.map((x) => (x.id === l.id ? { ...x, qty: Number.isFinite(n) ? n : 0 } : x)));
                      }}
                      fieldClassName="w-20"
                      className="text-center tabular-nums"
                    />
                    <Button
                      type="button"
                      size="small"
                      variant="secondary"
                      iconOnly
                      leadingIcon={RiAddLine}
                      aria-label={`Tambah ${l.productName}`}
                      onClick={() => setLines((all) => all.map((x) => (x.id === l.id ? { ...x, qty: x.qty + 1 } : x)))}
                    />
                    <Button
                      type="button"
                      size="small"
                      variant="ghost"
                      iconOnly
                      leadingIcon={RiDeleteBinLine}
                      aria-label={`Hapus ${l.productName}`}
                      onClick={() => setLines((all) => all.filter((x) => x.id !== l.id))}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Detail" className="h-fit lg:sticky lg:top-2">
          <div className="flex flex-col gap-4">
            <SegmentedControl
              aria-label="Jenis perubahan stok"
              selectedKeys={new Set([mode])}
              onSelectionChange={(keys) => {
                const next = [...keys][0];
                if (next) setMode(next as Mode);
              }}
            >
              <SegmentedControlItem id="RECEIPT">Penerimaan</SegmentedControlItem>
              <SegmentedControlItem id="ADJUSTMENT">Penyesuaian</SegmentedControlItem>
            </SegmentedControl>

            <div className="flex flex-col gap-1.5">
              <span className="text-body-medium text-text-secondary">Cabang</span>
              <Select
                aria-label="Cabang"
                selectedKey={branchId}
                onSelectionChange={(k) => setBranchId(k ? String(k) : null)}
                triggerClassName="w-full"
                popoverClassName="min-w-60"
              >
                {me.branches.map((b) => (
                  <SelectItem key={b.id} id={b.id} textValue={b.name}>
                    {b.name}
                  </SelectItem>
                ))}
              </Select>
            </div>

            <Input
              label={mode === "RECEIPT" ? "No. surat jalan / keterangan" : "Alasan"}
              placeholder={mode === "RECEIPT" ? "SJ-0012 dari CV Sumber Kain" : "Rusak saat display"}
              value={reason}
              onChange={setReason}
              isRequired
            />

            <dl className="flex items-center justify-between rounded-xl bg-background-primary-default px-3 py-2.5 shadow-card">
              <dt className="text-body-medium text-text-secondary">{lines.length} varian</dt>
              <dd className="text-headline-semibold text-text-primary tabular-nums">
                {totalUnits > 0 && mode === "ADJUSTMENT" ? "+" : ""}
                {formatNumber(totalUnits)} unit
              </dd>
            </dl>

            {error && (
              <p role="alert" className="text-body-medium text-text-error-primary">
                {error}
              </p>
            )}
            <Button type="button" className="w-full" onClick={onSubmit} disabled={submit.isPending}>
              {submit.isPending ? "Menyimpan…" : mode === "RECEIPT" ? "Simpan penerimaan" : "Simpan penyesuaian"}
            </Button>
          </div>
        </Panel>
      </div>
    </>
  );
}
