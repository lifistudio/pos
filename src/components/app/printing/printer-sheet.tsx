"use client";

import { RiBluetoothLine, RiBookOpenLine, RiFilePdf2Line, RiLinkM, RiPrinterLine, RiUsbLine } from "@remixicon/react";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { Button } from "@/components/base/buttons/button";
import { Radio, RadioGroup } from "@/components/base/radio/radio";
import { SegmentedControl, SegmentedControlItem } from "@/components/base/segmented-control/segmented-control";
import { Select, SelectItem } from "@/components/base/select/select";
import { Switch } from "@/components/base/switch/switch";
import { Sheet } from "@/components/app/sheet";
import { useToast } from "@/components/app/toast";
import { isDirect, savePrinterSettings, type DirectMode, type PrinterMode } from "./printer-settings";
import { pairBluetooth, pairSerial, pairUsb, PrinterError, support } from "./transports";
import { useReceiptPrinter } from "./use-receipt-printer";

const MODES: { id: PrinterMode; title: string; hint: string; needs?: DirectMode }[] = [
  {
    id: "browser",
    title: "Printer terpasang di perangkat",
    hint: "Semua printer yang sudah terpasang di Windows/macOS/Android (USB, LAN/Wi-Fi, Bluetooth). Paling kompatibel.",
  },
  { id: "usb", title: "USB langsung", hint: "Kirim ke printer struk thermal tanpa dialog cetak. Chrome/Edge.", needs: "usb" },
  { id: "serial", title: "Serial / COM", hint: "Printer serial, USB-serial, atau Bluetooth yang terpasang sebagai port COM. Chrome/Edge komputer.", needs: "serial" },
  { id: "bluetooth", title: "Bluetooth", hint: "Printer thermal portable 58/80 mm (BLE). Chrome di Android atau komputer.", needs: "bluetooth" },
  { id: "pdf", title: "Unduh PDF", hint: "Struk disimpan sebagai file PDF selebar kertas — untuk dikirim atau dicetak nanti." },
];

const ICON = { usb: RiUsbLine, serial: RiLinkM, bluetooth: RiBluetoothLine } as const;
const PAIR = { usb: pairUsb, serial: pairSerial, bluetooth: pairBluetooth } as const;

const NO_SUPPORT = { usb: false, serial: false, bluetooth: false };
const noopSubscribe = () => () => {};
let supportCache: ReturnType<typeof support> | null = null;
const supportSnapshot = () => (supportCache ??= support());

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-body-medium text-text-secondary">{label}</span>
      {children}
    </div>
  );
}

