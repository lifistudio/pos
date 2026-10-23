"use client";

import { RiAddLine, RiBookOpenLine, RiCheckLine, RiFileCopyLine, RiKey2Line, RiRobot2Line } from "@remixicon/react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useSyncExternalStore } from "react";
import { Chip } from "@/components/base/badges/chip";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { Select, SelectItem } from "@/components/base/select/select";
import { PageHeader, Panel, Skeleton } from "@/components/app/page-header";
import { useSession } from "@/components/app/session-context";
import { ConfirmDialog, Sheet } from "@/components/app/sheet";
import { useToast } from "@/components/app/toast";
import { api } from "@/lib/api-client";
import { readApiError } from "@/lib/form-errors";
import { formatDate, formatDateTime } from "@/lib/format";
import { MCP_CLIENTS } from "@/lib/mcp-clients";
import { SettingsNav } from "../settings-nav";

type ApiKey = { id: string; name: string; prefix: string; expiresAt: string | null; lastUsedAt: string | null; revokedAt: string | null; createdAt: string };
type Created = ApiKey & { key: string };
type ConnectedApp = { clientId: string; name: string; redirectUris: string[]; connectedAt: string | null; lastUsedAt: string | null };

const hostOf = (uri: string) => {
  try {
    const u = new URL(uri);
    return u.protocol === "https:" || u.protocol === "http:" ? u.host : u.protocol.replace(/:$/, "");
  } catch {
    return uri;
  }
};

