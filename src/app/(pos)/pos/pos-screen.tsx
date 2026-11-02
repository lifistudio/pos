"use client";

import { RiArrowGoBackLine, RiArrowLeftLine, RiHistoryLine, RiLogoutCircleRLine, RiBankCardLine, RiComputerLine, RiMapPin2Line, RiPrinterLine, RiTvLine } from "@remixicon/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/base/buttons/button";
import { Dropdown, DropdownItem, DropdownPopover, DropdownTrigger } from "@/components/base/dropdown/dropdown";
import { Input } from "@/components/base/input/input";
import { Select, SelectItem } from "@/components/base/select/select";
import { BrandMark } from "@/components/app/brand-mark";
import { PrinterSheet } from "@/components/app/printing/printer-sheet";
import { TerminalSheet } from "@/components/app/payment-terminal/terminal-sheet";
import { Skeleton } from "@/components/app/page-header";
import { useSession } from "@/components/app/session-context";
import { useToast } from "@/components/app/toast";
import { api } from "@/lib/api-client";
import { readApiError } from "@/lib/form-errors";
import { formatDateTime, formatRupiah } from "@/lib/format";
import { computeTotals, type TaxConfig } from "@/lib/pricing";
import { CartPanel } from "./cart-panel";
import { CatalogPanel } from "./catalog-panel";
import { CloseShiftSheet } from "./close-shift-sheet";
import { PaymentDialog, type QrisSupport } from "./payment-dialog";
import { ReturnSheet } from "./return-sheet";
import { ShiftHistorySheet } from "./shift-history-sheet";
import { useCart } from "./use-cart";
import { CustomerPicker } from "./customer-picker";
import { cartMessage, openCustomerDisplay, postDisplay } from "./customer-display";
import { useQuote, type ManualDiscount, type PosCustomer, type Quote } from "./use-quote";
import { isNetworkError, markOffline, useOnline } from "./offline/connectivity";
import { idbGet, idbSet } from "./offline/idb";
import { warmPosShell } from "@/components/app/service-worker";
import { clearResults, flush, useOutbox } from "./offline/outbox";
import { useOfflinePack, type OfflinePack } from "./offline/pack";
import { ConnectivityBadge, SyncSheet } from "./offline/sync-sheet";

export type CartPricingView = Omit<Quote, "lines">;

export type PosSession = {
  shift: { id: string; openingCash: number; openedAt: string } | null;
  branch: { id: string; code: string; name: string; tax: TaxConfig };
  qris: QrisSupport;
};

const digits = (v: string) => v.replace(/[^\d]/g, "");

function OpenShiftCard({ branchName, branchId }: { branchName: string; branchId: string }) {
  const qc = useQueryClient();
  const [cash, setCash] = useState("");
  const [error, setError] = useState<string | null>(null);
  const open = useMutation({
    mutationFn: () => api("/pos/shifts", { method: "POST", body: { branchId, openingCash: Number(digits(cash) || 0) } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pos-session", branchId] }),
    onError: (e) => setError(readApiError(e).message),
  });
  return (
    <div className="flex flex-1 items-center justify-center p-4">
      <form
        className="w-full max-w-[400px] rounded-3xl border border-border-button-default bg-background-primary-default p-6 shadow-card"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          open.mutate();
        }}
      >
        <h1 className="text-title-2-medium text-text-primary">Buka shift</h1>
        <p className="mt-1 text-body-regular text-text-secondary">
          Hitung uang di laci kasir {branchName} sebelum mulai berjualan.
        </p>
        <div className="mt-5">
          <Input
            label="Kas awal (Rp)"
            inputMode="numeric"
            placeholder="0"
            value={cash ? Number(cash).toLocaleString("id-ID") : ""}
            onChange={(v) => setCash(digits(v))}
            autoFocus
            inputClassName="text-title-3-semibold tabular-nums"
          />
        </div>
        {error && (
          <p role="alert" className="mt-3 text-body-medium text-text-error-primary">
            {error}
          </p>
        )}
        <Button type="submit" className="mt-5 w-full" disabled={open.isPending}>
          {open.isPending ? "Membuka…" : "Mulai shift"}
        </Button>
      </form>
    </div>
  );
}