/** Pengaturan printer struk untuk perangkat kasir ini (disimpan di browser, bukan di server). */
export function PrinterSheet({ isOpen, onClose, storeName }: { isOpen: boolean; onClose: () => void; storeName: string }) {
  const { settings, busy, printTest } = useReceiptPrinter();
  const toast = useToast();
  // Dukungan API perangkat hanya diketahui di browser; server merender semua "tidak didukung".
  const can = useSyncExternalStore(noopSubscribe, supportSnapshot, () => NO_SUPPORT);
  const [pairing, setPairing] = useState(false);

  const direct = isDirect(settings.mode) ? settings.mode : null;
  const device = direct ? settings.devices[direct] : undefined;

  async function pair(mode: DirectMode) {
    setPairing(true);
    try {
      const d = await PAIR[mode]();
      savePrinterSettings({ devices: { ...settings.devices, [mode]: d } });
      toast.show({ status: "success", title: "Printer terhubung", description: d.label });
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "NotFoundError")) {
        toast.show({ status: "error", title: "Printer gagal dihubungkan", description: e instanceof PrinterError ? e.message : (e as Error).message });
      }
    } finally {
      setPairing(false);
    }
  }

  return (
    <Sheet
      isOpen={isOpen}
      onClose={onClose}
      title="Pengaturan printer"
      description="Berlaku untuk perangkat ini saja. Tiap komputer/tablet kasir bisa memakai printer berbeda."
      footer={
        <div className="flex w-full flex-wrap items-center gap-2">
          <Link href="/panduan/printer" target="_blank" className="me-auto flex items-center gap-1.5 text-body-medium text-text-secondary hover:text-text-primary">
            <RiBookOpenLine className="size-4" aria-hidden />
            Panduan printer
          </Link>
          <Button variant="secondary" leadingIcon={RiPrinterLine} onClick={() => printTest(storeName)} disabled={busy || (!!direct && !device)}>
            Cetak tes
          </Button>
          <Button onClick={onClose}>Selesai</Button>
        </div>
      }
    >
      <div className="flex flex-col gap-6">
        <RadioGroup
          aria-label="Cara mencetak struk"
          value={settings.mode}
          onChange={(v) => savePrinterSettings({ mode: v as PrinterMode })}
          className="flex flex-col gap-3"
        >
          {MODES.map((m) => {
            const unsupported = !!m.needs && !can[m.needs];
            return (
              <Radio key={m.id} value={m.id} isDisabled={unsupported}>
                <span className="flex flex-col">
                  <span className="text-body-medium text-text-primary">{m.title}</span>
                  <span className="text-body-2-regular text-text-tertiary">{unsupported ? "Tidak didukung browser ini — pakai Chrome atau Edge." : m.hint}</span>
                </span>
              </Radio>
            );
          })}
        </RadioGroup>

        {direct && (
          <div className="flex flex-col gap-3 rounded-2xl bg-background-secondary-default p-4">
            <div className="flex items-center gap-3">
              {(() => {
                const Icon = ICON[direct];
                return <Icon className="size-5 shrink-0 text-foreground-icon-secondary" aria-hidden />;
              })()}
              <div className="min-w-0 flex-1">
                <p className="truncate text-body-medium text-text-primary">{device?.label ?? "Belum ada printer"}</p>
                <p className="text-body-2-regular text-text-tertiary">{device ? "Terhubung di perangkat ini" : "Nyalakan printer lalu hubungkan."}</p>
              </div>
              <Button size="small" variant={device ? "secondary" : "primary"} onClick={() => pair(direct)} disabled={pairing}>
                {device ? "Ganti" : "Hubungkan printer"}
              </Button>
            </div>
            {direct === "serial" && (
              <Field label="Kecepatan (baud rate)">
                <Select
                  aria-label="Kecepatan (baud rate)"
                  selectedKey={String(settings.baudRate)}
                  onSelectionChange={(k) => savePrinterSettings({ baudRate: Number(k) })}
                  triggerClassName="w-full"
                >
                  {[9600, 19200, 38400, 57600, 115200].map((b) => (
                    <SelectItem key={b} id={String(b)} textValue={String(b)}>
                      {b}
                    </SelectItem>
                  ))}
                </Select>
              </Field>
            )}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Lebar kertas">
            <SegmentedControl
              aria-label="Lebar kertas"
              selectedKeys={new Set([String(settings.paper)])}
              onSelectionChange={(keys) => {
                const next = [...keys][0];
                if (next) savePrinterSettings({ paper: next === "80" ? 80 : 58 });
              }}
            >
              <SegmentedControlItem id="58">58 mm</SegmentedControlItem>
              <SegmentedControlItem id="80">80 mm</SegmentedControlItem>
            </SegmentedControl>
          </Field>
          <Field label="Jumlah salinan">
            <Select aria-label="Jumlah salinan" selectedKey={String(settings.copies)} onSelectionChange={(k) => savePrinterSettings({ copies: Number(k) })} triggerClassName="w-full">
              {[1, 2, 3].map((n) => (
                <SelectItem key={n} id={String(n)} textValue={`${n} salinan`}>
                  {n} salinan
                </SelectItem>
              ))}
            </Select>
          </Field>
        </div>

        <div className="flex flex-col gap-4">
          <Switch isSelected={settings.autoPrint} onChange={(v) => savePrinterSettings({ autoPrint: v })} size="sm">
            <span className="flex flex-col">
              <span className="text-body-medium text-text-primary">Cetak otomatis setelah bayar</span>
              <span className="text-body-2-regular text-text-tertiary">
                {settings.mode === "browser"
                  ? "Dialog cetak terbuka otomatis. Agar langsung tercetak tanpa dialog, lihat panduan (mode kiosk Chrome)."
                  : settings.mode === "pdf"
                    ? "File PDF struk langsung terunduh."
                    : "Struk langsung keluar dari printer begitu transaksi lunas."}
              </span>
            </span>
          </Switch>
          {direct && (
            <>
              <Switch isSelected={settings.cut} onChange={(v) => savePrinterSettings({ cut: v })} size="sm">
                <span className="text-body-medium text-text-primary">Potong kertas otomatis (printer dengan pemotong)</span>
              </Switch>
              <Switch isSelected={settings.openDrawer} onChange={(v) => savePrinterSettings({ openDrawer: v })} size="sm">
                <span className="flex flex-col">
                  <span className="text-body-medium text-text-primary">Buka laci kas</span>
                  <span className="text-body-2-regular text-text-tertiary">Untuk laci yang dicolok ke printer. Terbuka saat transaksi tunai, bukan saat cetak ulang.</span>
                </span>
              </Switch>
            </>
          )}
        </div>

        {settings.mode !== "pdf" && (
          <p className="flex items-start gap-2 text-body-2-regular text-text-tertiary">
            <RiFilePdf2Line className="mt-0.5 size-4 shrink-0" aria-hidden />
            Tombol &ldquo;PDF&rdquo; di layar transaksi berhasil dan di halaman struk tetap tersedia kapan pun.
          </p>
        )}
      </div>
    </Sheet>
  );
}
