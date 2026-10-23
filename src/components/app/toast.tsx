"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { Notification, NotificationViewport, type NotificationStatus } from "@/components/base/notification/notification";

type Toast = { id: number; title: string; description?: string; status: NotificationStatus };
type ToastApi = { show: (t: Omit<Toast, "id">) => void };

const ToastContext = createContext<ToastApi | null>(null);

/** Notifikasi singkat setelah aksi (simpan, hapus, gagal) memakai Notification BoardUI. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((t) => t.id !== id)), []);
  const show = useCallback((t: Omit<Toast, "id">) => {
    setToasts((all) => [...all.slice(-2), { ...t, id: Date.now() + Math.random() }]);
  }, []);
  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <NotificationViewport position="bottom-end" aria-label="Notifikasi">
        {toasts.map((t) => (
          <Notification
            key={t.id}
            title={t.title}
            description={t.description}
            status={t.status}
            dismissible
            closeLabel="Tutup"
            autoDismissDuration={t.status === "error" ? 8000 : 4000}
            onDismiss={() => dismiss(t.id)}
          />
        ))}
      </NotificationViewport>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast harus dipakai di dalam ToastProvider");
  return ctx;
}
