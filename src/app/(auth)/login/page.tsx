import type { Metadata } from "next";
import { Suspense } from "react";
import { BrandMark } from "@/components/app/brand-mark";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Masuk" };

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-[400px]">
        <BrandMark className="mb-8" />
        <section className="rounded-3xl border border-border-button-default bg-background-primary-default p-6 shadow-card sm:p-8">
          <h1 className="text-title-2-medium text-text-primary">Masuk ke back-office</h1>
          <p className="mt-1.5 text-body-regular text-text-secondary">
            Gunakan email dan password yang diberikan admin toko Anda.
          </p>
          <Suspense>
            <LoginForm />
          </Suspense>
        </section>
        <p className="mt-6 text-body-2-regular text-text-tertiary">
          Lupa password? Minta admin atau owner mengatur ulang dari menu Pengguna.
        </p>
      </div>
    </main>
  );
}
