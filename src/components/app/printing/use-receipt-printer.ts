"use client";

import { useCallback, useState } from "react";
import { useToast } from "@/components/app/toast";
import { api } from "@/lib/api-client";
import { readApiError } from "@/lib/form-errors";
import { escPosReceipt } from "@/lib/receipt/escpos";
import { offlineToReceipt, saleToReceipt, type ReceiptSale } from "@/lib/receipt/from-sale";
import { columnsFor, layoutReceipt, toPlainLines, type ReceiptDoc } from "@/lib/receipt/layout";
import { receiptPdf } from "@/lib/receipt/pdf";
import { isDirect, readPrinterSettings, usePrinterSettings, type PrinterMode, type PrinterSettings } from "./printer-settings";
import { downloadBlob, PrinterError, printBluetooth, printSerial, printUsb, printViaBrowser } from "./transports";

export type PrintOptions = {
  /** Paksa cara cetak tertentu (mis. tombol "Unduh PDF"), mengabaikan pengaturan. */
  mode?: PrinterMode;
  /** Buka laci kas (hanya printer langsung & bila diaktifkan di pengaturan) — untuk transaksi tunai baru, bukan cetak ulang. */
  drawer?: boolean;
};

const fileSafe = (s: string) => s.replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "") || "struk";

/** Kirim satu struk ke cara cetak yang dipilih. Melempar PrinterError dengan pesan yang bisa ditampilkan. */
export async function printReceiptDoc(doc: ReceiptDoc, title: string, settings: PrinterSettings, options: PrintOptions = {}) {
  const mode = options.mode ?? settings.mode;
  const columns = columnsFor(settings.paper);
  const lines = layoutReceipt(doc, columns);

  if (mode === "browser") return printViaBrowser(toPlainLines(lines, columns), settings.paper, title, settings.copies);
  if (mode === "pdf") return downloadBlob(receiptPdf(lines, { paperMm: settings.paper, columns, title }), `struk-${fileSafe(title)}.pdf`, "application/pdf");

  const device = isDirect(mode) ? settings.devices[mode] : undefined;
  if (!device) throw new PrinterError("Printer belum dihubungkan. Buka Pengaturan printer di kasir lalu ketuk Hubungkan printer.");
  const data = escPosReceipt(lines, columns, { cut: settings.cut, openDrawer: settings.openDrawer && !!options.drawer, copies: settings.copies });
  if (mode === "usb") return printUsb(data, device);
  if (mode === "serial") return printSerial(data, device, settings.baudRate);
  return printBluetooth(data, device);
}

export function testReceipt(storeName: string, settings: PrinterSettings): ReceiptDoc {
  return {
    storeName,
    headerLines: ["Cetak tes printer"],
    banner: null,
    meta: [
      ["Kertas", `${settings.paper} mm (${columnsFor(settings.paper)} karakter)`],
      ["Waktu", new Date().toLocaleString("id-ID")],
    ],
    items: [
      { name: "Contoh barang dengan nama yang cukup panjang", qtyLine: "2 x Rp15.000", amount: "Rp30.000" },
      { name: "Barang kedua", qtyLine: "1 x Rp7.500", amount: "Rp7.500" },
    ],
    summary: [{ label: "TOTAL", value: "Rp37.500", bold: true }],
    payments: [["Tunai", "Rp50.000"], ["Kembali", "Rp12.500"]],
    extra: [],
    footerLines: ["Bila baris di atas rapi & tidak terpotong, printer siap dipakai."],
  };
}

/**
 * Cetak struk dari mana saja di aplikasi: ambil transaksi lewat API → susun struk → kirim ke printer sesuai pengaturan
 * perangkat ini. Kesalahan ditampilkan sebagai toast; fungsi mengembalikan true bila terkirim.
 */
export function useReceiptPrinter() {
  const settings = usePrinterSettings();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    async (task: () => Promise<void>) => {
      setBusy(true);
      try {
        await task();
        return true;
      } catch (e) {
        // Pengguna menutup jendela pilih perangkat → bukan kesalahan.
        if (e instanceof DOMException && e.name === "NotFoundError") return false;
        toast.show({
          status: "error",
          title: "Struk gagal dicetak",
          description: e instanceof PrinterError ? e.message : readApiError(e, "Coba lagi, atau unduh PDF struknya.").message,
        });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );

  const printSale = useCallback(
    (saleId: string, options: PrintOptions = {}) =>
      run(async () => {
        const { data } = await api<{ data: ReceiptSale }>(`/sales/${saleId}`);
        await printReceiptDoc(saleToReceipt(data), data.number, readPrinterSettings(), options);
      }),
    [run],
  );

  const printOffline = useCallback(
    (sale: Parameters<typeof offlineToReceipt>[0], ctx: { branchName: string; cashierName: string }, options: PrintOptions = {}) =>
      run(() => printReceiptDoc(offlineToReceipt(sale, ctx), sale.localRef, readPrinterSettings(), options)),
    [run],
  );

  const printTest = useCallback(
    (storeName: string) =>
      run(async () => {
        const s = readPrinterSettings();
        await printReceiptDoc(testReceipt(storeName, s), "Tes printer", s, { drawer: true });
      }),
    [run],
  );

  return { settings, busy, printSale, printOffline, printTest };
}
