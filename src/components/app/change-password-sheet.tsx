"use client";

import { useState } from "react";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { Sheet } from "@/components/app/sheet";
import { useToast } from "@/components/app/toast";
import { authClient } from "@/lib/auth-client";

const MIN_LENGTH = 10;

/** Ganti password sendiri. Sesi di perangkat lain ikut diputus agar password lama yang bocor tidak bisa dipakai lagi. */
export function ChangePasswordSheet({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  return (
    <Sheet isOpen={isOpen} onClose={onClose} title="Ganti password" description="Anda tetap masuk di perangkat ini. Sesi di perangkat lain akan keluar otomatis.">
      {isOpen && <PasswordForm onDone={onClose} />}
    </Sheet>
  );
}

function PasswordForm({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mismatch = confirm.length > 0 && confirm !== next;
  const tooShort = next.length > 0 && next.length < MIN_LENGTH;

  async function submit() {
    setPending(true);
    setError(null);
    const { error } = await authClient.changePassword({ currentPassword: current, newPassword: next, revokeOtherSessions: true });
    setPending(false);
    if (error) {
      setError(error.code === "INVALID_PASSWORD" ? "Password saat ini salah." : "Password belum bisa diganti. Coba lagi.");
      return;
    }
    toast.show({ status: "success", title: "Password diganti" });
    onDone();
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Input label="Password saat ini" type="password" autoComplete="current-password" value={current} onChange={setCurrent} isRequired />
      <Input
        label="Password baru"
        type="password"
        autoComplete="new-password"
        value={next}
        onChange={setNext}
        isInvalid={tooShort}
        hint={tooShort ? `Minimal ${MIN_LENGTH} karakter.` : undefined}
        isRequired
      />
      <Input label="Ulangi password baru" type="password" autoComplete="new-password" value={confirm} onChange={setConfirm} isInvalid={mismatch} hint={mismatch ? "Password tidak sama." : undefined} isRequired />
      {error && (
        <p role="alert" className="text-body-medium text-text-error-primary">
          {error}
        </p>
      )}
      <Button type="submit" disabled={!current || next.length < MIN_LENGTH || confirm !== next || pending}>
        {pending ? "Menyimpan…" : "Simpan password"}
      </Button>
    </form>
  );
}
