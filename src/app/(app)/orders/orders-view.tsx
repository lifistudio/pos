"use client";

import { RiAddLine, RiSearchLine, RiShoppingBag3Line } from "@remixicon/react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Chip } from "@/components/base/badges/chip";
import { ButtonLink } from "@/components/base/buttons/button";
import { InputBase } from "@/components/base/input/input";
import { SegmentedControl, SegmentedControlItem } from "@/components/base/segmented-control/segmented-control";
import { Select, SelectItem } from "@/components/base/select/select";
import { DataTable, type Column } from "@/components/app/data-table";
import { PageHeader } from "@/components/app/page-header";
import { useSession } from "@/components/app/session-context";
import { useDebounced, useUrlState } from "@/hooks/use-url-state";
import { api } from "@/lib/api-client";
import { formatDateTime, formatNumber, formatRupiah } from "@/lib/format";
import { CHANNEL_LABEL, ORDER_STATUS, type Channel, type OrderStatus } from "./order-labels";

type Row = {
  id: string;
  number: string;
  channel: Channel;
  externalOrderNo: string | null;
  status: OrderStatus;
  recipientName: string;
  branchName: string;
  total: number;
  itemQty: number;
  courier: string | null;
  trackingNo: string | null;
  reservedUntil: string;
  createdAt: string;
};

/** Urutan tab mengikuti alur kerja admin: tagih → kemas → kirim. */
const TABS: (OrderStatus | "all")[] = ["all", "PENDING_PAYMENT", "PAID", "PACKED", "SHIPPED", "COMPLETED", "CANCELLED"];

