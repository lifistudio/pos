"use client";

import { maskPan, MASKED_PAN_RE, type TerminalReceipt } from "@/lib/payment-terminal";
import { ACK, encodeFrame, FrameParser, NAK } from "@/lib/ecr-frame";
import { findProtocol, type EcrProtocol } from "@/lib/ecr-protocols";
import type { TerminalSettings } from "./terminal-settings";

/** Kesalahan yang pesannya aman ditampilkan ke kasir. `uncertain` = EDC mungkin sudah memproses → wajib cek slip. */
export class TerminalError extends Error {
  constructor(
    message: string,
    readonly kind: "declined" | "timeout" | "cancelled" | "connection" | "config",
    readonly uncertain = false,
  ) {
    super(message);
  }
}

type SerialPortLike = {
  getInfo(): { usbVendorId?: number; usbProductId?: number };
  open(o: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
};
type SerialApi = { requestPort(o?: object): Promise<SerialPortLike>; getPorts(): Promise<SerialPortLike[]> };
const serialApi = () => (typeof navigator !== "undefined" ? (navigator as Navigator & { serial?: SerialApi }).serial : undefined);

export const serialSupported = () => !!serialApi();

export async function pairTerminal() {
  const api = serialApi();
  if (!api) throw new TerminalError("Browser ini tidak mendukung port serial. Pakai Chrome atau Edge di komputer.", "config");
  const port = await api.requestPort();
  const info = port.getInfo();
  return {
    label: info.usbVendorId ? `EDC USB ${info.usbVendorId.toString(16).padStart(4, "0")}:${(info.usbProductId ?? 0).toString(16).padStart(4, "0")}` : "EDC port serial",
    vendorId: info.usbVendorId,
    productId: info.usbProductId,
  };
}

export type ChargeOptions = { signal?: AbortSignal; onProgress?: (message: string) => void };

/** Rapikan hasil dari EDC: nomor kartu dipaksa tersamar, field kosong dibuang. */
function finalize(provider: string, r: Omit<TerminalReceipt, "provider">): TerminalReceipt {
  const masked = r.maskedPan && MASKED_PAN_RE.test(r.maskedPan) ? r.maskedPan : maskPan(r.maskedPan);
  const out: TerminalReceipt = { provider, approvalCode: r.approvalCode };
  for (const k of ["terminalId", "merchantId", "rrn", "traceNo", "batchNo", "cardType"] as const) {
    const v = r[k]?.replace(/[^\w .\-/]/g, "").trim();
    if (v) out[k] = v;
  }
  if (masked) out.maskedPan = masked;
  return out;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new TerminalError("Dibatalkan.", "cancelled"));
    });
  });

/** EDC tiruan untuk latihan: menyetujui setelah beberapa detik; nominal berakhiran 13 selalu ditolak (uji penolakan). */
async function simulate(amount: number, o: ChargeOptions): Promise<TerminalReceipt> {
  o.onProgress?.("Tempel/celup kartu di mesin EDC…");
  await sleep(1500, o.signal);
  o.onProgress?.("Pelanggan memasukkan PIN…");
  await sleep(1500, o.signal);
  if (amount % 100 === 13) throw new TerminalError("Kartu ditolak (simulasi: saldo tidak cukup).", "declined");
  const n = () => String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
  return finalize("simulator", { approvalCode: n(), rrn: `SIM${n()}${n()}`, terminalId: "SIM00001", traceNo: n(), cardType: "DEBIT SIMULASI", maskedPan: "************4242" });
}

