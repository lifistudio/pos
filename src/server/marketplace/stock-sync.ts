import "server-only";

/** Jeda agar beberapa perubahan beruntun (mis. satu keranjang) dikirim sekali, dan transaksinya sudah commit. */
const DEBOUNCE_MS = 10_000;
const pending = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Stok cabang berubah: kirim angka baru ke marketplace tanpa menunggu cron, agar jendela oversell sempit.
 * Upaya terbaik di proses ini (cron tetap jaring pengaman); kegagalan tidak boleh mengganggu transaksi kasir.
 */
export function scheduleStockPush(branchIds: Iterable<string>) {
  for (const branchId of new Set(branchIds)) {
    if (pending.has(branchId)) continue;
    const timer = setTimeout(() => {
      pending.delete(branchId);
      void import("@/server/services/marketplace.service")
        .then((m) => m.pushBranchStock(branchId))
        .catch((error) => console.error("[marketplace] gagal kirim stok", error));
    }, DEBOUNCE_MS);
    timer.unref?.();
    pending.set(branchId, timer);
  }
}
