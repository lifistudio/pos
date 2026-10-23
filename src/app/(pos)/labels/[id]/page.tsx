import type { Metadata } from "next";
import { Suspense } from "react";
import { LabelSheet } from "./label-sheet";

export const metadata: Metadata = { title: "Cetak label barcode" };

/** Cetak label barcode per varian produk (layar penuh tanpa sidebar, siap print). Id produk dibaca di client (useParams). */
export default function LabelsPage() {
  return (
    <Suspense fallback={<div className="flex min-h-dvh items-center justify-center text-body-medium text-text-tertiary">Menyiapkan label…</div>}>
      <LabelSheet />
    </Suspense>
  );
}
