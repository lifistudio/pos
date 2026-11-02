import type { Metadata } from "next";
import { Suspense } from "react";
import { BrandMark } from "@/components/app/brand-mark";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = { title: "Password baru" };

export default function ResetPasswordPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-[400px]">
        <BrandMark className="mb-8" />
        <section className="rounded-3xl border border-border-button-default bg-background-primary-default p-6 shadow-card sm:p-8">
          <h1 className="text-title-2-medium text-text-primary">Buat password baru</h1>
          <p className="mt-1.5 text-body-regular text-text-secondary">Semua sesi lama akan keluar otomatis setelah password diganti.</p>
          <Suspense>
            <ResetForm />
          </Suspense>
        </section>
      </div>
    </main>
  );
}
