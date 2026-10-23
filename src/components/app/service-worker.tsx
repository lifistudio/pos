"use client";

import { useEffect } from "react";

const ENABLED = process.env.NODE_ENV === "production";

/**
 * Daftarkan service worker (hanya production — di development chunk berubah terus dan cache
 * akan basi). Di development, SW lama dilepas dan cache-nya dihapus agar tidak mengganggu.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (!ENABLED) {
      void navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister()));
      void caches?.keys().then((keys) => keys.filter((k) => k.startsWith("konten-pos-")).forEach((k) => caches.delete(k)));
      return;
    }
    void navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => null);
  }, []);
  return null;
}

/** Minta SW menyimpan shell kasir terbaru (dipanggil saat halaman kasir dibuka online). */
export function warmPosShell() {
  if (!ENABLED || !("serviceWorker" in navigator)) return;
  void navigator.serviceWorker.ready.then((reg) => reg.active?.postMessage("warm-pos"));
}

/** Hapus shell kasir (berisi nama & hak akses) saat keluar akun. */
export async function clearPosShell() {
  if (!("caches" in window)) return;
  const keys = await caches.keys();
  await Promise.all(keys.filter((k) => k.startsWith("konten-pos-shell-")).map((k) => caches.delete(k)));
  navigator.serviceWorker?.controller?.postMessage("clear-shell");
}
