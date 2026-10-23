"use client";

import { useSyncExternalStore } from "react";

/**
 * Pengaturan mesin EDC per perangkat kasir (localStorage), seperti printer: tiap meja kasir punya EDC sendiri.
 *  - manual    : EDC berdiri sendiri, kasir mengetik kode approval (default, berlaku untuk semua bank).
 *  - ecr       : EDC tersambung kabel (USB-serial/RS-232) — nominal dikirim & hasil dibaca otomatis lewat protokol ECR bank.
 *  - simulator : EDC tiruan untuk latihan/uji alur (hanya bila server mengizinkan simulator, bukan produksi).
 */
export type TerminalMode = "manual" | "ecr" | "simulator";

export type TerminalSettings = {
  mode: TerminalMode;
  /** id protokol ECR (lihat protocols.ts). */
  protocol: string;
  baudRate: number;
  /** Batas tunggu jawaban EDC (detik) — pelanggan butuh waktu memasukkan PIN. */
  timeoutSec: number;
  device: { label: string; vendorId?: number; productId?: number } | null;
};

const KEY = "konten:edc";
export const DEFAULT_TERMINAL: TerminalSettings = { mode: "manual", protocol: "", baudRate: 9600, timeoutSec: 120, device: null };
export const BAUD_RATES = [9600, 19200, 38400, 57600, 115200];

const listeners = new Set<() => void>();
let cache: { raw: string | null; value: TerminalSettings } | null = null;

export function readTerminalSettings(): TerminalSettings {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return DEFAULT_TERMINAL;
  }
  if (cache && cache.raw === raw) return cache.value;
  let value = DEFAULT_TERMINAL;
  try {
    const p = raw ? (JSON.parse(raw) as Partial<TerminalSettings>) : {};
    value = {
      mode: p.mode === "ecr" || p.mode === "simulator" ? p.mode : "manual",
      protocol: typeof p.protocol === "string" ? p.protocol.slice(0, 40) : "",
      baudRate: BAUD_RATES.includes(Number(p.baudRate)) ? Number(p.baudRate) : 9600,
      timeoutSec: Math.min(300, Math.max(30, Number(p.timeoutSec) || 120)),
      device: p.device && typeof p.device.label === "string" ? p.device : null,
    };
  } catch {
    // pengaturan rusak → default
  }
  cache = { raw, value };
  return value;
}

export function saveTerminalSettings(patch: Partial<TerminalSettings>) {
  const next = { ...readTerminalSettings(), ...patch };
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

export function useTerminalSettings() {
  return useSyncExternalStore(subscribe, readTerminalSettings, () => DEFAULT_TERMINAL);
}
