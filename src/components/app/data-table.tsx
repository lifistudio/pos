"use client";

import type { ReactNode } from "react";
import { Pagination } from "@/components/base/pagination/pagination";
import { Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from "@/components/base/table/table";
import { formatNumber } from "@/lib/format";
import { cx } from "@/utils/cx";
import { Skeleton } from "./page-header";

export type Column<T> = {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
  align?: "start" | "end";
  isRowHeader?: boolean;
};

/**
 * Tabel dengan pagination dari server (data sudah dipotong per halaman oleh API).
 * ≥768px: tabel BoardUI. <768px: daftar kartu dari `renderMobile` agar nyaman di HP.
 */
export function DataTable<T>({
  label,
  columns,
  rows,
  getRowId,
  isLoading,
  total,
  unit,
  page,
  pageCount,
  onPageChange,
  toolbar,
  empty,
  renderMobile,
  onRowAction,
}: {
  label: string;
  columns: Column<T>[];
  rows: T[] | undefined;
  getRowId: (row: T) => string;
  isLoading?: boolean;
  total?: number;
  /** Satuan jumlah hasil, misal "produk". */
  unit: string;
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  toolbar?: ReactNode;
  empty: ReactNode;
  renderMobile: (row: T) => ReactNode;
  onRowAction?: (row: T) => void;
}) {
  const byId = new Map((rows ?? []).map((r) => [getRowId(r), r]));

  return (
    <section className={cx("flex w-full flex-col rounded-2xl border border-border-table pt-2", pageCount > 1 ? "pb-3" : "pb-0")}>
      <div className="flex w-full flex-col items-start gap-3 px-3 py-1 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col justify-center">
          <p className="text-body-medium whitespace-nowrap text-text-tertiary">Total hasil</p>
          <p className="text-body-medium whitespace-nowrap text-text-primary tabular-nums" aria-live="polite">
            {total === undefined ? "…" : `${formatNumber(total)} ${unit}`}
          </p>
        </div>
        {toolbar && <div className="flex w-full flex-wrap items-center gap-2.5 md:w-auto md:justify-end">{toolbar}</div>}
      </div>

      {isLoading && !rows ? (
        <div className="mt-2 flex flex-col gap-2 px-3 pb-3" aria-busy="true">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : rows && rows.length === 0 ? (
        <div className="flex min-h-48 flex-col items-center justify-center gap-2 px-6 py-10 text-center">{empty}</div>
      ) : (
        <>
          <div className={cx("mt-2 hidden md:block", isLoading && "opacity-60 transition-opacity")}>
            <Table
              aria-label={label}
              size="md"
              selectionMode="none"
              className="min-w-[760px]"
              onRowAction={onRowAction ? (key) => byId.get(String(key)) && onRowAction(byId.get(String(key))!) : undefined}
            >
              <TableHeader>
                {columns.map((col) => (
                  <TableColumn key={col.id} id={col.id} isRowHeader={col.isRowHeader} className={cx(col.className, col.align === "end" && "text-end")}>
                    {col.header}
                  </TableColumn>
                ))}
              </TableHeader>
              <TableBody>
                {(rows ?? []).map((row) => (
                  <TableRow key={getRowId(row)} id={getRowId(row)} className={onRowAction ? "cursor-pointer" : undefined}>
                    {columns.map((col) => (
                      <TableCell key={col.id} className={cx(col.className, col.align === "end" && "text-end")}>
                        {col.cell(row)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <ul className={cx("mt-2 flex flex-col md:hidden", isLoading && "opacity-60")}>
            {(rows ?? []).map((row) => (
              <li key={getRowId(row)} className="border-t border-separator-border px-3 py-3 first:border-t-0">
                {renderMobile(row)}
              </li>
            ))}
          </ul>
        </>
      )}

      {pageCount > 1 && (
        <div className="border-t border-separator-border px-3 pt-3">
          <Pagination page={page} totalPages={pageCount} onChange={onPageChange} previousLabel="Sebelumnya" nextLabel="Berikutnya" />
        </div>
      )}
    </section>
  );
}
