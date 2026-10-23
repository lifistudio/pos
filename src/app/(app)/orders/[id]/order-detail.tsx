"use client";

import { RiCheckboxCircleFill, RiQrCodeLine, RiTimeLine, RiTruckLine } from "@remixicon/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Chip } from "@/components/base/badges/chip";
import { Breadcrumb, BreadcrumbItem } from "@/components/base/breadcrumb/breadcrumb";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { Select, SelectItem } from "@/components/base/select/select";
import { PageHeader, Panel, Skeleton } from "@/components/app/page-header";
import { QrCode } from "@/components/app/qr-code";
import { useSession } from "@/components/app/session-context";
import { ConfirmDialog } from "@/components/app/sheet";
import { Timeline } from "@/components/app/timeline";
import { CourierPicker } from "@/components/app/courier-picker";
import { useToast } from "@/components/app/toast";
import { mmss, useRemaining } from "@/hooks/use-remaining";
import { api } from "@/lib/api-client";
import { readApiError } from "@/lib/form-errors";
import { formatDateTime, formatNumber, formatRupiah } from "@/lib/format";
import { PAYMENT_LABEL } from "@/lib/pricing";
import { CHANNEL_LABEL, ORDER_STATUS, type Channel, type OrderStatus } from "../order-labels";

type Payment = { id: string; provider: string; gatewayOrderId: string; amount: number; status: "PENDING" | "PAID" | "EXPIRED" | "FAILED" | "CANCELLED"; qrString: string | null; expiresAt: string; paidAt: string | null };
type Order = {
  id: string;
  number: string;
  channel: Channel;
  externalOrderNo: string | null;
  connectionId: string | null;
  status: OrderStatus;
  recipientName: string;
  recipientPhone: string;
  shippingAddress: string;
  courier: string | null;
  trackingNo: string | null;
  shippingFee: number;
  subtotal: number;
  taxTotal: number;
  total: number;
  note: string | null;
  reservedUntil: string;
  paidAt: string | null;
  packedAt: string | null;
  shippedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
  items: { variantId: string; productName: string; variantTitle: string; sku: string; qty: number; unitPrice: number; lineTotal: number }[];
  branch: { name: string };
  customer: { id: string; name: string; memberNo: string | null } | null;
  createdByUser: { name: string } | null;
  sale: { id: string; number: string; status: string; refundTotal: number } | null;
  payment: Payment | null;
  qris: { available: boolean; provider: string | null; simulator: boolean };
};

const MANUAL_METHODS = ["TRANSFER", "EWALLET", "QRIS", "CASH"] as const;

