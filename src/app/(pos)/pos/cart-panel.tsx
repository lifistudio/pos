"use client";

import {
  RiAddLine,
  RiCloseLine,
  RiCloudOffLine,
  RiCopperCoinLine,
  RiPercentLine,
  RiCoupon3Line,
  RiDeleteBinLine,
  RiShoppingBag3Line,
  RiSubtractLine,
  RiUserLine,
  RiVipCrown2Line,
} from "@remixicon/react";
import { useState } from "react";
import { Button } from "@/components/base/buttons/button";
import { InputBase } from "@/components/base/input/input";
import { Kbd } from "@/components/base/kbd/kbd";
import { SegmentedControl, SegmentedControlItem } from "@/components/base/segmented-control/segmented-control";
import { displayPhone } from "@/components/app/customer-form";
import { formatNumber, formatRupiah } from "@/lib/format";
import type { TaxConfig } from "@/lib/pricing";
import { cx } from "@/utils/cx";
import type { CartPricingView } from "./pos-screen";
import type { useCart } from "./use-cart";
import type { ManualDiscount, PosCustomer } from "./use-quote";

type Cart = ReturnType<typeof useCart>;

function Totals({ cart, tax, pricing, quoting }: { cart: Cart; tax: TaxConfig; pricing: CartPricingView; quoting: boolean }) {
  return (
    <dl className={cx("flex flex-col gap-1.5 text-body-medium transition-opacity", quoting && "opacity-60")} aria-busy={quoting}>
      <div className="flex justify-between text-text-secondary">
        <dt>Subtotal · {formatNumber(cart.units)} item</dt>
        <dd className="tabular-nums">{formatRupiah(pricing.gross)}</dd>
      </div>
      {pricing.memberDiscount > 0 && (
        <div className="flex justify-between text-status-purple-text">
          <dt>Diskon member {pricing.memberDiscountBps / 100}%</dt>
          <dd className="tabular-nums">−{formatRupiah(pricing.memberDiscount)}</dd>
        </div>
      )}
      {pricing.voucherDiscount > 0 && (
        <div className="flex justify-between text-status-lime-text">
          <dt>Voucher {pricing.voucher?.code}</dt>
          <dd className="tabular-nums">−{formatRupiah(pricing.voucherDiscount)}</dd>
        </div>
      )}
      {pricing.manualDiscount > 0 && (
        <div className="flex justify-between text-status-orange-text">
          <dt>Diskon manual</dt>
          <dd className="tabular-nums">−{formatRupiah(pricing.manualDiscount)}</dd>
        </div>
      )}
      {pricing.pointsDiscount > 0 && (
        <div className="flex justify-between text-status-yellow-text">
          <dt>Tukar {formatNumber(pricing.points?.redeemed ?? 0)} poin</dt>
          <dd className="tabular-nums">−{formatRupiah(pricing.pointsDiscount)}</dd>
        </div>
      )}
      {tax.enabled && (
        <div className="flex justify-between text-text-secondary">
          <dt>
            PPN {tax.rateBps / 100}%{tax.inclusive ? " (termasuk)" : ""}
          </dt>
          <dd className="tabular-nums">{formatRupiah(pricing.taxTotal)}</dd>
        </div>
      )}
      <div className="mt-1 flex items-baseline justify-between">
        <dt className="text-headline-medium text-text-primary">Total</dt>
        <dd className="text-display-4-medium text-text-primary tabular-nums">{formatRupiah(pricing.total)}</dd>
      </div>
      {pricing.pointsEarned > 0 && <p className="text-end text-body-2-regular text-text-tertiary">+{formatNumber(pricing.pointsEarned)} poin untuk member</p>}
    </dl>
  );
}

function CustomerRow({ customer, onPick, onClear }: { customer: PosCustomer | null; onPick: () => void; onClear: () => void }) {
  if (!customer) {
    return (
      <Button size="small" variant="secondary" leadingIcon={RiUserLine} className="w-full justify-start" onClick={onPick}>
        Tambah customer
        <Kbd className="ms-auto hidden lg:inline-flex">F4</Kbd>
      </Button>
    );
  }
  return (
    <div className="flex items-center gap-2 rounded-xl bg-background-primary-default px-3 py-2 shadow-card">
      {customer.isMember ? (
        <RiVipCrown2Line className="size-4 shrink-0 text-status-purple-text" aria-hidden />
      ) : (
        <RiUserLine className="size-4 shrink-0 text-foreground-icon-tertiary" aria-hidden />
      )}
      <button type="button" onClick={onPick} className="min-w-0 flex-1 cursor-pointer text-start outline-none" aria-label={`Ganti customer ${customer.name}`}>
        <span className="block truncate text-body-medium text-text-primary">{customer.name}</span>
        <span className="block truncate text-caption-1-regular text-text-tertiary">
          {customer.isMember ? `${customer.tierName ?? "Member"} · ${formatNumber(customer.points)} poin` : displayPhone(customer.phone)}
        </span>
      </button>
      <Button size="xs" variant="ghost" iconOnly leadingIcon={RiCloseLine} aria-label="Lepas customer" onClick={onClear} />
    </div>
  );
}

