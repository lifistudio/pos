"use client";

/**
 * Pengiriman byte ESC/POS ke printer lewat API browser (Chrome/Edge). Tipe minimal ditulis sendiri karena
 * WebUSB/Web Serial/Web Bluetooth belum ada di lib DOM TypeScript bawaan.
 */

type UsbEndpoint = { endpointNumber: number; direction: "in" | "out"; type: "bulk" | "interrupt" | "isochronous" };
type UsbAlternate = { endpoints: UsbEndpoint[] };
type UsbInterface = { interfaceNumber: number; alternate: UsbAlternate; claimed: boolean };
type UsbDevice = {
  vendorId: number;
  productId: number;
  productName?: string;
  manufacturerName?: string;
  opened: boolean;
  configuration: { interfaces: UsbInterface[] } | null;
  open(): Promise<void>;
  close(): Promise<void>;
  selectConfiguration(n: number): Promise<void>;
  claimInterface(n: number): Promise<void>;
  releaseInterface(n: number): Promise<void>;
  transferOut(endpoint: number, data: BufferSource): Promise<{ status: string }>;
};
type SerialPort = {
  getInfo(): { usbVendorId?: number; usbProductId?: number };
  open(o: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  writable: WritableStream<Uint8Array> | null;
};
type BtCharacteristic = {
  uuid: string;
  properties: { write: boolean; writeWithoutResponse: boolean };
  writeValueWithoutResponse?(v: BufferSource): Promise<void>;
  writeValue(v: BufferSource): Promise<void>;
};
type BtDevice = {
  id: string;
  name?: string;
  gatt?: { connected: boolean; connect(): Promise<BtServer>; disconnect(): void };
};
type BtServer = { getPrimaryServices(): Promise<{ uuid: string; getCharacteristics(): Promise<BtCharacteristic[]> }[]> };

type Nav = Navigator & {
  usb?: { requestDevice(o: { filters: object[] }): Promise<UsbDevice>; getDevices(): Promise<UsbDevice[]> };
  serial?: { requestPort(o?: object): Promise<SerialPort>; getPorts(): Promise<SerialPort[]> };
  bluetooth?: { requestDevice(o: object): Promise<BtDevice>; getDevices?(): Promise<BtDevice[]> };
};
const nav = () => navigator as Nav;

export const support = () => ({
  usb: typeof navigator !== "undefined" && !!nav().usb,
  serial: typeof navigator !== "undefined" && !!nav().serial,
  bluetooth: typeof navigator !== "undefined" && !!nav().bluetooth,
});

export class PrinterError extends Error {}

const describe = (d: { productName?: string; manufacturerName?: string; vendorId: number; productId: number }) =>
  [d.manufacturerName, d.productName].filter(Boolean).join(" ") || `USB ${d.vendorId.toString(16).padStart(4, "0")}:${d.productId.toString(16).padStart(4, "0")}`;

// ── USB ────────────────────────────────────────────────────────────────

export async function pairUsb() {
  if (!nav().usb) throw new PrinterError("Browser ini tidak mendukung USB langsung. Pakai Chrome/Edge di komputer atau Android, atau mode Browser.");
  const d = await nav().usb!.requestDevice({ filters: [] });
  return { label: describe(d), vendorId: d.vendorId, productId: d.productId };
}

export async function printUsb(data: Uint8Array, device: { vendorId?: number; productId?: number }) {
  if (!nav().usb) throw new PrinterError("Browser ini tidak mendukung USB langsung.");
  const d = (await nav().usb!.getDevices()).find((x) => x.vendorId === device.vendorId && x.productId === device.productId);
  if (!d) throw new PrinterError("Printer USB tidak ditemukan. Pastikan kabel tersambung dan printer menyala, lalu hubungkan ulang di Pengaturan printer.");
  try {
    if (!d.opened) await d.open();
    if (!d.configuration) await d.selectConfiguration(1);
    const iface = d.configuration?.interfaces.find((i) => i.alternate.endpoints.some((e) => e.direction === "out" && e.type === "bulk"));
    const endpoint = iface?.alternate.endpoints.find((e) => e.direction === "out" && e.type === "bulk");
    if (!iface || !endpoint) throw new PrinterError("Perangkat USB ini bukan printer struk (tidak ada jalur kirim data).");
    if (!iface.claimed) await d.claimInterface(iface.interfaceNumber);
    for (let i = 0; i < data.length; i += 4096) await d.transferOut(endpoint.endpointNumber, data.slice(i, i + 4096));
    await d.releaseInterface(iface.interfaceNumber).catch(() => {});
  } catch (e) {
    if (e instanceof PrinterError) throw e;
    // Windows: driver printer bawaan "mengunci" perangkat → WebUSB ditolak. Lihat panduan (Zadig / mode Browser).
    throw new PrinterError(`Gagal mengirim ke printer USB: ${(e as Error).message}. Di Windows, printer yang sudah memakai driver pabrik biasanya harus memakai mode Browser.`);
  } finally {
    await d.close().catch(() => {});
  }
}

// ── Serial (USB-serial, Bluetooth Classic SPP sebagai COM port) ───────

export async function pairSerial() {
  if (!nav().serial) throw new PrinterError("Browser ini tidak mendukung port serial. Pakai Chrome/Edge di komputer.");
  const p = await nav().serial!.requestPort();
  const info = p.getInfo();
  return {
    label: info.usbVendorId ? `Serial USB ${info.usbVendorId.toString(16)}:${(info.usbProductId ?? 0).toString(16)}` : "Port serial / Bluetooth",
    vendorId: info.usbVendorId,
    productId: info.usbProductId,
  };
}

export async function printSerial(data: Uint8Array, device: { vendorId?: number; productId?: number }, baudRate: number) {
  if (!nav().serial) throw new PrinterError("Browser ini tidak mendukung port serial.");
  const ports = await nav().serial!.getPorts();
  const port = ports.find((p) => (device.vendorId ? p.getInfo().usbVendorId === device.vendorId && p.getInfo().usbProductId === device.productId : true));
  if (!port) throw new PrinterError("Port printer tidak ditemukan. Hubungkan ulang di Pengaturan printer.");
  await port.open({ baudRate });
  try {
    const writer = port.writable!.getWriter();
    await writer.write(data);
    await writer.close();
  } finally {
    await port.close().catch(() => {});
  }
}

// ── Bluetooth Low Energy ──────────────────────────────────────────────

/** Layanan BLE yang umum dipakai printer thermal 58/80 mm (Zjiang, Goojprt, Xprinter, MTP, PeriPage, dll.). */
const BLE_SERVICES = [
  "000018f0-0000-1000-8000-00805f9b34fb",
  "0000ff00-0000-1000-8000-00805f9b34fb",
  "0000ffe0-0000-1000-8000-00805f9b34fb",
  "0000fee7-0000-1000-8000-00805f9b34fb",
  "49535343-fe7d-4ae5-8fa9-9fafd205e455",
  "e7810a71-73ae-499d-8c15-faa9aef0c3f2",
];

let btDevice: BtDevice | null = null;

export async function pairBluetooth() {
  if (!nav().bluetooth) throw new PrinterError("Browser ini tidak mendukung Bluetooth. Pakai Chrome di Android/komputer, atau mode Browser.");
  btDevice = await nav().bluetooth!.requestDevice({ acceptAllDevices: true, optionalServices: BLE_SERVICES });
  return { label: btDevice.name || "Printer Bluetooth", bluetoothId: btDevice.id };
}

export async function printBluetooth(data: Uint8Array, device: { bluetoothId?: string }) {
  if (!nav().bluetooth) throw new PrinterError("Browser ini tidak mendukung Bluetooth.");
  if (!btDevice || btDevice.id !== device.bluetoothId) {
    const known = (await nav().bluetooth!.getDevices?.()) ?? [];
    btDevice = known.find((d) => d.id === device.bluetoothId) ?? null;
  }
  if (!btDevice?.gatt) throw new PrinterError("Printer Bluetooth belum tersambung di sesi ini. Buka Pengaturan printer lalu ketuk Hubungkan.");
  const server = await btDevice.gatt.connect();
  let target: BtCharacteristic | null = null;
  for (const service of await server.getPrimaryServices()) {
    for (const c of await service.getCharacteristics()) {
      if (c.properties.writeWithoutResponse || c.properties.write) {
        target = c;
        break;
      }
    }
    if (target) break;
  }
  if (!target) throw new PrinterError("Printer Bluetooth tidak menyediakan jalur tulis yang dikenal.");
  // BLE mengirim paket kecil; jeda singkat agar buffer printer tidak meluap.
  for (let i = 0; i < data.length; i += 100) {
    const chunk = data.slice(i, i + 100);
    if (target.properties.writeWithoutResponse && target.writeValueWithoutResponse) await target.writeValueWithoutResponse(chunk);
    else await target.writeValue(chunk);
    await new Promise((r) => setTimeout(r, 20));
  }
}

// ── Browser (driver OS) & PDF ─────────────────────────────────────────

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Cetak lewat dialog browser dari iframe tersembunyi (tanpa jendela pop-up). */
export function printViaBrowser(lines: { text: string; bold: boolean; large: boolean }[], paperMm: 58 | 80, title: string, copies = 1) {
  const body = lines.map((l) => `<div class="${l.bold ? "b " : ""}${l.large ? "l" : ""}">${escapeHtml(l.text) || "&nbsp;"}</div>`).join("");
  const html = `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
@page{size:${paperMm}mm auto;margin:0}html,body{margin:0;background:#fff;color:#000}
.r{width:${paperMm - 6}mm;margin:3mm;font:${paperMm === 58 ? 10.5 : 11}px/1.35 ui-monospace,Consolas,Menlo,monospace;white-space:pre}
.b{font-weight:700}.l{font-size:2em;line-height:1.2}.r+.r{break-before:page}
</style></head><body>${Array.from({ length: copies }, () => `<div class="r">${body}</div>`).join("")}</body></html>`;
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(html);
  doc.close();
  const cleanup = () => setTimeout(() => frame.remove(), 1000);
  frame.contentWindow!.addEventListener("afterprint", cleanup, { once: true });
  setTimeout(() => {
    frame.contentWindow!.focus();
    frame.contentWindow!.print();
    setTimeout(cleanup, 60_000);
  }, 50);
}

export function downloadBlob(data: Uint8Array, fileName: string, type: string) {
  const url = URL.createObjectURL(new Blob([new Uint8Array(data)], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