/** Satu transaksi ECR lewat Web Serial: kirim permintaan (ulang bila NAK), baca jawaban sampai final atau batas waktu. */
async function viaSerial(protocol: EcrProtocol, settings: TerminalSettings, amount: number, ref: string, o: ChargeOptions): Promise<TerminalReceipt> {
  const api = serialApi();
  if (!api) throw new TerminalError("Browser ini tidak mendukung port serial. Pakai Chrome atau Edge di komputer.", "config");
  const dev = settings.device;
  if (!dev) throw new TerminalError("Mesin EDC belum dihubungkan. Buka Pengaturan EDC di kasir lalu ketuk Hubungkan EDC.", "config");
  const port = (await api.getPorts()).find((p) => (dev.vendorId ? p.getInfo().usbVendorId === dev.vendorId && p.getInfo().usbProductId === dev.productId : true));
  if (!port) throw new TerminalError("Mesin EDC tidak ditemukan. Cek kabel lalu hubungkan ulang di Pengaturan EDC.", "connection");

  try {
    await port.open({ baudRate: settings.baudRate });
  } catch (e) {
    throw new TerminalError(`Port EDC tidak bisa dibuka (${(e as Error).message}). Tutup aplikasi lain yang memakai port ini.`, "connection");
  }
  const writer = port.writable!.getWriter();
  const reader = port.readable!.getReader();
  const parser = new FrameParser(protocol.frame);
  const pending: ReturnType<FrameParser["push"]> = [];
  let sent = false; // permintaan sudah diterima EDC (ACK) → hasil bisa "tidak pasti" bila putus
  const deadline = Date.now() + settings.timeoutSec * 1000;

  const next = async (ms: number) => {
    while (!pending.length) {
      if (o.signal?.aborted) throw new TerminalError("Dibatalkan.", "cancelled", sent);
      const left = Math.min(ms, deadline - Date.now());
      if (left <= 0) return null;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const r = await Promise.race([
        reader.read(),
        new Promise<"timeout">((res) => (timer = setTimeout(() => res("timeout"), left))),
        new Promise<"abort">((res) => o.signal?.addEventListener("abort", () => res("abort"), { once: true })),
      ]).finally(() => clearTimeout(timer));
      if (r === "timeout") return null;
      if (r === "abort") throw new TerminalError("Dibatalkan.", "cancelled", sent);
      if (r.done) throw new TerminalError("Sambungan ke EDC terputus.", "connection", sent);
      pending.push(...parser.push(r.value));
    }
    return pending.shift()!;
  };

  try {
    const frame = encodeFrame(protocol.sale(amount, ref), protocol.frame);
    for (let attempt = 0; attempt < 3 && !sent; attempt++) {
      await writer.write(frame);
      const ev = await next(3000);
      if (ev?.type === "ack") sent = true;
      else if (ev?.type === "frame") {
        pending.unshift(ev); // sebagian EDC langsung menjawab tanpa ACK
        sent = true;
      }
    }
    if (!sent) throw new TerminalError("EDC tidak merespons. Pastikan EDC menyala, di menu utama, dan mode ECR/kabel aktif.", "connection");
    o.onProgress?.("Ikuti instruksi di mesin EDC…");

    for (;;) {
      const ev = await next(deadline - Date.now());
      if (!ev) throw new TerminalError("EDC tidak menjawab sampai batas waktu.", "timeout", true);
      if (ev.type === "bad-frame") {
        await writer.write(Uint8Array.of(NAK));
        continue;
      }
      if (ev.type !== "frame") continue;
      await writer.write(Uint8Array.of(ACK));
      const res = protocol.parse(ev.data);
      if (!res) continue;
      if (res.status === "progress") o.onProgress?.(res.message);
      else if (res.status === "declined") throw new TerminalError(res.message, "declined");
      else return finalize(protocol.id, res.receipt);
    }
  } catch (e) {
    if (e instanceof TerminalError && e.kind === "cancelled" && protocol.cancel) {
      await writer.write(encodeFrame(protocol.cancel(ref), protocol.frame)).catch(() => {});
    }
    if (e instanceof TerminalError) throw e;
    throw new TerminalError(`Gagal berkomunikasi dengan EDC: ${(e as Error).message}`, "connection", sent);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
    writer.releaseLock();
    await port.close().catch(() => {});
  }
}

/** Minta EDC menagih `amount`. Melempar TerminalError bila ditolak/batal/gagal. */
export async function chargeTerminal(settings: TerminalSettings, amount: number, ref: string, o: ChargeOptions = {}): Promise<TerminalReceipt> {
  if (settings.mode === "simulator") return simulate(amount, o);
  const protocol = findProtocol(settings.protocol);
  if (!protocol) throw new TerminalError("Protokol EDC belum dipilih di Pengaturan EDC.", "config");
  return viaSerial(protocol, settings, amount, ref, o);
}