function VoucherRow({ code, pricing, onApply }: { code: string | null; pricing: CartPricingView; onApply: (code: string | null) => void }) {
  const [draft, setDraft] = useState("");
  if (code) {
    const v = pricing.voucher;
    const rejected = !!v && !v.applied;
    return (
      <div className={cx("flex items-start gap-2 rounded-xl px-3 py-2", rejected ? "bg-status-rose-background" : "bg-background-primary-default shadow-card")}>
        <RiCoupon3Line className={cx("mt-0.5 size-4 shrink-0", rejected ? "text-status-rose-text" : "text-status-lime-text")} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-mono text-body-medium text-text-primary">{code}</p>
          <p className={cx("text-caption-1-regular", rejected ? "text-status-rose-text" : "text-text-tertiary")} role="status">
            {!v ? "Memeriksa voucher…" : v.applied ? `Hemat ${formatRupiah(pricing.voucherDiscount)}` : v.reason}
          </p>
        </div>
        <Button size="xs" variant="ghost" iconOnly leadingIcon={RiCloseLine} aria-label="Hapus voucher" onClick={() => onApply(null)} />
      </div>
    );
  }
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (draft.trim()) onApply(draft.trim().toUpperCase());
        setDraft("");
      }}
    >
      <InputBase
        aria-label="Kode voucher"
        placeholder="Kode voucher"
        leadingIcon={RiCoupon3Line}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        size="small"
        fieldClassName="flex-1"
        className="font-mono uppercase placeholder:font-sans placeholder:normal-case"
      />
      <Button type="submit" size="small" variant="secondary" disabled={!draft.trim()}>
        Pakai
      </Button>
    </form>
  );
}

/** Diskon manual kasir (nominal/persen + alasan). Tanpa hak `pos:discount_manual` → PIN atasan saat bayar. */
function ManualDiscountRow({ value, pricing, onChange }: { value: ManualDiscount | null; pricing: CartPricingView; onChange: (d: ManualDiscount | null) => void }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<ManualDiscount["type"]>("PERCENT");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  if (value) {
    return (
      <div className="flex items-start gap-2 rounded-xl bg-background-primary-default px-3 py-2 shadow-card">
        <RiPercentLine className="mt-0.5 size-4 shrink-0 text-status-orange-text" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-body-medium text-text-primary">
            Diskon manual {value.type === "PERCENT" ? `${value.value / 100}%` : formatRupiah(value.value)}
          </p>
          <p className="truncate text-caption-1-regular text-text-tertiary" role="status">
            {pricing.manual?.capped ? "Dibatasi maksimal kebijakan toko · " : ""}
            {value.reason}
            {pricing.manualNeedsApproval && " · perlu PIN atasan"}
          </p>
        </div>
        <Button size="xs" variant="ghost" iconOnly leadingIcon={RiCloseLine} aria-label="Hapus diskon manual" onClick={() => onChange(null)} />
      </div>
    );
  }
  if (!open) {
    return (
      <Button size="small" variant="ghost" leadingIcon={RiPercentLine} className="self-start" onClick={() => setOpen(true)}>
        Diskon manual
      </Button>
    );
  }
  const n = Number(amount || 0);
  const valid = n > 0 && (type === "NOMINAL" || n <= 100) && reason.trim().length >= 3;
  return (
    <form
      className="flex flex-col gap-2 rounded-xl border border-border-button-default p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        onChange({ type, value: type === "PERCENT" ? Math.round(n * 100) : n, reason: reason.trim() });
        setOpen(false);
      }}
    >
      <div className="flex items-center gap-2">
        <SegmentedControl aria-label="Jenis diskon" selectedKeys={new Set([type])} onSelectionChange={(k) => { const t = [...k][0]; if (t) setType(t as ManualDiscount["type"]); }}>
          <SegmentedControlItem id="PERCENT">%</SegmentedControlItem>
          <SegmentedControlItem id="NOMINAL">Rp</SegmentedControlItem>
        </SegmentedControl>
        <InputBase
          aria-label={type === "PERCENT" ? "Persen diskon" : "Nominal diskon"}
          inputMode="numeric"
          size="small"
          value={type === "NOMINAL" && amount ? Number(amount).toLocaleString("id-ID") : amount}
          onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
          fieldClassName="flex-1"
          className="tabular-nums"
          autoFocus
        />
      </div>
      <InputBase aria-label="Alasan diskon" placeholder="Alasan (mis. barang display)" size="small" value={reason} onChange={(e) => setReason(e.target.value)} />
      <div className="flex justify-end gap-2">
        <Button type="button" size="xs" variant="ghost" onClick={() => setOpen(false)}>
          Batal
        </Button>
        <Button type="submit" size="xs" disabled={!valid}>
          Pakai
        </Button>
      </div>
    </form>
  );
}

