"use client";

import { RiAddLine, RiStore3Line } from "@remixicon/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Chip } from "@/components/base/badges/chip";
import { Button } from "@/components/base/buttons/button";
import { Select, SelectItem } from "@/components/base/select/select";
import { PageHeader, Panel, Skeleton } from "@/components/app/page-header";
import { useSession } from "@/components/app/session-context";
import { Sheet } from "@/components/app/sheet";
import { api } from "@/lib/api-client";
import { readApiError } from "@/lib/form-errors";
import { formatDateTime } from "@/lib/format";
import { SettingsNav } from "../settings-nav";

export type ConnectionStatus = "ACTIVE" | "PAUSED" | "ERROR" | "DISCONNECTED";
type Provider = { provider: string; label: string; channel: string; oauth: boolean; available: boolean };
type Connection = {
  id: string;
  provider: string;
  name: string;
  externalShopId: string;
  branchName: string;
  status: ConnectionStatus;
  pullOrders: boolean;
  pushStock: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  retryCount: number;
};

export const CONNECTION_STATUS: Record<ConnectionStatus, { label: string; color: "lime" | "yellow" | "rose" | "neutral" }> = {
  ACTIVE: { label: "Aktif", color: "lime" },
  PAUSED: { label: "Dijeda", color: "yellow" },
  ERROR: { label: "Perlu dihubungkan ulang", color: "rose" },
  DISCONNECTED: { label: "Terputus", color: "neutral" },
};

function ConnectForm({ providers, onDone }: { providers: Provider[]; onDone: (id: string) => void }) {
  const { me } = useSession();
  const available = providers.filter((p) => p.available);
  const [provider, setProvider] = useState(available[0]?.provider ?? null);
  const [branchId, setBranchId] = useState(me.branches.find((b) => b.type === "WAREHOUSE")?.id ?? me.branches[0]?.id ?? null);
  const [error, setError] = useState<string | null>(null);
  const connect = useMutation({
    mutationFn: () => api<{ data: { authorizeUrl: string | null; connectionId: string | null } }>("/marketplace/connections", { method: "POST", body: { provider, branchId } }).then((r) => r.data),
    onSuccess: (d) => {
      // OAuth: lanjut ke halaman izin marketplace (kembali lewat callback).
      if (d.authorizeUrl) window.location.assign(d.authorizeUrl);
      else if (d.connectionId) onDone(d.connectionId);
    },
    onError: (e) => setError(readApiError(e).message),
  });
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        connect.mutate();
      }}
    >
      <div className="flex flex-col gap-1.5">
        <span className="text-body-medium text-text-secondary">Marketplace</span>
        <Select aria-label="Marketplace" selectedKey={provider} onSelectionChange={(k) => setProvider(String(k))} triggerClassName="w-full" disabledKeys={providers.filter((p) => !p.available).map((p) => p.provider)}>
          {providers.map((p) => (
            <SelectItem key={p.provider} id={p.provider} textValue={p.label}>
              {p.label}
              {!p.available && " — belum tersedia"}
            </SelectItem>
          ))}
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-body-medium text-text-secondary">Sumber stok</span>
        <Select aria-label="Sumber stok" selectedKey={branchId} onSelectionChange={(k) => setBranchId(String(k))} triggerClassName="w-full">
          {me.branches.map((b) => (
            <SelectItem key={b.id} id={b.id} textValue={b.name}>
              {b.name}
            </SelectItem>
          ))}
        </Select>
        <span className="text-caption-1-regular text-text-tertiary">Stok cabang ini yang dikirim ke marketplace; order marketplace me-reserve stok di sini.</span>
      </div>
      {error && (
        <p role="alert" className="text-body-medium text-text-error-primary">
          {error}
        </p>
      )}
      <Button type="submit" disabled={!provider || !branchId || connect.isPending}>
        {connect.isPending ? "Menghubungkan…" : providers.find((p) => p.provider === provider)?.oauth ? "Lanjut ke halaman izin" : "Hubungkan"}
      </Button>
    </form>
  );
}

