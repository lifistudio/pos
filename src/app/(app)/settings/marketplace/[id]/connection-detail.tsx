"use client";

import { RiLinkUnlinkM, RiLink, RiRefreshLine, RiSearchLine } from "@remixicon/react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Chip } from "@/components/base/badges/chip";
import { Breadcrumb, BreadcrumbItem } from "@/components/base/breadcrumb/breadcrumb";
import { Button } from "@/components/base/buttons/button";
import { Input, InputBase } from "@/components/base/input/input";
import { SegmentedControl, SegmentedControlItem } from "@/components/base/segmented-control/segmented-control";
import { Select, SelectItem } from "@/components/base/select/select";
import { Switch } from "@/components/base/switch/switch";
import { PageHeader, Panel, Skeleton } from "@/components/app/page-header";
import { useSession } from "@/components/app/session-context";
import { ConfirmDialog } from "@/components/app/sheet";
import { useToast } from "@/components/app/toast";
import { variantLabel, type VariantHit } from "@/components/app/variant-lookup";
import { useDebounced } from "@/hooks/use-url-state";
import { api } from "@/lib/api-client";
import { readApiError } from "@/lib/form-errors";
import { formatDateTime, formatNumber } from "@/lib/format";
import { cx } from "@/utils/cx";
import { CONNECTION_STATUS, type ConnectionStatus } from "../marketplace-view";

type Log = { id: string; kind: "ORDERS" | "STOCK" | "LISTINGS" | "WEBHOOK"; status: "OK" | "PARTIAL" | "FAILED"; stats: Record<string, number>; issues: { ref: string; message: string }[]; error: string | null; startedAt: string };
type Detail = {
  id: string;
  provider: string;
  name: string;
  externalShopId: string;
  branchId: string;
  branchName: string;
  status: ConnectionStatus;
  pullOrders: boolean;
  pushStock: boolean;
  stockBuffer: number;
  lastSyncAt: string | null;
  lastError: string | null;
  retryCount: number;
  tokenExpiresAt: string | null;
  stats: { listings: number; mapped: number; unmapped: number };
  simulator: boolean;
  logs: Log[];
};
type Listing = { id: string; externalSku: string | null; name: string; variantId: string | null; manualMapping: boolean; lastPushedQty: number | null; variantLabel: string | null; variantSku: string | null };

const KIND_LABEL: Record<Log["kind"], string> = { ORDERS: "Tarik order", STOCK: "Push stok", LISTINGS: "Katalog", WEBHOOK: "Webhook" };
const STAT_LABEL: Record<string, string> = {
  created: "baru",
  updated: "diperbarui",
  unchanged: "tetap",
  skipped: "dilewati",
  pushed: "dikirim",
  failed: "gagal",
  autoMapped: "terpetakan otomatis",
  unmapped: "belum dipetakan",
  listings: "produk",
  retrying: "tertunda",
};