/** Tukar poin member: satu ketuk untuk pakai maksimal, atau isi jumlah sendiri. */
function PointsRow({ pricing, value, onChange }: { pricing: CartPricingView; value: number; onChange: (points: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const p = pricing.points;
  if (!p || p.balance <= 0) return null;
  if (value > 0) {
    return (
      <div className={cx("flex items-start gap-2 rounded-xl px-3 py-2", p.reason ? "bg-status-rose-background" : "bg-background-primary-default shadow-card")}>
        <RiCopperCoinLine className={cx("mt-0.5 size-4 shrink-0", p.reason ? "text-status-rose-text" : "text-status-yellow-text")} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-body-medium text-text-primary">Tukar {formatNumber(p.redeemed || value)} poin</p>
          <p className={cx("text-caption-1-regular", p.reason ? "text-status-rose-text" : "text-text-tertiary")} role="status">
            {p.reason ?? `Hemat ${formatRupiah(pricing.pointsDiscount)} · sisa ${formatNumber(p.balance - p.redeemed)} poin`}
          </p>
        </div>
        <Button size="xs" variant="ghost" iconOnly leadingIcon={RiCloseLine} aria-label="Batal tukar poin" onClick={() => onChange(0)} />
      </div>
    );
  }
  const usable = p.maxRedeemable >= p.minRedeem ? p.maxRedeemable : 0;
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const n = Number(draft || 0);
        onChange(n > 0 ? n : usable);
        setDraft(null);
      }}
    >
      <InputBase
        aria-label="Jumlah poin yang ditukar"
        placeholder={usable ? `Tukar poin (maks ${formatNumber(usable)})` : `${formatNumber(p.balance)} poin · belum bisa ditukar`}
        leadingIcon={RiCopperCoinLine}
        inputMode="numeric"
        value={draft ?? ""}
        onChange={(e) => setDraft(e.target.value.replace(/\D/g, ""))}
        size="small"
        fieldClassName="flex-1"
        disabled={!usable}
      />
      <Button type="submit" size="small" variant="secondary" disabled={!usable}>
        {draft ? "Pakai" : `Pakai ${formatRupiah(usable * p.pointValue)}`}
      </Button>
    </form>
  );
}

