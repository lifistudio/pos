"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { authClient } from "@/lib/auth-client";

export function ForgotForm() {
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email") ?? "").trim();
    setPending(true);
    await authClient.requestPasswordReset({ email, redirectTo: `${window.location.origin}/reset-password` });
    // Pesan sama apa pun hasilnya, agar halaman ini tidak bisa dipakai menebak email yang terdaftar.
    setPending(false);
    setSent(true);
  }

  if (sent) {
    return (
      <div className="mt-6 flex flex-col gap-4">
        <p role="status" className="text-body-regular text-text-secondary">
          Bila email itu terdaftar, tautan sudah dikirim dan berlaku 1 jam. Periksa juga folder spam.
        </p>
        <Link href="/login" className="text-body-medium text-text-accent-primary">
          Kembali ke halaman masuk
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
      <Input name="email" type="email" label="Email" placeholder="nama@toko.com" autoComplete="username" isRequired autoFocus />
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Mengirim…" : "Kirim tautan"}
      </Button>
      <Link href="/login" className="text-center text-body-medium text-text-secondary">
        Kembali ke halaman masuk
      </Link>
    </form>
  );
}
