"use client";

import { parseDate, type CalendarDate } from "@internationalized/date";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/base/buttons/button";
import { DatePicker } from "@/components/base/date-picker/date-picker";
import { Input } from "@/components/base/input/input";
import { SegmentedControl, SegmentedControlItem } from "@/components/base/segmented-control/segmented-control";
import { Select, SelectItem } from "@/components/base/select/select";
import { Switch } from "@/components/base/switch/switch";
import { Textarea } from "@/components/base/textarea/textarea";
import { MultiPicker, type PickerOption } from "@/components/app/multi-picker";
import { useSession } from "@/components/app/session-context";
import { api } from "@/lib/api-client";
import { readApiError } from "@/lib/form-errors";
import { displayPhone } from "@/components/app/customer-form";

export type VoucherDetail = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  valueType: "NOMINAL" | "PERCENT";
  value: number;
  maxDiscount: number | null;
  minSpend: number;
  maxSpend: number | null;
  startsAt: string;
  endsAt: string | null;
  quotaTotal: number | null;
  quotaUsed: number;
  quotaPerCustomer: number | null;
  productScope: "ALL" | "CATEGORY" | "PRODUCT" | "VARIANT";
  customerScope: "ALL" | "MEMBER" | "TIER" | "CUSTOMER";
  status: "ACTIVE" | "PAUSED";
  state: "ACTIVE" | "SCHEDULED" | "EXPIRED" | "EXHAUSTED" | "PAUSED";
  targets: { type: string; id: string; isExclusion: boolean; label: string }[];
};

const digits = (v: string) => v.replace(/[^\d]/g, "");
const money = (v: string) => (v ? Number(v).toLocaleString("id-ID") : "");

