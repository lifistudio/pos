"use client";

import { RiArrowRightLine, RiCheckDoubleLine, RiCheckLine, RiInboxArchiveLine, RiSendPlaneLine } from "@remixicon/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Chip } from "@/components/base/badges/chip";
import { Breadcrumb, BreadcrumbItem } from "@/components/base/breadcrumb/breadcrumb";
import { Button } from "@/components/base/buttons/button";
import { Input, InputBase } from "@/components/base/input/input";
import { PageHeader, Panel, Skeleton } from "@/components/app/page-header";
import { ScanInput } from "@/components/app/scan-input";
import { useSession } from "@/components/app/session-context";
import { ConfirmDialog } from "@/components/app/sheet";
import { Timeline } from "@/components/app/timeline";
import { useToast } from "@/components/app/toast";
import { lookupVariant } from "@/components/app/variant-lookup";
import { api } from "@/lib/api-client";
import { readApiError } from "@/lib/form-errors";
import { formatDateTime, formatNumber } from "@/lib/format";
import { cx } from "@/utils/cx";
import { TRANSFER_STATUS, type TransferStatus } from "../transfer-list";

type Item = { variantId: string; qtySent: number; qtyReceived: number | null; sku: string; barcode: string | null; variantTitle: string; productName: string; availableAtOrigin: number };
type Transfer = {
  id: string;
  number: string;
  status: TransferStatus;
  fromBranchName: string;
  toBranchName: string;
  note: string | null;
  receiveNote: string | null;
  createdByName: string | null;
  createdAt: string;
  sentAt: string | null;
  receivedAt: string | null;
  cancelledAt: string | null;
  items: Item[];
};

function TransferTimeline({ t }: { t: Transfer }) {
  return (
    <Timeline
      steps={[
        { label: "Dibuat", at: t.createdAt },
        { label: "Dikirim", at: t.sentAt },
        t.status === "CANCELLED" ? { label: "Dibatalkan", at: t.cancelledAt } : { label: "Diterima", at: t.receivedAt },
      ]}
    />
  );
}

/** Mode terima: hitung barang yang datang dengan scan; selisih dengan kiriman ditandai sebelum konfirmasi. */
function ReceivePanel({ t, onDone, onCancel }: { t: Transfer; onDone: () => void; onCancel: () => void }) {
  const toast = useToast();
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [note, setNote] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const qc = useQueryClient();

  const receive = useMutation({
    mutationFn: () =>
      api(`/stock-transfers/${t.id}/receive`, {
        method: "POST",
        body: { items: t.items.map((i) => ({ variantId: i.variantId, qtyReceived: counts[i.variantId] ?? 0 })), note: note.trim() || null },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transfer", t.id] });
      qc.invalidateQueries({ queryKey: ["transfers"] });
      qc.invalidateQueries({ queryKey: ["inventory"] });
      toast.show({ status: "success", title: `${t.number} diterima`, description: "Stok cabang tujuan sudah bertambah." });
      onDone();
    },
    onError: (e) => toast.show({ status: "error", title: readApiError(e).message }),
  });

  async function onScan(code: string) {
    setNotice(null);
    const item = t.items.find((i) => i.barcode === code || i.sku.toUpperCase() === code.toUpperCase());
    const variantId = item?.variantId ?? (await lookupVariant(code).then((r) => (r.kind === "hit" ? r.variant.id : null)).catch(() => null));
    const target = t.items.find((i) => i.variantId === variantId);
    if (!target) return setNotice(`"${code}" tidak termasuk transfer ini.`);
    const next = (counts[target.variantId] ?? 0) + 1;
    if (next > target.qtySent) return setNotice(`${target.productName} sudah lengkap (${target.qtySent}).`);
    setCounts((c) => ({ ...c, [target.variantId]: next }));
  }

  const totalSent = t.items.reduce((s, i) => s + i.qtySent, 0);
  const totalCounted = t.items.reduce((s, i) => s + (counts[i.variantId] ?? 0), 0);
  const short = totalSent - totalCounted;

  return (
    <Panel title="Terima barang">
      <p className="mb-3 text-body-2-regular text-text-secondary">Scan setiap barang yang datang. Barang yang kurang atau rusak dicatat sebagai selisih.</p>
      <ScanInput onScan={onScan} autoFocus />
      {notice && (
        <p className="mt-2 text-body-medium text-text-error-primary" role="status">
          {notice}
        </p>
      )}
      <ul className="mt-4 flex flex-col divide-y divide-separator-border">
        {t.items.map((i) => {
          const c = counts[i.variantId] ?? 0;
          return (
            <li key={i.variantId} className="flex items-center gap-3 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body-medium text-text-primary">{i.productName}</span>
                <span className="block truncate text-body-2-regular text-text-tertiary">
                  {i.variantTitle !== "Default" ? `${i.variantTitle} · ` : ""}
                  <span className="font-mono">{i.sku}</span>
                </span>
              </span>
              <InputBase
                aria-label={`Diterima ${i.productName}`}
                inputMode="numeric"
                value={String(c)}
                onChange={(e) => setCounts((all) => ({ ...all, [i.variantId]: Math.min(i.qtySent, Number(e.target.value.replace(/\D/g, "")) || 0) }))}
                fieldClassName="w-20"
                className="text-center tabular-nums"
              />
              <span className={cx("w-14 text-end text-body-2-medium tabular-nums", c === i.qtySent ? "text-status-lime-text" : "text-text-tertiary")}>/ {i.qtySent}</span>
            </li>
          );
        })}
      </ul>
      <div className="mt-4 flex flex-col gap-3">
        <Button type="button" variant="secondary" size="small" leadingIcon={RiCheckDoubleLine} className="w-fit" onClick={() => setCounts(Object.fromEntries(t.items.map((i) => [i.variantId, i.qtySent])))}>
          Semua sesuai kiriman
        </Button>
        {short > 0 && <Input label="Catatan selisih" placeholder="Misal: 1 pcs basah saat pengiriman" value={note} onChange={setNote} />}
        <p className={cx("text-body-medium", short > 0 ? "text-status-yellow-text" : "text-text-secondary")}>
          {formatNumber(totalCounted)} dari {formatNumber(totalSent)} unit{short > 0 ? ` · kurang ${formatNumber(short)}` : " · lengkap"}
        </p>
        <div className="flex gap-2">
          <Button type="button" leadingIcon={RiInboxArchiveLine} disabled={receive.isPending || totalCounted === 0} onClick={() => receive.mutate()}>
            {receive.isPending ? "Menyimpan…" : "Konfirmasi penerimaan"}
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel}>
            Batal
          </Button>
        </div>
      </div>
    </Panel>
  );
}

