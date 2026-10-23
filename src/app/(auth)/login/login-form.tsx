"use client";

import { RiErrorWarningLine } from "@remixicon/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/base/buttons/button";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import { Input } from "@/components/base/input/input";
import { authClient } from "@/lib/auth-client";

function safeNext(value: string | null) {
  // Hanya path internal agar parameter `next` tidak bisa dipakai untuk open redirect.
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/dashboard";
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    const { error } = await authClient.signIn.email({
      email: String(form.get("email") ?? "").trim(),
      password: String(form.get("password") ?? ""),
      rememberMe: true,
    });
    if (error) {
      setPending(false);
      setError(
        error.status === 429
          ? "Terlalu banyak percobaan. Tunggu satu menit lalu coba lagi."
          : error.status === 401 || error.code === "INVALID_EMAIL_OR_PASSWORD"
            ? "Email atau password salah."
            : "Tidak bisa masuk sekarang. Periksa koneksi lalu coba lagi.",
      );
      return;
    }
    router.replace(safeNext(params.get("next")));
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4" noValidate>
      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl bg-status-rose-background px-3 py-2.5 text-body-medium text-status-rose-text"
        >
          <RiErrorWarningLine className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </div>
      )}
      <Input
        name="email"
        type="email"
        label="Email"
        placeholder="nama@toko.com"
        autoComplete="username"
        isRequired
        autoFocus
      />
      <Input
        name="password"
        type={showPassword ? "text" : "password"}
        label="Password"
        placeholder="Password Anda"
        autoComplete="current-password"
        isRequired
      />
      <Checkbox size="sm" isSelected={showPassword} onChange={setShowPassword} className="-mt-1 w-fit">
        Tampilkan password
      </Checkbox>
      <Button type="submit" className="mt-1 w-full" disabled={pending}>
        {pending ? "Memeriksa…" : "Masuk"}
      </Button>
    </form>
  );
}