function SellScreen({ session, online, pack, pendingQty }: { session: PosSession & { shift: NonNullable<PosSession["shift"]> }; online: boolean; pack: OfflinePack | null; pendingQty: Map<string, number> }) {
  const toast = useToast();
  const { me } = useSession();
  const cart = useCart(session.branch.tax);
  const [customer, setCustomer] = useState<PosCustomer | null>(null);
  const [voucherCode, setVoucherCode] = useState<string | null>(null);
  const [pointsRedeem, setPointsRedeem] = useState(0);
  const [manualDiscount, setManualDiscount] = useState<ManualDiscount | null>(null);
  const [pickingCustomer, setPickingCustomer] = useState(false);
  const [paying, setPaying] = useState(false);
  const [mobileCart, setMobileCart] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  // Offline: member, voucher, poin, dan diskon manual butuh server → diabaikan (tidak dihapus dari state).
  const offline = !online;
  const effCustomer = offline ? null : customer;
  const effVoucher = offline ? null : voucherCode;
  const effPoints = offline ? 0 : pointsRedeem;
  const effManual = offline ? null : manualDiscount;
  const quote = useQuote(session.branch.id, cart.lines, effCustomer, effVoucher, effPoints, effManual);
  const priced = !!effCustomer || !!effVoucher || !!effManual;

  // Offline: total dari harga paket offline (bertanda tangan) dengan rumus yang sama.
  const packPrice = new Map(pack?.items.map((i) => [i.variantId, i.price]) ?? []);
  const local = offline && pack ? computeTotals(cart.lines.map((l) => ({ unitPrice: packPrice.get(l.variantId) ?? l.price, qty: l.qty })), pack.tax) : cart.totals;
  // Total yang ditagih: dari server bila ada customer/voucher, selain itu perhitungan lokal yang sama.
  const pricing: CartPricingView = quote.data && priced
    ? quote.data
    : { gross: local.subtotal, subtotal: local.subtotal, memberDiscount: 0, memberDiscountBps: 0, voucherDiscount: 0, pointsDiscount: 0, points: null, manualDiscount: 0, manual: null, manualNeedsApproval: false, taxTotal: local.taxTotal, total: local.total, pointsEarned: 0, voucher: null };
  const quoting = priced && cart.lines.length > 0 && (quote.isFetching || !quote.data);

  // Layar pelanggan mengikuti keranjang (selama dialog bayar terbuka, dialog yang mengirim: QR/terima kasih).
  useEffect(() => {
    if (!paying) postDisplay(cartMessage(session.branch.name, cart.lines, pricing.total));
  }, [cart.lines, pricing.total, paying, session.branch.name]);

  const reset = () => {
    cart.dispatch({ type: "clear" });
    setCustomer(null);
    setVoucherCode(null);
    setPointsRedeem(0);
    setManualDiscount(null);
    setMobileCart(false);
  };

  // Pintasan keyboard kasir: F2 cari, F4 customer, F8 bayar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F2") {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === "F4") {
        e.preventDefault();
        setPickingCustomer(true);
      }
      if (e.key === "F8" && cart.lines.length && !paying && !quoting) {
        e.preventDefault();
        setPaying(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cart.lines.length, paying, quoting]);

  return (
    <div className="flex min-h-0 flex-1">
      <CatalogPanel
        branchId={session.branch.id}
        offline={offline}
        pack={pack}
        pendingQty={pendingQty}
        searchRef={searchRef}
        inCart={new Map(cart.lines.map((l) => [l.variantId, l.qty]))}
        onAdd={(item) => {
          const inCart = cart.lines.find((l) => l.variantId === item.variantId)?.qty ?? 0;
          if (inCart + 1 > item.available) {
            toast.show({ status: "error", title: `Stok ${item.productName}${item.title !== "Default" ? ` ${item.title}` : ""} tinggal ${item.available}` });
            return;
          }
          cart.dispatch({ type: "add", item });
        }}
      />
      <CartPanel
        cart={cart}
        tax={session.branch.tax}
        pricing={pricing}
        quoting={quoting}
        offline={offline}
        customer={customer}
        onPickCustomer={() => setPickingCustomer(true)}
        onClearCustomer={() => {
          setCustomer(null);
          setPointsRedeem(0);
        }}
        pointsRedeem={pointsRedeem}
        onPointsRedeemChange={setPointsRedeem}
        manualDiscount={manualDiscount}
        onManualDiscountChange={setManualDiscount}
        voucherCode={voucherCode}
        onApplyVoucher={setVoucherCode}
        onPay={() => setPaying(true)}
        mobileOpen={mobileCart}
        onMobileOpenChange={setMobileCart}
      />
      <CustomerPicker
        isOpen={pickingCustomer}
        onClose={() => setPickingCustomer(false)}
        onPick={(c) => {
          setCustomer(c);
          setPointsRedeem(0);
        }}
      />
      <PaymentDialog
        isOpen={paying}
        onClose={() => {
          setPaying(false);
          searchRef.current?.focus();
        }}
        branchId={session.branch.id}
        lines={cart.lines}
        total={pricing.total}
        customerId={effCustomer?.id ?? null}
        voucherCode={pricing.voucher?.applied ? effVoucher : null}
        pointsRedeem={pricing.points?.redeemed ?? 0}
        qris={session.qris}
        manualDiscount={pricing.manualDiscount > 0 ? effManual : null}
        needsApproval={pricing.manualNeedsApproval}
        offline={{ active: offline, pack, shiftId: session.shift.id, branchName: session.branch.name, cashierName: me.name }}
        onCompleted={reset}
      />
    </div>
  );
}

