"use client";

import { RiCheckboxCircleFill, RiFullscreenLine, RiQrCodeLine } from "@remixicon/react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/base/buttons/button";
import { BrandMark } from "@/components/app/brand-mark";
import { QrCode } from "@/components/app/qr-code";
import { mmss, useRemaining } from "@/hooks/use-remaining";
import { formatRupiah } from "@/lib/format";
import { subscribeDisplay, type DisplayMessage } from "../customer-display";

type Shown = Exclude<DisplayMessage, { type: "hello" }>;

/** Layar menghadap pelanggan. Dibuka dari menu Perangkat di kasir, lalu digeser ke monitor kedua & dibuat layar penuh. */
export function DisplayView() {
  const [state, setState] = useState<Shown | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const paidAt = useRef(0);

  useEffect(
    () =>
      subscribeDisplay((m) => {
        if (m.type === "hello") return;
        if (m.type === "paid") paidAt.current = Date.now();
        // Ucapan terima kasih bertahan sebentar walau keranjang kasir langsung dikosongkan.
        else if (m.type === "idle" && Date.now() - paidAt.current < 8000) return;
        setState(m);
      }),
    [],
  );

  useEffect(() => {
    if (state?.type !== "paid") return;
    const t = setTimeout(() => setState({ type: "idle", storeName: state.storeName }), 8000);
    return () => clearTimeout(t);
  }, [state]);

  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  return (
    <div className="flex min-h-dvh flex-col bg-background-full">
      <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-separator-border px-6">
        <div className="flex items-center gap-3">
          <BrandMark showName={false} />
          <span className="text-title-3-semibold text-text-primary">{state?.storeName ?? "Konten POS"}</span>
        </div>
        {!fullscreen && (
          <Button size="small" variant="secondary" leadingIcon={RiFullscreenLine} onClick={() => document.documentElement.requestFullscreen().catch(() => {})}>
            Layar penuh
          </Button>
        )}
      </header>
      <main className="flex flex-1 items-center justify-center p-6 sm:p-10">
        {!state || state.type === "idle" ? (
          <div className="text-center">
            <p className="text-display-2-semibold text-text-primary">Selamat datang</p>
            <p className="mt-3 text-title-3-regular text-text-secondary">{state ? "Belanjaan Anda akan tampil di sini." : "Menunggu layar kasir… Buka kasir di jendela lain pada browser ini."}</p>
          </div>
        ) : state.type === "cart" ? (
          <CartView state={state} />
        ) : state.type === "qris" ? (
          <QrisView state={state} />
        ) : (
          <div className="flex flex-col items-center gap-4 text-center">
            <RiCheckboxCircleFill className="size-20 text-status-lime-text" aria-hidden />
            <p className="text-display-2-semibold text-text-primary">Terima kasih</p>
            <p className="text-title-2-regular text-text-secondary tabular-nums">Total {formatRupiah(state.total)}</p>
            {state.change > 0 && (
              <div className="mt-2 rounded-3xl bg-background-secondary-default px-10 py-6">
                <p className="text-title-3-medium text-text-secondary">Kembalian</p>
                <p className="text-display-1-semibold text-text-primary tabular-nums">{formatRupiah(state.change)}</p>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function CartView({ state }: { state: Extract<Shown, { type: "cart" }> }) {
  const count = state.lines.reduce((s, l) => s + l.qty, 0);
  return (
    <div className="grid w-full max-w-5xl gap-8 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-end">
      <ul className="flex max-h-[60dvh] flex-col divide-y divide-separator-border overflow-y-auto rounded-3xl bg-background-secondary-default px-6">
        {state.lines.map((l, i) => (
          <li key={i} className="flex items-baseline justify-between gap-4 py-4">
            <span className="min-w-0 text-title-3-regular text-text-primary">
              <span className="text-text-tertiary tabular-nums">{l.qty} × </span>
              {l.name}
            </span>
            <span className="shrink-0 text-title-3-medium text-text-primary tabular-nums">{formatRupiah(l.total)}</span>
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-1 lg:text-end">
        <p className="text-title-3-medium text-text-secondary">{count} barang · Total</p>
        <p className="text-display-1-semibold text-text-primary tabular-nums">{formatRupiah(state.total)}</p>
      </div>
    </div>
  );
}

function QrisView({ state }: { state: Extract<Shown, { type: "qris" }> }) {
  const remaining = useRemaining(state.expiresAt);
  return (
    <div className="flex flex-col items-center gap-5 text-center">
      <p className="flex items-center gap-2 text-title-2-semibold text-text-primary">
        <RiQrCodeLine className="size-7" aria-hidden />
        Scan untuk membayar
      </p>
      <div className="rounded-3xl bg-white p-5 shadow-card">
        <QrCode value={state.qrString} label={`QRIS sebesar ${formatRupiah(state.amount)}`} className="size-[min(60dvh,420px)]" />
      </div>
      <p className="text-display-2-semibold text-text-primary tabular-nums">{formatRupiah(state.amount)}</p>
      <p className="text-title-3-regular text-text-secondary">
        Pakai aplikasi bank atau e-wallet apa pun{remaining != null && remaining > 0 ? ` · berlaku ${mmss(remaining)}` : ""}
      </p>
    </div>
  );
}
