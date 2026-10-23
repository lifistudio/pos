"use client";

import type { VariantHit } from "./variant-lookup";

/** Daftar pilihan saat hasil scan/cari cocok dengan beberapa varian. */
export function VariantChoices({ options, onPick }: { options: VariantHit[]; onPick: (v: VariantHit) => void }) {
  return (
    <div className="rounded-xl border border-border-button-default bg-background-primary-default p-1.5" role="listbox" aria-label="Pilih varian">
      <p className="px-2 py-1 text-body-2-medium text-text-tertiary">Beberapa barang cocok, pilih salah satu:</p>
      {options.map((h) => (
        <button
          key={h.id}
          type="button"
          role="option"
          aria-selected={false}
          onClick={() => onPick(h)}
          className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg px-2 py-2 text-start outline-none hover:bg-background-primary-hover focus-visible:ring-2 focus-visible:ring-border-focus-ring"
        >
          <span className="min-w-0 truncate text-body-medium text-text-primary">
            {h.productName}
            {h.title !== "Default" && <span className="text-text-tertiary"> · {h.title}</span>}
          </span>
          <span className="shrink-0 font-mono text-body-2-regular text-text-tertiary">{h.sku}</span>
        </button>
      ))}
    </div>
  );
}
