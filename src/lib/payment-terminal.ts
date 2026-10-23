/**
 * Hasil transaksi dari mesin EDC (terminal kartu) yang tercatat di pembayaran. Tidak pernah berisi nomor kartu
 * lengkap, CVV, atau PIN — hanya 4 digit terakhir (PCI DSS). Dipakai bersama client (driver ECR) & server (validasi).
 */
export type TerminalReceipt = {
  /** Driver/protokol yang dipakai, mis. "simulator" atau nama protokol bank. */
  provider: string;
  approvalCode: string;
  terminalId?: string | null;
  merchantId?: string | null;
  /** Retrieval reference number dari host bank. */
  rrn?: string | null;
  traceNo?: string | null;
  batchNo?: string | null;
  /** Mis. "DEBIT BCA", "VISA", "MASTERCARD", "QRIS". */
  cardType?: string | null;
  /** Nomor kartu tersamar, maks. 4 digit terakhir terlihat: "************1234". */
  maskedPan?: string | null;
};

/** Hanya 4 digit terakhir boleh terlihat; sisanya * atau X. */
export const MASKED_PAN_RE = /^[*Xx]{0,15}\d{4}$/;

/** Samarkan nomor kartu apa pun yang diterima dari terminal → hanya 4 digit terakhir. */
export function maskPan(pan: string | null | undefined) {
  const digits = (pan ?? "").replace(/[^\d*Xx]/g, "");
  const last4 = digits.replace(/[^\d]/g, "").slice(-4);
  return last4.length === 4 ? `${"*".repeat(Math.max(0, Math.min(15, digits.length - 4)))}${last4}` : null;
}
