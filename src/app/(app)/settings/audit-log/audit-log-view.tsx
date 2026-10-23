"use client";

import { RiArrowDownSLine, RiHistoryLine } from "@remixicon/react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Chip } from "@/components/base/badges/chip";
import { Button } from "@/components/base/buttons/button";
import { Select, SelectItem } from "@/components/base/select/select";
import { PageHeader, Skeleton } from "@/components/app/page-header";
import { api } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { cx } from "@/utils/cx";
import { SettingsNav } from "../settings-nav";

type Entry = {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  actorType: string;
  actorName: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  createdAt: string;
};

const ENTITY_LABEL: Record<string, string> = {
  product: "Produk",
  product_variant: "Varian",
  category: "Kategori",
  inventory: "Stok",
  branch: "Cabang",
  user: "Pengguna",
  role: "Role",
  api_key: "API key",
  mcp: "MCP",
};
const ACTION_LABEL: Record<string, string> = {
  create: "Menambah",
  update: "Mengubah",
  delete: "Menghapus",
  adjust: "Menyesuaikan",
  revoke: "Mencabut",
  reset_password: "Mengatur ulang password",
  mcp_tool: "Memanggil tool",
};

function Detail({ entry }: { entry: Entry }) {
  const show = (v: unknown) => (v == null ? "—" : JSON.stringify(v, null, 2));
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {entry.before != null && (
        <div>
          <p className="mb-1 text-body-2-medium text-text-tertiary">Sebelum</p>
          <pre className="max-h-64 overflow-auto rounded-xl bg-background-secondary-default p-3 font-mono text-caption-1-regular whitespace-pre-wrap text-text-secondary">
            {show(entry.before)}
          </pre>
        </div>
      )}
      <div className={entry.before == null ? "md:col-span-2" : undefined}>
        <p className="mb-1 text-body-2-medium text-text-tertiary">{entry.before == null ? "Data" : "Sesudah"}</p>
        <pre className="max-h-64 overflow-auto rounded-xl bg-background-secondary-default p-3 font-mono text-caption-1-regular whitespace-pre-wrap text-text-secondary">
          {show(entry.after)}
        </pre>
      </div>
    </div>
  );
}

/** Riwayat perubahan, read-only, cursor pagination. */
export function AuditLogView() {
  const [entity, setEntity] = useState("all");
  const [open, setOpen] = useState<string | null>(null);
  const query = useInfiniteQuery({
    queryKey: ["audit-logs", entity],
    queryFn: ({ pageParam }) =>
      api<{ data: Entry[]; nextCursor: string | null }>("/audit-logs", {
        query: { cursor: pageParam, limit: 30, entity: entity === "all" ? undefined : entity },
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = query.data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <>
      <PageHeader title="Pengaturan" description="Cabang, pengguna, hak akses, dan integrasi." />
      <SettingsNav />
      <section className="rounded-2xl border border-border-table">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <p className="text-body-2-regular text-text-tertiary">Setiap perubahan data dicatat: siapa, kapan, dari mana, dan nilainya.</p>
          <Select aria-label="Filter jenis data" selectedKey={entity} onSelectionChange={(k) => setEntity(String(k))} popoverClassName="min-w-44">
            <SelectItem id="all" textValue="Semua data">Semua data</SelectItem>
            {Object.entries(ENTITY_LABEL).map(([k, v]) => (
              <SelectItem key={k} id={k} textValue={v}>
                {v}
              </SelectItem>
            ))}
          </Select>
        </div>
        {query.isPending ? (
          <div className="flex flex-col gap-2 border-t border-separator-border p-3">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex min-h-40 flex-col items-center justify-center gap-2 border-t border-separator-border px-6 py-10 text-center">
            <RiHistoryLine className="size-6 text-foreground-icon-tertiary" aria-hidden />
            <p className="text-body-medium text-text-primary">Belum ada catatan.</p>
          </div>
        ) : (
          <ol className="divide-y divide-separator-border border-t border-separator-border">
            {rows.map((e) => {
              const expanded = open === e.id;
              return (
                <li key={e.id}>
                  <button
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => setOpen(expanded ? null : e.id)}
                    className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-start outline-none hover:bg-background-secondary-hover/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-focus-ring"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body-medium text-text-primary">
                        <span className="text-text-secondary">{e.actorName ?? (e.actorType === "SYSTEM" ? "Sistem" : "Tidak dikenal")}</span>{" "}
                        {(ACTION_LABEL[e.action] ?? e.action).toLowerCase()} {(ENTITY_LABEL[e.entity] ?? e.entity).toLowerCase()}
                        {e.entity === "mcp" && e.entityId && <span className="font-mono text-body-2-regular"> {e.entityId}</span>}
                      </span>
                      <span className="text-body-2-regular text-text-tertiary">
                        {formatDateTime(e.createdAt)}
                        {e.ip && ` · ${e.ip}`}
                      </span>
                    </span>
                    {(e.actorType === "API_KEY" || e.actorType === "OAUTH") && (
                      <Chip variant="subtle" color="purple">
                        {e.actorType === "OAUTH" ? "Aplikasi AI" : "API key"}
                      </Chip>
                    )}
                    <RiArrowDownSLine className={cx("size-5 shrink-0 text-foreground-icon-tertiary transition-transform", expanded && "rotate-180")} aria-hidden />
                  </button>
                  {expanded && (
                    <div className="px-4 pb-4">
                      <Detail entry={e} />
                    </div>
                  )}
                </li>
              );
            })}
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