function SettingsForm({ d, onSaved }: { d: Detail; onSaved: (d: Detail) => void }) {
  const { me, can } = useSession();
  const toast = useToast();
  const [branchId, setBranchId] = useState(d.branchId);
  const [pullOrders, setPullOrders] = useState(d.pullOrders);
  const [pushStock, setPushStock] = useState(d.pushStock);
  const [buffer, setBuffer] = useState(String(d.stockBuffer));
  const editable = can("marketplace:manage") && d.status !== "DISCONNECTED";
  const save = useMutation({
    mutationFn: () => api<{ data: Detail }>(`/marketplace/connections/${d.id}`, { method: "PATCH", body: { branchId, pullOrders, pushStock, stockBuffer: Number(buffer || 0) } }).then((r) => r.data),
    onSuccess: (next) => {
      onSaved(next);
      toast.show({ status: "success", title: "Pengaturan disimpan" });
    },
    onError: (e) => toast.show({ status: "error", title: readApiError(e).message }),
  });
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="flex flex-col gap-1.5">
        <span className="text-body-medium text-text-secondary">Sumber stok</span>
        <Select aria-label="Sumber stok" selectedKey={branchId} onSelectionChange={(k) => setBranchId(String(k))} triggerClassName="w-full" isDisabled={!editable}>
          {me.branches.map((b) => (
            <SelectItem key={b.id} id={b.id} textValue={b.name}>
              {b.name}
            </SelectItem>
          ))}
        </Select>
      </div>
      <Switch isSelected={pullOrders} onChange={setPullOrders} isDisabled={!editable} size="sm">
        <span className="text-body-medium text-text-primary">Tarik order otomatis</span>
      </Switch>
      <Switch isSelected={pushStock} onChange={setPushStock} isDisabled={!editable} size="sm">
        <span className="text-body-medium text-text-primary">Kirim stok ke marketplace</span>
      </Switch>
      <Input
        label="Buffer stok (unit)"
        inputMode="numeric"
        value={buffer}
        onChange={(v) => setBuffer(v.replace(/\D/g, ""))}
        hint="Ditahan dari stok yang ditampilkan di marketplace untuk mencegah oversell."
        isDisabled={!editable}
      />
      {editable && (
        <Button type="submit" size="small" className="self-end" disabled={save.isPending}>
          {save.isPending ? "Menyimpan…" : "Simpan"}
        </Button>
      )}
    </form>
  );
}

/** Cari varian lalu petakan listing ke varian itu. */
function MapControl({ listing, onDone }: { listing: Listing; onDone: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState(listing.externalSku ?? "");
  const term = useDebounced(q.trim(), 250);
  const results = useQuery({
    queryKey: ["variant-search", term],
    queryFn: () => api<{ data: VariantHit[] }>("/variants/search", { query: { q: term, limit: 6 } }).then((r) => r.data),
    enabled: open && term.length >= 2,
  });
  const map = useMutation({
    mutationFn: (variantId: string | null) => api(`/marketplace/listings/${listing.id}`, { method: "PUT", body: { variantId } }),
    onSuccess: () => {
      setOpen(false);
      onDone();
    },
    onError: (e) => toast.show({ status: "error", title: readApiError(e).message }),
  });
  if (!open) {
    return listing.variantId ? (
      <Button size="xs" variant="ghost" leadingIcon={RiLinkUnlinkM} onClick={() => map.mutate(null)} aria-label={`Lepas pemetaan ${listing.name}`}>
        Lepas
      </Button>
    ) : (
      <Button size="xs" variant="secondary" leadingIcon={RiLink} onClick={() => setOpen(true)}>
        Petakan
      </Button>
    );
  }
  return (
    <div className="flex w-full flex-col gap-2 sm:w-80">
      <InputBase aria-label="Cari varian" placeholder="Cari nama atau SKU" leadingIcon={RiSearchLine} size="small" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      <ul className="flex flex-col gap-1">
        {(results.data ?? []).map((v) => (
          <li key={v.id}>
            <button type="button" className="flex w-full cursor-pointer justify-between gap-2 rounded-lg px-2 py-1.5 text-start hover:bg-background-secondary-hover" onClick={() => map.mutate(v.id)}>
              <span className="truncate text-body-2-medium text-text-primary">{variantLabel(v)}</span>
              <span className="shrink-0 font-mono text-caption-1-regular text-text-tertiary">{v.sku}</span>
            </button>
          </li>
        ))}
        {term.length >= 2 && results.data?.length === 0 && <li className="px-2 text-body-2-regular text-text-tertiary">Tidak ada varian cocok.</li>}
      </ul>
      <Button size="xs" variant="ghost" className="self-end" onClick={() => setOpen(false)}>
        Batal
      </Button>
    </div>
  );
}

function Listings({ connId, editable }: { connId: string; editable: boolean }) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"unmapped" | "all">("unmapped");
  const [q, setQ] = useState("");
  const term = useDebounced(q.trim(), 250);
  const list = useQuery({
    queryKey: ["mp-listings", connId, filter, term],
    queryFn: () => api<{ data: Listing[]; meta: { total: number } }>(`/marketplace/connections/${connId}/listings`, { query: { filter, q: term || undefined, pageSize: 50 } }),
    placeholderData: keepPreviousData,
  });
  return (
    <Panel
      title="Pemetaan produk"
      action={
        <SegmentedControl aria-label="Filter listing" selectedKeys={new Set([filter])} onSelectionChange={(k) => { const n = [...k][0]; if (n) setFilter(n as typeof filter); }}>
          <SegmentedControlItem id="unmapped">Belum dipetakan</SegmentedControlItem>
          <SegmentedControlItem id="all">Semua</SegmentedControlItem>
        </SegmentedControl>
      }
    >
      <InputBase aria-label="Cari produk marketplace" placeholder="Cari nama atau SKU marketplace" leadingIcon={RiSearchLine} value={q} onChange={(e) => setQ(e.target.value)} fieldClassName="mb-3" />
      {!list.data ? (
        <Skeleton className="h-40 rounded-xl" />
      ) : list.data.data.length === 0 ? (
        <p className="py-6 text-center text-body-regular text-text-tertiary">{filter === "unmapped" ? "Semua produk sudah terpetakan." : "Tidak ada produk."}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-separator-border">
          {list.data.data.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body-medium text-text-primary">{l.name}</span>
                <span className="block truncate text-body-2-regular text-text-tertiary">
                  SKU marketplace <span className="font-mono">{l.externalSku ?? "—"}</span>
                  {l.variantLabel ? (
                    <>
                      {" "}→ <span className="text-text-secondary">{l.variantLabel}</span>
                      {l.manualMapping && " (manual)"}
                      {l.lastPushedQty !== null && ` · stok terkirim ${formatNumber(l.lastPushedQty)}`}
                    </>
                  ) : (
                    <span className="text-status-yellow-text"> · belum dipetakan</span>
                  )}
                </span>
              </span>
              {editable && <MapControl listing={l} onDone={() => { qc.invalidateQueries({ queryKey: ["mp-listings", connId] }); qc.invalidateQueries({ queryKey: ["mp-connection", connId] }); }} />}
            </li>
          ))}
        </ul>
      )}
      {list.data && list.data.meta.total > list.data.data.length && <p className="mt-2 text-caption-1-regular text-text-tertiary">Menampilkan {list.data.data.length} dari {formatNumber(list.data.meta.total)} — persempit dengan pencarian.</p>}
    </Panel>
  );
}

