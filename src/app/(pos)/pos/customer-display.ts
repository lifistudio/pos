"use client";

/**
 * Layar pelanggan (monitor kedua menghadap pelanggan) — seperti di minimarket: keranjang, total, QRIS, terima kasih.
 * Kasir & layar pelanggan adalah dua jendela di browser yang sama (satu komputer, dua monitor), berkomunikasi lewat
 * BroadcastChannel: tidak lewat server, tidak ada data yang keluar dari perangkat.
 */
export type DisplayMessage =
  | { type: "idle"; storeName: string }
  | { type: "cart"; storeName: string; lines: { name: string; qty: number; total: number }[]; total: number }
  | { type: "qris"; storeName: string; qrString: string; amount: number; expiresAt: string }
  | { type: "paid"; storeName: string; total: number; change: number }
  /** Layar pelanggan baru dibuka → minta kasir mengirim keadaan terkini. */
  | { type: "hello" };

const CHANNEL = "konten-pos-display";
let channel: BroadcastChannel | null = null;
let last: DisplayMessage | null = null;

function getChannel() {
  if (typeof BroadcastChannel === "undefined") return null;
  if (!channel) {
    channel = new BroadcastChannel(CHANNEL);
    channel.addEventListener("message", (e: MessageEvent<DisplayMessage>) => {
      if (e.data?.type === "hello" && last) channel!.postMessage(last);
    });
  }
  return channel;
}

/** Kirim keadaan kasir ke layar pelanggan (aman dipanggil walau layar pelanggan tidak dibuka). */
export function postDisplay(message: Exclude<DisplayMessage, { type: "hello" }>) {
  last = message;
  getChannel()?.postMessage(message);
}

export function subscribeDisplay(onMessage: (m: DisplayMessage) => void) {
  if (typeof BroadcastChannel === "undefined") return () => {};
  const c = new BroadcastChannel(CHANNEL);
  const handler = (e: MessageEvent<DisplayMessage>) => onMessage(e.data);
  c.addEventListener("message", handler);
  c.postMessage({ type: "hello" } satisfies DisplayMessage);
  return () => {
    c.removeEventListener("message", handler);
    c.close();
  };
}

export function openCustomerDisplay() {
  return window.open("/pos/display", "konten-pos-display", "popup,width=1024,height=768");
}

/** Keranjang → pesan layar pelanggan (nama varian digabung, total per baris dari harga kasir). */
export function cartMessage(storeName: string, lines: { productName: string; title: string; price: number; qty: number }[], total: number): Exclude<DisplayMessage, { type: "hello" }> {
  if (!lines.length) return { type: "idle", storeName };
  return {
    type: "cart",
    storeName,
    lines: lines.map((l) => ({ name: l.title === "Default" ? l.productName : `${l.productName} ${l.title}`, qty: l.qty, total: l.price * l.qty })),
    total,
  };
}
