import { formatRupiah } from "@/lib/format";
import { PAYMENT_LABEL } from "@/lib/pricing";
import type { TerminalReceipt } from "@/lib/payment-terminal";
import type { ReceiptDoc } from "./layout";

/** Bentuk transaksi dari GET /api/v1/sales/{id} yang dibutuhkan struk. */
export type ReceiptSale = {
  number: string;
  status: "PENDING" | "PAID" | "VOIDED";
  subtotal: number;
  discountTotal: number;
  memberDiscount: number;
  voucherCode: string | null;
  voucherDiscount: number;
  pointsRedeemed: number;
  pointsDiscount: number;
  shippingFee: number;
  pointsEarned: number;
  taxTotal: number;
  total: number;
  customer: { name: string; memberNo: string | null; points: number } | null;
  taxSnapshot: { enabled: boolean; rateBps: number; inclusive: boolean };
  createdAt: string;
  voidReason: string | null;
  items: { productName: string; variantTitle: string; qty: number; unitPrice: number }[];
  payments: { method: string; amount: number; tendered: number | null; change: number; reference: string | null; terminal?: TerminalReceipt | null }[];
  branch: { name: string; address: string | null; phone: string | null; timezone: string; settings: { receiptHeader?: string; receiptFooter?: string } };
  cashier: { name: string };
};

export function saleToReceipt(sale: ReceiptSale): ReceiptDoc {
  const header = sale.branch.settings.receiptHeader?.trim();
  const date = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: sale.branch.timezone }).format(new Date(sale.createdAt));
  const summary: ReceiptDoc["summary"] = [{ label: "Subtotal", value: formatRupiah(sale.subtotal + sale.discountTotal) }];
  if (sale.memberDiscount > 0) summary.push({ label: "Diskon member", value: `-${formatRupiah(sale.memberDiscount)}` });
  if (sale.voucherDiscount > 0) summary.push({ label: `Voucher ${sale.voucherCode ?? ""}`.trim(), value: `-${formatRupiah(sale.voucherDiscount)}` });
  if (sale.pointsDiscount > 0) summary.push({ label: `Tukar ${sale.pointsRedeemed} poin`, value: `-${formatRupiah(sale.pointsDiscount)}` });
  if (sale.shippingFee > 0) summary.push({ label: "Ongkir", value: formatRupiah(sale.shippingFee) });
  if (sale.taxSnapshot.enabled) summary.push({ label: `PPN ${sale.taxSnapshot.rateBps / 100}%${sale.taxSnapshot.inclusive ? " (termasuk)" : ""}`, value: formatRupiah(sale.taxTotal) });
  summary.push({ label: "TOTAL", value: formatRupiah(sale.total), bold: true });

  const payments: [string, string][] = [];
  for (const p of sale.payments) {
    payments.push([PAYMENT_LABEL[p.method] ?? p.method, formatRupiah(p.tendered ?? p.amount)]);
    if (p.terminal) {
      // Dari EDC terhubung: jenis kartu + 4 digit terakhir, approval, RRN (nomor kartu lengkap tidak pernah disimpan).
      const card = [p.terminal.cardType, p.terminal.maskedPan ? `**${p.terminal.maskedPan.slice(-4)}` : null].filter(Boolean).join(" ");
      if (card) payments.push(["Kartu", card]);
      payments.push(["Approval", p.terminal.approvalCode]);
      if (p.terminal.rrn) payments.push(["RRN", p.terminal.rrn]);
      if (p.terminal.terminalId) payments.push(["TID", p.terminal.terminalId]);
    } else if (p.reference) payments.push(["Ref.", p.reference]);
    if (p.change > 0) payments.push(["Kembali", formatRupiah(p.change)]);
  }
  const extra: [string, string][] = [];
  if (sale.customer?.memberNo && sale.pointsEarned > 0 && sale.status === "PAID") {
    extra.push(["Poin didapat", `+${sale.pointsEarned}`], ["Total poin", String(sale.customer.points)]);
  }
  if (sale.status === "VOIDED" && sale.voidReason) extra.push(["Alasan batal", sale.voidReason]);

  const meta: [string, string][] = [
    ["No.", sale.number],
    ["Waktu", date],
    ["Kasir", sale.cashier.name],
  ];
  if (sale.customer) meta.push(["Customer", sale.customer.memberNo ? `${sale.customer.name} (${sale.customer.memberNo})` : sale.customer.name]);

  return {
    storeName: sale.branch.name,
    headerLines: header ? header.split("\n") : [sale.branch.address, sale.branch.phone].filter((x): x is string => !!x),
    banner: sale.status === "VOIDED" ? "DIBATALKAN" : sale.status === "PENDING" ? "MENUNGGU PEMBAYARAN" : null,
    meta,
    items: sale.items.map((i) => ({
      name: i.variantTitle !== "Default" ? `${i.productName} ${i.variantTitle}` : i.productName,
      qtyLine: `${i.qty} x ${formatRupiah(i.unitPrice)}`,
      amount: formatRupiah(i.qty * i.unitPrice),
    })),
    summary,
    payments,
    extra,
    footerLines: (sale.branch.settings.receiptFooter?.trim() || "Terima kasih telah berbelanja").split("\n"),
  };
}

/** Struk sementara transaksi offline (nomor resmi INV/… diberikan saat sinkron). */
export function offlineToReceipt(
  sale: { localRef: string; createdAt: string; total: number; items: { name: string; qty: number; unitPrice: number }[]; payments: { method: string; amount: number; tendered?: number | null }[] },
  opts: { branchName: string; cashierName: string },
): ReceiptDoc {
  const change = sale.payments.reduce((s, p) => s + Math.max(0, (p.tendered ?? p.amount) - p.amount), 0);
  return {
    storeName: opts.branchName,
    headerLines: [],
    banner: "STRUK SEMENTARA (OFFLINE)",
    meta: [
      ["Ref.", sale.localRef],
      ["Waktu", new Date(sale.createdAt).toLocaleString("id-ID")],
      ["Kasir", opts.cashierName],
    ],
    items: sale.items.map((i) => ({ name: i.name, qtyLine: `${i.qty} x ${formatRupiah(i.unitPrice)}`, amount: formatRupiah(i.qty * i.unitPrice) })),
    summary: [{ label: "TOTAL", value: formatRupiah(sale.total), bold: true }],
    payments: [...sale.payments.map((p): [string, string] => [PAYMENT_LABEL[p.method] ?? p.method, formatRupiah(p.tendered ?? p.amount)]), ...(change > 0 ? [["Kembali", formatRupiah(change)] as [string, string]] : [])],
    extra: [],
    footerLines: ["Nomor resmi diterbitkan saat kasir kembali online.", "Terima kasih"],
  };
}
