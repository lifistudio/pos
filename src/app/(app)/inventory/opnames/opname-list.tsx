"use client";

import { RiAddLine, RiClipboardLine } from "@remixicon/react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Chip } from "@/components/base/badges/chip";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { RadioGroup, Radio } from "@/components/base/radio/radio";
import { Select, SelectItem } from "@/components/base/select/select";
import { DataTable, type Column } from "@/components/app/data-table";
import { PageHeader } from "@/components/app/page-header";
import { useSession } from "@/components/app/session-context";
import { Sheet } from "@/components/app/sheet";
import { useUrlState } from "@/hooks/use-url-state";
import { api } from "@/lib/api-client";
import { readApiError } from "@/lib/form-errors";
import { formatDate, formatNumber } from "@/lib/format";
import { InventoryNav } from "../inventory-nav";

export type OpnameStatus = "COUNTING" | "POSTED" | "CANCELLED";
type Row = {
  id: string;
  number: string;
  status: OpnameStatus;
  mode: "PARTIAL" | "FULL";
  branchName: string;
  note: string | null;
  createdAt: string;
  postedAt: string | null;
  createdByName: string | null;
  lines: number;
  counted: number;
  plus: number;
  minus: number;
};

export const OPNAME_STATUS: Record<OpnameStatus, { label: string; color: "yellow" | "lime" | "neutral" }> = {
  COUNTING: { label: "Sedang dihitung", color: "yellow" },
  POSTED: { label: "Diposting", color: "lime" },
  CANCELLED: { label: "Dibatalkan", color: "neutral" },
};

function StartOpname({ onStarted }: { onStarted: (id: string) => void }) {
  const { me, branchId: sessionBranch } = useSession();
  const qc = useQueryClient();
  const [branchId, setBranchId] = useState<string | null>(sessionBranch ?? me.branches[0]?.id ?? null);
  const [mode, setMode] = useState<"PARTIAL" | "FULL">("PARTIAL");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const start = useMutation({
    mutationFn: () => api<{ data: { id: string } }>("/stock-opnames", { method: "POST", body: { branchId, mode, note: note.trim() || null } }),
    onSuccess: ({ data }) => {
      qc.invalidateQueries({ queryKey: ["opnames"] });
      onStarted(data.id);
    },
    onError: (e) => setError(readApiError(e).message),
  });
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start.mutate();
      }}
    >
      <div className="flex flex-col gap-1.5">
        <span className="text-body-medium text-text-secondary">Cabang</span>
        <Select aria-label="Cabang" selectedKey={branchId} onSelectionChange={(k) => setBranchId(String(k))} triggerClassName="w-full">
          {me.branches.map((b) => (
            <SelectItem key={b.id} id={b.id} textValue={b.name}>
              {b.name}
            </SelectItem>
          ))}
        </Select>
      </div>
      <RadioGroup aria-label="Cakupan hitung" value={mode} onChange={(v) => setMode(v as "PARTIAL" | "FULL")} className="flex flex-col gap-3">
        <Radio value="PARTIAL">
          <span className="flex flex-col">
            <span className="text-body-medium text-text-primary">Sebagian</span>
            <span className="text-body-2-regular text-text-tertiary">Hanya barang yang dihitung yang disesuaikan. Cocok untuk cek rak atau kategori tertentu.</span>
          </span>
        </Radio>
        <Radio value="FULL">
          <span className="flex flex-col">
            <span className="text-body-medium text-text-primary">Seluruh toko</span>
            <span className="text-body-2-regular text-text-tertiary">Barang berstok yang tidak dihitung dianggap 0 saat posting.</span>
          </span>
        </Radio>
      </RadioGroup>
      <Input label="Catatan" placeholder="Opname akhir bulan, rak A–C…" value={note} onChange={setNote} />
      {error && (
        <p role="alert" className="text-body-medium text-text-error-primary">
          {error}
        </p>
      )}
      <Button type="submit" disabled={start.isPending || !branchId}>
        {start.isPending ? "Memulai…" : "Mulai menghitung"}
      </Button>
    </form>
  );
}

