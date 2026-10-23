"use client";

import { RiCloseLine } from "@remixicon/react";
import type { ReactNode } from "react";
import { Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { Button } from "@/components/base/buttons/button";
import { cx } from "@/utils/cx";

/**
 * Panel samping untuk form tambah/ubah data master. Dibangun di atas Modal react-aria
 * (fokus terkunci, Esc menutup, fokus kembali ke pemicu). HP: penuh layar dari bawah.
 */
export function Sheet({
  isOpen,
  onClose,
  title,
  description,
  children,
  footer,
  wide = false,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={(open) => !open && onClose()}
      isDismissable
      className="fixed inset-0 z-90 bg-black/30 data-[entering]:animate-[fade-in_200ms_ease-out] data-[exiting]:animate-[fade-in_150ms_ease-in_reverse]"
    >
      <Modal
        className={cx(
          "fixed inset-x-0 bottom-0 top-8 flex sm:inset-y-2 sm:right-2 sm:left-auto sm:top-2",
          wide ? "sm:w-[min(760px,calc(100vw-1rem))]" : "sm:w-[min(480px,calc(100vw-1rem))]",
          "data-[entering]:animate-[sheet-in_250ms_cubic-bezier(0.16,1,0.3,1)] data-[exiting]:animate-[sheet-in_150ms_ease-in_reverse]",
        )}
      >
        <Dialog className="flex w-full flex-col overflow-hidden rounded-t-3xl border border-border-button-default bg-background-primary-default shadow-dropdown outline-none sm:rounded-3xl">
          <header className="flex items-start justify-between gap-4 border-b border-separator-border px-5 py-4">
            <div className="min-w-0">
              <Heading slot="title" className="text-title-3-semibold text-text-primary">
                {title}
              </Heading>
              {description && <p className="mt-0.5 text-body-2-regular text-text-secondary">{description}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Tutup"
              className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-foreground-icon-secondary outline-none hover:bg-background-secondary-hover focus-visible:ring-2 focus-visible:ring-border-focus-ring"
            >
              <RiCloseLine className="size-5" aria-hidden />
            </button>
          </header>
          <div className="relative min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
          {footer && <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-separator-border px-5 py-3">{footer}</footer>}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

/** Konfirmasi aksi destruktif: menyebut objek & akibatnya (DESIGN_SYSTEM §7). */
export function ConfirmDialog({
  isOpen,
  onClose,
  title,
  description,
  confirmLabel,
  onConfirm,
  pending,
  tone = "danger",
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  pending?: boolean;
  /** "primary" untuk tindakan final yang tidak merusak data (posting, kirim). */
  tone?: "danger" | "primary";
}) {
  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={(open) => !open && onClose()}
      isDismissable
      className="fixed inset-0 z-90 flex items-center justify-center bg-black/30 p-4 data-[entering]:animate-[fade-in_200ms_ease-out]"
    >
      <Modal className="w-full max-w-[420px] data-[entering]:animate-[pop-in_200ms_cubic-bezier(0.16,1,0.3,1)]">
        <Dialog role="alertdialog" className="rounded-3xl border border-border-button-default bg-background-primary-default p-5 shadow-dropdown outline-none">
          <Heading slot="title" className="text-title-3-semibold text-text-primary">
            {title}
          </Heading>
          <div className="mt-1.5 text-body-regular text-text-secondary">{description}</div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              Batal
            </Button>
            <Button variant={tone === "danger" ? "danger" : "primary"} onClick={onConfirm} disabled={pending}>
              {pending ? "Memproses…" : confirmLabel}
            </Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
