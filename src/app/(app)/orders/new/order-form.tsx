"use client";

import { RiAddLine, RiCloseLine, RiDeleteBinLine, RiSubtractLine, RiUserLine } from "@remixicon/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Breadcrumb, BreadcrumbItem } from "@/components/base/breadcrumb/breadcrumb";
import { Button } from "@/components/base/buttons/button";
import { Input, InputBase } from "@/components/base/input/input";
import { Select, SelectItem } from "@/components/base/select/select";
import { Textarea } from "@/components/base/textarea/textarea";
import { displayPhone } from "@/components/app/customer-form";
import { PageHeader, Panel } from "@/components/app/page-header";
import { ScanInput } from "@/components/app/scan-input";
import { useSession } from "@/components/app/session-context";
import { CourierPicker } from "@/components/app/courier-picker";
import { useToast } from "@/components/app/toast";
import { VariantChoices } from "@/components/app/variant-choices";
import { lookupVariant, type VariantHit } from "@/components/app/variant-lookup";
import { api } from "@/lib/api-client";
import { readApiError } from "@/lib/form-errors";
import { formatNumber, formatRupiah } from "@/lib/format";
import { CustomerPicker } from "@/app/(pos)/pos/customer-picker";
import type { PosCustomer } from "@/app/(pos)/pos/use-quote";
import { CHANNEL_LABEL, type Channel } from "../order-labels";

type Line = VariantHit & { qty: number; available: number | null };
const digits = (v: string) => v.replace(/[^\d]/g, "");