export function MarketplaceView() {
  const { can } = useSession();
  const router = useRouter();
  const qc = useQueryClient();
  const params = useSearchParams();
  const oauthError = params.get("error");
  const [connecting, setConnecting] = useState(false);
  const providers = useQuery({ queryKey: ["mp-providers"], queryFn: () => api<{ data: Provider[] }>("/marketplace/providers").then((r) => r.data) });
  const connections = useQuery({ queryKey: ["mp-connections"], queryFn: () => api<{ data: Connection[] }>("/marketplace/connections").then((r) => r.data) });

  return (
    <>
      <PageHeader
        title="Pengaturan"
        description="Cabang, pengguna, hak akses, kebijakan toko, dan integrasi."
        actions={
          can("marketplace:manage") && (
            <Button leadingIcon={RiAddLine} onClick={() => setConnecting(true)}>
              Hubungkan toko
            </Button>
          )
        }
      />
      <SettingsNav />
      {oauthError && <p className="mb-4 rounded-xl bg-status-rose-background p-3 text-body-2-medium text-status-rose-text">Gagal menghubungkan: {oauthError}</p>}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="flex flex-col gap-3">
          {connections.isPending ? (
            <Skeleton className="h-28 rounded-2xl" />
          ) : !connections.data?.length ? (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border-button-default px-6 py-12 text-center">
              <RiStore3Line className="size-6 text-foreground-icon-tertiary" aria-hidden />
              <p className="text-body-medium text-text-primary">Belum ada toko marketplace yang terhubung.</p>
              <p className="max-w-[48ch] text-body-regular text-text-tertiary">Hubungkan toko agar order masuk otomatis ke Order online dan stok di marketplace mengikuti stok Konten.</p>
            </div>
          ) : (
            connections.data.map((c) => (
              <Link key={c.id} href={`/settings/marketplace/${c.id}`} className="flex flex-col gap-2 rounded-2xl bg-background-secondary-default p-4 outline-none transition-colors hover:bg-background-secondary-hover focus-visible:ring-2 focus-visible:ring-focus-ring">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-headline-medium text-text-primary">{c.name}</p>
                    <p className="text-body-2-regular text-text-tertiary">
                      {providers.data?.find((p) => p.provider === c.provider)?.label ?? c.provider} · ID {c.externalShopId} · stok dari {c.branchName}
                    </p>
                  </div>
                  <Chip variant="bold" color={CONNECTION_STATUS[c.status].color}>
                    {CONNECTION_STATUS[c.status].label}
                  </Chip>
                </div>
                <p className="text-body-2-regular text-text-secondary">
                  {[c.pullOrders && "Tarik order", c.pushStock && "Sinkron stok"].filter(Boolean).join(" · ") || "Sinkron mati"}
                  {c.lastSyncAt ? ` · sinkron ${formatDateTime(c.lastSyncAt)}` : " · belum pernah sinkron"}
                  {c.retryCount > 0 && <span className="text-status-yellow-text"> · {c.retryCount} order tertunda</span>}
                </p>
                {c.lastError && <p className="text-body-2-regular text-status-rose-text">{c.lastError}</p>}
              </Link>
            ))
          )}
        </section>
        <Panel title="Cara kerja">
          <ul className="flex flex-col gap-2 text-body-2-regular text-text-secondary">
            <li>Produk marketplace dipetakan ke varian lewat SKU yang sama; sisanya dipetakan manual.</li>
            <li>Order baru masuk sebagai Order online dan langsung me-reserve stok cabang sumber; dikirim → stok dipotong; dibatalkan → reservasi dilepas.</li>
            <li>Stok tersedia (dikurangi buffer) dikirim ke marketplace setiap ada perubahan saat sinkron.</li>
            <li>Sinkron berjalan lewat webhook marketplace dan cron <span className="font-mono">POST /api/v1/marketplace/sync</span> tiap 5 menit.</li>
          </ul>
        </Panel>
      </div>
      <Sheet isOpen={connecting} onClose={() => setConnecting(false)} title="Hubungkan toko marketplace">
        {connecting && providers.data && (
          <ConnectForm
            providers={providers.data}
            onDone={(id) => {
              qc.invalidateQueries({ queryKey: ["mp-connections"] });
              router.push(`/settings/marketplace/${id}`);
            }}
          />
        )}
      </Sheet>
    </>
  );
}
