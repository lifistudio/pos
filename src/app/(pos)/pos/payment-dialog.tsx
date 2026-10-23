"use client";

import { RiBankCardLine, RiCheckboxCircleFill, RiCloudOffLine, RiFilePdf2Line, RiPrinterLine, RiQrCodeLine, RiTimeLine } from "@remixicon/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { useApproval } from "@/components/app/approval-dialog";
import { useReceiptPrinter } from "@/components/app/printing/use-receipt-printer";
import { chargeTerminal, TerminalError } from "@/components/app/payment-terminal/terminal";
import { readTerminalSettings, useTerminalSettings } from "@/components/app/payment-terminal/terminal-settings";
import type { TerminalReceipt } from "@/lib/payment-terminal";
import { QrCode } from "@/components/app/qr-code";
import { SegmentedControl, SegmentedControlItem } from "@/components/base/segmented-control/segmented-control";
import { mmss, useRemaining } from "@/hooks/use-remaining";
import { api } from "@/lib/api-client";
import { readApiError } from "@/lib/form-errors";
import { formatRupiah } from "@/lib/format";
import { computeTotals, PAYMENT_LABEL, quickCashAmounts } from "@/lib/pricing";
import type { CartLine } from "./use-cart";
import type { ManualDiscount } from "./use-quote";
import { cartMessage, postDisplay } from "./customer-display";
import { isNetworkError, markOffline } from "./offline/connectivity";
import { enqueue, nextLocalRef, type OutboxSale } from "./offline/outbox";
import type { OfflinePack } from "./offline/pack";

type Method = "CASH" | "QRIS" | "DEBIT" | "TRANSFER";
export type CompletedSale = { id: string; number: string; total: number; pointsEarned: number; payments: { method: string; change: number }[] };
type PosQris = {
  sale: CompletedSale & { status: "PENDING" | "PAID" | "VOIDED"; voidReason: string | null };
  payment: { status: "PENDING" | "PAID" | "EXPIRED" | "FAILED" | "CANCELLED"; amount: number; qrString: string | null; expiresAt: string } | null;
  simulator: boolean;
};
export type QrisSupport = { dynamic: boolean; simulator: boolean };
/** Konteks mode offline: paket harga bertanda tangan + shift untuk antrean sinkron. */
export type OfflineContext = { active: boolean; pack: OfflinePack | null; shiftId: string; branchName: string; cashierName: string };

const digits = (v: string) => v.replace(/[^\d]/g, "");

const NON_CASH_HINT: Record<Exclude<Method, "CASH">, string> = {
  QRIS: "Tampilkan QRIS toko, tunggu notifikasi berhasil di aplikasi/EDC, lalu isi nomor referensinya.",
  DEBIT: "Proses di mesin EDC. Isi kode approval dari slip EDC.",
  TRANSFER: "Pastikan dana sudah masuk ke rekening toko sebelum menyelesaikan transaksi.",
};

