"use client";

import { RiCheckLine, RiCloseLine, RiErrorWarningLine, RiEyeLine, RiShieldCheckLine } from "@remixicon/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/base/buttons/button";
import { api } from "@/lib/api-client";
import { readApiError } from "@/lib/form-errors";

type Info = {
  client: { id: string; name: string; redirectHost: string };
  scope: string;
  account: { name: string; email: string };
  error: { error: string; description: string; redirectTo: string } | null;
};

const KEYS = ["response_type", "client_id", "redirect_uri", "code_challenge", "code_challenge_method", "scope", "state", "resource"] as const;

export function ConsentForm() {
  const search = useSearchParams();
  const params = Object.fromEntries(KEYS.flatMap((k) => (search.get(k) != null ? [[k, search.get(k)!]] : []))) as Record<(typeof KEYS)[number], string>;
  const info = useQuery({
    queryKey: ["oauth-authorize", search.toString()],
    queryFn: () => api<{ data: Info }>("/oauth/authorize", { query: params }).then((r) => r.data),
    retry: false,
  });
  const decide = useMutation({
    mutationFn: (approve: boolean) => api<{ data: { redirectTo: string } }>("/oauth/authorize", { method: "POST", body: { params, approve } }).then((r) => r.data),
    // Kembali ke aplikasi AI (alamat sudah divalidasi server terhadap daftar redirect_uri klien).
    onSuccess: ({ redirectTo }) => window.location.assign(redirectTo),
  });

  if (info.isPending) return <div className="h-64 animate-pulse rounded-2xl bg-background-secondary-default" />;
  if (info.isError) {
    return (
      <div className="flex flex-col gap-3">
        <RiErrorWarningLine className="size-8 text-status-rose-text" aria-hidden />
        <h1 className="text-title-2-medium text-text-primary">Permintaan tidak valid</h1>
        <p className="text-body-regular text-text-secondary">{readApiError(info.error, "Permintaan akses tidak bisa diproses.").message}</p>
        <p className="text-body-2-regular text-text-tertiary">Tutup halaman ini dan hubungkan ulang dari aplikasi AI Anda.</p>
      </div>
    );
  }
  const { client, account, error } = info.data;
  if (error) {
    return (
      <div className="flex flex-col gap-3">
        <RiErrorWarningLine className="size-8 text-status-rose-text" aria-hidden />
        <h1 className="text-title-2-medium text-text-primary">Permintaan dari {client.name} tidak bisa diproses</h1>
        <p className="text-body-regular text-text-secondary">{error.description}</p>
        <Button className="mt-2" variant="secondary" onClick={() => window.location.assign(error.redirectTo)}>
          Kembali ke aplikasi
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-title-2-medium text-text-primary">
          Izinkan <span className="break-words">{client.name}</span> mengakses Konten POS?
        </h1>
        <p className="mt-1.5 text-body-regular text-text-secondary">
          Aplikasi ini akan kembali ke <span className="font-mono text-body-2-regular text-text-primary">{client.redirectHost}</span>. Izinkan hanya bila Anda sendiri yang baru saja menghubungkannya.
        </p>
      </div>

      <ul className="flex flex-col gap-3 rounded-2xl bg-background-secondary-default p-4 text-body-2-regular text-text-secondary">
        <li className="flex gap-3">
          <RiEyeLine className="mt-0.5 size-4 shrink-0 text-foreground-icon-secondary" aria-hidden />
          <span>
            <span className="text-body-2-medium text-text-primary">Membaca data toko</span> (stok, produk, penjualan, laporan) sesuai hak akses akun{" "}
            <span className="text-text-primary">{account.name}</span> ({account.email}).
          </span>
        </li>
        <li className="flex gap-3">
          <RiShieldCheckLine className="mt-0.5 size-4 shrink-0 text-foreground-icon-secondary" aria-hidden />
          <span>
            <span className="text-body-2-medium text-text-primary">Hanya-baca</span>: tidak bisa mengubah, menghapus, atau membuat transaksi. Setiap akses tercatat di audit log.
          </span>
        </li>
      </ul>

      {decide.isError && (
        <p role="alert" className="text-body-medium text-text-error-primary">
          {readApiError(decide.error, "Gagal menyimpan keputusan. Coba lagi.").message}
        </p>
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" leadingIcon={RiCloseLine} disabled={decide.isPending} onClick={() => decide.mutate(false)}>
          Tolak
        </Button>
        <Button leadingIcon={RiCheckLine} disabled={decide.isPending} onClick={() => decide.mutate(true)}>
          Izinkan
        </Button>
      </div>
    </div>
  );
}
