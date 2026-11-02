import type { Metadata } from "next";
import { BrandMark } from "@/components/app/brand-mark";
import { ForgotForm } from "./forgot-form";

export const metadata: Metadata = { title: "Lupa password" };

export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-[400px]">
        <BrandMark className="mb-8" />
        <section className="rounded-3xl border border-border-button-default bg-background-primary-default p-6 shadow-card sm:p-8">
          <h1 className="text-title-2-medium text-text-primary">Lupa password</h1>
          <p className="mt-1.5 text-body-regular text-text-secondary">Masukkan email akun Anda. Kami kirim tautan untuk membuat password baru.</p>
          <ForgotForm />
        </section>
      </div>
    </main>
  );
}
