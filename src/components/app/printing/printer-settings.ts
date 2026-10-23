"use client";

import { useSyncExternalStore } from "react";

/**
 * Pengaturan printer struk — per perangkat (localStorage), karena tiap mesin kasir bisa punya printer berbeda.
 *  - browser   : dialog cetak browser/OS → semua printer yang terpasang di komputer (USB, LAN/Wi-Fi, Bluetooth via driver).
 *                Dengan Chrome `--kiosk-printing` langsung tercetak tanpa dialog.
 *  - usb       : WebUSB, kirim ESC/POS langsung (tanpa dialog).
 *  - serial    : Web Serial — printer serial/USB-serial atau Bluetooth Classic yang dipasangkan sebagai COM port.
 *  - bluetooth : Web Bluetooth (BLE) — printer thermal portable.
 *  - pdf       : unduh PDF struk.
 */
export type PrinterMode = "browser" | "usb" | "serial" | "bluetooth" | "pdf";

export type PrinterSettings = {
  mode: PrinterMode;
  paper: 58 | 80;
  /** Cetak otomatis begitu transaksi lunas. */
  autoPrint: boolean;
  copies: number;
  cut: boolean;
  openDrawer: boolean;
  baudRate: number;
  /** Perangkat yang sudah dipasangkan, per jenis sambungan (berganti mode tidak menghapus pasangan lain). */
  devices: Partial<Record<DirectMode, PrinterDevice>>;
};

export type DirectMode = "usb" | "serial" | "bluetooth";
export type PrinterDevice = { label: string; vendorId?: number; productId?: number; bluetoothId?: string };
export const isDirect = (mode: PrinterMode): mode is DirectMode => mode === "usb" || mode === "serial" || mode === "bluetooth";

const KEY = "konten:printer";
export const DEFAULT_PRINTER: PrinterSettings = { mode: "browser", paper: 58, autoPrint: false, copies: 1, cut: true, openDrawer: false, baudRate: 9600, devices: {} };

const listeners = new Set<() => void>();
let cache: { raw: string | null; value: PrinterSettings } | null = null;

export function readPrinterSettings(): PrinterSettings {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return DEFAULT_PRINTER;
  }
  if (cache && cache.raw === raw) return cache.value;
  let value = DEFAULT_PRINTER;
  try {
    const p = raw ? (JSON.parse(raw) as Partial<PrinterSettings>) : {};
    value = {
      mode: (["browser", "usb", "serial", "bluetooth", "pdf"] as const).includes(p.mode as PrinterMode) ? (p.mode as PrinterMode) : "browser",
      paper: p.paper === 80 ? 80 : 58,
      autoPrint: !!p.autoPrint,
      copies: Math.min(3, Math.max(1, Number(p.copies) || 1)),
      cut: p.cut !== false,
      openDrawer: !!p.openDrawer,
      baudRate: [9600, 19200, 38400, 57600, 115200].includes(Number(p.baudRate)) ? Number(p.baudRate) : 9600,
      devices: Object.fromEntries(
        (["usb", "serial", "bluetooth"] as const).flatMap((k) => {
          const d = p.devices?.[k];
          return d && typeof d.label === "string" ? [[k, d]] : [];
        }),
      ),
    };
  } catch {
    // pengaturan rusak → default
  }
  cache = { raw, value };
  return value;
}

export function savePrinterSettings(patch: Partial<PrinterSettings>) {
  const next = { ...readPrinterSettings(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    cache = { raw: JSON.stringify(next), value: next };
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => e.key === KEY && listener();
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function usePrinterSettings() {
  return useSyncExternalStore(subscribe, readPrinterSettings, () => DEFAULT_PRINTER);
}
