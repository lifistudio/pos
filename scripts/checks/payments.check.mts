/**
 * Pemeriksaan adapter Xendit & DOKU dengan fetch tiruan (tanpa akun sungguhan): `pnpm check:payments`.
 * Memeriksa bentuk permintaan sesuai dokumentasi resmi, tanda tangan, pemetaan status, dan verifikasi webhook.
 */
import assert from "node:assert/strict";
import { createHash, createHmac, createVerify, generateKeyPairSync } from "node:crypto";

process.env.DATABASE_URL ??= "postgres://check:check@localhost:5432/check";
process.env.BETTER_AUTH_SECRET ??= "x".repeat(40);
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";

const { XenditProvider } = await import("../../src/server/payments/xendit");
const { DokuProvider, dokuSignature, snapTimestamp } = await import("../../src/server/payments/doku");

type Handler = (url: URL, init: RequestInit) => { status?: number; body: unknown };
let handler: Handler = () => ({ status: 500, body: {} });
const calls: { url: URL; init: RequestInit }[] = [];
globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
  const url = new URL(String(input));
  calls.push({ url, init });
  const r = handler(url, init);
  return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
}) as typeof fetch;
const headersOf = (init: RequestInit) => init.headers as Record<string, string>;

// ── Xendit ──────────────────────────────────────────────────────────────
const xendit = new XenditProvider("xnd_development_kunci", "token-webhook-uji", "https://x.test/v3");
handler = () => ({ status: 201, body: { payment_request_id: "pr-1", status: "REQUIRES_ACTION", actions: [{ type: "PRESENT_TO_CUSTOMER", descriptor: "QR_STRING", value: "00020101QR" }] } });
const created = await xendit.createQris({ gatewayOrderId: "INV-1-1", amount: 150000, expiryMinutes: 15 });
assert.equal(created.qrString, "00020101QR");
assert.equal(created.providerRef, "pr-1");
const sent = JSON.parse(String(calls[0].init.body));
assert.equal(calls[0].url.pathname, "/v3/payment_requests");
assert.equal(headersOf(calls[0].init)["api-version"], "2024-11-11");
assert.equal(headersOf(calls[0].init).Authorization, `Basic ${Buffer.from("xnd_development_kunci:").toString("base64")}`);
assert.equal(headersOf(calls[0].init)["idempotency-key"], "INV-1-1", "percobaan ulang tidak menagih dua kali");
assert.deepEqual({ ...sent, channel_properties: undefined }, { reference_id: "INV-1-1", type: "PAY", country: "ID", currency: "IDR", request_amount: 150000, capture_method: "AUTOMATIC", channel_code: "QRIS", channel_properties: undefined });
assert.ok(new Date(sent.channel_properties.expires_at).getTime() > Date.now());

handler = () => ({ status: 400, body: { message: "channel not activated" } });
await assert.rejects(xendit.createQris({ gatewayOrderId: "X", amount: 1000, expiryMinutes: 15 }), /channel not activated/);

for (const [remote, want] of [["SUCCEEDED", "PAID"], ["EXPIRED", "EXPIRED"], ["CANCELED", "CANCELLED"], ["FAILED", "FAILED"], ["REQUIRES_ACTION", "PENDING"]]) {
  handler = () => ({ body: { status: remote, request_amount: 150000 } });
  assert.equal((await xendit.getStatus("INV-1-1", "pr-1"))?.status, want);
}
assert.equal(await xendit.getStatus("INV-1-1", null), null, "tanpa id gateway tidak bisa dicek");

const hook = { event: "payment.capture", data: { payment_id: "py-1", payment_request_id: "pr-1", reference_id: "INV-1-1", status: "SUCCEEDED", request_amount: 150000, captures: [{ capture_id: "cp-1", capture_amount: 150000 }] } };
const ctx = (token: string) => ({ headers: new Headers({ "x-callback-token": token }), path: "/x" });
assert.deepEqual(xendit.parseNotification(hook, ctx("token-webhook-uji")), { gatewayOrderId: "INV-1-1", status: "PAID", amount: 150000, providerRef: "pr-1", eventKey: "py-1:cp-1:payment.capture" });
assert.throws(() => xendit.parseNotification(hook, ctx("token-palsu!!!!!!")), /Signature/);
assert.throws(() => xendit.parseNotification(hook, { headers: new Headers(), path: "" }), /Signature/);
assert.equal((xendit.parseNotification({ event: "payment.failure", data: { reference_id: "INV-1-1", status: "FAILED" } }, ctx("token-webhook-uji")) as { status: string }).status, "PENDING", "percobaan gagal tidak membatalkan transaksi");
console.log("  ✓ Xendit: permintaan, status, webhook");