export function OrderForm() {
  const { me, branchId: sessionBranch } = useSession();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  // Default sumber stok: gudang (asumsi Q-04), selain itu cabang aktif.
  const [branchId, setBranchId] = useState<string | null>(me.branches.find((b) => b.type === "WAREHOUSE")?.id ?? sessionBranch ?? me.branches[0]?.id ?? null);
  const [channel, setChannel] = useState<Channel>("WHATSAPP");
  const [externalNo, setExternalNo] = useState("");
  const [customer, setCustomer] = useState<PosCustomer | null>(null);
  const [picking, setPicking] = useState(false);
  const [recipient, setRecipient] = useState({ name: "", phone: "", address: "" });
  const [courier, setCourier] = useState("");
  const [shippingFee, setShippingFee] = useState("");
  const [deadline, setDeadline] = useState("24");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [choices, setChoices] = useState<VariantHit[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function availabilityOf(v: VariantHit) {
    if (!branchId) return null;
    const { data } = await api<{ data: { variantId: string; available: number }[] }>("/inventory", { query: { branchId, q: v.sku, pageSize: 5 } });
    return data.find((d) => d.variantId === v.id)?.available ?? 0;
  }

  async function addLine(v: VariantHit) {
    setChoices(null);
    setNotice(null);
    if (lines.some((l) => l.id === v.id)) return setLines((all) => all.map((l) => (l.id === v.id ? { ...l, qty: l.qty + 1 } : l)));
    const available = await availabilityOf(v);
    setLines((all) => [{ ...v, qty: 1, available }, ...all]);
  }

  async function onScan(code: string) {
    try {
      const r = await lookupVariant(code);
      if (r.kind === "hit") await addLine(r.variant);
      else if (r.kind === "choices") setChoices(r.options);
      else setNotice(`Tidak ada barang untuk "${code}".`);
    } catch {
      setNotice("Pencarian gagal. Periksa koneksi lalu coba lagi.");
    }
  }

  const fee = Number(shippingFee || 0);
  const itemsTotal = lines.reduce((s, l) => s + (l.price ?? 0) * l.qty, 0);
  const units = lines.reduce((s, l) => s + l.qty, 0);

  const save = useMutation({
    mutationFn: () =>
      api<{ data: { id: string; number: string } }>("/online-orders", {
        method: "POST",
        body: {
          branchId,
          channel,
          externalOrderNo: externalNo.trim() || null,
          customerId: customer?.id ?? null,
          recipientName: recipient.name.trim(),
          recipientPhone: recipient.phone.trim(),
          shippingAddress: recipient.address.trim(),
          courier: courier.trim() || null,
          shippingFee: fee,
          paymentDeadlineHours: Number(deadline || 24),
          note: note.trim() || null,
          items: lines.map((l) => ({ variantId: l.id, qty: l.qty })),
        },
      }),
    onSuccess: ({ data }) => {
      qc.invalidateQueries({ queryKey: ["online-orders"] });
      qc.invalidateQueries({ queryKey: ["inventory"] });
      toast.show({ status: "success", title: `${data.number} dibuat`, description: "Stok sudah di-reserve. Tagih pembayarannya dari halaman order." });
      router.push(`/orders/${data.id}`);
    },
    onError: (e) => setError(readApiError(e).message),
  });

  function submit() {
    setError(null);
    if (!branchId) return setError("Pilih cabang sumber stok.");
    if (!lines.length) return setError("Tambahkan minimal satu barang.");
    const over = lines.filter((l) => l.available !== null && l.qty > l.available);
    if (over.length) return setError(`Stok tersedia tidak cukup: ${over.map((l) => l.productName).join(", ")}.`);
    save.mutate();
  }

  return (
    <>
      <Breadcrumb className="mb-3">
        <BreadcrumbItem href="/orders">Order online</BreadcrumbItem>
        <BreadcrumbItem current>Buat order</BreadcrumbItem>
      </Breadcrumb>
      <PageHeader title="Buat order" description="Catat order dari kanal online. Stok langsung di-reserve sampai dibayar dan dikirim, atau dilepas bila lewat batas bayar." />
      <form
        className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex min-w-0 flex-col gap-4">
          <Panel title="Barang">
            <ScanInput onScan={onScan} placeholder="Scan barcode, ketik SKU atau nama barang lalu Enter" />
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
              <p className="mt-6 rounded-xl border border-dashed border-border-button-default px-4 py-10 text-center text-body-regular text-text-tertiary">Belum ada barang di order ini.</p>
            ) : (
              <ul className="mt-4 flex flex-col divide-y divide-separator-border">
                {lines.map((l) => {
                  const over = l.available !== null && l.qty > l.available;
                  const set = (qty: number) => setLines((all) => all.map((x) => (x.id === l.id ? { ...x, qty: Math.max(1, qty) } : x)));
                  return (
                    <li key={l.id} className="flex flex-wrap items-center gap-3 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-body-medium text-text-primary">{l.productName}</p>
                        <p className="truncate text-body-2-regular text-text-tertiary">
                          {l.title !== "Default" ? `${l.title} · ` : ""}
                          {formatRupiah(l.price ?? 0)}
                          {l.available !== null && <span className={over ? "text-status-rose-text" : undefined}> · tersedia {formatNumber(l.available)}</span>}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Button type="button" size="small" variant="secondary" iconOnly leadingIcon={RiSubtractLine} aria-label={`Kurangi ${l.productName}`} onClick={() => set(l.qty - 1)} />
                        <InputBase
                          aria-label={`Jumlah ${l.productName}`}
                          inputMode="numeric"
                          value={String(l.qty)}
                          onChange={(e) => set(Number(digits(e.target.value)) || 1)}
                          fieldClassName="w-16"
                          className={`text-center tabular-nums ${over ? "text-status-rose-text" : ""}`}
                        />
                        <Button type="button" size="small" variant="secondary" iconOnly leadingIcon={RiAddLine} aria-label={`Tambah ${l.productName}`} onClick={() => set(l.qty + 1)} />
                        <Button type="button" size="small" variant="ghost" iconOnly leadingIcon={RiDeleteBinLine} aria-label={`Hapus ${l.productName}`} onClick={() => setLines((all) => all.filter((x) => x.id !== l.id))} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          <Panel title="Penerima & pengiriman">
            <div className="flex flex-col gap-4">
              {customer ? (
                <div className="flex items-center gap-2 rounded-xl bg-background-primary-default px-3 py-2 shadow-card">
                  <RiUserLine className="size-4 shrink-0 text-foreground-icon-tertiary" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body-medium text-text-primary">{customer.name}</span>
                    <span className="block text-caption-1-regular text-text-tertiary">{customer.memberNo ?? displayPhone(customer.phone)}</span>
                  </span>
                  <Button type="button" size="xs" variant="ghost" iconOnly leadingIcon={RiCloseLine} aria-label="Lepas customer" onClick={() => setCustomer(null)} />
                </div>
              ) : (
                <Button type="button" size="small" variant="secondary" leadingIcon={RiUserLine} className="self-start" onClick={() => setPicking(true)}>
                  Hubungkan ke customer
                </Button>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <Input label="Nama penerima" value={recipient.name} onChange={(v) => setRecipient((r) => ({ ...r, name: v }))} isRequired />
                <Input label="No. HP penerima" inputMode="tel" value={recipient.phone} onChange={(v) => setRecipient((r) => ({ ...r, phone: v }))} isRequired />
              </div>
              <Textarea label="Alamat lengkap" rows={3} value={recipient.address} onChange={(v) => setRecipient((r) => ({ ...r, address: v }))} isRequired />
              <div className="grid gap-4 sm:grid-cols-2">
                <CourierPicker label="Kurir & layanan" value={courier} onChange={setCourier} />
                <Input label="Ongkir (Rp)" inputMode="numeric" value={shippingFee ? Number(shippingFee).toLocaleString("id-ID") : ""} onChange={(v) => setShippingFee(digits(v))} placeholder="0" />
              </div>
            </div>
          </Panel>
        </div>

        <div className="flex flex-col gap-4">
          <Panel title="Order">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <span className="text-body-medium text-text-secondary">Sumber stok</span>
                <Select
                  aria-label="Sumber stok"
                  selectedKey={branchId}
                  onSelectionChange={(k) => {
                    setBranchId(String(k));
                    setLines([]);
                  }}
                  triggerClassName="w-full"
                  isDisabled={lines.length > 0}
                >
                  {me.branches.map((b) => (
                    <SelectItem key={b.id} id={b.id} textValue={b.name}>
                      {b.name}
                    </SelectItem>
                  ))}
                </Select>
                {lines.length > 0 && <span className="text-caption-1-regular text-text-tertiary">Kosongkan barang untuk mengganti sumber stok.</span>}
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-body-medium text-text-secondary">Kanal</span>
                <Select aria-label="Kanal" selectedKey={channel} onSelectionChange={(k) => setChannel(k as Channel)} triggerClassName="w-full">
                  {(Object.keys(CHANNEL_LABEL) as Channel[]).map((c) => (
                    <SelectItem key={c} id={c} textValue={CHANNEL_LABEL[c]}>
                      {CHANNEL_LABEL[c]}
                    </SelectItem>
                  ))}
                </Select>
              </div>
              <Input label="No. order di kanal" placeholder="Opsional, mis. nomor pesanan Shopee" value={externalNo} onChange={setExternalNo} />
              <Input label="Batas bayar (jam)" inputMode="numeric" value={deadline} onChange={(v) => setDeadline(digits(v))} hint="Lewat dari ini order dibatalkan dan stok dilepas." />
              <Input label="Catatan" value={note} onChange={setNote} />
            </div>
          </Panel>
          <Panel className="lg:sticky lg:top-2">
            <dl className="flex flex-col gap-1.5 text-body-medium">
              <div className="flex justify-between text-text-secondary">
                <dt>Barang · {formatNumber(units)} item</dt>
                <dd className="tabular-nums">{formatRupiah(itemsTotal)}</dd>
              </div>
              <div className="flex justify-between text-text-secondary">
                <dt>Ongkir</dt>
                <dd className="tabular-nums">{formatRupiah(fee)}</dd>
              </div>
              <div className="mt-1 flex items-baseline justify-between">
                <dt className="text-headline-medium text-text-primary">Perkiraan total</dt>
                <dd className="text-title-3-semibold text-text-primary tabular-nums">{formatRupiah(itemsTotal + fee)}</dd>
              </div>
              <p className="text-caption-1-regular text-text-tertiary">Total final (termasuk PPN cabang bila aktif) dihitung server.</p>
            </dl>
            {error && (
              <p role="alert" className="mt-3 text-body-medium text-text-error-primary">
                {error}
              </p>
            )}
            <Button type="submit" className="mt-4 w-full" disabled={save.isPending}>
              {save.isPending ? "Menyimpan…" : "Buat order & reserve stok"}
            </Button>
          </Panel>
        </div>
      </form>
      <CustomerPicker
        isOpen={picking}
        onClose={() => setPicking(false)}
        onPick={(c) => {
          setCustomer(c);
          setRecipient((r) => ({ ...r, name: r.name || c.name, phone: r.phone || displayPhone(c.phone) }));
        }}
      />
    </>
  );
}
