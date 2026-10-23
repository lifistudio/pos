"use client";

import { RiFilePdf2Line, RiPrinterLine } from "@remixicon/react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { Button } from "@/components/base/buttons/button";
import { SegmentedControl, SegmentedControlItem } from "@/components/base/segmented-control/segmented-control";
import { useReceiptPrinter } from "@/components/app/printing/use-receipt-printer";

/**
 * Kontrol layar (tidak ikut tercetak): pratinjau lebar kertas, cetak ke printer yang diatur di kasir, atau unduh PDF.
 * `?print=1` mencetak otomatis sekali saat halaman dibuka.
 */
export function ReceiptActions({ saleId, width, autoPrint }: { saleId: string; width: 58 | 80; autoPrint: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const printer = useReceiptPrinter();
  const printed = useRef(false);

  useEffect(() => {
    if (!autoPrint || printed.current) return;
    printed.current = true;
    void printer.printSale(saleId);
  }, [autoPrint, printer, saleId]);

  return (
    <div className="flex flex-wrap items-center justify-center gap-3 print:hidden">
      <SegmentedControl
        aria-label="Lebar kertas pratinjau"
        selectedKeys={new Set([String(width)])}
        onSelectionChange={(keys) => {
          const next = [...keys][0];
          if (next) router.replace(`${pathname}?w=${next}`);
        }}
      >
        <SegmentedControlItem id="58">58 mm</SegmentedControlItem>
        <SegmentedControlItem id="80">80 mm</SegmentedControlItem>
      </SegmentedControl>
      <Button variant="secondary" leadingIcon={RiFilePdf2Line} disabled={printer.busy} onClick={() => printer.printSale(saleId, { mode: "pdf" })}>
        Unduh PDF
      </Button>
      <Button leadingIcon={RiPrinterLine} disabled={printer.busy} onClick={() => printer.printSale(saleId)}>
        Cetak
      </Button>
    </div>
  );
}
