"use client";

import { RiShieldKeyholeLine } from "@remixicon/react";
import { useRef, useState } from "react";
import { Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { Button } from "@/components/base/buttons/button";
import { InputBase } from "@/components/base/input/input";
import { api } from "@/lib/api-client";
import { readApiError } from "@/lib/form-errors";

export type ApprovablePermission = "pos:void" | "pos:refund" | "pos:discount_manual";

const ACTION_LABEL: Record<ApprovablePermission, string> = {
  "pos:void": "membatalkan transaksi",
  "pos:refund": "memproses retur",
  "pos:discount_manual": "memberi diskon manual",
};

type Pending = { permission: ApprovablePermission; branchId: string; resolve: (approvalId: string | null) => void };

/**
 * Persetujuan atasan di perangkat kasir: atasan mengetik PIN 6 angka → izin sekali pakai.
 * `request()` mengembalikan id izin (kirim di header `X-Approval-Id`) atau null bila dibatalkan.
 */
export function useApproval() {
  const [pending, setPending] = useState<Pending | null>(null);
  const resolver = useRef<Pending["resolve"] | null>(null);

  function request(permission: ApprovablePermission, branchId: string) {
    return new Promise<string | null>((resolve) => {
      resolver.current = resolve;
      setPending({ permission, branchId, resolve });
    });
  }
  function finish(approvalId: string | null) {
    resolver.current?.(approvalId);
    resolver.current = null;
    setPending(null);
  }

  const dialog = (
    <ModalOverlay
      isOpen={pending !== null}
      onOpenChange={(open) => !open && finish(null)}
      isDismissable
      className="fixed inset-0 z-[95] flex items-center justify-center bg-black/40 p-4 data-[entering]:animate-[fade-in_150ms_ease-out]"
    >
      <Modal className="w-full max-w-[380px] data-[entering]:animate-[pop-in_200ms_cubic-bezier(0.16,1,0.3,1)]">
        <Dialog className="rounded-3xl border border-border-button-default bg-background-primary-default p-5 shadow-dropdown outline-none">
          {pending && <PinForm key={`${pending.permission}:${pending.branchId}`} pending={pending} onDone={finish} />}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
  return { request, dialog };
}

function PinForm({ pending, onDone }: { pending: Pending; onDone: (id: string | null) => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const { data } = await api<{ data: { approvalId: string; approverName: string } }>("/pos/approvals", {
        method: "POST",
        body: { permission: pending.permission, branchId: pending.branchId, pin },
      });
      onDone(data.approvalId);
    } catch (e) {
      setError(readApiError(e).message);
      setPin("");
      setBusy(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (pin.length === 6 && !busy) void submit();
      }}
    >
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-background-secondary-default">
          <RiShieldKeyholeLine className="size-5 text-foreground-icon-secondary" aria-hidden />
        </span>
        <div>
          <Heading slot="title" className="text-headline-semibold text-text-primary">
            Persetujuan atasan
          </Heading>
          <p className="text-body-2-regular text-text-secondary">Minta kepala toko memasukkan PIN untuk {ACTION_LABEL[pending.permission]}.</p>
        </div>
      </div>
      <InputBase
        aria-label="PIN atasan"
        type="password"
        inputMode="numeric"
        autoComplete="off"
        autoFocus
        maxLength={6}
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
        className="text-center text-title-2-medium tracking-[0.5em] tabular-nums"
      />
      {error && (
        <p role="alert" className="text-body-2-medium text-text-error-primary">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => onDone(null)}>
          Batal
        </Button>
        <Button type="submit" disabled={pin.length !== 6 || busy}>
          {busy ? "Memeriksa…" : "Setujui"}
        </Button>
      </div>
    </form>
  );
}
