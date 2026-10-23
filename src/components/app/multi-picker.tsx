"use client";

import { RiCloseLine, RiSearchLine } from "@remixicon/react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import { InputBase } from "@/components/base/input/input";
import { useDebounced } from "@/hooks/use-url-state";

export type PickerOption = { id: string; label: string; hint?: string };

/**
 * Pilih banyak item dengan pencarian (kategori, produk, varian, customer, tier, cabang).
 * `search` dipanggil lewat API; hasil terpilih tampil sebagai chip yang bisa dihapus.
 */
export function MultiPicker({
  label,
  queryKey,
  search,
  value,
  onChange,
  placeholder = "Cari…",
  emptyHint = "Ketik untuk mencari.",
  minChars = 0,
}: {
  label: string;
  queryKey: string;
  search: (q: string) => Promise<PickerOption[]>;
  value: PickerOption[];
  onChange: (next: PickerOption[]) => void;
  placeholder?: string;
  emptyHint?: string;
  minChars?: number;
}) {
  const [q, setQ] = useState("");
  const term = useDebounced(q.trim(), 250);
  const enabled = term.length >= minChars;
  const results = useQuery({ queryKey: ["picker", queryKey, term], queryFn: () => search(term), enabled, staleTime: 30_000 });
  const selected = new Set(value.map((v) => v.id));

  const toggle = (opt: PickerOption, on: boolean) => onChange(on ? [...value, opt] : value.filter((v) => v.id !== opt.id));

  return (
    <div className="flex flex-col gap-2">
      <span className="text-body-medium text-text-secondary">{label}</span>
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={`${label} terpilih`}>
          {value.map((v) => (
            <li key={v.id} className="flex items-center gap-1 rounded-full bg-background-secondary-default py-1 ps-3 pe-1.5 text-body-2-medium text-text-primary">
              {v.label}
              <button
                type="button"
                aria-label={`Hapus ${v.label}`}
                onClick={() => toggle(v, false)}
                className="flex size-5 cursor-pointer items-center justify-center rounded-full text-foreground-icon-tertiary hover:bg-background-tertiary-hover"
              >
                <RiCloseLine className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="rounded-xl border border-border-button-default">
        <InputBase
          aria-label={`Cari ${label.toLowerCase()}`}
          placeholder={placeholder}
          leadingIcon={RiSearchLine}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          fieldClassName="rounded-b-none border-0 border-b border-separator-border bg-transparent"
          size="small"
        />
        <div className="relative max-h-48 overflow-y-auto p-1">
          {!enabled ? (
            <p className="px-2 py-3 text-body-2-regular text-text-tertiary">{emptyHint}</p>
          ) : results.isPending ? (
            <p className="px-2 py-3 text-body-2-regular text-text-tertiary">Mencari…</p>
          ) : !results.data?.length ? (
            <p className="px-2 py-3 text-body-2-regular text-text-tertiary">Tidak ada hasil.</p>
          ) : (
            results.data.map((opt) => (
              <div key={opt.id} className="rounded-lg px-2 py-1.5 hover:bg-background-secondary-hover">
                <Checkbox size="sm" isSelected={selected.has(opt.id)} onChange={(on) => toggle(opt, on)} className="w-full">
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-body-2-medium text-text-primary">{opt.label}</span>
                    {opt.hint && <span className="truncate text-caption-1-regular text-text-tertiary">{opt.hint}</span>}
                  </span>
                </Checkbox>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
