"use client";

import { RiMenuLine } from "@remixicon/react";
import { useEffect, useState, type ReactNode } from "react";
import { AppSidebar } from "./app-sidebar";
import { BrandMark } from "./brand-mark";
import { SessionProvider, type Me } from "./session-context";

/**
 * Kerangka back-office. Desktop (≥1024px): sidebar mengambang di kiri.
 * Tablet & HP: bar atas + sidebar sebagai drawer.
 */
export function AppShell({ me, children }: { me: Me; children: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawerOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  return (
    <SessionProvider me={me}>
      <div className="flex min-h-dvh lg:h-dvh lg:gap-4 lg:p-4">
        <div className="sticky top-4 hidden h-[calc(100dvh-2rem)] lg:block">
          <AppSidebar />
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-separator-border bg-background-full/90 px-4 backdrop-blur-md lg:hidden">
            <BrandMark />
            <button
              type="button"
              aria-label="Buka menu"
              aria-expanded={drawerOpen}
              onClick={() => setDrawerOpen(true)}
              className="flex size-11 cursor-pointer items-center justify-center rounded-xl text-foreground-icon-primary hover:bg-background-secondary-hover"
            >
              <RiMenuLine className="size-5" aria-hidden />
            </button>
          </header>
          <main className="relative min-w-0 flex-1 px-4 pt-5 pb-10 sm:px-6 lg:overflow-y-auto lg:px-4 lg:pt-2">{children}</main>
        </div>

        {drawerOpen && (
          <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
            <button
              type="button"
              aria-label="Tutup menu"
              className="absolute inset-0 animate-[fade-in_200ms_ease-out] bg-black/30"
              onClick={() => setDrawerOpen(false)}
            />
            <div className="absolute inset-y-2 left-2 w-[min(300px,calc(100vw-1rem))] animate-[drawer-in_250ms_cubic-bezier(0.16,1,0.3,1)]">
              <AppSidebar mobile onClose={() => setDrawerOpen(false)} />
            </div>
          </div>
        )}
      </div>
    </SessionProvider>
  );
}