/** Printer struk, mesin EDC, dan layar pelanggan — semua opsional, diatur per perangkat kasir. */
function DevicesMenu({ onPrinter, onTerminal }: { onPrinter: () => void; onTerminal: () => void }) {
  const [open, setOpen] = useState(false);
  const pick = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  const item = "flex w-full items-center gap-2.5 text-start";
  return (
    <Dropdown isOpen={open} onOpenChange={setOpen}>
      <DropdownTrigger
        aria-label="Perangkat kasir"
        className="flex h-8 items-center gap-1.5 rounded-xl px-2.5 text-body-2-medium text-text-secondary outline-focus-ring hover:bg-background-secondary-hover focus-visible:outline-2"
      >
        <RiComputerLine className="size-4 text-foreground-icon-secondary" aria-hidden />
        <span className="hidden lg:inline">Perangkat</span>
      </DropdownTrigger>
      <DropdownPopover aria-label="Perangkat kasir" placement="bottom end" className="min-w-60">
        <DropdownItem onSelect={pick(onPrinter)}>
          <span className={item}>
            <RiPrinterLine className="size-4 text-foreground-icon-secondary" aria-hidden />
            Printer struk
          </span>
        </DropdownItem>
        <DropdownItem onSelect={pick(onTerminal)}>
          <span className={item}>
            <RiBankCardLine className="size-4 text-foreground-icon-secondary" aria-hidden />
            Mesin EDC
          </span>
        </DropdownItem>
        <DropdownItem onSelect={pick(() => void openCustomerDisplay())}>
          <span className={item}>
            <RiTvLine className="size-4 text-foreground-icon-secondary" aria-hidden />
            Buka layar pelanggan
          </span>
        </DropdownItem>
      </DropdownPopover>
    </Dropdown>
  );
}

