"use client";

import { RiArrowLeftLine, RiPrinterLine } from "@remixicon/react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Button, ButtonLink } from "@/components/base/buttons/button";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import { InputBase } from "@/components/base/input/input";
import { Select, SelectItem } from "@/components/base/select/select";
import { BarcodeSvg } from "@/components/app/barcode-svg";
import { Skeleton } from "@/components/app/page-header";
import { api } from "@/lib/api-client";
import { formatRupiah } from "@/lib/format";
import { cx } from "@/utils/cx";

type Variant = { id: string; sku: string; barcode: string | null; title: string; price: number; isActive: boolean };
type Product = { id: string; name: string; variants: Variant[] };

/** Ukuran label umum printer thermal & stiker A4 (mm). */
const SIZES = {
  "33x15": { w: 33, h: 15, label: "33 × 15 mm (kecil)" },
  "38x25": { w: 38, h: 25, label: "38 × 25 mm" },
  "50x25": { w: 50, h: 25, label: "50 × 25 mm" },
  "58x40": { w: 58, h: 40, label: "58 × 40 mm (besar)" },
} as const;
type SizeKey = keyof typeof SIZES;
type Mode = "roll" | "a4";

export function LabelSheet() {
  const { id: productId } = useParams<{ id: string }>();
  const [size, setSize] = useState<SizeKey>("38x25");
  const [mode, setMode] = useState<Mode>("roll");
  const [showPrice, setShowPrice] = useState(true);
  const [showName, setShowName] = useState(true);
  const [useSku, setUseSku] = useState(false);
  const [qty, setQty] = useState<Record<string, string>>({});

  const product = useQuery({
    queryKey: ["product", productId],
    queryFn: () => api<{ data: Product }>(`/products/${productId}`).then((r) => r.data),
  });

  const s = SIZES[size];
  const variants = product.data?.variants.filter((v) => v.isActive) ?? [];
  const codeOf = (v: Variant) => (useSku || !v.barcode ? v.sku : v.barcode);
  const count = (v: Variant) => Math.min(500, Math.max(0, Number(qty[v.id] ?? "1") || 0));
  const labels = variants.flatMap((v) => Array.from({ length: count(v) }, (_, i) => ({ key: `${v.id}-${i}`, v })));
  const small = s.h < 20;

  return (
    <div className="min-h-dvh bg-background-secondary-default print:bg-white">
      <style>
        {mode === "roll"
          ? `@page { size: ${s.w}mm ${s.h}mm; margin: 0; } @media print { .label { break-after: page; } }`
          : `@page { size: A4; margin: 8mm; }`}
      </style>

      <div className="mx-auto flex max-w-5xl flex-col gap-4 p-4 sm:p-6 print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <ButtonLink href={`/products/${productId}`} variant="ghost" iconOnly leadingIcon={RiArrowLeftLine} aria-label="Kembali ke produk" />
            <div>
              <h1 className="text-title-3-medium text-text-primary">Cetak label barcode</h1>
              <p className="text-body-2-regular text-text-tertiary">{product.data?.name ?? "…"}</p>
            </div>
          </div>
          <Button leadingIcon={RiPrinterLine} onClick={() => window.print()} disabled={!labels.length}>
            Cetak {labels.length} label
          </Button>
        </div>

        <div className="grid gap-4 rounded-2xl bg-background-primary-default p-4 shadow-card md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <span className="text-body-medium text-text-secondary">Ukuran label</span>
              <Select aria-label="Ukuran label" selectedKey={size} onSelectionChange={(k) => setSize(k as SizeKey)} triggerClassName="w-full">
                {Object.entries(SIZES).map(([k, v]) => (
                  <SelectItem key={k} id={k} textValue={v.label}>
                    {v.label}
                  </SelectItem>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-body-medium text-text-secondary">Kertas</span>
              <Select aria-label="Jenis kertas" selectedKey={mode} onSelectionChange={(k) => setMode(k as Mode)} triggerClassName="w-full">
                <SelectItem id="roll" textValue="Printer label (gulungan)">
                  Printer label (gulungan) — satu label per halaman
                </SelectItem>
                <SelectItem id="a4" textValue="Kertas stiker A4">
                  Kertas stiker A4 — label berderet
                </SelectItem>
              </Select>
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              <Checkbox size="sm" isSelected={showName} onChange={setShowName}>
                Nama produk
              </Checkbox>
              <Checkbox size="sm" isSelected={showPrice} onChange={setShowPrice}>
                Harga
              </Checkbox>
              <Checkbox size="sm" isSelected={useSku} onChange={setUseSku}>
                Pakai SKU sebagai barcode
              </Checkbox>
            </div>
            <p className="text-body-2-regular text-text-tertiary">
              Di dialog cetak: pilih printer label, ukuran kertas sesuai label, skala 100%, dan matikan header/footer browser.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-body-medium text-text-secondary">Jumlah label per varian</span>
            {product.isPending ? (
              <Skeleton className="h-24 rounded-xl" />
            ) : (
              <ul className="relative flex max-h-72 flex-col gap-1.5 overflow-y-auto">
                {variants.map((v) => (
                  <li key={v.id} className="flex items-center gap-3 rounded-xl bg-background-secondary-default px-3 py-2">
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-body-medium text-text-primary">{v.title === "Default" ? product.data?.name : v.title}</span>
                      <span className="truncate font-mono text-caption-1-regular text-text-tertiary">{codeOf(v)}</span>
                    </span>
                    <InputBase
                      aria-label={`Jumlah label ${v.title}`}
                      inputMode="numeric"
                      value={qty[v.id] ?? "1"}
                      onChange={(e) => setQty((q) => ({ ...q, [v.id]: e.target.value.replace(/\D/g, "").slice(0, 3) }))}
                      fieldClassName="w-20"
                      size="small"
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <p className="text-body-2-regular text-text-tertiary">Pratinjau ({labels.length} label):</p>
      </div>

      <div className={cx("mx-auto flex max-w-5xl flex-wrap gap-2 px-4 pb-10 sm:px-6", "print:m-0 print:max-w-none print:p-0", mode === "roll" ? "print:block" : "print:gap-[2mm]")}>
        {labels.map(({ key, v }) => (
          <div
            key={key}
            className="label flex flex-col items-center justify-center overflow-hidden bg-white px-[1.5mm] py-[1mm] text-black shadow-card print:shadow-none"
            style={{ width: `${s.w}mm`, height: `${s.h}mm` }}
          >
            {showName && (
              // Nama produk boleh terpotong; nama varian (warna/ukuran) selalu utuh karena paling penting di rak.
              <span className={cx("flex w-full min-w-0 justify-center gap-1 font-sans leading-tight", small ? "text-[6pt]" : "text-[7.5pt]")}>
                <span className="min-w-0 truncate">{product.data?.name}</span>
                {v.title !== "Default" && <span className="shrink-0 font-semibold">{v.title}</span>}
              </span>
            )}
            <BarcodeSvg code={codeOf(v)} showText={false} height={40} className="w-full flex-1" />
            <span className="flex w-full items-baseline justify-between gap-1 font-mono leading-tight">
              <span className={small ? "text-[5.5pt]" : "text-[6.5pt]"}>{codeOf(v)}</span>
              {showPrice && <span className={cx("font-sans font-semibold", small ? "text-[6.5pt]" : "text-[8pt]")}>{formatRupiah(v.price)}</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