export function TransferDetail({ id }: { id: string }) {
  const { can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [receiving, setReceiving] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");
  const q = useQuery({ queryKey: ["transfer", id], queryFn: () => api<{ data: Transfer }>(`/stock-transfers/${id}`).then((r) => r.data) });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["transfer", id] });
    qc.invalidateQueries({ queryKey: ["transfers"] });
    qc.invalidateQueries({ queryKey: ["inventory"] });
  };
  const send = useMutation({
    mutationFn: () => api(`/stock-transfers/${id}/send`, { method: "POST", body: {} }),
    onSuccess: () => {
      refresh();
      toast.show({ status: "success", title: "Transfer dikirim", description: "Stok cabang asal sudah berkurang." });
    },
    onError: (e) => toast.show({ status: "error", title: readApiError(e).message }),
  });
  const cancel = useMutation({
    mutationFn: () => api(`/stock-transfers/${id}/cancel`, { method: "POST", body: { reason: reason.trim() } }),
    onSuccess: () => {
      refresh();
      setCancelOpen(false);
      toast.show({ status: "success", title: "Transfer dibatalkan" });
    },
    onError: (e) => toast.show({ status: "error", title: readApiError(e).message }),
  });

  if (!q.data) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }
  const t = q.data;
  const st = TRANSFER_STATUS[t.status];
  const sent = t.items.reduce((s, i) => s + i.qtySent, 0);
  const received = t.items.reduce((s, i) => s + (i.qtyReceived ?? 0), 0);

  return (
    <>
      <Breadcrumb className="mb-3">
        <BreadcrumbItem href="/inventory/transfers">Transfer</BreadcrumbItem>
        <BreadcrumbItem current>{t.number}</BreadcrumbItem>
      </Breadcrumb>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="font-mono">{t.number}</span>
            <Chip variant="bold" color={st.color}>
              {st.label}
            </Chip>
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-1.5">
            {t.fromBranchName}
            <RiArrowRightLine className="size-4" aria-label="ke" />
            {t.toBranchName}
            {t.createdByName && ` · dibuat ${t.createdByName}`}
          </span>
        }
        actions={
          <>
            {t.status === "DRAFT" && can("stock_transfer:create") && (
              <Button leadingIcon={RiSendPlaneLine} onClick={() => send.mutate()} disabled={send.isPending}>
                {send.isPending ? "Mengirim…" : "Kirim sekarang"}
              </Button>
            )}
            {t.status === "IN_TRANSIT" && can("stock_transfer:approve") && !receiving && (
              <Button leadingIcon={RiInboxArchiveLine} onClick={() => setReceiving(true)}>
                Terima barang
              </Button>
            )}
            {(t.status === "DRAFT" || t.status === "IN_TRANSIT") && (can("stock_transfer:create") || can("stock_transfer:approve")) && (
              <Button variant="secondary" onClick={() => setCancelOpen(true)}>
                Batalkan
              </Button>
            )}
          </>
        }
      />
      <div className="flex flex-col gap-4">
        <Panel>
          <TransferTimeline t={t} />
          {(t.note || t.receiveNote) && (
            <div className="mt-4 flex flex-col gap-1 border-t border-separator-border pt-3 text-body-2-regular text-text-secondary">
              {t.note && <p>Catatan: {t.note}</p>}
              {t.receiveNote && <p>{t.status === "CANCELLED" ? "Alasan batal" : "Catatan penerimaan"}: {t.receiveNote}</p>}
            </div>
          )}
        </Panel>

        {receiving && t.status === "IN_TRANSIT" ? (
          <ReceivePanel t={t} onDone={() => setReceiving(false)} onCancel={() => setReceiving(false)} />
        ) : (
          <Panel title={`Barang · ${t.items.length} SKU`}>
            <div className="-mx-4 overflow-x-auto">
              <table className="w-full min-w-[560px]">
                <thead>
                  <tr className="border-b border-separator-border text-body-2-medium text-text-tertiary">
                    <th className="px-4 pb-2.5 text-start font-medium">Barang</th>
                    <th className="px-3 pb-2.5 text-start font-medium">SKU</th>
                    {t.status === "DRAFT" && <th className="px-3 pb-2.5 text-end font-medium">Tersedia di asal</th>}
                    <th className="px-3 pb-2.5 text-end font-medium">Dikirim</th>
                    {t.status === "RECEIVED" && <th className="px-4 pb-2.5 text-end font-medium">Diterima</th>}
                  </tr>
                </thead>
                <tbody>
                  {t.items.map((i) => {
                    const diff = i.qtyReceived !== null ? i.qtySent - i.qtyReceived : 0;
                    return (
                      <tr key={i.variantId} className="border-b border-separator-border text-body-medium last:border-0">
                        <td className="px-4 py-3 text-text-primary">
                          {i.productName}
                          {i.variantTitle !== "Default" && <span className="text-text-tertiary"> · {i.variantTitle}</span>}
                        </td>
                        <td className="px-3 py-3 font-mono text-body-2-regular text-text-secondary">{i.sku}</td>
                        {t.status === "DRAFT" && (
                          <td className={cx("px-3 py-3 text-end tabular-nums", i.availableAtOrigin < i.qtySent ? "text-status-rose-text" : "text-text-secondary")}>{formatNumber(i.availableAtOrigin)}</td>
                        )}
                        <td className="px-3 py-3 text-end text-text-primary tabular-nums">{formatNumber(i.qtySent)}</td>
                        {t.status === "RECEIVED" && (
                          <td className="px-4 py-3 text-end tabular-nums">
                            <span className={diff > 0 ? "text-status-yellow-text" : "text-text-primary"}>{formatNumber(i.qtyReceived ?? 0)}</span>
                            {diff > 0 && <span className="ms-1 text-body-2-regular text-status-yellow-text">(−{diff})</span>}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-body-2-medium text-text-secondary tabular-nums">
              Total dikirim {formatNumber(sent)} unit
              {t.status === "RECEIVED" && ` · diterima ${formatNumber(received)}${sent - received > 0 ? ` · selisih ${formatNumber(sent - received)}` : ""}`}
            </p>
          </Panel>
        )}
      </div>

      <ConfirmDialog
        isOpen={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title={`Batalkan ${t.number}?`}
        description={
          <div className="flex flex-col gap-3">
            <p>{t.status === "IN_TRANSIT" ? "Barang sudah dikirim. Stok akan dikembalikan ke cabang asal." : "Draf akan dibatalkan; stok tidak berubah."}</p>
            <Input label="Alasan" value={reason} onChange={setReason} isRequired autoFocus />
          </div>
        }
        confirmLabel="Batalkan transfer"
        pending={cancel.isPending}
        onConfirm={() => reason.trim().length >= 3 && cancel.mutate()}
      />
    </>
  );
}