export function OrdersView() {
  const { can, me, branchId: sessionBranch } = useSession();
  const router = useRouter();
  const url = useUrlState();
  const [search, setSearch] = useState(url.get("q") ?? "");
  const q = useDebounced(search.trim());
  const page = Number(url.get("page") ?? 1);
  const status = (url.get("status") ?? "all") as OrderStatus | "all";
  const channel = url.get("channel") ?? "all";
  const branchId = url.get("branch") ?? sessionBranch ?? "all";

  const list = useQuery({
    queryKey: ["online-orders", { q, page, status, channel, branchId }],
    queryFn: () =>
      api<{ data: Row[]; meta: { total: number; pageCount: number; statusCounts: Record<string, number> } }>("/online-orders", {
        query: {
          q,
          page,
          pageSize: 25,
          status: status === "all" ? undefined : status,
          channel: channel === "all" ? undefined : channel,
          branchId: branchId === "all" ? undefined : branchId,
        },
      }),
    placeholderData: keepPreviousData,
  });
  const counts = list.data?.meta.statusCounts ?? {};
  const allCount = Object.values(counts).reduce((s, n) => s + n, 0);

  const columns: Column<Row>[] = [
    {
      id: "number",
      header: "No. order",
      isRowHeader: true,
      cell: (r) => (
        <Link href={`/orders/${r.id}`} className="flex flex-col">
          <span className="font-mono text-body-2-medium text-text-primary">{r.number}</span>
          <span className="text-caption-1-regular text-text-tertiary">
            {CHANNEL_LABEL[r.channel]}
            {r.externalOrderNo && <span className="font-mono"> · {r.externalOrderNo}</span>}
          </span>
        </Link>
      ),
    },
    { id: "recipient", header: "Penerima", cell: (r) => <span className="text-body-medium text-text-secondary">{r.recipientName}</span> },
    { id: "branch", header: "Sumber stok", cell: (r) => <span className="text-body-medium text-text-secondary">{r.branchName}</span> },
    {
      id: "ship",
      header: "Pengiriman",
      cell: (r) =>
        r.trackingNo ? (
          <span className="flex flex-col text-body-2-regular">
            <span className="text-text-secondary">{r.courier ?? "Kurir"}</span>
            <span className="font-mono text-text-tertiary">{r.trackingNo}</span>
          </span>
        ) : r.status === "PENDING_PAYMENT" ? (
          <span className="text-body-2-regular text-text-tertiary">Bayar sebelum {formatDateTime(r.reservedUntil)}</span>
        ) : (
          <span className="text-body-2-regular text-text-tertiary">{r.courier ?? "—"}</span>
        ),
    },
    { id: "qty", header: "Item", align: "end", cell: (r) => <span className="text-body-medium text-text-secondary tabular-nums">{formatNumber(r.itemQty)}</span> },
    { id: "total", header: "Total", align: "end", cell: (r) => <span className="text-body-medium text-text-primary tabular-nums">{formatRupiah(r.total)}</span> },
    {
      id: "status",
      header: "Status",
      cell: (r) => (
        <Chip variant="bold" color={ORDER_STATUS[r.status].color}>
          {ORDER_STATUS[r.status].label}
        </Chip>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Order online"
        description="Order dari website, WhatsApp, Instagram, dan marketplace. Stok di-reserve sejak order dibuat dan dipotong saat dikirim."
        actions={
          can("online_order:create") && (
            <ButtonLink href="/orders/new" leadingIcon={RiAddLine}>
              Buat order
            </ButtonLink>
          )
        }
      />
      <div className="mb-4 overflow-x-auto pb-1">
        <SegmentedControl
          aria-label="Status order"
          selectedKeys={new Set([status])}
          onSelectionChange={(k) => {
            const next = [...k][0];
            if (next) url.set({ status: next === "all" ? null : String(next), page: null });
          }}
        >
          {TABS.map((t) => (
            <SegmentedControlItem key={t} id={t}>
              <span className="whitespace-nowrap">
                {t === "all" ? "Semua" : ORDER_STATUS[t].label}
                <span className="ms-1.5 text-text-tertiary tabular-nums">{t === "all" ? allCount : (counts[t] ?? 0)}</span>
              </span>
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
      </div>
      <DataTable
        label="Daftar order online"
        unit="order"
        columns={columns}
        rows={list.data?.data}
        getRowId={(r) => r.id}
        isLoading={list.isFetching}
        total={list.data?.meta.total}
        page={page}
        pageCount={list.data?.meta.pageCount ?? 1}
        onPageChange={(p) => url.set({ page: p })}
        onRowAction={(r) => router.push(`/orders/${r.id}`)}
        toolbar={
          <>
            <Select aria-label="Kanal" selectedKey={channel} onSelectionChange={(k) => url.set({ channel: k === "all" ? null : String(k), page: null })} className="shrink-0" popoverClassName="min-w-44">
              <SelectItem id="all" textValue="Semua kanal">Semua kanal</SelectItem>
              {(Object.keys(CHANNEL_LABEL) as Channel[]).map((c) => (
                <SelectItem key={c} id={c} textValue={CHANNEL_LABEL[c]}>
                  {CHANNEL_LABEL[c]}
                </SelectItem>
              ))}
            </Select>
            {me.branches.length > 1 && (
              <Select aria-label="Cabang" selectedKey={branchId} onSelectionChange={(k) => url.set({ branch: k === "all" ? null : String(k), page: null })} className="shrink-0" popoverClassName="min-w-52">
                <SelectItem id="all" textValue="Semua cabang">Semua cabang</SelectItem>
                {me.branches.map((b) => (
                  <SelectItem key={b.id} id={b.id} textValue={b.name}>
                    {b.name}
                  </SelectItem>
                ))}
              </Select>
            )}
            <InputBase
              aria-label="Cari order"
              placeholder="Cari nomor, penerima, resi"
              leadingIcon={RiSearchLine}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                url.set({ q: e.target.value.trim() || null, page: null });
              }}
              fieldClassName="min-w-[180px] flex-1 rounded-full bg-background-secondary-default md:w-[240px] md:flex-none"
              className="text-body-medium"
            />
          </>
        }
        empty={
          <>
            <RiShoppingBag3Line className="size-6 text-foreground-icon-tertiary" aria-hidden />
            <p className="text-body-medium text-text-primary">Belum ada order di sini.</p>
            <p className="text-body-regular text-text-tertiary">Order online yang dibuat akan muncul sesuai statusnya.</p>
          </>
        }
        renderMobile={(r) => (
          <Link href={`/orders/${r.id}`} className="flex items-start justify-between gap-3">
            <span className="min-w-0">
              <span className="block font-mono text-body-2-medium text-text-primary">{r.number}</span>
              <span className="block truncate text-body-2-regular text-text-tertiary">
                {CHANNEL_LABEL[r.channel]} · {r.recipientName} · {formatRupiah(r.total)}
              </span>
            </span>
            <Chip variant="bold" color={ORDER_STATUS[r.status].color}>
              {ORDER_STATUS[r.status].label}
            </Chip>
          </Link>
        )}
      />
    </>
  );
}
