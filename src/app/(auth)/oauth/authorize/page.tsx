import type { Metadata } from "next";
import { Suspense } from "react";
import { BrandMark } from "@/components/app/brand-mark";
import { ConsentForm } from "./consent-form";

export const metadata: Metadata = { title: "Izinkan aplikasi AI" };

/** Layar persetujuan OAuth: aplikasi AI (Claude, ChatGPT, …) meminta akses baca ke data toko atas nama pengguna. */
export default function OAuthAuthorizePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-[440px]">
        <BrandMark className="mb-8" />
        <section className="rounded-3xl border border-border-button-default bg-background-primary-default p-6 shadow-card sm:p-8">
          <Suspense fallback={<div className="h-64 animate-pulse rounded-2xl bg-background-secondary-default" />}>
            <ConsentForm />
          </Suspense>
        </section>
        <p className="mt-6 text-body-2-regular text-text-tertiary">Akses bisa dicabut kapan saja di Pengaturan › API key &amp; MCP › Aplikasi terhubung.</p>
      </div>
    </main>
  );
}