/** Aplikasi AI yang login lewat OAuth (Claude, ChatGPT, …) — hanya-baca, bisa diputus kapan saja. */
function ConnectedApps() {
  const qc = useQueryClient();
  const toast = useToast();
  const apps = useQuery({ queryKey: ["oauth-apps"], queryFn: () => api<{ data: ConnectedApp[] }>("/oauth/apps").then((r) => r.data) });
  const [target, setTarget] = useState<ConnectedApp | null>(null);
  const disconnect = useMutation({
    mutationFn: (clientId: string) => api(`/oauth/apps/${encodeURIComponent(clientId)}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["oauth-apps"] });
      toast.show({ status: "success", title: `${target?.name ?? "Aplikasi"} diputuskan` });
      setTarget(null);
    },
    onError: (e) => {
      toast.show({ status: "error", title: readApiError(e).message });
      setTarget(null);
    },
  });

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-headline-medium text-text-primary">Aplikasi terhubung</h2>
        <p className="text-body-2-regular text-text-tertiary">Aplikasi AI yang Anda izinkan lewat login (OAuth). Hanya bisa membaca data, sesuai hak akses akun Anda.</p>
      </div>
      <div className="rounded-2xl border border-border-table">
        {apps.isPending ? (
          <div className="p-3">
            <Skeleton className="h-14" />
          </div>
        ) : !apps.data?.length ? (
          <div className="flex items-center gap-3 px-4 py-4 text-body-2-regular text-text-tertiary">
            <RiRobot2Line className="size-5 shrink-0 text-foreground-icon-tertiary" aria-hidden />
            Belum ada. Tambahkan URL MCP sebagai connector di Claude atau ChatGPT, lalu login dengan akun ini.
          </div>
        ) : (
          <ul className="divide-y divide-separator-border">
            {apps.data.map((a) => (
              <li key={a.clientId} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-body-medium text-text-primary">
                    <span className="truncate">{a.name}</span>
                    <Chip variant="subtle" color="purple">
                      Hanya-baca
                    </Chip>
                  </p>
                  <p className="text-body-2-regular text-text-tertiary">
                    {[...new Set(a.redirectUris.map(hostOf))].join(", ")}
                    {a.connectedAt && ` · terhubung ${formatDate(a.connectedAt)}`}
                    {` · ${a.lastUsedAt ? `terakhir dipakai ${formatDateTime(a.lastUsedAt)}` : "belum pernah dipakai"}`}
                  </p>
                </div>
                <Button size="small" variant="secondary" onClick={() => setTarget(a)}>
                  Putuskan
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <ConfirmDialog
        isOpen={target !== null}
        onClose={() => setTarget(null)}
        title={`Putuskan ${target?.name ?? "aplikasi"}?`}
        description="Aplikasi ini langsung kehilangan akses ke data toko. Untuk memakainya lagi, hubungkan ulang dan login dari aplikasi tersebut."
        confirmLabel="Putuskan"
        pending={disconnect.isPending}
        onConfirm={() => target && disconnect.mutate(target.clientId)}
      />
    </section>
  );
}

const noopSubscribe = () => () => {};

function keyStatus(k: ApiKey): { label: string; color: "lime" | "gray" | "rose" } {
  if (k.revokedAt) return { label: "Dicabut", color: "gray" };
  if (k.expiresAt && new Date(k.expiresAt) < new Date()) return { label: "Kedaluwarsa", color: "rose" };
  return { label: "Aktif", color: "lime" };
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-body-medium text-text-secondary">{label}</span>
      <div className="flex items-start gap-2 rounded-xl bg-background-secondary-default p-3">
        <pre className="min-w-0 flex-1 overflow-x-auto font-mono text-body-2-regular break-all whitespace-pre-wrap text-text-primary">{value}</pre>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          iconOnly
          leadingIcon={copied ? RiCheckLine : RiFileCopyLine}
          aria-label={copied ? "Tersalin" : `Salin ${label}`}
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        />
      </div>
    </div>
  );
}

/** Pilih aplikasi AI → langkah & konfigurasi siap salin. `apiKey` diisi key asli tepat setelah dibuat. */
function McpConnect({ url, apiKey }: { url: string; apiKey?: string }) {
  const [clientId, setClientId] = useState(MCP_CLIENTS[0].id);
  const client = MCP_CLIENTS.find((c) => c.id === clientId) ?? MCP_CLIENTS[0];
  const isLocal = /^https?:\/\/(localhost|127\.|\[::1\])/.test(url);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <span className="text-body-medium text-text-secondary">Aplikasi AI</span>
        <Select aria-label="Aplikasi AI" selectedKey={client.id} onSelectionChange={(k) => setClientId(String(k))} triggerClassName="w-full">
          {MCP_CLIENTS.map((c) => (
            <SelectItem key={c.id} id={c.id} textValue={c.name}>
              {c.name}
            </SelectItem>
          ))}
        </Select>
      </div>
      <ol className="flex list-decimal flex-col gap-1.5 ps-5 text-body-2-regular text-text-secondary">
        {client.steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      {client.publicUrl && isLocal && (
        <p className="rounded-xl bg-status-yellow-background px-3 py-2 text-body-2-regular text-status-yellow-text">
          Aplikasi ini terhubung dari cloud, jadi tidak bisa membuka alamat localhost. Pakai alamat HTTPS publik setelah aplikasi di-deploy.
        </p>
      )}
      {client.snippet && <CopyField label={client.snippet.label} value={client.snippet.value(url, apiKey ?? "<API_KEY>")} />}
    </div>
  );
}

function CreateKeyForm({ onCreated, onCancel }: { onCreated: (k: Created) => void; onCancel: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [expires, setExpires] = useState("90");
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () =>
      api<{ data: Created }>("/api-keys", {
        method: "POST",
        body: { name: name.trim(), expiresInDays: expires === "never" ? undefined : Number(expires) },
      }),
    onSuccess: ({ data }) => {
      qc.invalidateQueries({ queryKey: ["api-keys"] });
      onCreated(data);
    },
    onError: (e) => setError(readApiError(e).message),
  });
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        create.mutate();
      }}
    >
      <Input label="Nama" placeholder="Claude — laporan stok" value={name} onChange={setName} isRequired autoFocus hint="Untuk mengenali di mana key dipakai." />
      <div className="flex flex-col gap-1.5">
        <span className="text-body-medium text-text-secondary">Berlaku</span>
        <Select aria-label="Masa berlaku" selectedKey={expires} onSelectionChange={(k) => setExpires(String(k))} triggerClassName="w-full">
          <SelectItem id="30" textValue="30 hari">30 hari</SelectItem>
          <SelectItem id="90" textValue="90 hari">90 hari</SelectItem>
          <SelectItem id="365" textValue="1 tahun">1 tahun</SelectItem>
          <SelectItem id="never" textValue="Tanpa batas">Tanpa batas waktu</SelectItem>
        </Select>
      </div>
      <p className="rounded-xl bg-background-secondary-default p-3 text-body-2-regular text-text-secondary">
        Key memiliki akses yang sama dengan akun Anda (role & cabang). AI agent yang memakai key ini hanya bisa membaca data yang boleh Anda lihat.
      </p>
      {error && (
        <p role="alert" className="text-body-medium text-text-error-primary">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Batal
        </Button>
        <Button type="submit" disabled={create.isPending || name.trim().length < 2}>
          {create.isPending ? "Membuat…" : "Buat API key"}
        </Button>
      </div>
    </form>
  );
}

export function ApiKeysView() {
  const { can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const keys = useQuery({ queryKey: ["api-keys"], queryFn: () => api<{ data: ApiKey[] }>("/api-keys").then((r) => r.data) });
  const [sheet, setSheet] = useState<"create" | Created | null>(null);
  const [revoking, setRevoking] = useState<ApiKey | null>(null);
  // Origin hanya diketahui di browser; server merender string kosong tanpa mismatch hidrasi.
  const origin = useSyncExternalStore(noopSubscribe, () => window.location.origin, () => "");

  const revoke = useMutation({
    mutationFn: (id: string) => api(`/api-keys/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["api-keys"] });
      toast.show({ status: "success", title: `API key ${revoking?.name} dicabut` });
      setRevoking(null);
    },
    onError: (e) => {
      toast.show({ status: "error", title: readApiError(e).message });
      setRevoking(null);
    },
  });

  return (
    <>
      <PageHeader
        title="Pengaturan"
        description="Cabang, pengguna, hak akses, dan integrasi."
        actions={
          can("api_key:create") && (
            <Button leadingIcon={RiAddLine} onClick={() => setSheet("create")}>
              Buat API key
            </Button>
          )
        }
      />
      <SettingsNav />

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-6">
          <section className="flex flex-col gap-3">
            <div>
              <h2 className="text-headline-medium text-text-primary">API key</h2>
              <p className="text-body-2-regular text-text-tertiary">Untuk aplikasi yang memakai header API key (Claude Code, Cursor, Codex, integrasi lain).</p>
            </div>
            <div className="rounded-2xl border border-border-table">
              {keys.isPending ? (
                <div className="flex flex-col gap-2 p-3">
                  {[0, 1, 2].map((i) => (
                    <Skeleton key={i} className="h-14" />
                  ))}
                </div>
              ) : !keys.data?.length ? (
                <div className="flex min-h-48 flex-col items-center justify-center gap-2 px-6 py-10 text-center">
                  <RiKey2Line className="size-6 text-foreground-icon-tertiary" aria-hidden />
                  <p className="text-body-medium text-text-primary">Belum ada API key.</p>
                  <p className="max-w-[44ch] text-body-regular text-text-tertiary">Buat key untuk menghubungkan AI agent (MCP) atau aplikasi lain ke data toko.</p>
                </div>
              ) : (
                <ul className="divide-y divide-separator-border">
                  {keys.data.map((k) => {
                    const st = keyStatus(k);
                    return (
                      <li key={k.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-2 text-body-medium text-text-primary">
                            {k.name}
                            <Chip variant="subtle" color={st.color}>
                              {st.label}
                            </Chip>
                          </p>
                          <p className="text-body-2-regular text-text-tertiary">
                            <span className="font-mono">{k.prefix}…</span> · dibuat {formatDate(k.createdAt)}
                            {k.expiresAt && ` · berlaku s.d. ${formatDate(k.expiresAt)}`}
                            {` · ${k.lastUsedAt ? `terakhir dipakai ${formatDateTime(k.lastUsedAt)}` : "belum pernah dipakai"}`}
                          </p>
                        </div>
                        {!k.revokedAt && can("api_key:delete") && (
                          <Button size="small" variant="secondary" onClick={() => setRevoking(k)}>
                            Cabut
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>
          <ConnectedApps />
        </div>

        <Panel title="Hubungkan AI agent (MCP)">
          <div className="flex flex-col gap-3 text-body-2-regular text-text-secondary">
            <p>Endpoint MCP membaca stok, produk, dan kartu stok sesuai hak akses pemilik key. Semua pemanggilan tercatat di audit log.</p>
            <CopyField label="URL MCP" value={`${origin}/api/mcp`} />
            <p>
              Claude &amp; ChatGPT: cukup tempel URL ini sebagai connector, lalu login (OAuth). Aplikasi lain: kirim API key di header{" "}
              <code className="font-mono text-text-primary">x-api-key</code> (atau <code className="font-mono text-text-primary">Authorization: Bearer</code>).
            </p>
            <McpConnect url={`${origin}/api/mcp`} />
            <Link href="/panduan/mcp" className="flex items-center gap-1.5 text-body-medium text-text-secondary hover:text-text-primary">
              <RiBookOpenLine className="size-4" aria-hidden />
              Panduan lengkap menghubungkan AI agent
            </Link>
          </div>
        </Panel>
      </div>

      <Sheet
        isOpen={sheet !== null}
        onClose={() => setSheet(null)}
        title={sheet === "create" ? "Buat API key" : "API key siap dipakai"}
        description={sheet === "create" ? undefined : "Salin sekarang. Key ini tidak akan ditampilkan lagi."}
      >
        {sheet === "create" ? (
          <CreateKeyForm onCreated={(k) => setSheet(k)} onCancel={() => setSheet(null)} />
        ) : sheet ? (
          <div className="flex flex-col gap-4">
            <CopyField label="API key" value={sheet.key} />
            <McpConnect url={`${origin}/api/mcp`} apiKey={sheet.key} />
            <p className="text-body-2-regular text-text-tertiary">
              Simpan di pengelola rahasia. Jika key bocor, cabut dari halaman ini lalu buat yang baru.
            </p>
            <Button className="self-end" onClick={() => setSheet(null)}>
              Sudah saya simpan
            </Button>
          </div>
        ) : null}
      </Sheet>
      <ConfirmDialog
        isOpen={revoking !== null}
        onClose={() => setRevoking(null)}
        title={`Cabut API key ${revoking?.name ?? ""}?`}
        description="Aplikasi atau AI agent yang memakai key ini langsung kehilangan akses. Tindakan ini tidak bisa dibatalkan."
        confirmLabel="Cabut key"
        pending={revoke.isPending}
        onConfirm={() => revoking && revoke.mutate(revoking.id)}
      />
    </>
  );
}
