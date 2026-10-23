import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ApiClientError } from "@/lib/api-client";
import { formatRupiah } from "@/lib/format";
import { PAYMENT_LABEL } from "@/lib/pricing";
import type { TerminalReceipt } from "@/lib/payment-terminal";
import { apiServer } from "@/server/api/server-client";
import { ReceiptActions } from "./receipt-actions";

export const metadata: Metadata = { title: "Struk" };

type Sale = {
  id: string;
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
  items: { id: string; productName: string; variantTitle: string; qty: number; unitPrice: number; lineTotal: number }[];
  payments: { id: string; method: string; amount: number; tendered: number | null; change: number; reference: string | null; terminal?: TerminalReceipt | null }[];
  branch: { name: string; address: string | null; phone: string | null; timezone: string; settings: { receiptHeader?: string; receiptFooter?: string } };
  cashier: { name: string };
};

function Line({ left, right, bold }: { left: React.ReactNode; right: React.ReactNode; bold?: boolean }) {
  return (
    <div className={`flex justify-between gap-2 ${bold ? "font-semibold" : ""}`}>
      <span className="min-w-0">{left}</span>
      <span className="shrink-0 tabular-nums">{right}</span>
    </div>
  );
}

async function Receipt({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ w?: string; print?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const sale = await apiServer<{ data: Sale }>(`/sales/${id}`).then(
    (r) => r.data,
    (error) => {
      if (error instanceof ApiClientError && error.status === 404) notFound();
      throw error;
    },
  );
  const width = sp.w === "58" ? 58 : 80;
  const date = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: sale.branch.timezone }).format(new Date(sale.createdAt));
  const header = sale.branch.settings.receiptHeader?.trim();
  const footer = sale.branch.settings.receiptFooter?.trim() || "Terima kasih telah berbelanja";

  return (
    <div className="flex min-h-dvh flex-col items-center gap-4 bg-background-secondary-default py-6 print:block print:bg-white print:py-0">
      <style>{`@page { size: ${width}mm auto; margin: 0; }`}</style>
      <ReceiptActions saleId={sale.id} width={width} autoPrint={sp.print === "1"} />
      <article
        className="relative bg-white px-3 py-4 font-mono text-[11px] leading-[1.45] text-black shadow-card print:shadow-none"
        style={{ width: `${width}mm` }}
        aria-label={`Struk ${sale.number}`}
      >
        {sale.status === "VOIDED" && (
          <p className="mb-2 border-y border-dashed border-black py-1 text-center font-semibold tracking-widest">DIBATALKAN</p>
        )}
        <header className="text-center">
          <p className="text-[13px] font-semibold">{sale.branch.name}</p>
          {header ? (
            <p className="whitespace-pre-line">{header}</p>
          ) : (
            <>
              {sale.branch.address && <p>{sale.branch.address}</p>}
              {sale.branch.phone && <p>{sale.branch.phone}</p>}
            </>
          )}
        </header>
        <hr className="my-2 border-dashed border-black" />
        <Line left="No." right={sale.number} />
        <Line left="Waktu" right={date} />
        <Line left="Kasir" right={sale.cashier.name} />
        {sale.customer && <Line left="Customer" right={sale.customer.memberNo ? `${sale.customer.name} (${sale.customer.memberNo})` : sale.customer.name} />}
        <hr className="my-2 border-dashed border-black" />
        <ul className="flex flex-col gap-1">
          {sale.items.map((i) => (
            <li key={i.id}>
              <p>
                {i.productName}
                {i.variantTitle !== "Default" && ` ${i.variantTitle}`}
              </p>
              <Line left={`${i.qty} x ${formatRupiah(i.unitPrice)}`} right={formatRupiah(i.unitPrice * i.qty)} />
            </li>
          ))}
        </ul>
        <hr className="my-2 border-dashed border-black" />
        <Line left="Subtotal" right={formatRupiah(sale.subtotal + sale.discountTotal)} />
        {sale.memberDiscount > 0 && <Line left="Diskon member" right={`-${formatRupiah(sale.memberDiscount)}`} />}
        {sale.voucherDiscount > 0 && <Line left={`Voucher ${sale.voucherCode}`} right={`-${formatRupiah(sale.voucherDiscount)}`} />}
        {sale.pointsDiscount > 0 && <Line left={`Tukar ${sale.pointsRedeemed} poin`} right={`-${formatRupiah(sale.pointsDiscount)}`} />}
        {sale.shippingFee > 0 && <Line left="Ongkir" right={formatRupiah(sale.shippingFee)} />}
        {sale.taxSnapshot.enabled && (
          <Line left={`PPN ${sale.taxSnapshot.rateBps / 100}%${sale.taxSnapshot.inclusive ? " (termasuk)" : ""}`} right={formatRupiah(sale.taxTotal)} />
        )}
        <Line left="TOTAL" right={formatRupiah(sale.total)} bold />
        <hr className="my-2 border-dashed border-black" />
        {sale.payments.map((p) => (
          <div key={p.id}>
            <Line left={PAYMENT_LABEL[p.method] ?? p.method} right={formatRupiah(p.tendered ?? p.amount)} />
            {p.terminal ? (
              <>
                {(p.terminal.cardType || p.terminal.maskedPan) && (
                  <Line left="Kartu" right={[p.terminal.cardType, p.terminal.maskedPan ? `**${p.terminal.maskedPan.slice(-4)}` : null].filter(Boolean).join(" ")} />
                )}
                <Line left="Approval" right={p.terminal.approvalCode} />
                {p.terminal.rrn && <Line left="RRN" right={p.terminal.rrn} />}
                {p.terminal.terminalId && <Line left="TID" right={p.terminal.terminalId} />}
              </>
            ) : (
              p.reference && <Line left="Ref." right={p.reference} />
            )}
            {p.change > 0 && <Line left="Kembali" right={formatRupiah(p.change)} />}
          </div>
        ))}
        {sale.customer?.memberNo && sale.pointsEarned > 0 && sale.status === "PAID" && (
          <>
            <hr className="my-2 border-dashed border-black" />
            <Line left="Poin didapat" right={`+${sale.pointsEarned}`} />
            <Line left="Total poin" right={String(sale.customer.points)} />
          </>
        )}
        {sale.status === "VOIDED" && sale.voidReason && <p className="mt-2">Alasan batal: {sale.voidReason}</p>}
        <hr className="my-2 border-dashed border-black" />
        <p className="text-center whitespace-pre-line">{footer}</p>
      </article>
    </div>
  );
}

export default function ReceiptPage({ params, searchParams }: PageProps<"/pos/receipt/[id]">) {
  return (
    <Suspense fallback={<p className="p-6 text-center text-body-medium text-text-tertiary">Menyiapkan struk…</p>}>
      <Receipt params={params} searchParams={searchParams as Promise<{ w?: string; print?: string }>} />
    </Suspense>
  );
}