export function CartPanel({
  cart,
  tax,
  pricing,
  quoting,
  offline,
  customer,
  onPickCustomer,
  onClearCustomer,
  voucherCode,
  onApplyVoucher,
  pointsRedeem,
  onPointsRedeemChange,
  manualDiscount,
  onManualDiscountChange,
  onPay,
  mobileOpen,
  onMobileOpenChange,
}: {
  cart: Cart;
  tax: TaxConfig;
  pricing: CartPricingView;
  quoting: boolean;
  offline: boolean;
  customer: PosCustomer | null;
  onPickCustomer: () => void;
  onClearCustomer: () => void;
  voucherCode: string | null;
  onApplyVoucher: (code: string | null) => void;
  pointsRedeem: number;
  onPointsRedeemChange: (points: number) => void;
  manualDiscount: ManualDiscount | null;
  onManualDiscountChange: (d: ManualDiscount | null) => void;
  onPay: () => void;
  mobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
}) {
  const empty = cart.lines.length === 0;

  const body = (
    <>
      <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-2">
        <h2 className="text-headline-medium text-text-primary">Keranjang</h2>
        {!empty && (
          <Button size="xs" variant="ghost" onClick={() => cart.dispatch({ type: "clear" })}>
            Kosongkan
          </Button>
        )}
      </div>
      <div className="relative min-h-0 flex-1 overflow-y-auto px-4">
        {empty ? (
          <div className="flex h-full min-h-32 flex-col items-center justify-center gap-2 text-center">
            <RiShoppingBag3Line className="size-6 text-foreground-icon-tertiary" aria-hidden />
            <p className="max-w-[28ch] text-body-regular text-text-tertiary">Scan barcode atau ketuk produk untuk menambahkannya.</p>
          </div>
        ) : (
          <ul className="flex flex-col divide-y divide-separator-border" aria-live="polite">
            {cart.lines.map((l) => (
              <li key={l.variantId} className="flex flex-col gap-2 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-body-medium text-text-primary">{l.productName}</p>
                    <p className="truncate text-body-2-regular text-text-tertiary">
                      {l.title !== "Default" ? `${l.title} · ` : ""}
                      {formatRupiah(l.price)}
                    </p>
                  </div>
                  <p className="shrink-0 text-body-medium text-text-primary tabular-nums">{formatRupiah(l.price * l.qty)}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button
                    size="small"
                    variant="secondary"
                    iconOnly
                    leadingIcon={RiSubtractLine}
                    aria-label={`Kurangi ${l.productName}`}
                    onClick={() => cart.dispatch({ type: "setQty", variantId: l.variantId, qty: l.qty - 1 })}
                  />
                  <span className="min-w-10 text-center text-body-medium text-text-primary tabular-nums" aria-label={`Jumlah ${l.qty}`}>
                    {l.qty}
                  </span>
                  <Button
                    size="small"
                    variant="secondary"
                    iconOnly
                    leadingIcon={RiAddLine}
                    aria-label={`Tambah ${l.productName}`}
                    disabled={l.qty >= l.available}
                    onClick={() => cart.dispatch({ type: "setQty", variantId: l.variantId, qty: l.qty + 1 })}
                  />
                  {l.qty >= l.available && <span className="text-caption-1-regular text-status-yellow-text">batas stok</span>}
                  <Button
                    size="small"
                    variant="ghost"
                    iconOnly
                    leadingIcon={RiDeleteBinLine}
                    aria-label={`Hapus ${l.productName}`}
                    className="ms-auto"
                    onClick={() => cart.dispatch({ type: "remove", variantId: l.variantId })}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex flex-col gap-3 border-t border-separator-border p-4">
        {offline ? (
          <p className="flex gap-2 rounded-xl bg-status-yellow-background p-3 text-body-2-regular text-status-yellow-text">
            <RiCloudOffLine className="mt-0.5 size-4 shrink-0" aria-hidden />
            Mode offline: member, voucher, tukar poin, diskon manual, dan QRIS dinamis tidak tersedia. Transaksi disimpan di perangkat lalu disinkronkan.
          </p>
        ) : (
          <>
            <CustomerRow customer={customer} onPick={onPickCustomer} onClear={onClearCustomer} />
            <VoucherRow code={voucherCode} pricing={pricing} onApply={onApplyVoucher} />
            {customer?.isMember && <PointsRow pricing={pricing} value={pointsRedeem} onChange={onPointsRedeemChange} />}
            {!empty && <ManualDiscountRow value={manualDiscount} pricing={pricing} onChange={onManualDiscountChange} />}
          </>
        )}
        <Totals cart={cart} tax={tax} pricing={pricing} quoting={quoting} />
        <Button size="medium" className="h-14 w-full text-headline-medium" disabled={empty || quoting} onClick={onPay}>
          Bayar {empty ? "" : formatRupiah(pricing.total)}
          <Kbd className="ms-2 hidden lg:inline-flex">F8</Kbd>
        </Button>
      </div>
    </>
  );

  return (
    <>
      {/* Desktop & tablet lebar: panel tetap di kanan */}
      <aside className="hidden w-[380px] shrink-0 flex-col border-s border-separator-border bg-background-secondary-default lg:flex xl:w-[420px]" aria-label="Keranjang">
        {body}
      </aside>

      {/* HP & tablet: bar ringkas di bawah, keranjang dibuka sebagai panel */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-separator-border bg-background-primary-default p-3 lg:hidden">
        <Button className="h-14 w-full text-headline-medium" onClick={() => onMobileOpenChange(true)} disabled={empty}>
          {empty ? "Keranjang kosong" : `${formatNumber(cart.units)} item · ${formatRupiah(pricing.total)}`}
        </Button>
      </div>
      <div className={cx("fixed inset-0 z-40 lg:hidden", mobileOpen ? "" : "pointer-events-none")} aria-hidden={!mobileOpen}>
        <button
          type="button"
          aria-label="Tutup keranjang"
          tabIndex={mobileOpen ? 0 : -1}
          className={cx("absolute inset-0 bg-black/30 transition-opacity duration-200", mobileOpen ? "opacity-100" : "opacity-0")}
          onClick={() => onMobileOpenChange(false)}
        />
        <div
          role="dialog"
          aria-label="Keranjang"
          className={cx(
            "absolute inset-x-0 bottom-0 flex max-h-[90dvh] flex-col rounded-t-3xl bg-background-primary-default shadow-dropdown transition-transform duration-250 ease-out",
            mobileOpen ? "translate-y-0" : "translate-y-full",
          )}
        >
          {body}
        </div>
      </div>
    </>
  );
}
