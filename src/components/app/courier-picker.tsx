"use client";

import { COURIERS, canonicalCourier } from "@/lib/couriers";
import { nameKey } from "@/lib/names";
import { SearchSelect } from "./search-select";

/** Kurir dari daftar standar (cari) atau ketik sendiri — server merapikan ejaan ke nama resmi. */
export function CourierPicker({ value, onChange, label = "Kurir", className }: { value: string; onChange: (v: string) => void; label?: string; className?: string }) {
  return (
    <SearchSelect
      label={label}
      placeholder="JNE REG, SiCepat, kurir toko…"
      queryKey={["couriers"]}
      value={value ? { id: value, name: value } : null}
      onChange={(v) => onChange(v?.name ?? "")}
      className={className}
      createLabel="Pakai"
      search={async (q) => {
        const key = nameKey(q);
        return COURIERS.filter((c) => !key || [c.name, ...(c.aliases ?? [])].some((n) => nameKey(n).includes(key))).map((c) => ({
          id: c.name,
          name: c.name,
          exact: canonicalCourier(q) === c.name,
        }));
      }}
      onCreate={async (typed) => {
        const name = canonicalCourier(typed) ?? typed;
        return { id: name, name };
      }}
    />
  );
}
