"use client";

import { useSyncExternalStore } from "react";

/**
 * Status koneksi kasir: `navigator.onLine` + kegagalan jaringan nyata (server tak terjangkau walau Wi-Fi
 * tersambung). Saat dianggap offline, server diperiksa tiap 5 detik lewat `/api/v1/pos/ping`.
 */
let online = typeof navigator === "undefined" ? true : navigator.onLine;
const listeners = new Set<() => void>();
let probe: ReturnType<typeof setInterval> | null = null;

function set(value: boolean) {
  if (online === value) return;
  online = value;
  for (const l of listeners) l();
}

async function ping() {
  try {
    const res = await fetch("/api/v1/pos/ping", { cache: "no-store", credentials: "same-origin" });
    // 401 pun berarti server terjangkau.
    if (res.status < 500) {
      set(true);
      if (probe) clearInterval(probe);
      probe = null;
    }
  } catch {
    /* masih offline */
  }
}

/** Panggil saat request gagal karena jaringan (bukan error dari server). */
export function markOffline() {
  set(false);
  probe ??= setInterval(ping, 5_000);
}

/** Error fetch karena jaringan (TypeError), bukan respons error dari server. */
export function isNetworkError(error: unknown) {
  return error instanceof TypeError;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const goOnline = () => void ping();
  const goOffline = () => markOffline();
  window.addEventListener("online", goOnline);
  window.addEventListener("offline", goOffline);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("online", goOnline);
    window.removeEventListener("offline", goOffline);
  };
}

export function useOnline() {
  return useSyncExternalStore(
    subscribe,
    () => online,
    () => true,
  );
}
