"use client";

import { RiHistoryLine } from "@remixicon/react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Chip } from "@/components/base/badges/chip";
import { Button } from "@/components/base/buttons/button";
import { PageHeader, Skeleton } from "@/components/app/page-header";
import { useSession } from "@/components/app/session-context";
import { api } from "@/lib/api-client";
import { formatDateTime, formatNumber } from "@/lib/format";
import { MOVEMENT_LABEL } from "@/lib/stock-labels";
import { InventoryNav } from "../inventory-nav";

type Movement = {
  id: string;
  type: string;
  qtyChange: number;
  balanceAfter: number;
  reason: string | null;
  createdAt: string;
  branchName: string;
  sku: string;
  variantTitle: string;
  productName: string;
  actorName: string | null;
};

/** Riwayat append-only, jadi memakai cursor pagination ("Muat lebih banyak") — bukan nomor halaman. */
export function MovementList() {
  const { branchId } = useSession();
  const query = useInfiniteQuery({
    queryKey: ["inventory", "movements", branchId],
    queryFn: ({ pageParam }) =>
      api<{ data: Movement[]; nextCursor: string | null }>("/inventory/movements", {
        query: { cursor: pageParam, limit: 30, branchId: branchId ?? undefined },
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = query.data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <>
      <PageHeader title="Stok" description="Setiap perubahan stok tercatat di sini beserta siapa, kapan, dan alasannya." />
      <InventoryNav />
      <section className="rounded-2xl border border-border-table">
        {query.isPending ? (
          <div className="flex flex-col gap-2 p-3" aria-busy="true">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex min-h-48 flex-col items-center justify-center gap-2 px-6 py-10 text-center">
            <RiHistoryLine className="size-6 text-foreground-icon-tertiary" aria-hidden />
            <p className="text-body-medium text-text-primary">Belum ada pergerakan stok.</p>
          </div>
        ) : (
          <ol className="divide-y divide-separator-border">
            {rows.map((m) => (
              <li key={m.id} className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 px-4 py-3 md:grid-cols-[180px_minmax(0,1fr)_160px_96px_96px] md:items-center">
                <div className="order-3 col-span-2 flex items-center gap-2 md:order-none md:col-span-1">
                  <Chip variant="subtle" color={m.qtyChange > 0 ? "lime" : "rose"}>
                    {MOVEMENT_LABEL[m.type] ?? m.type}
                  </Chip>
                  <span className="text-body-2-regular text-text-tertiary md:hidden">{formatDateTime(m.createdAt)}</span>
                </div>
                <div className="min-w-0">
                  <p className="truncate text-body-medium text-text-primary">
                    {m.productName}
                    {m.variantTitle !== "Default" && <span className="text-text-tertiary"> · {m.variantTitle}</span>}
                  </p>
                  <p className="truncate text-body-2-regular text-text-tertiary">
                    <span className="font-mono">{m.sku}</span> · {m.branchName}
                    {m.reason && ` · ${m.reason}`}
                  </p>
                </div>
                <div className="hidden min-w-0 md:block">
                  <p className="truncate text-body-2-medium text-text-secondary">{m.actorName ?? "Sistem"}</p>
                  <p className="text-body-2-regular text-text-tertiary">{formatDateTime(m.createdAt)}</p>
                </div>
                <p className={`text-end text-body-medium tabular-nums ${m.qtyChange > 0 ? "text-status-lime-text" : "text-status-rose-text"}`}>
                  {m.qtyChange > 0 ? "+" : "−"}
                  {formatNumber(Math.abs(m.qtyChange))}
                </p>
                <p className="hidden text-end text-body-medium text-text-secondary tabular-nums md:block">
                  sisa {formatNumber(m.balanceAfter)}
                </p>
              </li>
            ))}
          </ol>
        )}
        {query.hasNextPage && (
          <div className="border-t border-separator-border p-3 text-center">
            <Button variant="secondary" size="small" onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>
              {query.isFetchingNextPage ? "Memuat…" : "Muat lebih banyak"}
            </Button>
          </div>
        )}
      </section>
    </>
  );
}
