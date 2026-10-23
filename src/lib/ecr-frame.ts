/**
 * Lapisan tautan ECR (Electronic Cash Register ↔ EDC) yang umum dipakai protokol bank: paket
 * STX ‖ data ‖ ETX ‖ LRC, LRC = XOR byte setelah STX sampai ETX (inklusif), dibalas ACK/NAK.
 * Murni (tanpa I/O) agar bisa diuji di Node; transport serial ada di components/app/payment-terminal.
 */
export const STX = 0x02;
export const ETX = 0x03;
export const ACK = 0x06;
export const NAK = 0x15;

export type FrameOptions = {
  /** Nilai awal XOR (umumnya 0x00; beberapa protokol 0x7F/0xFF). */
  lrcInit?: number;
  /** Sertakan ETX dalam LRC (default true). */
  lrcIncludesEtx?: boolean;
};

export function lrc(bytes: Uint8Array, init = 0) {
  let x = init & 0xff;
  for (const b of bytes) x ^= b;
  return x;
}

export function encodeFrame(data: Uint8Array, o: FrameOptions = {}) {
  const body = new Uint8Array(data.length + 1);
  body.set(data);
  body[data.length] = ETX;
  const check = lrc(o.lrcIncludesEtx === false ? data : body, o.lrcInit ?? 0);
  const out = new Uint8Array(body.length + 2);
  out[0] = STX;
  out.set(body, 1);
  out[out.length - 1] = check;
  return out;
}

export type ParseEvent = { type: "ack" } | { type: "nak" } | { type: "frame"; data: Uint8Array } | { type: "bad-frame" };

/**
 * Pengurai aliran byte bertahap: masukkan potongan apa adanya dari port, keluarkan ACK/NAK/paket utuh.
 * Byte di luar paket (noise) diabaikan; paket dengan LRC salah → "bad-frame" (pengirim harus membalas NAK).
 */
export class FrameParser {
  private buf: number[] = [];
  private inFrame = false;
  private awaitingLrc = false;
  constructor(private o: FrameOptions = {}) {}

  push(chunk: Uint8Array): ParseEvent[] {
    const events: ParseEvent[] = [];
    for (const b of chunk) {
      if (this.awaitingLrc) {
        const data = Uint8Array.from(this.buf);
        const body = Uint8Array.from([...this.buf, ETX]);
        const ok = lrc(this.o.lrcIncludesEtx === false ? data : body, this.o.lrcInit ?? 0) === b;
        events.push(ok ? { type: "frame", data } : { type: "bad-frame" });
        this.buf = [];
        this.inFrame = false;
        this.awaitingLrc = false;
      } else if (this.inFrame) {
        if (b === ETX) this.awaitingLrc = true;
        else if (b === STX) this.buf = []; // paket baru sebelum ETX → mulai ulang
        else if (this.buf.length < 4096) this.buf.push(b);
        else {
          this.buf = [];
          this.inFrame = false;
          events.push({ type: "bad-frame" });
        }
      } else if (b === STX) {
        this.inFrame = true;
        this.buf = [];
      } else if (b === ACK) events.push({ type: "ack" });
      else if (b === NAK) events.push({ type: "nak" });
    }
    return events;
  }
}