export function OpnameList() {
  const { can, me, branchId: sessionBranch } = useSession();
  const router = useRouter();
  const url = useUrlState();
  const page = Number(url.get("page") ?? 1);
  const status = url.get("status") ?? "all";
  const branchId = url.get("branch") ?? sessionBranch ?? undefined;
  const [starting, setStarting] = useState(false);

  const list = useQuery({
    queryKey: ["opnames", { page, status, branchId }],
    queryFn: () =>
      api<{ data: Row[]; meta: { total: number; pageCount: number } }>("/stock-opnames", { query: { page, pageSize: 25, branchId, status: status === "all" ? undefined : status } }),
    placeholderData: keepPreviousData,
  });

  const columns: Column<Row>[] = [
    {
      id: "number",
      header: "No. opname",
      isRowHeader: true,
      cell: (r) => (
        <Link href={`/inventory/opnames/${r.id}`} className="flex flex-col">
          <span className="font-mono text-body-2-medium text-text-primary">{r.number}</span>
          {r.note && <span className="truncate text-caption-1-regular text-text-tertiary">{r.note}</span>}
        </Link>
      ),
    },
    { id: "branch", header: "Cabang", cell: (r) => <span className="text-body-medium text-text-secondary">{r.branchName}</span> },
    { id: "mode", header: "Cakupan", cell: (r) => <span className="text-body-medium text-text-secondary">{r.mode === "FULL" ? "Seluruh toko" : "Sebagian"}</span> },
    { id: "lines", header: "Dihitung", align: "end", cell: (r) => <span className="text-body-medium text-text-secondary tabular-nums">{formatNumber(r.counted)} unit · {r.lines} SKU</span> },
    {
      id: "diff",
      header: "Selisih",
      align: "end",
      cell: (r) =>
        r.status === "POSTED" ? (
          <span className="text-body-medium tabular-nums">
            <span className="text-status-lime-text">+{formatNumber(r.plus)}</span> <span className="text-status-rose-text">−{formatNumber(r.minus)}</span>
          </span>
        ) : (
          <span className="text-text-tertiary">—</span>
        ),
    },
    { id: "date", header: "Tanggal", cell: (r) => <span className="whitespace-nowrap text-body-medium text-text-secondary">{formatDate(r.postedAt ?? r.createdAt)}</span> },
    {
      id: "status",
      header: "Status",
      cell: (r) => (
        <Chip variant="bold" color={OPNAME_STATUS[r.status].color}>
          {OPNAME_STATUS[r.status].label}
        </Chip>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Stok"
        description="Hitung stok fisik dengan scan barcode, bandingkan dengan sistem, lalu posting selisihnya ke kartu stok."
        actions={
          can("stock_opname:create") && (
            <Button leadingIcon={RiAddLine} onClick={() => setStarting(true)}>
              Mulai opname
            </Button>
          )
        }
      />
      <InventoryNav />
      <DataTable
        label="Daftar stok opname"
        unit="opname"
        columns={columns}
        rows={list.data?.data}
        getRowId={(r) => r.id}
        isLoading={list.isFetching}
        total={list.data?.meta.total}
        page={page}
        pageCount={list.data?.meta.pageCount ?? 1}
        onPageChange={(p) => url.set({ page: p })}
        onRowAction={(r) => router.push(`/inventory/opnames/${r.id}`)}
        toolbar={
          <>
            {me.branches.length > 1 && (
              <Select aria-label="Cabang" selectedKey={branchId ?? "all"} onSelectionChange={(k) => url.set({ branch: k === "all" ? null : String(k), page: null })} className="shrink-0" popoverClassName="min-w-52">
                <SelectItem id="all" textValue="Semua cabang">Semua cabang</SelectItem>
                {me.branches.map((b) => (
                  <SelectItem key={b.id} id={b.id} textValue={b.name}>
                    {b.name}
                  </SelectItem>
                ))}
              </Select>
            )}
            <Select aria-label="Status" selectedKey={status} onSelectionChange={(k) => url.set({ status: k === "all" ? null : String(k), page: null })} className="shrink-0" popoverClassName="min-w-44">
              <SelectItem id="all" textValue="Semua status">Semua status</SelectItem>
              {Object.entries(OPNAME_STATUS).map(([k, s]) => (
                <SelectItem key={k} id={k} textValue={s.label}>
                  {s.label}
                </SelectItem>
              ))}
            </Select>
          </>
        }
        empty={
          <>
            <RiClipboardLine className="size-6 text-foreground-icon-tertiary" aria-hidden />
            <p className="text-body-medium text-text-primary">Belum ada stok opname.</p>
            <p className="text-body-regular text-text-tertiary">Mulai opname untuk mencocokkan stok fisik dengan sistem.</p>
          </>
        }
        renderMobile={(r) => (
          <Link href={`/inventory/opnames/${r.id}`} className="flex items-start justify-between gap-3">
            <span className="min-w-0">
              <span className="block font-mono text-body-2-medium text-text-primary">{r.number}</span>
              <span className="block truncate text-body-2-regular text-text-tertiary">
                {r.branchName} · {formatNumber(r.counted)} unit
              </span>
            </span>
            <Chip variant="bold" color={OPNAME_STATUS[r.status].color}>
              {OPNAME_STATUS[r.status].label}
            </Chip>
          </Link>
        )}
      />
      <Sheet isOpen={starting} onClose={() => setStarting(false)} title="Mulai stok opname" description="Satu opname berjalan per cabang. Hitungan tersimpan langsung, bisa dilakukan beberapa orang bersamaan.">
        {starting && <StartOpname onStarted={(id) => router.push(`/inventory/opnames/${id}`)} />}
      </Sheet>
    </>
  );
}
