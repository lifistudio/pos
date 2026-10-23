"use client";

import { useSyncExternalStore } from "react";
import { idbAll, idbDelete, idbSet } from "./idb";
import { isNetworkError, markOffline } from "./connectivity";

export type OfflinePayment = { method: "CASH" | "QRIS" | "DEBIT" | "TRANSFER"; amount: number; tendered?: number | null; reference?: string | null };
export type OutboxSale = {
  /** Idempotency-Key; sama dengan kunci checkout online bila jatuh ke offline di tengah pembayaran. */
  key: string;
  localRef: string;
  branchId: string;
  shiftId: string;
  createdAt: string;
  packIssuedAt: string;
  items: { variantId: string; qty: number; unitPrice: number; sig: string; name: string; sku: string }[];
  payments: OfflinePayment[];
  total: number;
  status: "pending" | "syncing" | "failed";
  error: string | null;
  attempts: number;
};
export type SyncResult = { localRef: string; number: string; shortfall: { sku: string; qty: number }[] };

/** Antrean transaksi offline (persisten di IndexedDB) + status untuk UI lewat useSyncExternalStore. */
let items: OutboxSale[] = [];
let syncing = false;
let lastResults: SyncResult[] = [];
let loaded = false;
const listeners = new Set<() => void>();
let snapshot = { items, syncing, lastResults };

function emit() {
  snapshot = { items, syncing, lastResults };
  for (const l of listeners) l();
}

async function load() {
  if (loaded) return;
  loaded = true;
  items = (await idbAll<OutboxSale>("outbox").catch(() => [])).map((i) => (i.status === "syncing" ? { ...i, status: "pending" as const } : i)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  emit();
}

async function save(item: OutboxSale) {
  items = [...items.filter((i) => i.key !== item.key), item].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  emit();
  await idbSet("outbox", item.key, item);
}

async function remove(key: string) {
  items = items.filter((i) => i.key !== key);
  emit();
  await idbDelete("outbox", key);
}

export async function enqueue(sale: Omit<OutboxSale, "status" | "error" | "attempts">) {
  await load();
  await save({ ...sale, status: "pending", error: null, attempts: 0 });
}

/** Nomor struk sementara: OFF-{kode perangkat}-{urut}. */
export function nextLocalRef() {
  let device = localStorage.getItem("konten-pos-device");
  if (!device) {
    device = Math.random().toString(36).slice(2, 6).toUpperCase();
    localStorage.setItem("konten-pos-device", device);
  }
  const seq = Number(localStorage.getItem("konten-pos-offline-seq") ?? "0") + 1;
  localStorage.setItem("konten-pos-offline-seq", String(seq));
  return `OFF-${device}-${String(seq).padStart(4, "0")}`;
}

/**
 * Kirim antrean berurutan (urutan waktu). Gagal jaringan → berhenti & tandai offline (dicoba lagi saat
 * online). Ditolak server (4xx) → `failed` dengan pesan, tidak menghalangi transaksi lain.
 */
export async function flush() {
  await load();
  if (syncing) return;
  syncing = true;
  emit();
  const results: SyncResult[] = [];
  try {
    for (const item of items.filter((i) => i.status === "pending")) {
      await save({ ...item, status: "syncing" });
      try {
        const res = await fetch("/api/v1/pos/offline-sales", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json", "idempotency-key": item.key },
          body: JSON.stringify({
            branchId: item.branchId,
            shiftId: item.shiftId,
            localRef: item.localRef,
            createdAt: item.createdAt,
            packIssuedAt: item.packIssuedAt,
            items: item.items.map(({ variantId, qty, unitPrice, sig }) => ({ variantId, qty, unitPrice, sig })),
            payments: item.payments,
          }),
        });
        const payload = await res.json().catch(() => null);
        if (res.ok) {
          results.push({ localRef: item.localRef, number: payload.data.sale.number, shortfall: payload.data.shortfall });
          await remove(item.key);
        } else if (res.status >= 500 || res.status === 401) {
          // Server bermasalah / sesi habis: coba lagi nanti tanpa menandai gagal permanen.
          await save({ ...item, status: "pending", attempts: item.attempts + 1, error: payload?.error?.message ?? `Server ${res.status}` });
          break;
        } else {
          await save({ ...item, status: "failed", attempts: item.attempts + 1, error: payload?.error?.message ?? "Ditolak server." });
        }
      } catch (error) {
        await save({ ...item, status: "pending", attempts: item.attempts + 1 });
        if (isNetworkError(error)) markOffline();
        break;
      }
    }
  } finally {
    syncing = false;
    if (results.length) lastResults = results;
    emit();
  }
  return results;
}

export async function retryFailed(key: string) {
  const item = items.find((i) => i.key === key);
  if (item) await save({ ...item, status: "pending", error: null });
  return flush();
}

/** Hapus dari antrean (transaksi dicatat manual oleh admin). */
export const discard = (key: string) => remove(key);
export const clearResults = () => {
  lastResults = [];
  emit();
};

/** Jumlah transaksi offline di perangkat (dipakai sebelum keluar akun). */
export async function countPendingOffline() {
  try {
    return (await idbAll<OutboxSale>("outbox")).length;
  } catch {
    return 0;
  }
}

export function useOutbox() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      void load();
      return () => listeners.delete(cb);
    },
    () => snapshot,
    () => snapshot,
  );
}
