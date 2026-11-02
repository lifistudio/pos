import type { TerminalReceipt } from "@/lib/payment-terminal";
import type { FrameOptions } from "./ecr-frame";

/** Jawaban EDC yang sudah diterjemahkan protokol. `progress` = EDC masih menunggu kartu/PIN. */
export type EcrResult =
  | { status: "approved"; receipt: Omit<TerminalReceipt, "provider"> }
  | { status: "declined"; message: string }
  | { status: "progress"; message: string };

/**
 * Satu protokol ECR (cara EDC tertentu menerima nominal & mengirim hasil). Protokol bank (BCA, Mandiri, BRI, BNI, …)
 * ditambahkan di sini setelah spesifikasi resminya didapat dari bank — lihat docs/ECR.md. Fungsi murni (tanpa I/O).
 */
export type EcrProtocol = {
  id: string;
  name: string;
  description: string;
  frame: FrameOptions;
  /** Data permintaan bayar (tanpa STX/ETX/LRC). `ref` = nomor unik transaksi kasir (maks. 20 karakter). */
  sale(amount: number, ref: string): Uint8Array;
  /** Terjemahkan satu paket dari EDC; null bila bukan jawaban yang dikenal (diabaikan). */
  parse(data: Uint8Array): EcrResult | null;
  /** Permintaan batal (bila protokol mendukung). */
  cancel?(ref: string): Uint8Array;
};

const enc = new TextEncoder();
const dec = new TextDecoder();
const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/**
 * POS ECR v1 — protokol terbuka berbasis JSON (ASCII) di atas framing STX/ETX/LRC. Untuk jembatan/aplikasi EDC
 * yang dibuat vendor atau komunitas (mis. aplikasi di EDC Android, atau perantara ke protokol bank). Spesifikasi: docs/ECR.md.
 */
export const kontenEcr: EcrProtocol = {
  id: "konten-ecr-v1",
  name: "POS ECR v1 (terbuka)",
  description: "Untuk EDC atau aplikasi perantara yang mendukung protokol terbuka POS ECR.",
  frame: { lrcInit: 0, lrcIncludesEtx: true },
  sale: (amount, ref) => enc.encode(JSON.stringify({ v: 1, cmd: "SALE", amount, currency: "IDR", ref })),
  cancel: (ref) => enc.encode(JSON.stringify({ v: 1, cmd: "CANCEL", ref })),
  parse(data) {
    let m: Record<string, unknown>;
    try {
      m = JSON.parse(dec.decode(data));
    } catch {
      return null;
    }
    if (!m || m.v !== 1) return null;
    if (m.status === "PROGRESS") return { status: "progress", message: str(m.message, 80) ?? "Menunggu EDC…" };
    if (m.status === "DECLINED" || m.status === "CANCELLED" || m.status === "ERROR") {
      return { status: "declined", message: str(m.message, 120) ?? (m.status === "CANCELLED" ? "Dibatalkan di mesin EDC." : "Transaksi ditolak EDC.") };
    }
    if (m.status === "APPROVED") {
      const approvalCode = str(m.approvalCode, 20);
      if (!approvalCode) return { status: "declined", message: "EDC menjawab berhasil tanpa kode approval — cek slip EDC." };
      return {
        status: "approved",
        receipt: {
          approvalCode,
          rrn: str(m.rrn, 20),
          terminalId: str(m.terminalId, 20),
          merchantId: str(m.merchantId, 30),
          traceNo: str(m.traceNo, 12),
          batchNo: str(m.batchNo, 12),
          cardType: str(m.cardType, 40),
          maskedPan: str(m.maskedPan, 19),
        },
      };
    }
    return null;
  },
};

export const ECR_PROTOCOLS: EcrProtocol[] = [kontenEcr];
export const findProtocol = (id: string) => ECR_PROTOCOLS.find((p) => p.id === id) ?? null;