export function PosScreen() {
  const { me, can, branchId: sessionBranch, setBranchId } = useSession();
  const sellable = me.branches.filter((b) => b.type !== "WAREHOUSE");
  const branchId = sellable.find((b) => b.id === sessionBranch)?.id ?? sellable[0]?.id ?? null;
  const [closing, setClosing] = useState(false);
  const [history, setHistory] = useState(false);
  const [returning, setReturning] = useState(false);
  const [printerOpen, setPrinterOpen] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);

  const online = useOnline();
  const remoteSession = useQuery({
    queryKey: ["pos-session", branchId],
    queryFn: async () => {
      try {
        const { data } = await api<{ data: PosSession }>("/pos/session", { query: { branchId } });
        await idbSet("meta", `session:${branchId}`, data).catch(() => null);
        return data;
      } catch (error) {
        if (isNetworkError(error)) markOffline();
        throw error;
      }
    },
    enabled: !!branchId && online,
    retry: (count, error) => !isNetworkError(error) && count < 2,
  });
  // Sesi terakhir di perangkat: dipakai saat halaman kasir dibuka ulang tanpa koneksi.
  const storedSession = useQuery({
    queryKey: ["pos-session-local", branchId],
    queryFn: async () => (await idbGet<PosSession>("meta", `session:${branchId}`)) ?? null,
    enabled: !!branchId,
    networkMode: "always",
    staleTime: Infinity,
  });
  const sessionData = remoteSession.data ?? (online ? undefined : (storedSession.data ?? undefined));
  const session = {
    data: sessionData,
    isPending: !sessionData && (online ? remoteSession.isPending : storedSession.isPending),
    isError: !sessionData && (online ? remoteSession.isError : storedSession.isFetched && !storedSession.data),
    error: online ? remoteSession.error : new Error("Kasir belum pernah dibuka di perangkat ini saat online. Sambungkan internet sekali."),
  };
  const shift = session.data?.shift;
  const toast = useToast();
  const outbox = useOutbox();
  const { pack } = useOfflinePack(branchId ?? "", online && !!branchId);
  const [syncOpen, setSyncOpen] = useState(false);
  const pending = outbox.items.filter((i) => i.status !== "failed");
  const failed = outbox.items.filter((i) => i.status === "failed");
  // Barang di antrean offline belum memotong stok server → kurangi dari stok tampilan.
  const pendingQty = new Map<string, number>();
  for (const s of outbox.items) for (const i of s.items) pendingQty.set(i.variantId, (pendingQty.get(i.variantId) ?? 0) + i.qty);

  // Online + sesi kasir termuat → minta SW menyimpan shell kasir terbaru untuk dibuka ulang saat offline.
  const hasSession = !!remoteSession.data;
  useEffect(() => {
    if (online && hasSession) warmPosShell();
  }, [online, hasSession]);
  // Kembali online → kirim antrean otomatis.
  const pendingCount = pending.length;
  useEffect(() => {
    if (online && pendingCount > 0) void flush();
  }, [online, pendingCount]);
  // Kabari hasil sinkron (termasuk kekurangan stok yang perlu dicek).
  useEffect(() => {
    if (!outbox.lastResults.length) return;
    const short = outbox.lastResults.filter((r) => r.shortfall.length);
    toast.show({
      status: short.length ? "information" : "success",
      title: `${outbox.lastResults.length} transaksi offline tersinkron`,
      description: short.length ? `Stok sistem kurang untuk ${short.map((r) => r.number).join(", ")} — cek/opname barangnya.` : outbox.lastResults.map((r) => `${r.localRef} → ${r.number}`).join(", "),
    });
    clearResults();
  }, [outbox.lastResults, toast]);

  return (
    <div className="flex h-dvh flex-col bg-background-full">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-separator-border px-3 sm:px-4">
        <Link href="/dashboard" aria-label="Kembali ke back-office" className="flex size-10 items-center justify-center rounded-xl text-foreground-icon-secondary hover:bg-background-secondary-hover">
          <RiArrowLeftLine className="size-5" aria-hidden />
        </Link>
        <BrandMark showName={false} className="hidden sm:flex" />
        {sellable.length > 1 ? (
          <Select
            aria-label="Cabang kasir"
            selectedKey={branchId}
            onSelectionChange={(k) => setBranchId(String(k))}
            size="sm"
            popoverClassName="min-w-56"
            isDisabled={!!shift}
          >
            {sellable.map((b) => (
              <SelectItem key={b.id} id={b.id} textValue={b.name}>
                {b.name}
              </SelectItem>
            ))}
          </Select>
        ) : (
          <span className="flex items-center gap-1.5 text-body-medium text-text-primary">
            <RiMapPin2Line className="size-4 text-foreground-icon-tertiary" aria-hidden />
            {sellable[0]?.name ?? "—"}
          </span>
        )}
        {shift && (
          <span className="hidden text-body-2-regular text-text-tertiary md:inline">
            Shift {me.name} sejak {formatDateTime(shift.openedAt)} · kas awal {formatRupiah(shift.openingCash)}
          </span>
        )}
        <div className="ms-auto flex items-center gap-2">
          <ConnectivityBadge online={online} pending={pending.length} failed={failed.length} syncing={outbox.syncing} onClick={() => setSyncOpen(true)} />
          <DevicesMenu onPrinter={() => setPrinterOpen(true)} onTerminal={() => setTerminalOpen(true)} />
          {shift && (
            <>
              {(can("pos:refund") || can("pos:access")) && (
                <Button size="small" variant="ghost" leadingIcon={RiArrowGoBackLine} aria-label="Retur barang" onClick={() => setReturning(true)}>
                  <span className="hidden sm:inline">Retur</span>
                </Button>
              )}
              <Button size="small" variant="ghost" leadingIcon={RiHistoryLine} aria-label="Transaksi shift" onClick={() => setHistory(true)}>
                <span className="hidden sm:inline">Transaksi shift</span>
              </Button>
              <Button
                size="small"
                variant="secondary"
                leadingIcon={RiLogoutCircleRLine}
                aria-label="Tutup shift"
                onClick={() => {
                  // Shift ditutup hanya setelah semua transaksi offline masuk server.
                  if (!online || outbox.items.some((i) => i.shiftId === shift.id)) {
                    toast.show({ status: "error", title: "Belum bisa tutup shift", description: online ? "Masih ada transaksi offline yang belum tersinkron." : "Kasir sedang offline. Tutup shift setelah koneksi kembali." });
                    return;
                  }
                  setClosing(true);
                }}
              >
                <span className="hidden sm:inline">Tutup shift</span>
              </Button>
            </>
          )}
        </div>
      </header>

      {!branchId ? (
        <div className="flex flex-1 items-center justify-center p-6 text-center text-body-regular text-text-secondary">
          Akun Anda belum ditugaskan ke cabang toko. Minta admin menambahkan penugasan di Pengaturan › Pengguna.
        </div>
      ) : !session.data ? (
        session.isPending ? (
          <div className="flex flex-1 gap-4 p-4">
            <Skeleton className="flex-1 rounded-2xl" />
            <Skeleton className="hidden w-[380px] rounded-2xl lg:block" />
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center p-6 text-center text-body-regular text-text-secondary">
            {readApiError(session.error, "Kasir gagal dimuat.").message}
          </div>
        )
      ) : !shift ? (
        online ? (
          <OpenShiftCard branchId={branchId} branchName={session.data.branch.name} />
        ) : (
          <div className="flex flex-1 items-center justify-center p-6 text-center text-body-regular text-text-secondary">
            Belum ada shift terbuka. Membuka shift butuh koneksi internet — sambungkan lalu coba lagi.
          </div>
        )
      ) : (
        <SellScreen key={shift.id} session={{ ...session.data, shift }} online={online} pack={pack} pendingQty={pendingQty} />
      )}

      {shift && session.data && (
        <>
          <CloseShiftSheet isOpen={closing} onClose={() => setClosing(false)} shiftId={shift.id} branchId={session.data.branch.id} />
          <ShiftHistorySheet isOpen={history} onClose={() => setHistory(false)} shiftId={shift.id} branchId={session.data.branch.id} />
          <ReturnSheet isOpen={returning} onClose={() => setReturning(false)} branchId={session.data.branch.id} shiftId={shift.id} />
        </>
      )}
      <PrinterSheet isOpen={printerOpen} onClose={() => setPrinterOpen(false)} storeName={session.data?.branch.name ?? "POS by lifistudio"} />
      <TerminalSheet isOpen={terminalOpen} onClose={() => setTerminalOpen(false)} allowSimulator={!!session.data?.qris.simulator} />
      <SyncSheet isOpen={syncOpen} onClose={() => setSyncOpen(false)} online={online} />
    </div>
  );
}