function splitLocal(iso: string | null | undefined): { date: CalendarDate | null; time: string } {
  if (!iso) return { date: null, time: "00:00" };
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return { date: parseDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`), time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}
const joinLocal = (date: CalendarDate | null, time: string) => (date ? new Date(`${date.toString()}T${time || "00:00"}`).toISOString() : null);

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-body-medium text-text-secondary">{label}</span>
      {children}
      {hint && <span className="text-body-2-regular text-text-tertiary">{hint}</span>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-4 border-t border-separator-border pt-5 first:border-0 first:pt-0">
      <legend className="mb-1 text-headline-medium text-text-primary">{title}</legend>
      {children}
    </fieldset>
  );
}

// Sumber data picker — semuanya lewat API.
const searchCategories = async (q: string): Promise<PickerOption[]> => {
  const { data } = await api<{ data: { id: string; name: string; parentId: string | null; productCount: number }[] }>("/categories");
  return data.filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase())).map((c) => ({ id: c.id, label: c.name, hint: `${c.productCount} produk${c.parentId ? " · sub-kategori" : ""}` }));
};
const searchProducts = async (q: string): Promise<PickerOption[]> => {
  const { data } = await api<{ data: { id: string; name: string; variantCount: number | null }[] }>("/products", { query: { q, pageSize: 20 } });
  return data.map((p) => ({ id: p.id, label: p.name, hint: `${p.variantCount ?? 0} varian` }));
};
const searchVariants = async (q: string): Promise<PickerOption[]> => {
  const { data } = await api<{ data: { id: string; productName: string; title: string; sku: string }[] }>("/variants/search", { query: { q, limit: 20 } });
  return data.map((v) => ({ id: v.id, label: v.title === "Default" ? v.productName : `${v.productName} · ${v.title}`, hint: v.sku }));
};
const searchTiers = async (): Promise<PickerOption[]> => {
  const { data } = await api<{ data: { id: string; name: string; memberCount: number }[] }>("/membership-tiers");
  return data.map((t) => ({ id: t.id, label: t.name, hint: `${t.memberCount} member` }));
};
const searchCustomers = async (q: string): Promise<PickerOption[]> => {
  const { data } = await api<{ data: { id: string; name: string; phone: string; memberNo: string | null }[] }>("/customers", { query: { q, pageSize: 20 } });
  return data.map((c) => ({ id: c.id, label: c.name, hint: `${displayPhone(c.phone)}${c.memberNo ? ` · ${c.memberNo}` : ""}` }));
};

const PRODUCT_SCOPE_LABEL = { ALL: "Semua produk", CATEGORY: "Kategori tertentu", PRODUCT: "Produk tertentu", VARIANT: "Varian tertentu" } as const;
const CUSTOMER_SCOPE_LABEL = { ALL: "Semua pembeli", MEMBER: "Khusus member", TIER: "Tier member tertentu", CUSTOMER: "Customer tertentu" } as const;

export function VoucherForm({ voucher, onSaved, onCancel }: { voucher: VoucherDetail | null; onSaved: (v: VoucherDetail) => void; onCancel: () => void }) {
  const qc = useQueryClient();
  const { me } = useSession();
  const t = voucher?.targets ?? [];
  const opt = (type: string, exclusion = false) => t.filter((x) => x.type === type && x.isExclusion === exclusion).map((x) => ({ id: x.id, label: x.label }));

  const [valueType, setValueType] = useState<"NOMINAL" | "PERCENT">(voucher?.valueType ?? "PERCENT");
  const [value, setValue] = useState(voucher ? String(voucher.valueType === "PERCENT" ? voucher.value / 100 : voucher.value) : "");
  const [maxDiscount, setMaxDiscount] = useState(voucher?.maxDiscount ? String(voucher.maxDiscount) : "");
  const [minSpend, setMinSpend] = useState(voucher?.minSpend ? String(voucher.minSpend) : "");
  const [maxSpend, setMaxSpend] = useState(voucher?.maxSpend ? String(voucher.maxSpend) : "");
  const start = splitLocal(voucher?.startsAt ?? new Date().toISOString());
  const end = splitLocal(voucher?.endsAt);
  const [startDate, setStartDate] = useState<CalendarDate | null>(start.date);
  const [startTime, setStartTime] = useState(start.time);
  const [endDate, setEndDate] = useState<CalendarDate | null>(end.date);
  const [endTime, setEndTime] = useState(voucher?.endsAt ? end.time : "23:59");
  const [productScope, setProductScope] = useState(voucher?.productScope ?? "ALL");
  const [productTargets, setProductTargets] = useState<PickerOption[]>(voucher ? opt(voucher.productScope) : []);
  const [exclusions, setExclusions] = useState<PickerOption[]>(opt("PRODUCT", true));
  const [customerScope, setCustomerScope] = useState(voucher?.customerScope ?? "ALL");
  const [customerTargets, setCustomerTargets] = useState<PickerOption[]>(voucher ? opt(voucher.customerScope) : []);
  const [branchTargets, setBranchTargets] = useState<PickerOption[]>(opt("BRANCH"));
  const [active, setActive] = useState((voucher?.status ?? "ACTIVE") === "ACTIVE");
  const [error, setError] = useState<{ message: string; fields: Record<string, string> } | null>(null);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      voucher ? api<{ data: VoucherDetail }>(`/vouchers/${voucher.id}`, { method: "PUT", body }) : api<{ data: VoucherDetail }>("/vouchers", { method: "POST", body }),
    onSuccess: ({ data }) => {
      qc.invalidateQueries({ queryKey: ["vouchers"] });
      qc.setQueryData(["voucher", data.id], data);
      onSaved(data);
    },
    onError: (e) => setError(readApiError(e)),
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    setError(null);
    const numericValue = valueType === "PERCENT" ? Math.round(Number(value.replace(",", ".")) * 100) : Number(digits(value));
    save.mutate({
      code: String(f.get("code")).trim(),
      name: String(f.get("name")).trim(),
      description: String(f.get("description") ?? "").trim() || null,
      valueType,
      value: numericValue,
      maxDiscount: valueType === "PERCENT" && maxDiscount ? Number(maxDiscount) : null,
      minSpend: Number(minSpend || 0),
      maxSpend: maxSpend ? Number(maxSpend) : null,
      startsAt: joinLocal(startDate, startTime) ?? new Date().toISOString(),
      endsAt: joinLocal(endDate, endTime),
      quotaTotal: f.get("quotaTotal") ? Number(f.get("quotaTotal")) : null,
      quotaPerCustomer: f.get("quotaPerCustomer") ? Number(f.get("quotaPerCustomer")) : null,
      productScope,
      productIds: productScope === "ALL" ? [] : productTargets.map((p) => p.id),
      excludeIds: exclusions.map((p) => ({ type: "PRODUCT", id: p.id })),
      customerScope,
      customerIds: customerScope === "TIER" || customerScope === "CUSTOMER" ? customerTargets.map((c) => c.id) : [],
      branchIds: branchTargets.map((b) => b.id),
      status: active ? "ACTIVE" : "PAUSED",
    });
  }

  const fe = error?.fields ?? {};
  const branchOptions = me.branches.filter((b) => b.type !== "WAREHOUSE");

  return (
    <form onSubmit={submit} className="flex flex-col gap-6">
      <Section title="Identitas">
        <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
          <Input name="code" label="Kode" placeholder="PAYDAY20" defaultValue={voucher?.code} isRequired isInvalid={!!fe.code} hint={fe.code ?? "Diketik kasir; huruf besar/kecil sama."} inputClassName="font-mono uppercase" />
          <Input name="name" label="Nama" placeholder="Payday 20% semua pakaian" defaultValue={voucher?.name} isRequired isInvalid={!!fe.name} hint={fe.name} />
        </div>
        <Textarea name="description" label="Keterangan internal" defaultValue={voucher?.description ?? ""} rows={2} />
      </Section>

      <Section title="Nilai potongan">
        <SegmentedControl aria-label="Tipe potongan" selectedKeys={new Set([valueType])} onSelectionChange={(k) => { const n = [...k][0]; if (n) setValueType(n as "NOMINAL" | "PERCENT"); }}>
          <SegmentedControlItem id="PERCENT">Persen</SegmentedControlItem>
          <SegmentedControlItem id="NOMINAL">Nominal (Rp)</SegmentedControlItem>
        </SegmentedControl>
        <div className="grid gap-3 sm:grid-cols-2">
          {valueType === "PERCENT" ? (
            <>
              <Input label="Potongan (%)" inputMode="decimal" placeholder="20" value={value} onChange={setValue} isRequired />
              <Input label="Maksimal potongan (Rp)" inputMode="numeric" placeholder="50.000" value={money(maxDiscount)} onChange={(v) => setMaxDiscount(digits(v))} isRequired hint="Wajib untuk voucher persen." />
            </>
          ) : (
            <Input label="Potongan (Rp)" inputMode="numeric" placeholder="25.000" value={money(digits(value))} onChange={(v) => setValue(digits(v))} isRequired />
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Minimal belanja (Rp)" inputMode="numeric" placeholder="0" value={money(minSpend)} onChange={(v) => setMinSpend(digits(v))} hint="Dihitung dari barang yang termasuk voucher." />
          <Input label="Maksimal belanja (Rp)" inputMode="numeric" placeholder="Tanpa batas" value={money(maxSpend)} onChange={(v) => setMaxSpend(digits(v))} />
        </div>
      </Section>

      <Section title="Periode & kuota">
        <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
          <Field label="Mulai">
            <DatePicker value={startDate} onChange={setStartDate} placeholder="Pilih tanggal" />
          </Field>
          <Input label="Jam" type="time" value={startTime} onChange={setStartTime} />
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
          <Field label="Berakhir" hint={endDate ? undefined : "Kosongkan bila tanpa batas waktu."}>
            <div className="flex items-center gap-2">
              <DatePicker value={endDate} onChange={setEndDate} className="flex-1" placeholder="Tanpa batas" />
              {endDate && (
                <Button type="button" size="small" variant="ghost" onClick={() => setEndDate(null)}>
                  Hapus
                </Button>
              )}
            </div>
          </Field>
          <Input label="Jam" type="time" value={endTime} onChange={setEndTime} isDisabled={!endDate} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input name="quotaTotal" label="Kuota total" inputMode="numeric" placeholder="Tanpa batas" defaultValue={voucher?.quotaTotal?.toString() ?? ""} hint={voucher ? `Sudah terpakai ${voucher.quotaUsed}.` : "Jumlah pemakaian untuk semua pembeli."} />
          <Input name="quotaPerCustomer" label="Kuota per customer" inputMode="numeric" placeholder="Tanpa batas" defaultValue={voucher?.quotaPerCustomer?.toString() ?? ""} hint="Bila diisi, kasir wajib memilih customer." />
        </div>
      </Section>

      <Section title="Berlaku untuk produk">
        <Field label="Cakupan">
          <Select aria-label="Cakupan produk" selectedKey={productScope} onSelectionChange={(k) => { setProductScope(k as typeof productScope); setProductTargets([]); }} triggerClassName="w-full">
            {Object.entries(PRODUCT_SCOPE_LABEL).map(([k, v]) => (
              <SelectItem key={k} id={k} textValue={v}>
                {v}
              </SelectItem>
            ))}
          </Select>
        </Field>
        {productScope === "CATEGORY" && <MultiPicker label="Kategori" queryKey="cat" search={searchCategories} value={productTargets} onChange={setProductTargets} />}
        {productScope === "PRODUCT" && <MultiPicker label="Produk" queryKey="prod" search={searchProducts} value={productTargets} onChange={setProductTargets} placeholder="Cari nama produk" />}
        {productScope === "VARIANT" && <MultiPicker label="Varian" queryKey="var" search={searchVariants} value={productTargets} onChange={setProductTargets} placeholder="Cari nama, SKU, atau barcode" minChars={1} />}
        <MultiPicker label="Kecualikan produk (opsional)" queryKey="excl" search={searchProducts} value={exclusions} onChange={setExclusions} placeholder="Misal produk yang sudah diskon" />
      </Section>

      <Section title="Berlaku untuk pembeli">
        <Field label="Cakupan">
          <Select aria-label="Cakupan pembeli" selectedKey={customerScope} onSelectionChange={(k) => { setCustomerScope(k as typeof customerScope); setCustomerTargets([]); }} triggerClassName="w-full">
            {Object.entries(CUSTOMER_SCOPE_LABEL).map(([k, v]) => (
              <SelectItem key={k} id={k} textValue={v}>
                {v}
              </SelectItem>
            ))}
          </Select>
        </Field>
        {customerScope === "TIER" && <MultiPicker label="Tier member" queryKey="tier" search={searchTiers} value={customerTargets} onChange={setCustomerTargets} />}
        {customerScope === "CUSTOMER" && <MultiPicker label="Customer" queryKey="cust" search={searchCustomers} value={customerTargets} onChange={setCustomerTargets} placeholder="Nama, no. HP, no. member" minChars={2} />}
        <MultiPicker
          label="Cabang (kosong = semua cabang)"
          queryKey="branch"
          search={async (q) => branchOptions.filter((b) => !q || b.name.toLowerCase().includes(q.toLowerCase())).map((b) => ({ id: b.id, label: b.name, hint: b.code }))}
          value={branchTargets}
          onChange={setBranchTargets}
        />
      </Section>

      <Switch isSelected={active} onChange={setActive} size="sm">
        <span className="text-body-medium text-text-primary">Voucher aktif</span>
      </Switch>

      {error && (
        <p role="alert" className="text-body-medium text-text-error-primary">
          {error.message}
        </p>
      )}
      <div className="sticky -bottom-5 -mx-5 flex justify-end gap-2 border-t border-separator-border bg-background-primary-default px-5 py-3">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Batal
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? "Menyimpan…" : voucher ? "Simpan perubahan" : "Buat voucher"}
        </Button>
      </div>
    </form>
  );
}
