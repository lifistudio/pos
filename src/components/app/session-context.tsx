"use client";

import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";

export type Me = {
  id: string;
  name: string;
  email: string;
  authType: "USER" | "API_KEY" | "OAUTH";
  roles: string[];
  permissions: string[];
  branches: { id: string; code: string; name: string; type: string }[];
  /** Sudah mengatur PIN persetujuan (untuk menyetujui void/retur/diskon kasir). */
  hasApprovalPin: boolean;
};

type SessionContextValue = {
  me: Me;
  can: (permission: string) => boolean;
  /** null = semua cabang yang bisa diakses. */
  branchId: string | null;
  setBranchId: (id: string | null) => void;
};

const SessionContext = createContext<SessionContextValue | null>(null);

// Pilihan cabang = preferensi per perangkat, disimpan di localStorage dan disiarkan ke semua komponen.
const BRANCH_KEY = "pos:branch";
const listeners = new Set<() => void>();
const branchStore = {
  get(): string | null {
    try {
      return localStorage.getItem(BRANCH_KEY);
    } catch {
      return null;
    }
  },
  set(id: string | null) {
    try {
      if (id) localStorage.setItem(BRANCH_KEY, id);
      else localStorage.removeItem(BRANCH_KEY);
    } catch {}
    listeners.forEach((l) => l());
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    window.addEventListener("storage", listener);
    return () => {
      listeners.delete(listener);
      window.removeEventListener("storage", listener);
    };
  },
};

export function SessionProvider({ me, children }: { me: Me; children: ReactNode }) {
  const stored = useSyncExternalStore(branchStore.subscribe, branchStore.get, () => null);
  // Abaikan pilihan tersimpan bila user sudah tidak punya akses ke cabang itu.
  const branchId = stored && me.branches.some((b) => b.id === stored) ? stored : null;

  const value = useMemo(() => {
    const perms = new Set(me.permissions);
    return { me, can: (p: string) => perms.has(p), branchId, setBranchId: branchStore.set };
  }, [me, branchId]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession harus dipakai di dalam SessionProvider");
  return ctx;
}
