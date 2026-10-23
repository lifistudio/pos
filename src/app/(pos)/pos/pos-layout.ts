"use client";

import { useSyncExternalStore } from "react";

/** Preferensi tampilan katalog kasir — per perangkat (localStorage), bukan per akun. */
export type PosLayout = {
  mode: "grid" | "list";
  /** Jumlah kolom grid di layar lebar; layar sempit dibatasi agar tile tetap terbaca. */
  columns: "auto" | 3 | 4 | 5 | 6;
  showImages: boolean;
};

const KEY = "konten:pos-layout";
const DEFAULT: PosLayout = { mode: "grid", columns: "auto", showImages: true };
const listeners = new Set<() => void>();
let cache: { raw: string | null; value: PosLayout } | null = null;

function read(): PosLayout {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return DEFAULT;
  }
  if (cache && cache.raw === raw) return cache.value;
  let value = DEFAULT;
  try {
    const parsed = raw ? (JSON.parse(raw) as Partial<PosLayout>) : {};
    value = {
      mode: parsed.mode === "list" ? "list" : "grid",
      columns: [3, 4, 5, 6].includes(parsed.columns as number) ? (parsed.columns as PosLayout["columns"]) : "auto",
      showImages: parsed.showImages !== false,
    };
  } catch {
    // nilai rusak → pakai default
  }
  cache = { raw, value };
  return value;
}

export function setPosLayout(patch: Partial<PosLayout>) {
  const next = { ...read(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // mode privat / penyimpanan penuh: tetap berlaku sampai halaman dimuat ulang
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

export function usePosLayout() {
  return useSyncExternalStore(subscribe, read, () => DEFAULT);
}

/** Kelas grid per pilihan kolom. HP: selalu 2 kolom; jumlah penuh berlaku mulai layar lebar (di samping keranjang). */
export const GRID_CLASS: Record<PosLayout["columns"], string> = {
  auto: "grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5",
  3: "grid-cols-2 sm:grid-cols-3",
  4: "grid-cols-2 sm:grid-cols-3 md:grid-cols-4",
  5: "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5",
  6: "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6",
};
