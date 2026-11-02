/**
 * Pemeriksaan EDC/ECR: framing STX/ETX/LRC, pengurai aliran byte (potongan acak, noise, LRC salah),
 * protokol POS ECR v1, dan penyamaran nomor kartu. Jalankan: pnpm check:ecr
 */
import assert from "node:assert/strict";
import { ACK, encodeFrame, ETX, FrameParser, lrc, NAK, STX } from "../../src/lib/ecr-frame";
import { kontenEcr } from "../../src/lib/ecr-protocols";
import { maskPan, MASKED_PAN_RE } from "../../src/lib/payment-terminal";

let passed = 0;
const ok = (name: string) => {
  passed++;
  console.log(`  ✓ ${name}`);
};
const enc = new TextEncoder();

// Framing: STX data ETX LRC, LRC = XOR(data, ETX)
const data = enc.encode("HELLO");
const frame = encodeFrame(data);
assert.equal(frame[0], STX);
assert.equal(frame[frame.length - 2], ETX);
assert.equal(frame[frame.length - 1], lrc(Uint8Array.from([...data, ETX])));
assert.equal(lrc(Uint8Array.of(0x01, 0x02, 0x04)), 0x07);
assert.equal(lrc(Uint8Array.of(0x01), 0x7f), 0x7e);
assert.equal(encodeFrame(data, { lrcIncludesEtx: false }).at(-1), lrc(data));
ok("framing & LRC (termasuk/tanpa ETX, nilai awal)");

// Pengurai: potongan acak + noise + ACK/NAK + paket rusak
const p = new FrameParser();
const good = encodeFrame(enc.encode('{"v":1}'));
const bad = encodeFrame(enc.encode("XX"));
bad[bad.length - 1] ^= 0xff;
const stream = Uint8Array.from([0x00, 0xff, ACK, ...good, NAK, ...bad, ...good]);
const events = [];
for (let i = 0; i < stream.length; i += 3) events.push(...p.push(stream.slice(i, i + 3)));
assert.deepEqual(
  events.map((e) => e.type),
  ["ack", "frame", "nak", "bad-frame", "frame"],
);
const f = events[1] as { type: "frame"; data: Uint8Array };
assert.equal(new TextDecoder().decode(f.data), '{"v":1}');
ok("pengurai aliran: potongan, noise, ACK/NAK, LRC salah");

// POS ECR v1
const sale = JSON.parse(new TextDecoder().decode(kontenEcr.sale(150000, "ABC123")));
assert.deepEqual(sale, { v: 1, cmd: "SALE", amount: 150000, currency: "IDR", ref: "ABC123" });
const parse = (o: object) => kontenEcr.parse(enc.encode(JSON.stringify(o)));
assert.deepEqual(parse({ v: 1, status: "PROGRESS", message: "Masukkan PIN" }), { status: "progress", message: "Masukkan PIN" });
assert.equal(parse({ v: 1, status: "DECLINED", message: "Saldo kurang" })?.status, "declined");
assert.equal(parse({ v: 1, status: "APPROVED" })?.status, "declined", "approved tanpa kode → tidak dianggap lunas");
const ap = parse({ v: 1, status: "APPROVED", approvalCode: "123456", rrn: "000111222333", maskedPan: "************4242", cardType: "DEBIT BCA" });
assert.equal(ap?.status, "approved");
assert.equal(parse({ v: 2, status: "APPROVED", approvalCode: "1" }), null, "versi lain diabaikan");
assert.equal(kontenEcr.parse(enc.encode("bukan json")), null);
ok("POS ECR v1: SALE, PROGRESS, DECLINED, APPROVED, validasi");

// Penyamaran kartu (PCI DSS): hanya 4 digit terakhir
assert.equal(maskPan("4111 1111 1111 4242"), "************4242");
assert.equal(maskPan("411111******4242"), "************4242");
assert.equal(maskPan("12"), null);
assert.ok(MASKED_PAN_RE.test("************4242"));
assert.ok(!MASKED_PAN_RE.test("4111111111114242"), "nomor kartu lengkap ditolak");
ok("nomor kartu tersamar, nomor lengkap ditolak");

console.log(`\nEDC/ECR: ${passed} pemeriksaan lulus.`);
