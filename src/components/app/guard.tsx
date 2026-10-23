"use client";

import { RiLockLine } from "@remixicon/react";
import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useSession } from "./session-context";

/** Urutan halaman awal yang dicoba bila user tidak punya akses dashboard. */
const HOME_CANDIDATES = [
  { href: "/dashboard", permission: "dashboard:read" },
  { href: "/products", permission: "product:read" },
  { href: "/inventory", permission: "inventory:read" },
  { href: "/settings", permission: "user:read" },
];

/** Dashboard tanpa izin → pindah ke halaman pertama yang boleh dibuka (misal kasir → Produk). */
export function HomeGuard({ children }: { children: ReactNode }) {
  const { can } = useSession();
  const router = useRouter();
  const allowed = can("dashboard:read");
  const target = HOME_CANDIDATES.find((c) => can(c.permission))?.href;
  useEffect(() => {
    if (!allowed && target && target !== "/dashboard") router.replace(target);
  }, [allowed, target, router]);
  if (allowed) return children;
  return target ? null : <Guard permission="dashboard:read">{children}</Guard>;
}

/**
 * Penjaga tampilan per halaman. Hanya untuk kenyamanan UI — otorisasi sebenarnya tetap di API
 * (middleware `requirePermission` + cek cabang di service).
 */
export function Guard({ permission, children }: { permission: string; children: ReactNode }) {
  const { can } = useSession();
  if (can(permission)) return children;
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-2 px-6 text-center">
      <RiLockLine className="size-6 text-foreground-icon-tertiary" aria-hidden />
      <h1 className="text-title-3-semibold text-text-primary">Anda belum punya akses ke halaman ini</h1>
      <p className="max-w-[48ch] text-body-regular text-text-secondary">Minta owner atau admin menambahkan akses ini ke role Anda di Pengaturan › Role & akses.</p>
    </div>
  );
}