function QrisPanel({ order, onChanged }: { order: Order; onChanged: (o: Order) => void }) {
  const toast = useToast();
  const p = order.payment;
  const active = p?.status === "PENDING" && p.qrString ? p : null;
  const remaining = useRemaining(active?.expiresAt ?? null);
  const expired = remaining === 0;

  const create = useMutation({
    mutationFn: () => api<{ data: Order }>(`/online-orders/${order.id}/payments/qris`, { method: "POST", body: {} }).then((r) => r.data),
    onSuccess: onChanged,
    onError: (e) => toast.show({ status: "error", title: readApiError(e).message }),
  });
  const simulate = useMutation({
    mutationFn: () => api<{ data: { order: Order } }>(`/online-orders/${order.id}/payments/simulate`, { method: "POST", body: {} }).then((r) => r.data.order),
    onSuccess: (o) => {
      onChanged(o);
      if (o.status === "PAID") toast.show({ status: "success", title: "Pembayaran QRIS diterima", description: `${order.number} lunas. Lanjut kemas barangnya.` });
    },
    onError: (e) => toast.show({ status: "error", title: readApiError(e).message }),
  });

  if (!order.qris.available) {
    return <p className="text-body-2-regular text-text-tertiary">QRIS dinamis belum diaktifkan di server. Catat pembayaran manual di bawah.</p>;
  }
  if (!active || expired) {
    return (
      <div className="flex flex-col gap-2">
        {p && p.status !== "PAID" && (
          <p className="text-body-2-regular text-text-tertiary">{expired || p.status === "EXPIRED" ? "QR sebelumnya kedaluwarsa." : p.status === "FAILED" ? "Permintaan QR sebelumnya gagal." : null}</p>
        )}
        <Button leadingIcon={RiQrCodeLine} onClick={() => create.mutate()} disabled={create.isPending}>
          {create.isPending ? "Membuat QR…" : p ? "Buat QR baru" : "Tagih dengan QRIS"}
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <QrCode value={active.qrString!} label={`QRIS ${order.number} sebesar ${formatRupiah(active.amount)}`} className="size-56" />
      <div>
        <p className="text-title-3-semibold text-text-primary tabular-nums">{formatRupiah(active.amount)}</p>
        <p className="flex items-center justify-center gap-1 text-body-2-regular text-text-tertiary" aria-live="off">
          <RiTimeLine className="size-3.5" aria-hidden />
          Berlaku {mmss(remaining ?? 0)} · menunggu pembayaran
        </p>
      </div>
      <p className="text-caption-1-regular text-text-tertiary">Kirim QR ini ke pembeli atau tampilkan di layar. Status lunas masuk otomatis.</p>
      {order.qris.simulator && (
        <Button size="small" variant="secondary" onClick={() => simulate.mutate()} disabled={simulate.isPending}>
          {simulate.isPending ? "Memproses…" : "Simulasikan pembeli membayar (dev)"}
        </Button>
      )}
    </div>
  );
}

function ManualPayment({ order, onChanged }: { order: Order; onChanged: (o: Order) => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<(typeof MANUAL_METHODS)[number]>("TRANSFER");
  const [reference, setReference] = useState("");
  const pay = useMutation({
    mutationFn: () => api<{ data: Order }>(`/online-orders/${order.id}/payments/manual`, { method: "POST", body: { method, reference: reference.trim() || null } }).then((r) => r.data),
    onSuccess: (o) => {
      onChanged(o);
      toast.show({ status: "success", title: `${order.number} lunas`, description: "Pembayaran manual tercatat." });
    },
    onError: (e) => toast.show({ status: "error", title: readApiError(e).message }),
  });
  if (!open) {
    return (
      <Button size="small" variant="ghost" className="self-center" onClick={() => setOpen(true)}>
        Catat pembayaran manual
      </Button>
    );
  }
  return (
    <form
      className="flex flex-col gap-3 rounded-xl border border-border-button-default p-3"
      onSubmit={(e) => {
        e.preventDefault();
        pay.mutate();
      }}
    >
      <div className="flex flex-col gap-1.5">
        <span className="text-body-medium text-text-secondary">Metode</span>
        <Select aria-label="Metode pembayaran" selectedKey={method} onSelectionChange={(k) => setMethod(k as typeof method)} triggerClassName="w-full">
          {MANUAL_METHODS.map((m) => (
            <SelectItem key={m} id={m} textValue={PAYMENT_LABEL[m]}>
              {m === "QRIS" ? "QRIS statis / marketplace" : PAYMENT_LABEL[m]}
            </SelectItem>
          ))}
        </Select>
      </div>
      <Input label="Referensi" placeholder="No. mutasi bank, ID pembayaran…" value={reference} onChange={setReference} />
      <p className="text-caption-1-regular text-text-tertiary">Pastikan dana {formatRupiah(order.total)} sudah masuk sebelum menandai lunas.</p>
      <div className="flex justify-end gap-2">
        <Button type="button" size="small" variant="secondary" onClick={() => setOpen(false)}>
          Batal
        </Button>
        <Button type="submit" size="small" disabled={pay.isPending}>
          {pay.isPending ? "Menyimpan…" : "Tandai lunas"}
        </Button>
      </div>
    </form>
  );
}

function ShipForm({ order, onDone, onCancel }: { order: Order; onDone: (o: Order) => void; onCancel: () => void }) {
  const toast = useToast();
  const [courier, setCourier] = useState(order.courier ?? "");
  const [trackingNo, setTrackingNo] = useState(order.trackingNo ?? "");
  const ship = useMutation({
    mutationFn: () => api<{ data: Order }>(`/online-orders/${order.id}/ship`, { method: "POST", body: { courier: courier.trim() || null, trackingNo: trackingNo.trim() || null } }).then((r) => r.data),
    onSuccess: (o) => {
      onDone(o);
      toast.show({ status: "success", title: `${order.number} dikirim`, description: "Stok sudah dipotong dari reservasi." });
    },
    onError: (e) => toast.show({ status: "error", title: readApiError(e).message }),
  });
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        ship.mutate();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <CourierPicker value={courier} onChange={setCourier} />
        <Input label="No. resi" value={trackingNo} onChange={setTrackingNo} isRequired autoFocus />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Batal
        </Button>
        <Button type="submit" leadingIcon={RiTruckLine} disabled={!trackingNo.trim() || ship.isPending}>
          {ship.isPending ? "Menyimpan…" : "Tandai dikirim"}
        </Button>
      </div>
    </form>
  );
}

export function OrderDetail({ id }: { id: string }) {
  const { can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [shipping, setShipping] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");
  const key = ["online-order", id];
  const q = useQuery({
    queryKey: key,
    queryFn: () => api<{ data: Order }>(`/online-orders/${id}`).then((r) => r.data),
    // Selama QR aktif, cek status tiap 3 detik agar lunas tampil tanpa muat ulang.
    refetchInterval: (query) => (query.state.data?.status === "PENDING_PAYMENT" && query.state.data.payment?.status === "PENDING" ? 3000 : false),
  });
  const setOrder = (o: Order) => {
    qc.setQueryData(key, o);
    qc.invalidateQueries({ queryKey: ["online-orders"] });
  };

  const advance = useMutation({
    mutationFn: (action: "pack" | "complete") => api<{ data: Order }>(`/online-orders/${id}/${action}`, { method: "POST", body: {} }).then((r) => r.data),
    onSuccess: (o) => {
      setOrder(o);
      toast.show({ status: "success", title: o.status === "PACKED" ? "Order dikemas" : "Order selesai" });
    },
    onError: (e) => toast.show({ status: "error", title: readApiError(e).message }),
  });
  const cancel = useMutation({
    mutationFn: () => api<{ data: Order & { refundRequired?: boolean } }>(`/online-orders/${id}/cancel`, { method: "POST", body: { reason: reason.trim() } }).then((r) => r.data),
    onSuccess: (o) => {
      setOrder(o);
      setCancelOpen(false);
      qc.invalidateQueries({ queryKey: ["inventory"] });
      toast.show({
        status: "success",
        title: `${o.number} dibatalkan`,
        description: o.refundRequired ? `Reservasi stok dilepas. Kembalikan ${formatRupiah(o.total)} ke pembeli secara manual.` : "Reservasi stok dilepas.",
      });
    },
    onError: (e) => toast.show({ status: "error", title: readApiError(e).message }),
  });

  if (!q.data) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-80 rounded-2xl" />
      </div>
    );
  }
  const o = q.data;
  // Order marketplace: bayar, kirim, dan batal mengikuti marketplace (sinkron otomatis).
  const fromMarketplace = !!o.connectionId;
  const editable = can("online_order:update");
  const status = ORDER_STATUS[o.status];
  const units = o.items.reduce((s, i) => s + i.qty, 0);
  const steps =
    o.status === "CANCELLED"
      ? [
          { label: "Dibuat", at: o.createdAt },
          ...(o.paidAt ? [{ label: "Dibayar", at: o.paidAt }] : []),
          { label: "Dibatalkan", at: o.cancelledAt },
        ]
      : [
          { label: "Dibuat", at: o.createdAt },
          { label: "Dibayar", at: o.paidAt },
          { label: "Dikemas", at: o.packedAt },
          { label: "Dikirim", at: o.shippedAt },
          { label: "Selesai", at: o.completedAt },
        ];

  return (
    <>
      <Breadcrumb className="mb-3">
        <BreadcrumbItem href="/orders">Order online</BreadcrumbItem>
        <BreadcrumbItem current>{o.number}</BreadcrumbItem>
      </Breadcrumb>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="font-mono">{o.number}</span>
            <Chip variant="bold" color={status.color}>
              {status.label}
            </Chip>
          </span>
        }
        description={`${CHANNEL_LABEL[o.channel]}${o.externalOrderNo ? ` · ${o.externalOrderNo}` : ""} · stok dari ${o.branch.name}${o.createdByUser ? ` · dibuat ${o.createdByUser.name}` : ""}`}
        actions={
          editable && (
            <>
              {o.status === "PAID" && (
                <Button variant="secondary" onClick={() => advance.mutate("pack")} disabled={advance.isPending}>
                  Tandai dikemas
                </Button>
              )}
              {(o.status === "PAID" || o.status === "PACKED") && !shipping && !fromMarketplace && (
                <Button leadingIcon={RiTruckLine} onClick={() => setShipping(true)}>
                  Kirim
                </Button>
              )}
              {o.status === "SHIPPED" && !fromMarketplace && (
                <Button onClick={() => advance.mutate("complete")} disabled={advance.isPending}>
                  Tandai selesai
                </Button>
              )}
              {["PENDING_PAYMENT", "PAID", "PACKED"].includes(o.status) && !fromMarketplace && (
                <Button variant="ghost" onClick={() => setCancelOpen(true)}>
                  Batalkan
                </Button>
              )}
            </>
          )
        }
      />

      {fromMarketplace && (
        <p className="mb-4 rounded-xl bg-background-secondary-default p-3 text-body-2-regular text-text-secondary">
          Order ditarik otomatis dari marketplace. Pembayaran, pengiriman, dan pembatalan mengikuti status di marketplace; stok di-reserve dan dipotong otomatis.
        </p>
      )}
      <Panel className="mb-4">
        <Timeline steps={steps} />
      </Panel>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          {shipping && (
            <Panel title="Kirim order">
              <ShipForm
                order={o}
                onCancel={() => setShipping(false)}
                onDone={(next) => {
                  setShipping(false);
                  setOrder(next);
                  qc.invalidateQueries({ queryKey: ["inventory"] });
                }}
              />
            </Panel>
          )}
          <Panel title={`Barang · ${formatNumber(units)} item`}>
            <ul className="flex flex-col divide-y divide-separator-border">
              {o.items.map((i) => (
                <li key={i.variantId} className="flex justify-between gap-3 py-2.5">
                  <span className="min-w-0">
                    <span className="block truncate text-body-medium text-text-primary">
                      {i.productName}
                      {i.variantTitle !== "Default" && <span className="text-text-tertiary"> · {i.variantTitle}</span>}
                    </span>
                    <span className="block text-body-2-regular text-text-tertiary">
                      {i.qty} × {formatRupiah(i.unitPrice)} · <span className="font-mono">{i.sku}</span>
                    </span>
                  </span>
                  <span className="shrink-0 text-body-medium text-text-primary tabular-nums">{formatRupiah(i.lineTotal)}</span>
                </li>
              ))}
            </ul>
            <dl className="mt-3 flex flex-col gap-1.5 border-t border-separator-border pt-3 text-body-medium">
              <div className="flex justify-between text-text-secondary">
                <dt>Barang</dt>
                <dd className="tabular-nums">{formatRupiah(o.subtotal)}</dd>
              </div>
              {o.taxTotal > 0 && (
                <div className="flex justify-between text-text-secondary">
                  <dt>PPN</dt>
                  <dd className="tabular-nums">{formatRupiah(o.taxTotal)}</dd>
                </div>
              )}
              <div className="flex justify-between text-text-secondary">
                <dt>Ongkir</dt>
                <dd className="tabular-nums">{formatRupiah(o.shippingFee)}</dd>
              </div>
              <div className="flex justify-between text-text-primary">
                <dt className="text-headline-medium">Total</dt>
                <dd className="text-headline-semibold tabular-nums">{formatRupiah(o.total)}</dd>
              </div>
            </dl>
          </Panel>
          <Panel title="Penerima">
            <dl className="grid gap-3 text-body-medium sm:grid-cols-2">
              <div>
                <dt className="text-caption-1-regular text-text-tertiary">Nama & HP</dt>
                <dd className="text-text-primary">
                  {o.recipientName} · {o.recipientPhone}
                </dd>
                {o.customer && <dd className="text-body-2-regular text-text-tertiary">Customer: {o.customer.name}{o.customer.memberNo && ` · ${o.customer.memberNo}`}</dd>}
              </div>
              <div>
                <dt className="text-caption-1-regular text-text-tertiary">Pengiriman</dt>
                <dd className="text-text-primary">{o.courier ?? "Kurir belum diisi"}</dd>
                {o.trackingNo && <dd className="font-mono text-body-2-regular text-text-secondary">{o.trackingNo}</dd>}
              </div>
              <div className="sm:col-span-2">
                <dt className="text-caption-1-regular text-text-tertiary">Alamat</dt>
                <dd className="whitespace-pre-line text-text-primary">{o.shippingAddress}</dd>
              </div>
              {o.note && (
                <div className="sm:col-span-2">
                  <dt className="text-caption-1-regular text-text-tertiary">Catatan</dt>
                  <dd className="text-text-secondary">{o.note}</dd>
                </div>
              )}
            </dl>
          </Panel>
        </div>

        <Panel title="Pembayaran" className="h-fit lg:sticky lg:top-2">
          {o.status === "PENDING_PAYMENT" ? (
            <div className="flex flex-col gap-4">
              <p className="rounded-xl bg-status-yellow-background p-3 text-body-2-regular text-status-yellow-text">
                Bayar sebelum {formatDateTime(o.reservedUntil)}. Lewat dari itu order dibatalkan otomatis dan stok yang di-reserve dilepas.
              </p>
              {editable && !fromMarketplace ? (
                <>
                  <QrisPanel order={o} onChanged={setOrder} />
                  <ManualPayment order={o} onChanged={setOrder} />
                </>
              ) : (
                <p className="text-body-2-regular text-text-tertiary">Menunggu pembayaran {formatRupiah(o.total)}.</p>
              )}
            </div>
          ) : o.paidAt ? (
            <div className="flex flex-col gap-2">
              <p className="flex items-center gap-2 text-body-medium text-text-primary">
                <RiCheckboxCircleFill className="size-5 text-status-lime-text" aria-hidden />
                Lunas {formatRupiah(o.total)}
              </p>
              <p className="text-body-2-regular text-text-tertiary">
                {formatDateTime(o.paidAt)}
                {o.payment?.status === "PAID" && ` · QRIS ${o.payment.provider === "mock" ? "(simulator)" : o.payment.provider}`}
              </p>
              {o.sale && (
                <p className="text-body-2-regular text-text-secondary">
                  Tercatat sebagai transaksi <span className="font-mono">{o.sale.number}</span>
                  {o.sale.status === "VOIDED" && " (dibatalkan)"}
                  {o.sale.refundTotal > 0 && ` · diretur ${formatRupiah(o.sale.refundTotal)}`}
                </p>
              )}
              {o.status === "CANCELLED" && <p className="rounded-xl bg-status-rose-background p-3 text-body-2-regular text-status-rose-text">Order dibatalkan setelah lunas — pastikan dana sudah dikembalikan ke pembeli.</p>}
            </div>
          ) : (
            <p className="text-body-2-regular text-text-tertiary">Tidak ada pembayaran.{o.cancelReason && ` Dibatalkan: ${o.cancelReason}.`}</p>
          )}
        </Panel>
      </div>

      <ConfirmDialog
        isOpen={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title={`Batalkan ${o.number}?`}
        description={
          <div className="flex flex-col gap-3">
            <p>{o.paidAt ? `Order sudah lunas: reservasi stok dilepas dan transaksinya dibatalkan. Dana ${formatRupiah(o.total)} dikembalikan manual ke pembeli.` : "Reservasi stok dilepas dan QR yang aktif tidak berlaku."}</p>
            <Input label="Alasan" value={reason} onChange={setReason} isRequired autoFocus />
          </div>
        }
        confirmLabel="Batalkan order"
        pending={cancel.isPending}
        onConfirm={() => reason.trim().length >= 3 && cancel.mutate()}
      />
    </>
  );
}