// ── DOKU ────────────────────────────────────────────────────────────────
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
const doku = new DokuProvider({ clientId: "BRN-0001", secretKey: "rahasia-doku-uji", privateKey, merchantId: "M-1", terminalId: "T001", postalCode: "40115", base: "https://d.test" });

assert.match(snapTimestamp(new Date("2026-01-01T00:00:00Z")), /^2026-01-01T07:00:00\+07:00$/);
const manual = createHmac("sha512", "s").update(`POST:/p:t:${createHash("sha256").update("{}").digest("hex")}:ts`).digest("base64");
assert.equal(dokuSignature("s", "POST", "/p", "t", "{}", "ts"), manual);

handler = (url) => {
  if (url.pathname === "/authorization/v1/access-token/b2b") return { body: { accessToken: "TOKEN", expiresIn: "900" } };
  if (url.pathname.endsWith("/qr-mpm-generate")) return { body: { responseCode: "2004700", referenceNo: "REF1", qrContent: "00020101DOKU" } };
  return { body: { responseCode: "2005100", latestTransactionStatus: "00", amount: { value: "150000.00" } } };
};
calls.length = 0;
const qr = await doku.createQris({ gatewayOrderId: "INV-2-1", amount: 150000, expiryMinutes: 15 });
assert.equal(qr.qrString, "00020101DOKU");
assert.equal(qr.providerRef, "REF1");
const [tokenCall, genCall] = calls;
const th = headersOf(tokenCall.init);
assert.equal(th["X-CLIENT-KEY"], "BRN-0001");
assert.equal(JSON.parse(String(tokenCall.init.body)).grantType, "client_credentials");
assert.ok(createVerify("RSA-SHA256").update(`BRN-0001|${th["X-TIMESTAMP"]}`).verify(publicKey, th["X-SIGNATURE"], "base64"), "token: SHA256withRSA atas clientId|timestamp");
const gh = headersOf(genCall.init);
const genBody = String(genCall.init.body);
assert.equal(genCall.url.pathname, "/snap-adapter/b2b/v1.0/qr/qr-mpm-generate");
assert.equal(gh.Authorization, "Bearer TOKEN");
assert.equal(gh["CHANNEL-ID"], "H2H");
assert.equal(gh["X-PARTNER-ID"], "BRN-0001");
assert.match(gh["X-EXTERNAL-ID"], /^\d+$/);
assert.equal(gh["X-SIGNATURE"], dokuSignature("rahasia-doku-uji", "POST", genCall.url.pathname, "TOKEN", genBody, gh["X-TIMESTAMP"]));
const parsedBody = JSON.parse(genBody);
assert.deepEqual(parsedBody.amount, { value: "150000.00", currency: "IDR" });
assert.deepEqual(parsedBody.additionalInfo, { postalCode: "40115", feeType: "1" });
assert.equal(parsedBody.terminalId, "T001");

calls.length = 0;
assert.deepEqual(await doku.getStatus("INV-2-1", "REF1"), { status: "PAID", providerRef: "REF1", amount: 150000 });
assert.equal(calls.length, 1, "token dipakai ulang, tidak diminta tiap transaksi");
assert.deepEqual(JSON.parse(String(calls[0].init.body)), { originalReferenceNo: "REF1", originalPartnerReferenceNo: "INV-2-1", serviceCode: "47", merchantId: "M-1" });
for (const [remote, want] of [["03", "PENDING"], ["05", "CANCELLED"], ["06", "FAILED"]]) {
  handler = () => ({ body: { responseCode: "2005100", latestTransactionStatus: remote, amount: { value: "150000.00" } } });
  assert.equal((await doku.getStatus("INV-2-1", "REF1"))?.status, want);
}
handler = () => ({ status: 400, body: { responseCode: "4004700", responseMessage: "Bad Request" } });
assert.equal(await doku.getStatus("INV-2-1", "REF1"), null);
await assert.rejects(doku.createQris({ gatewayOrderId: "X", amount: 1000, expiryMinutes: 15 }), /Bad Request/);

// Notifikasi hanya pemicu: tidak ada status yang diambil dari isi webhook.
assert.deepEqual(doku.parseNotification({ originalPartnerReferenceNo: "INV-2-1", latestTransactionStatus: "00", amount: { value: "1.00" } }), { verifyOrderId: "INV-2-1" });
assert.throws(() => doku.parseNotification({}), /Signature/);
console.log("  ✓ DOKU: token RSA, signature HMAC, status, notifikasi");

console.log("Payment gateway: semua pemeriksaan lulus");
