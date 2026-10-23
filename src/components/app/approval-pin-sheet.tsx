"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { useSession } from "@/components/app/session-context";
import { Sheet } from "@/components/app/sheet";
import { useToast } from "@/components/app/toast";
import { api } from "@/lib/api-client";
import { readApiError } from "@/lib/form-errors";

const digits6 = (v: string) => v.replace(/\D/g, "").slice(0, 6);

/** Atur/ganti PIN persetujuan sendiri — dipakai kepala toko menyetujui void/retur/diskon di kasir. */
export function ApprovalPinSheet({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  return (
    <Sheet
      isOpen={isOpen}
      onClose={onClose}
      title="PIN persetujuan"
      description="Dipakai untuk menyetujui void, retur, dan diskon manual di layar kasir. Jangan bagikan PIN ke kasir."
    >
      {isOpen && <PinForm onDone={onClose} />}
    </Sheet>
  );
}

function PinForm({ onDone }: { onDone: () => void }) {
  const { me } = useSession();
  const router = useRouter();
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => api("/me/approval-pin", { method: "PUT", body: { pin, currentPin: me.hasApprovalPin ? current : null } }),
    onSuccess: () => {
      toast.show({ status: "success", title: me.hasApprovalPin ? "PIN diganti" : "PIN diatur" });
      router.refresh();
      onDone();
    },
    onError: (e) => setError(readApiError(e).message),
  });
  const mismatch = confirm.length === 6 && confirm !== pin;
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        save.mutate();
      }}
    >
      {me.hasApprovalPin && <Input label="PIN lama" type="password" inputMode="numeric" autoComplete="off" value={current} onChange={(v) => setCurrent(digits6(v))} isRequired />}
      <Input label="PIN baru (6 angka)" type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(v) => setPin(digits6(v))} hint="Hindari angka berulang/berurutan dan tanggal lahir." isRequired />
      <Input
        label="Ulangi PIN baru"
        type="password"
        inputMode="numeric"
        autoComplete="off"
        value={confirm}
        onChange={(v) => setConfirm(digits6(v))}
        isInvalid={mismatch}
        hint={mismatch ? "PIN tidak sama." : undefined}
        isRequired
      />
      {error && (
        <p role="alert" className="text-body-medium text-text-error-primary">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pin.length !== 6 || confirm !== pin || (me.hasApprovalPin && current.length !== 6) || save.isPending}>
        {save.isPending ? "Menyimpan…" : "Simpan PIN"}
      </Button>
    </form>
  );
}
