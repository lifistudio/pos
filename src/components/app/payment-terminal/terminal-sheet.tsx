"use client";

import { RiBankCardLine, RiBookOpenLine, RiLinkM } from "@remixicon/react";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { Button } from "@/components/base/buttons/button";
import { Radio, RadioGroup } from "@/components/base/radio/radio";
import { Select, SelectItem } from "@/components/base/select/select";
import { Sheet } from "@/components/app/sheet";
import { useToast } from "@/components/app/toast";
import { ECR_PROTOCOLS } from "@/lib/ecr-protocols";
import { pairTerminal, serialSupported, TerminalError } from "./terminal";
import { BAUD_RATES, saveTerminalSettings, useTerminalSettings, type TerminalMode } from "./terminal-settings";

const noopSubscribe = () => () => {};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-body-medium text-text-secondary">{label}</span>
      {children}
    </div>
  );
}

/** Pengaturan mesin EDC untuk perangkat kasir ini. Mode manual (default) tetap tersedia untuk semua bank. */
export function TerminalSheet({ isOpen, onClose, allowSimulator }: { isOpen: boolean; onClose: () => void; allowSimulator: boolean }) {
  const settings = useTerminalSettings();
  const toast = useToast();
  const serial = useSyncExternalStore(noopSubscribe, serialSupported, () => false);
  const [pairing, setPairing] = useState(false);

  const modes: { id: TerminalMode; title: string; hint: string; disabled?: string }[] = [
    { id: "manual", title: "Manual (semua bank)", hint: "EDC berdiri sendiri. Kasir mengetik nominal di EDC, lalu mencatat kode approval dari slip." },
    {
      id: "ecr",
      title: "Tersambung kabel (ECR)",
      hint: "Nominal terkirim ke EDC dan hasilnya terbaca otomatis. Butuh EDC yang mendukung ECR dan protokolnya.",
      disabled: serial ? undefined : "Tidak didukung browser ini — pakai Chrome atau Edge di komputer.",
    },
    ...(allowSimulator ? [{ id: "simulator" as const, title: "Simulasi (latihan)", hint: "EDC tiruan untuk melatih kasir. Tidak menagih kartu sungguhan; nonaktif di produksi." }] : []),
  ];

  async function pair() {
    setPairing(true);
    try {
      const device = await pairTerminal();
      saveTerminalSettings({ device });
      toast.show({ status: "success", title: "EDC terhubung", description: device.label });
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "NotFoundError")) {
        toast.show({ status: "error", title: "EDC gagal dihubungkan", description: e instanceof TerminalError ? e.message : (e as Error).message });
      }
    } finally {
      setPairing(false);
    }
  }

  return (
    <Sheet
      isOpen={isOpen}
      onClose={onClose}
      title="Pengaturan EDC"
      description="Berlaku untuk perangkat kasir ini. Cara bayar lain (tunai, QRIS, transfer) tidak terpengaruh."
      footer={
        <div className="flex w-full flex-wrap items-center gap-2">
          <Link href="/panduan/pembayaran#4-mesin-edc-kartu-debit-kredit" target="_blank" className="me-auto flex items-center gap-1.5 text-body-medium text-text-secondary hover:text-text-primary">
            <RiBookOpenLine className="size-4" aria-hidden />
            Panduan EDC
          </Link>
          <Button onClick={onClose}>Selesai</Button>
        </div>
      }
    >
      <div className="flex flex-col gap-6">
        <RadioGroup aria-label="Cara memakai EDC" value={settings.mode} onChange={(v) => saveTerminalSettings({ mode: v as TerminalMode })} className="flex flex-col gap-3">
          {modes.map((m) => (
            <Radio key={m.id} value={m.id} isDisabled={!!m.disabled}>
              <span className="flex flex-col">
                <span className="text-body-medium text-text-primary">{m.title}</span>
                <span className="text-body-2-regular text-text-tertiary">{m.disabled ?? m.hint}</span>
              </span>
            </Radio>
          ))}
        </RadioGroup>

        {settings.mode === "ecr" && (
          <div className="flex flex-col gap-4 rounded-2xl bg-background-secondary-default p-4">
            <div className="flex items-center gap-3">
              <RiLinkM className="size-5 shrink-0 text-foreground-icon-secondary" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate text-body-medium text-text-primary">{settings.device?.label ?? "Belum ada EDC"}</p>
                <p className="text-body-2-regular text-text-tertiary">{settings.device ? "Terhubung di perangkat ini" : "Colokkan kabel ECR EDC ke komputer, lalu hubungkan."}</p>
              </div>
              <Button size="small" variant={settings.device ? "secondary" : "primary"} onClick={pair} disabled={pairing}>
                {settings.device ? "Ganti" : "Hubungkan EDC"}
              </Button>
            </div>
            <Field label="Protokol EDC">
              <Select
                aria-label="Protokol EDC"
                placeholder="Pilih protokol"
                selectedKey={settings.protocol || null}
                onSelectionChange={(k) => saveTerminalSettings({ protocol: String(k) })}
                triggerClassName="w-full"
              >
                {ECR_PROTOCOLS.map((p) => (
                  <SelectItem key={p.id} id={p.id} textValue={p.name}>
                    {p.name}
                  </SelectItem>
                ))}
              </Select>
            </Field>
            <p className="text-body-2-regular text-text-tertiary">
              {ECR_PROTOCOLS.find((p) => p.id === settings.protocol)?.description ??
                "Protokol bank (BCA, Mandiri, BRI, BNI, …) ditambahkan setelah spesifikasi ECR resmi didapat dari bank Anda. Lihat panduan."}
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Kecepatan (baud rate)">
                <Select aria-label="Kecepatan (baud rate)" selectedKey={String(settings.baudRate)} onSelectionChange={(k) => saveTerminalSettings({ baudRate: Number(k) })} triggerClassName="w-full">
                  {BAUD_RATES.map((b) => (
                    <SelectItem key={b} id={String(b)} textValue={String(b)}>
                      {b}
                    </SelectItem>
                  ))}
                </Select>
              </Field>
              <Field label="Batas tunggu">
                <Select aria-label="Batas tunggu" selectedKey={String(settings.timeoutSec)} onSelectionChange={(k) => saveTerminalSettings({ timeoutSec: Number(k) })} triggerClassName="w-full">
                  {[60, 120, 180, 300].map((s) => (
                    <SelectItem key={s} id={String(s)} textValue={`${s / 60} menit`}>
                      {s / 60} menit
                    </SelectItem>
                  ))}
                </Select>
              </Field>
            </div>
          </div>
        )}

        <p className="flex items-start gap-2 text-body-2-regular text-text-tertiary">
          <RiBankCardLine className="mt-0.5 size-4 shrink-0" aria-hidden />
          Di layar bayar, tombol &ldquo;Isi manual&rdquo; selalu tersedia bila EDC terhubung sedang bermasalah.
        </p>
      </div>
    </Sheet>
  );
}