export function PaymentDialog({
  isOpen,
  onClose,
  branchId,
  lines,
  total,
  customerId,
  voucherCode,
  pointsRedeem,
  qris,
  manualDiscount,
  needsApproval,
  offline,
  onCompleted,
}: {
  isOpen: boolean;
  onClose: () => void;
  branchId: string;
  lines: CartLine[];
  total: number;
  customerId: string | null;
  voucherCode: string | null;
  pointsRedeem: number;
  qris: QrisSupport;
  manualDiscount: ManualDiscount | null;
  needsApproval: boolean;
  offline: OfflineContext;
  onCompleted: () => void;
}) {
  // Terkunci saat EDC memproses / kartu sudah tertagih tapi belum tersimpan → tidak bisa tertutup tak sengaja.
  const [locked, setLocked] = useState(false);
  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={(open) => !open && !locked && onClose()}
      isDismissable={!locked}
      isKeyboardDismissDisabled={locked}
      className="fixed inset-0 z-90 flex items-end justify-center bg-black/40 sm:items-center sm:p-4 data-[entering]:animate-[fade-in_150ms_ease-out]"
    >
      <Modal className="w-full sm:max-w-[480px] data-[entering]:animate-[pop-in_200ms_cubic-bezier(0.16,1,0.3,1)]">
        <Dialog className="relative max-h-[92dvh] overflow-y-auto rounded-t-3xl border border-border-button-default bg-background-primary-default shadow-dropdown outline-none sm:rounded-3xl">
          {/* Isi dirender ulang setiap kali dibuka → kunci idempotensi & isian baru per transaksi. */}
          {isOpen && (
            <PaymentBody
              branchId={branchId}
              lines={lines}
              total={total}
              customerId={customerId}
              voucherCode={voucherCode}
              pointsRedeem={pointsRedeem}
              qris={qris}
              manualDiscount={manualDiscount}
              needsApproval={needsApproval}
              offline={offline}
              onClose={onClose}
              onCompleted={onCompleted}
              onLockChange={setLocked}
            />
          )}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

function PaymentBody({
  branchId,
  lines,
  total,
  customerId,
  voucherCode,
  pointsRedeem,
  qris,
  manualDiscount,
  needsApproval,
  offline,
  onClose,
  onCompleted,
  onLockChange,
}: {
  branchId: string;
  lines: CartLine[];
  total: number;
  customerId: string | null;
  voucherCode: string | null;
  pointsRedeem: number;
  qris: QrisSupport;
  manualDiscount: ManualDiscount | null;
  needsApproval: boolean;
  offline: OfflineContext;
  onClose: () => void;
  onCompleted: () => void;
  onLockChange: (locked: boolean) => void;
}) {
  const totals = { total };
  const [queued, setQueued] = useState<OutboxSale | null>(null);
  const qc = useQueryClient();
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  // Transaksi QRIS dinamis yang sedang menunggu dibayar (status PENDING di server).
  const [qrSaleId, setQrSaleId] = useState<string | null>(null);
  const pendingQr = useRef<string | null>(null);
  // Dialog ditutup saat QR masih menunggu → batalkan agar stok & voucher tidak terkunci.
  useEffect(
    () => () => {
      if (pendingQr.current) void api(`/pos/qris/${pendingQr.current}/cancel`, { method: "POST", body: {} }).catch(() => null);
    },
    [],
  );
  const [method, setMethod] = useState<Method>("CASH");
  const dynamicQris = method === "QRIS" && qris.dynamic && !offline.active;
  const approval = useApproval();
  // Izin PIN untuk diskon manual: diminta sekali per pembayaran, dipakai di request berikutnya.
  const [approvalId, setApprovalId] = useState<string | null>(null);
  async function ensureApproval() {
    if (!needsApproval || approvalId) return approvalId ?? "";
    const id = await approval.request("pos:discount_manual", branchId);
    if (id) setApprovalId(id);
    return id;
  }
  const approvalHeader = (id: string | null): Record<string, string> => (id ? { "x-approval-id": id } : {});
  const [received, setReceived] = useState("");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<CompletedSale | null>(null);
  const printer = useReceiptPrinter();
  // EDC terhubung (opsional). Mode manual tetap jadi cara bawaan & cadangan.
  const terminal = useTerminalSettings();
  const [edcManual, setEdcManual] = useState(false);
  const edcAuto = method === "DEBIT" && !edcManual && !offline.active && (terminal.mode === "ecr" || (terminal.mode === "simulator" && qris.simulator));
  const [edc, setEdc] = useState<{ status: "idle" | "waiting" | "error"; message?: string; uncertain?: boolean }>({ status: "idle" });
  // Kartu sudah tertagih di EDC: disimpan agar "Simpan ulang" tidak menagih kartu dua kali.
  const [charged, setCharged] = useState<TerminalReceipt | null>(null);
  const edcAbort = useRef<AbortController | null>(null);
  useEffect(() => () => edcAbort.current?.abort(), []);
  const edcLocked = edc.status === "waiting" || (!!charged && !done);
  useEffect(() => onLockChange(edcLocked), [edcLocked, onLockChange]);
  useEffect(() => () => onLockChange(false), [onLockChange]);

  const cashReceived = Number(received || 0);
  const change = method === "CASH" ? cashReceived - totals.total : 0;
  const canSubmit = method === "CASH" ? cashReceived >= totals.total : true;

  const pay = useMutation({
    mutationFn: ({ approved, terminal: receipt }: { approved: string | null; terminal?: TerminalReceipt | null }) =>
      api<{ data: CompletedSale }>("/sales", {
        method: "POST",
        headers: { "idempotency-key": idempotencyKey, ...approvalHeader(approved) },
        body: {
          branchId,
          items: lines.map((l) => ({ variantId: l.variantId, qty: l.qty })),
          customerId,
          voucherCode,
          pointsRedeem: pointsRedeem || null,
          manualDiscount,
          payments: [
            method === "CASH"
              ? { method, amount: totals.total, tendered: cashReceived }
              : receipt
                ? { method, amount: totals.total, reference: receipt.approvalCode, terminal: receipt }
                : { method, amount: totals.total, reference: reference.trim() || null },
          ],
        },
      }),
    onSuccess: ({ data }) => finish(data),
    onError: async (e) => {
      setApprovalId(null); // izin mungkin sudah terpakai/kedaluwarsa
      // Koneksi putus di tengah bayar: simpan offline dengan kunci yang sama (bila ternyata sudah tercatat
      // di server, sinkron mengembalikan transaksi yang sama — tidak dobel).
      if (isNetworkError(e) && !customerId && !voucherCode && !pointsRedeem && !manualDiscount && offline.pack) {
        markOffline();
        await queueOffline();
        return;
      }
      setError(readApiError(e, "Transaksi gagal. Coba lagi — transaksi tidak akan tercatat dua kali.").message);
    },
  });

  /** Simpan transaksi ke antrean offline (harga & tanda tangan dari paket offline). */
  async function queueOffline() {
    const pack = offline.pack;
    if (!pack) return setError("Paket offline belum tersedia. Sambungkan internet sekali untuk mengunduh katalog.");
    const bySig = new Map(pack.items.map((i) => [i.variantId, i]));
    const missing = lines.filter((l) => !bySig.has(l.variantId));
    if (missing.length) return setError(`Belum ada di paket offline: ${missing.map((m) => m.productName).join(", ")}. Hapus dari keranjang atau tunggu online.`);
    const items = lines.map((l) => {
      const p = bySig.get(l.variantId)!;
      return { variantId: l.variantId, qty: l.qty, unitPrice: p.price, sig: p.sig, name: p.title === "Default" ? p.productName : `${p.productName} · ${p.title}`, sku: p.sku };
    });
    const offTotal = computeTotals(items.map((i) => ({ unitPrice: i.unitPrice, qty: i.qty })), pack.tax).total;
    if (method === "CASH" && cashReceived < offTotal) return setError("Uang tunai yang diterima kurang dari total.");
    const sale = {
      key: idempotencyKey,
      localRef: nextLocalRef(),
      branchId,
      shiftId: offline.shiftId,
      createdAt: new Date().toISOString(),
      packIssuedAt: pack.issuedAt,
      items,
      payments: [method === "CASH" ? { method, amount: offTotal, tendered: cashReceived } : { method, amount: offTotal, reference: reference.trim() || null }],
      total: offTotal,
    };
    await enqueue(sale);
    setQueued({ ...sale, status: "pending", error: null, attempts: 0 });
    postDisplay({ type: "paid", storeName: offline.branchName, total: offTotal, change: method === "CASH" ? cashReceived - offTotal : 0 });
    onCompleted();
    if (printer.settings.autoPrint) void printer.printOffline(sale, offline, { drawer: method === "CASH" });
  }

  function finish(sale: CompletedSale) {
    pendingQr.current = null;
    setDone(sale);
    postDisplay({ type: "paid", storeName: offline.branchName, total: sale.total, change: sale.payments.find((p) => p.method === "CASH")?.change ?? 0 });
    // Cetak otomatis (pengaturan printer perangkat ini). Laci kas hanya dibuka untuk pembayaran tunai.
    if (printer.settings.autoPrint) void printer.printSale(sale.id, { drawer: sale.payments.some((p) => p.method === "CASH") });
    onCompleted();
    qc.invalidateQueries({ queryKey: ["pos-catalog"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["shift-sales"] });
  }

  const startQris = useMutation({
    mutationFn: (approved: string | null) =>
      api<{ data: PosQris }>("/pos/qris", {
        method: "POST",
        headers: { "idempotency-key": idempotencyKey, ...approvalHeader(approved) },
        body: { branchId, items: lines.map((l) => ({ variantId: l.variantId, qty: l.qty })), customerId, voucherCode, pointsRedeem: pointsRedeem || null, manualDiscount },
      }).then((r) => r.data),
    onSuccess: (d) => {
      pendingQr.current = d.sale.id;
      setQrSaleId(d.sale.id);
    },
    onError: (e) => setError(readApiError(e, "QRIS gagal dibuat. Coba lagi atau pakai metode lain.").message),
  });

  /** Tagih lewat EDC terhubung lalu simpan transaksi dengan data dari EDC. */
  async function chargeAndPay(approved: string | null) {
    if (charged) return pay.mutate({ approved, terminal: charged });
    const ctrl = new AbortController();
    edcAbort.current = ctrl;
    setEdc({ status: "waiting", message: "Menghubungi mesin EDC…" });
    try {
      const receipt = await chargeTerminal(readTerminalSettings(), totals.total, idempotencyKey.replace(/-/g, "").slice(0, 20), {
        signal: ctrl.signal,
        onProgress: (message) => setEdc({ status: "waiting", message }),
      });
      setCharged(receipt);
      // Bila internet putus saat menyimpan, antrean offline tetap membawa kode approval.
      setReference(receipt.approvalCode);
      setEdc({ status: "idle" });
      pay.mutate({ approved, terminal: receipt });
    } catch (e) {
      const t = e instanceof TerminalError ? e : new TerminalError((e as Error).message, "connection");
      setEdc({
        status: "error",
        uncertain: t.uncertain,
        message: t.uncertain ? `${t.message} Cek slip/layar EDC: bila APPROVED, pilih Isi manual lalu ketik kode approval-nya — jangan tagih ulang.` : t.message,
      });
    } finally {
      edcAbort.current = null;
    }
  }

  function resetQris() {
    pendingQr.current = null;
    setQrSaleId(null);
    postDisplay(cartMessage(offline.branchName, lines, totals.total));
    // Transaksi PENDING lama sudah dibalik; percobaan baru butuh kunci idempotensi baru.
    setIdempotencyKey(crypto.randomUUID());
  }

  if (queued) {
    const cashChange = queued.payments.reduce((s, p) => s + Math.max(0, (p.tendered ?? p.amount) - p.amount), 0);
    return (
      <div className="flex flex-col items-center gap-4 p-6 text-center" onKeyDown={(e) => e.key === "Enter" && onClose()}>
        <RiCloudOffLine className="size-12 text-status-yellow-text" aria-hidden />
        <div>
          <Heading slot="title" className="text-title-2-medium text-text-primary">
            Tersimpan offline
          </Heading>
          <p className="mt-1 font-mono text-body-2-regular text-text-tertiary">{queued.localRef}</p>
          <p className="mt-1 text-body-2-regular text-text-secondary">Otomatis disinkronkan saat koneksi kembali.</p>
        </div>
        {cashChange > 0 && (
          <div className="w-full rounded-2xl bg-background-secondary-default p-4">
            <p className="text-body-medium text-text-secondary">Kembalian</p>
            <p className="text-display-3-medium text-text-primary tabular-nums">{formatRupiah(cashChange)}</p>
          </div>
        )}
        <div className="flex w-full gap-2">
          <Button variant="secondary" leadingIcon={RiPrinterLine} className="flex-1" disabled={printer.busy} onClick={() => printer.printOffline(queued, offline)}>
            Cetak struk sementara
          </Button>
          <Button className="flex-1" onClick={onClose} autoFocus>
            Transaksi baru
          </Button>
        </div>
      </div>
    );
  }

  if (done) {
    const cashChange = done.payments.find((p) => p.method === "CASH")?.change ?? 0;
    return (
      <div className="flex flex-col items-center gap-4 p-6 text-center" onKeyDown={(e) => e.key === "Enter" && onClose()}>
        <RiCheckboxCircleFill className="size-12 text-status-lime-text" aria-hidden />
        <div>
          <Heading slot="title" className="text-title-2-medium text-text-primary">
            Transaksi berhasil
          </Heading>
          <p className="mt-1 font-mono text-body-2-regular text-text-tertiary">{done.number}</p>
        </div>
        {done.pointsEarned > 0 && <p className="text-body-medium text-status-purple-text">+{done.pointsEarned} poin untuk member</p>}
        {cashChange > 0 && (
          <div className="w-full rounded-2xl bg-background-secondary-default p-4">
            <p className="text-body-medium text-text-secondary">Kembalian</p>
            <p className="text-display-3-medium text-text-primary tabular-nums">{formatRupiah(cashChange)}</p>
          </div>
        )}
        <div className="flex w-full gap-2">
          <Button variant="secondary" leadingIcon={RiPrinterLine} className="flex-1" disabled={printer.busy} onClick={() => printer.printSale(done.id)}>
            {printer.settings.autoPrint ? "Cetak ulang" : "Cetak struk"}
          </Button>
          <Button variant="secondary" leadingIcon={RiFilePdf2Line} aria-label="Unduh PDF struk" disabled={printer.busy} onClick={() => printer.printSale(done.id, { mode: "pdf" })}>
            PDF
          </Button>
          <Button className="flex-1" onClick={onClose} autoFocus>
            Transaksi baru
          </Button>
        </div>
      </div>
    );
  }

  if (qrSaleId) {
    return <QrisWait saleId={qrSaleId} total={totals.total} storeName={offline.branchName} simulator={qris.simulator} onPaid={finish} onReset={resetQris} />;
  }

  return (
    <form
      className="flex flex-col gap-5 p-5 sm:p-6"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        if (offline.active) {
          if (canSubmit) await queueOffline();
          return;
        }
        if (dynamicQris ? startQris.isPending : !canSubmit || pay.isPending) return;
        const approved = await ensureApproval();
        if (approved === null) return; // atasan batal menyetujui
        if (dynamicQris) startQris.mutate(approved || null);
        else if (edcAuto) await chargeAndPay(approved || null);
        else pay.mutate({ approved: approved || null });
      }}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <Heading slot="title" className="text-body-medium text-text-secondary">
            Total tagihan
          </Heading>
          <p className="text-display-3-medium text-text-primary tabular-nums">{formatRupiah(totals.total)}</p>
        </div>
        <Button type="button" size="small" variant="ghost" onClick={onClose} disabled={edcLocked}>
          Batal
        </Button>
      </div>

      <SegmentedControl
        aria-label="Metode pembayaran"
        isDisabled={edc.status === "waiting" || !!charged}
        selectedKeys={new Set([method])}
        onSelectionChange={(keys) => {
          const next = [...keys][0];
          if (next) setMethod(next as Method);
        }}
      >
        {(["CASH", "QRIS", "DEBIT", "TRANSFER"] as Method[]).map((m) => (
          <SegmentedControlItem key={m} id={m}>
            {m === "DEBIT" ? "EDC" : PAYMENT_LABEL[m]}
          </SegmentedControlItem>
        ))}
      </SegmentedControl>

      {method === "CASH" ? (
        <div className="flex flex-col gap-3">
          <Input
            label="Uang diterima"
            inputMode="numeric"
            placeholder="0"
            value={received ? Number(received).toLocaleString("id-ID") : ""}
            onChange={(v) => setReceived(digits(v))}
            autoFocus
            inputClassName="text-title-3-semibold tabular-nums"
          />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {quickCashAmounts(totals.total).map((amount) => (
              <Button key={amount} type="button" variant="secondary" size="small" onClick={() => setReceived(String(amount))}>
                {amount === totals.total ? "Uang pas" : formatRupiah(amount)}
              </Button>
            ))}
          </div>
          <div className="flex items-baseline justify-between rounded-2xl bg-background-secondary-default px-4 py-3">
            <span className="text-body-medium text-text-secondary">{change < 0 ? "Kurang" : "Kembalian"}</span>
            <span className={`text-title-2-medium tabular-nums ${change < 0 ? "text-status-rose-text" : "text-text-primary"}`}>
              {received ? formatRupiah(Math.abs(change)) : "—"}
            </span>
          </div>
        </div>
      ) : edcAuto ? (
        <div className="flex flex-col gap-3 rounded-2xl bg-background-secondary-default p-4" aria-live="polite">
          <div className="flex items-start gap-3">
            <RiBankCardLine className="mt-0.5 size-5 shrink-0 text-foreground-icon-secondary" aria-hidden />
            <div className="min-w-0 flex-1 text-body-2-regular text-text-secondary">
              {charged ? (
                <p>
                  Kartu sudah tertagih — approval <span className="font-mono text-text-primary">{charged.approvalCode}</span>
                  {charged.maskedPan && ` · ${charged.maskedPan.slice(-8)}`}. Simpan transaksinya; kartu tidak akan ditagih lagi.
                </p>
              ) : edc.status === "waiting" ? (
                <p className="text-body-medium text-text-primary">{edc.message}</p>
              ) : edc.status === "error" ? (
                <p role="alert" className="text-text-error-primary">{edc.message}</p>
              ) : (
                <p>
                  Nominal {formatRupiah(totals.total)} dikirim ke {terminal.mode === "simulator" ? "EDC simulasi" : (terminal.device?.label ?? "mesin EDC")}. Pelanggan menempel/mencelup kartu dan memasukkan PIN di EDC; hasilnya tercatat otomatis.
                </p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {edc.status === "waiting" ? (
              <Button type="button" size="small" variant="secondary" onClick={() => edcAbort.current?.abort()}>
                Batalkan
              </Button>
            ) : charged ? (
              error &&
              !pay.isPending && (
                <Button type="button" size="small" variant="ghost" onClick={() => setCharged(null)}>
                  Sudah di-void di mesin EDC
                </Button>
              )
            ) : (
              <Button type="button" size="small" variant="ghost" onClick={() => setEdcManual(true)}>
                Isi manual
              </Button>
            )}
          </div>
        </div>
      ) : dynamicQris ? (
        <p className="rounded-2xl bg-background-secondary-default p-3 text-body-2-regular text-text-secondary">
          QR berisi nominal pas dibuat khusus untuk transaksi ini. Pelanggan memindai dengan aplikasi bank/e-wallet; transaksi lunas otomatis.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="rounded-2xl bg-background-secondary-default p-3 text-body-2-regular text-text-secondary">{NON_CASH_HINT[method]}</p>
          <Input
            label={method === "TRANSFER" ? "Bank / catatan" : "No. referensi"}
            placeholder="Opsional, membantu rekonsiliasi"
            value={reference}
            onChange={setReference}
            autoFocus
            inputClassName="font-mono"
          />
        </div>
      )}

      {needsApproval && <p className="text-body-2-regular text-text-tertiary">Diskon manual butuh PIN kepala toko sebelum transaksi disimpan.</p>}
      {approval.dialog}
      {error && (
        <p role="alert" className="text-body-medium text-text-error-primary">
          {error}
        </p>
      )}
      {dynamicQris ? (
        <Button type="submit" leadingIcon={RiQrCodeLine} className="h-14 w-full text-headline-medium" disabled={startQris.isPending}>
          {startQris.isPending ? "Membuat QR…" : "Tampilkan QR"}
        </Button>
      ) : edcAuto ? (
        <Button type="submit" leadingIcon={RiBankCardLine} className="h-14 w-full text-headline-medium" disabled={edc.status === "waiting" || pay.isPending}>
          {pay.isPending ? "Menyimpan…" : edc.status === "waiting" ? "Menunggu EDC…" : charged ? "Simpan transaksi" : edc.status === "error" ? "Coba kirim lagi ke EDC" : `Kirim ${formatRupiah(totals.total)} ke EDC`}
        </Button>
      ) : (
        <Button type="submit" className="h-14 w-full text-headline-medium" disabled={!canSubmit || pay.isPending}>
          {pay.isPending ? "Menyimpan…" : method === "CASH" ? "Selesaikan transaksi" : `Konfirmasi ${PAYMENT_LABEL[method]} diterima`}
        </Button>
      )}
    </form>
  );
}

/** QR di layar kasir: cek status tiap 2 detik; lunas → layar sukses, kedaluwarsa/batal → buat ulang. */
function QrisWait({
  saleId,
  total,
  storeName,
  simulator,
  onPaid,
  onReset,
}: {
  saleId: string;
  total: number;
  storeName: string;
  simulator: boolean;
  onPaid: (sale: CompletedSale) => void;
  onReset: () => void;
}) {
  const q = useQuery({
    queryKey: ["pos-qris", saleId],
    queryFn: () => api<{ data: PosQris }>(`/pos/qris/${saleId}`).then((r) => r.data),
    refetchInterval: (query) => (query.state.data && query.state.data.sale.status !== "PENDING" ? false : 2000),
  });
  const cancel = useMutation({ mutationFn: () => api(`/pos/qris/${saleId}/cancel`, { method: "POST", body: {} }), onSettled: onReset });
  const simulate = useMutation({ mutationFn: () => api<{ data: PosQris }>(`/pos/qris/${saleId}/simulate`, { method: "POST", body: {} }).then((r) => r.data) });
  const data = simulate.data?.sale.status === "PAID" ? simulate.data : q.data;
  const status = data?.sale.status;
  const remaining = useRemaining(status === "PENDING" ? (data?.payment?.expiresAt ?? null) : null);

  useEffect(() => {
    if (data?.sale.status === "PAID") onPaid(data.sale);
  }, [data, onPaid]);
  // QR yang sama tampil di layar pelanggan (bila dibuka).
  const qr = status === "PENDING" ? data?.payment?.qrString : null;
  const qrExpires = data?.payment?.expiresAt;
  useEffect(() => {
    if (qr && qrExpires) postDisplay({ type: "qris", storeName, qrString: qr, amount: total, expiresAt: qrExpires });
  }, [qr, qrExpires, storeName, total]);

  if (status === "VOIDED") {
    return (
      <div className="flex flex-col items-center gap-4 p-6 text-center">
        <Heading slot="title" className="text-title-3-semibold text-text-primary">
          {data?.payment?.status === "EXPIRED" ? "QR kedaluwarsa" : "QR dibatalkan"}
        </Heading>
        <p className="text-body-regular text-text-secondary">Belum ada pembayaran masuk. Stok dan voucher sudah dikembalikan.</p>
        <Button className="w-full" onClick={onReset} autoFocus>
          Pilih metode lagi
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-4 p-5 text-center sm:p-6">
      <Heading slot="title" className="text-body-medium text-text-secondary">
        Scan untuk membayar
      </Heading>
      {data?.payment?.qrString ? (
        <QrCode value={data.payment.qrString} label={`QRIS ${data.sale.number} sebesar ${formatRupiah(total)}`} className="size-64 max-w-full" />
      ) : (
        <div className="size-64 animate-pulse rounded-xl bg-background-tertiary-default" aria-hidden />
      )}
      <div>
        <p className="text-display-3-medium text-text-primary tabular-nums">{formatRupiah(total)}</p>
        <p className="flex items-center justify-center gap-1 text-body-2-regular text-text-tertiary" role="status">
          <RiTimeLine className="size-3.5" aria-hidden />
          {remaining === null ? "Menyiapkan QR…" : remaining > 0 ? `Menunggu pembayaran · ${mmss(remaining)}` : "Memeriksa status terakhir…"}
        </p>
      </div>
      {simulator && (
        <Button size="small" variant="secondary" onClick={() => simulate.mutate()} disabled={simulate.isPending}>
          {simulate.isPending ? "Memproses…" : "Simulasikan pelanggan membayar (dev)"}
        </Button>
      )}
      <Button variant="ghost" className="w-full" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
        {cancel.isPending ? "Membatalkan…" : "Batalkan QR & pilih metode lain"}
      </Button>
    </div>
  );
}
