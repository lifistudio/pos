"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { authClient } from "@/lib/auth-client";

const MIN_LENGTH = 10;

export function ResetForm() {
  const router = useRouter();
  const token = useSearchParams().get("token");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!token) {
    return (
      <div className="mt-6 flex flex-col gap-4">
        <p role="alert" className="text-body-regular text-text-error-primary">Tautan tidak valid atau sudah kedaluwarsa.</p>
        <Link href="/forgot-password" className="text-body-medium text-text-accent-primary">Minta tautan baru</Link>
      </div>
    );
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const { error } = await authClient.resetPassword({ newPassword: password, token: token! });
    setPending(false);
    if (error) return setError("Tautan tidak valid atau sudah kedaluwarsa. Minta tautan baru.");
    router.replace("/login");
  }

  const mismatch = confirm.length > 0 && confirm !== password;
  const tooShort = password.length > 0 && password.length < MIN_LENGTH;
  return (
    <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
      <Input label="Password baru" type="password" autoComplete="new-password" value={password} onChange={setPassword} isInvalid={tooShort} hint={tooShort ? `Minimal ${MIN_LENGTH} karakter.` : undefined} isRequired autoFocus />
      <Input label="Ulangi password baru" type="password" autoComplete="new-password" value={confirm} onChange={setConfirm} isInvalid={mismatch} hint={mismatch ? "Password tidak sama." : undefined} isRequired />
      {error && <p role="alert" className="text-body-medium text-text-error-primary">{error}</p>}
      <Button type="submit" className="w-full" disabled={password.length < MIN_LENGTH || confirm !== password || pending}>
        {pending ? "Menyimpan…" : "Simpan password"}
      </Button>
    </form>
  );
}
