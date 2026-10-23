"use client";

import { RiCloudOffLine, RiErrorWarningLine, RiLoader4Line } from "@remixicon/react";
import { useState } from "react";
import { Button } from "@/components/base/buttons/button";
import { ConfirmDialog, Sheet } from "@/components/app/sheet";
import { formatDateTime, formatRupiah } from "@/lib/format";
import { cx } from "@/utils/cx";
import { discard, flush, retryFailed, useOutbox } from "./outbox";

/** Penanda koneksi di header kasir; tidak tampil saat online tanpa antrean. */
export function ConnectivityBadge({ online, pending, failed, syncing, onClick }: { online: boolean; pending: number; failed: number; syncing: boolean; onClick: () => void }) {
  if (online && !pending && !failed) return null;
  const label = failed ? `${failed} gagal sinkron` : syncing ? "Menyinkronkan…" : online ? `${pending} menunggu sinkron` : pending ? `Offline · ${pending} menunggu` : "Offline";
  const Icon = failed ? RiErrorWarningLine : syncing ? RiLoader4Line : RiCloudOffLine;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "flex h-9 cursor-pointer items-center gap-1.5 rounded-full px-3 text-body-2-medium outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring",
        failed ? "bg-status-rose-background text-status-rose-text" : "bg-status-yellow-background text-status-yellow-text",
      )}
      aria-label={`Status koneksi: ${label}`}
    >
      <Icon className={cx("size-4", syncing && "animate-spin")} aria-hidden />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

/** Antrean transaksi offline: kirim ulang, lihat yang ditolak server, atau keluarkan dari antrean. */
export function SyncSheet({ isOpen, onClose, online }: { isOpen: boolean; onClose: () => void; online: boolean }) {
  const { items, syncing } = useOutbox();
  const [discarding, setDiscarding] = useState<string | null>(null);
  const target = items.find((i) => i.key === discarding);
  return (
    <Sheet
      isOpen={isOpen}
      onClose={onClose}
      title="Transaksi offline"
      description={online ? "Transaksi yang dibuat saat offline dikirim otomatis berurutan." : "Kasir sedang offline. Transaksi tersimpan aman di perangkat ini dan dikirim saat koneksi kembali."}
    >
      {items.length === 0 ? (
        <p className="py-10 text-center text-body-regular text-text-tertiary">Tidak ada transaksi yang menunggu.</p>
      ) : (
        <div className="flex flex-col gap-4">
          <ul className="flex flex-col divide-y divide-separator-border">
            {items.map((i) => (
              <li key={i.key} className="flex flex-col gap-1 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-mono text-body-2-medium text-text-primary">{i.localRef}</span>
                  <span className="text-body-medium text-text-primary tabular-nums">{formatRupiah(i.total)}</span>
                </div>
                <span className="text-body-2-regular text-text-tertiary">
                  {formatDateTime(i.createdAt)} · {i.items.reduce((n, x) => n + x.qty, 0)} item · {i.status === "failed" ? "ditolak server" : i.status === "syncing" ? "mengirim…" : "menunggu"}
                </span>
                {i.error && <span className={cx("text-body-2-regular", i.status === "failed" ? "text-status-rose-text" : "text-text-tertiary")}>{i.error}</span>}
                {i.status === "failed" && (
                  <div className="flex gap-2 pt-1">
                    <Button size="xs" variant="secondary" onClick={() => void retryFailed(i.key)} disabled={!online || syncing}>
                      Coba lagi
                    </Button>
                    <Button size="xs" variant="ghost" onClick={() => setDiscarding(i.key)}>
                      Keluarkan dari antrean
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          <Button onClick={() => void flush()} disabled={!online || syncing}>
            {syncing ? "Menyinkronkan…" : online ? "Sinkronkan sekarang" : "Menunggu koneksi…"}
          </Button>
        </div>
      )}
      <ConfirmDialog
        isOpen={!!target}
        onClose={() => setDiscarding(null)}
        title={`Keluarkan ${target?.localRef ?? ""}?`}
        description="Transaksi ini tidak akan masuk ke sistem. Catat manual oleh admin (struk sementara sebagai bukti) agar kas dan stok tetap cocok."
        confirmLabel="Keluarkan"
        onConfirm={() => {
          if (target) void discard(target.key);
          setDiscarding(null);
        }}
      />
    </Sheet>
  );
}
