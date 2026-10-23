"use client";

import { RiAddLine, RiSearchLine, RiUserHeartLine, RiVipCrown2Line } from "@remixicon/react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Avatar } from "@/components/base/avatar/avatar";
import { Button } from "@/components/base/buttons/button";
import { InputBase } from "@/components/base/input/input";
import { Select, SelectItem } from "@/components/base/select/select";
import { DataTable, type Column } from "@/components/app/data-table";
import { PageHeader, Skeleton } from "@/components/app/page-header";
import { useSession } from "@/components/app/session-context";
import { Sheet } from "@/components/app/sheet";
import { useToast } from "@/components/app/toast";
import { useDebounced, useUrlState } from "@/hooks/use-url-state";
import { api } from "@/lib/api-client";
import { formatDate, formatDateTime, formatNumber, formatRupiah } from "@/lib/format";
import { CustomerForm, displayPhone, MemberChip, type CustomerDetail, type CustomerRow } from "@/components/app/customer-form";
import { CustomersNav } from "./customers-nav";

const initials = (name: string) => name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

const POINT_TYPE: Record<string, string> = { EARN: "Dapat", REDEEM: "Tukar", REVERSE: "Ditarik", REFUND: "Dikembalikan", ADJUST: "Koreksi" };

function CustomerDetailPanel({ id, onEdit }: { id: string; onEdit: (c: CustomerDetail) => void }) {
  const { can } = useSession();
  const detail = useQuery({ queryKey: ["customer", id], queryFn: () => api<{ data: CustomerDetail }>(`/customers/${id}`).then((r) => r.data) });
  if (!detail.data) return <Skeleton className="h-64 rounded-2xl" />;
  const c = detail.data;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start gap-3">
        <Avatar size="md" color="neutral" initials={initials(c.name)} />
        <div className="min-w-0 flex-1">
          <p className="text-title-3-semibold text-text-primary">{c.name}</p>
          <p className="text-body-2-regular text-text-tertiary">
            {displayPhone(c.phone)}
            {c.email && ` · ${c.email}`}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <MemberChip c={c} />
            {c.memberNo && <span className="font-mono text-caption-1-regular text-text-tertiary">{c.memberNo}</span>}
            {c.tierDiscountBps ? <span className="text-caption-1-regular text-text-tertiary">diskon {c.tierDiscountBps / 100}%</span> : null}
          </div>
        </div>
        {can("customer:update") && (
          <Button size="small" variant="secondary" onClick={() => onEdit(c)}>
            Ubah
          </Button>
        )}
      </div>
      <dl className="grid grid-cols-3 gap-2">
        {[
          ["Poin", formatNumber(c.points)],
          ["Total belanja", formatRupiah(c.totalSpent)],
          ["Kunjungan", formatNumber(c.visitCount)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-xl bg-background-secondary-default px-3 py-2">
            <dt className="text-caption-1-regular text-text-tertiary">{k}</dt>
            <dd className="text-body-medium text-text-primary tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      <section>
        <h3 className="mb-2 text-body-medium text-text-secondary">Transaksi terakhir</h3>
        {c.recentSales.length === 0 ? (
          <p className="text-body-regular text-text-tertiary">Belum ada transaksi.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-separator-border">
            {c.recentSales.map((s) => (
              <li key={s.id} className="flex justify-between gap-3 py-2">
                <span className="min-w-0">
                  <span className="block font-mono text-body-2-medium text-text-primary">{s.number}</span>
                  <span className="text-caption-1-regular text-text-tertiary">
                    {formatDateTime(s.createdAt)} · {s.branchName}
                    {s.voucherCode && ` · ${s.voucherCode}`}
                  </span>
                </span>
                <span className={`shrink-0 text-body-medium tabular-nums ${s.status === "VOIDED" ? "text-text-tertiary line-through" : "text-text-primary"}`}>{formatRupiah(s.total)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {c.isMember && (
        <section>
          <h3 className="mb-2 text-body-medium text-text-secondary">Riwayat poin</h3>
          {c.pointHistory.length === 0 ? (
            <p className="text-body-regular text-text-tertiary">Belum ada mutasi poin.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {c.pointHistory.map((p) => (
                <li key={p.id} className="flex justify-between text-body-2-regular">
                  <span className="text-text-secondary">
                    {formatDate(p.createdAt)} · {POINT_TYPE[p.type] ?? p.type}
                    {p.reason && <span className="font-mono"> {p.reason}</span>}
                  </span>
                  <span className={`tabular-nums ${p.change > 0 ? "text-status-lime-text" : "text-status-rose-text"}`}>
                    {p.change > 0 ? "+" : ""}
                    {p.change} → {p.balanceAfter}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

export function CustomersView() {
  const { can } = useSession();
  const toast = useToast();
  const url = useUrlState();
  const [search, setSearch] = useState(url.get("q") ?? "");
  const q = useDebounced(search.trim());
  const page = Number(url.get("page") ?? 1);
  const member = url.get("member") ?? "all";
  const [sheet, setSheet] = useState<{ mode: "view"; id: string } | { mode: "edit"; customer: CustomerDetail | null } | null>(null);

  const list = useQuery({
    queryKey: ["customers", { q, page, member }],
    queryFn: () =>
      api<{ data: CustomerRow[]; meta: { total: number; pageCount: number } }>("/customers", { query: { q, page, pageSize: 25, member: member === "all" ? undefined : member } }),
    placeholderData: keepPreviousData,
  });

  const columns: Column<CustomerRow>[] = [
    {
      id: "name",
      header: "Customer",
      isRowHeader: true,
      className: "w-[30%]",
      cell: (c) => (
        <span className="flex min-w-0 items-center gap-3">
          <Avatar size="sm" color="neutral" initials={initials(c.name)} />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-body-medium text-text-primary">{c.name}</span>
            <span className="truncate text-body-2-regular text-text-tertiary">{displayPhone(c.phone)}</span>
          </span>
        </span>
      ),
    },
    { id: "member", header: "Member", cell: (c) => <MemberChip c={c} /> },
    { id: "points", header: "Poin", align: "end", cell: (c) => <span className="text-body-medium text-text-secondary tabular-nums">{c.isMember ? formatNumber(c.points) : "—"}</span> },
    { id: "spent", header: "Total belanja", align: "end", cell: (c) => <span className="text-body-medium text-text-primary tabular-nums">{formatRupiah(c.totalSpent)}</span> },
    { id: "visits", header: "Kunjungan", align: "end", cell: (c) => <span className="text-body-medium text-text-secondary tabular-nums">{formatNumber(c.visitCount)}</span> },
    { id: "last", header: "Terakhir belanja", cell: (c) => <span className="whitespace-nowrap text-body-medium text-text-secondary">{c.lastVisitAt ? formatDate(c.lastVisitAt) : "—"}</span> },
  ];

  return (
    <>
      <PageHeader
        title="Customer"
        description="Data pelanggan, member, poin, dan riwayat belanja. Member mendapat diskon & poin sesuai tier."
        actions={
          can("customer:create") && (
            <Button leadingIcon={RiAddLine} onClick={() => setSheet({ mode: "edit", customer: null })}>
              Tambah customer
            </Button>
          )
        }
      />
      <CustomersNav />
      <DataTable
        label="Daftar customer"
        unit="customer"
        columns={columns}
        rows={list.data?.data}
        getRowId={(c) => c.id}
        isLoading={list.isFetching}
        total={list.data?.meta.total}
        page={page}
        pageCount={list.data?.meta.pageCount ?? 1}
        onPageChange={(p) => url.set({ page: p })}
        onRowAction={(c) => setSheet({ mode: "view", id: c.id })}
        toolbar={
          <>
            <Select aria-label="Filter member" selectedKey={member} onSelectionChange={(k) => url.set({ member: k === "all" ? null : String(k), page: null })} className="shrink-0" popoverClassName="min-w-40">
              <SelectItem id="all" textValue="Semua">Semua customer</SelectItem>
              <SelectItem id="true" textValue="Member">Member</SelectItem>
              <SelectItem id="false" textValue="Non-member">Non-member</SelectItem>
            </Select>
            <InputBase
              aria-label="Cari nama, no. HP, atau no. member"
              placeholder="Nama, no. HP, no. member"
              leadingIcon={RiSearchLine}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                url.set({ q: e.target.value.trim() || null, page: null });
              }}
              fieldClassName="min-w-[220px] flex-1 rounded-full bg-background-secondary-default md:w-[260px] md:flex-none"
              className="text-body-medium"
            />
          </>
        }
        empty={
          q ? (
            <p className="text-body-medium text-text-primary">Tidak ada customer yang cocok.</p>
          ) : (
            <>
              <RiUserHeartLine className="size-6 text-foreground-icon-tertiary" aria-hidden />
              <p className="text-body-medium text-text-primary">Belum ada customer.</p>
              <p className="text-body-regular text-text-tertiary">Daftarkan pelanggan di sini atau langsung dari layar kasir.</p>
            </>
          )
        }
        renderMobile={(c) => (
          <button type="button" className="flex w-full items-center gap-3 text-start" onClick={() => setSheet({ mode: "view", id: c.id })}>
            <Avatar size="sm" color="neutral" initials={initials(c.name)} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-body-medium text-text-primary">{c.name}</span>
              <span className="text-body-2-regular text-text-tertiary">
                {displayPhone(c.phone)} · {formatRupiah(c.totalSpent)}
              </span>
            </span>
            {c.isMember && <RiVipCrown2Line className="size-4 shrink-0 text-status-purple-text" aria-label="Member" />}
          </button>
        )}
      />
      <Sheet
        isOpen={sheet !== null}
        onClose={() => setSheet(null)}
        title={sheet?.mode === "view" ? "Profil customer" : sheet?.customer ? "Ubah customer" : "Tambah customer"}
      >
        {sheet?.mode === "view" && <CustomerDetailPanel id={sheet.id} onEdit={(c) => setSheet({ mode: "edit", customer: c })} />}
        {sheet?.mode === "edit" && (
          <CustomerForm
            customer={sheet.customer}
            onCancel={() => setSheet(sheet.customer ? { mode: "view", id: sheet.customer.id } : null)}
            onSaved={(c) => {
              toast.show({ status: "success", title: sheet.customer ? "Customer diperbarui" : c.isMember ? `Member ${c.memberNo} terdaftar` : "Customer ditambahkan" });
              setSheet({ mode: "view", id: c.id });
            }}
          />
        )}
      </Sheet>
    </>
  );
}