function Simulator({ connId, onChanged }: { connId: string; onChanged: () => void }) {
  const toast = useToast();
  const orders = useQuery({ queryKey: ["mp-mock-orders", connId], queryFn: () => api<{ data: { orderSn: string; status: string; updatedAt: string }[] }>(`/marketplace/connections/${connId}/mock/orders`).then((r) => r.data) });
  const run = useMutation({
    mutationFn: (p: { path: string; body: Record<string, unknown> }) => api(`/marketplace/connections/${connId}/mock/${p.path}`, { method: "POST", body: p.body }),
    onSuccess: () => {
      orders.refetch();
      onChanged();
    },
    onError: (e) => toast.show({ status: "error", title: readApiError(e).message }),
  });
  const next: Record<string, "PAID" | "SHIPPED" | "COMPLETED" | null> = { UNPAID: "PAID", PAID: "SHIPPED", SHIPPED: "COMPLETED", COMPLETED: null, CANCELLED: null };
  return (
    <Panel title="Simulator (development)">
      <p className="mb-3 text-body-2-regular text-text-tertiary">Membuat order seolah dari marketplace; diproses lewat webhook yang sama dengan marketplace sungguhan.</p>
      <div className="flex flex-wrap gap-2">
        <Button size="small" variant="secondary" onClick={() => run.mutate({ path: "orders", body: { status: "PAID" } })} disabled={run.isPending}>
          Order dibayar
        </Button>
        <Button size="small" variant="secondary" onClick={() => run.mutate({ path: "orders", body: { status: "UNPAID" } })} disabled={run.isPending}>
          Order belum dibayar
        </Button>
        <Button size="small" variant="ghost" onClick={() => run.mutate({ path: "orders", body: { unmapped: true } })} disabled={run.isPending}>
          Order barang tak dikenal
        </Button>
      </div>
      {!!orders.data?.length && (
        <ul className="mt-3 flex flex-col divide-y divide-separator-border">
          {orders.data.slice(0, 6).map((o) => (
            <li key={o.orderSn} className="flex items-center justify-between gap-2 py-2">
              <span className="font-mono text-body-2-medium text-text-primary">{o.orderSn}</span>
              <span className="flex items-center gap-2">
                <span className="text-caption-1-regular text-text-tertiary">{o.status}</span>
                {next[o.status] && (
                  <Button size="xs" variant="secondary" onClick={() => run.mutate({ path: `orders/${o.orderSn}/status`, body: { status: next[o.status] } })} disabled={run.isPending}>
                    → {next[o.status]}
                  </Button>
                )}
                {["UNPAID", "PAID"].includes(o.status) && (
                  <Button size="xs" variant="ghost" onClick={() => run.mutate({ path: `orders/${o.orderSn}/status`, body: { status: "CANCELLED" } })} disabled={run.isPending}>
                    Batal
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function ConnectionDetail({ id }: { id: string }) {
  const { can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const key = ["mp-connection", id];
  const q = useQuery({ queryKey: key, queryFn: () => api<{ data: Detail }>(`/marketplace/connections/${id}`).then((r) => r.data) });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: ["mp-listings", id] });
    qc.invalidateQueries({ queryKey: ["online-orders"] });
  };
  const sync = useMutation({
    mutationFn: (kind: "all" | "orders" | "stock" | "listings") => api(`/marketplace/connections/${id}/sync`, { method: "POST", body: { kind } }),
    onSuccess: () => {
      refresh();
      toast.show({ status: "success", title: "Sinkron selesai" });
    },
    onError: (e) => {
      refresh();
      toast.show({ status: "error", title: readApiError(e).message });
    },
  });
  const setStatus = useMutation({
    mutationFn: (status: "ACTIVE" | "PAUSED") => api<{ data: Detail }>(`/marketplace/connections/${id}`, { method: "PATCH", body: { status } }).then((r) => r.data),
    onSuccess: (d) => qc.setQueryData(key, d),
    onError: (e) => toast.show({ status: "error", title: readApiError(e).message }),
  });
  const disconnect = useMutation({
    mutationFn: () => api<{ data: Detail }>(`/marketplace/connections/${id}/disconnect`, { method: "POST", body: {} }).then((r) => r.data),
    onSuccess: (d) => {
      qc.setQueryData(key, d);
      setConfirmDisconnect(false);
      toast.show({ status: "success", title: "Koneksi diputus", description: "Order yang sudah masuk tetap tersimpan." });
    },
  });

  if (!q.data) return <Skeleton className="h-80 rounded-2xl" />;
  const d = q.data;
  const editable = can("marketplace:manage") && d.status !== "DISCONNECTED";

  return (
    <>
      <Breadcrumb className="mb-3">
        <BreadcrumbItem href="/settings/marketplace">Marketplace</BreadcrumbItem>
        <BreadcrumbItem current>{d.name}</BreadcrumbItem>
      </Breadcrumb>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {d.name}
            <Chip variant="bold" color={CONNECTION_STATUS[d.status].color}>
              {CONNECTION_STATUS[d.status].label}
            </Chip>
          </span>
        }
        description={`ID toko ${d.externalShopId} · stok dari ${d.branchName}${d.lastSyncAt ? ` · sinkron ${formatDateTime(d.lastSyncAt)}` : ""}`}
        actions={
          editable && (
            <>
              <Button leadingIcon={RiRefreshLine} onClick={() => sync.mutate("all")} disabled={sync.isPending}>
                {sync.isPending ? "Menyinkronkan…" : "Sinkron sekarang"}
              </Button>
              <Button variant="secondary" onClick={() => setStatus.mutate(d.status === "PAUSED" ? "ACTIVE" : "PAUSED")}>
                {d.status === "PAUSED" ? "Aktifkan" : "Jeda"}
              </Button>
              <Button variant="ghost" onClick={() => setConfirmDisconnect(true)}>
                Putuskan
              </Button>
            </>
          )
        }
      />
      {d.lastError && <p className="mb-4 rounded-xl bg-status-rose-background p-3 text-body-2-medium text-status-rose-text">{d.lastError}</p>}
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ["Produk marketplace", formatNumber(d.stats.listings)],
          ["Terpetakan", formatNumber(d.stats.mapped)],
          ["Belum dipetakan", formatNumber(d.stats.unmapped)],
          ["Order tertunda", formatNumber(d.retryCount)],
        ].map(([k, v], i) => (
          <div key={k} className="rounded-2xl bg-background-secondary-default px-4 py-3">
            <p className="text-caption-1-regular text-text-tertiary">{k}</p>
            <p className={cx("text-title-3-semibold tabular-nums", (i === 2 || i === 3) && v !== "0" ? "text-status-yellow-text" : "text-text-primary")}>{v}</p>
          </div>
        ))}
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Listings connId={id} editable={editable} />
          <Panel
            title="Riwayat sinkron"
            action={
              editable && (
                <Button size="xs" variant="ghost" onClick={() => sync.mutate("listings")} disabled={sync.isPending}>
                  Muat ulang katalog
                </Button>
              )
            }
          >
            {d.logs.length === 0 ? (
              <p className="py-6 text-center text-body-regular text-text-tertiary">Belum ada sinkron.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-separator-border">
                {d.logs.map((l) => (
                  <li key={l.id} className="flex flex-col gap-0.5 py-2.5">
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-body-medium text-text-primary">{KIND_LABEL[l.kind]}</span>
                      <span className={cx("text-caption-1-medium", l.status === "OK" ? "text-status-lime-text" : l.status === "PARTIAL" ? "text-status-yellow-text" : "text-status-rose-text")}>
                        {l.status === "OK" ? "Berhasil" : l.status === "PARTIAL" ? "Sebagian" : "Gagal"} · {formatDateTime(l.startedAt)}
                      </span>
                    </span>
                    <span className="text-body-2-regular text-text-tertiary">
                      {l.error ??
                        Object.entries(l.stats)
                          .filter(([k, v]) => v && STAT_LABEL[k])
                          .map(([k, v]) => `${formatNumber(v)} ${STAT_LABEL[k]}`)
                          .join(" · ") ??
                        "—"}
                    </span>
                    {l.issues.slice(0, 3).map((i) => (
                      <span key={i.ref + i.message} className="text-body-2-regular text-status-yellow-text">
                        <span className="font-mono">{i.ref}</span>: {i.message}
                      </span>
                    ))}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
        <div className="flex flex-col gap-4">
          <Panel title="Pengaturan">
            <SettingsForm key={`${d.branchId}:${d.stockBuffer}:${d.pullOrders}:${d.pushStock}`} d={d} onSaved={(next) => qc.setQueryData(key, next)} />
          </Panel>
          {d.simulator && editable && <Simulator connId={id} onChanged={refresh} />}
        </div>
      </div>
      <ConfirmDialog
        isOpen={confirmDisconnect}
        onClose={() => setConfirmDisconnect(false)}
        title={`Putuskan ${d.name}?`}
        description="Token akses dihapus dan sinkron berhenti. Order & data pemetaan tetap tersimpan; hubungkan ulang kapan saja."
        confirmLabel="Putuskan"
        pending={disconnect.isPending}
        onConfirm={() => disconnect.mutate()}
      />
    </>
  );
}
