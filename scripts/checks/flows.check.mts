/**
 * Uji alur end-to-end terhadap PostgreSQL sungguhan (bukan tiruan): kasir, retur, voucher, order online, transfer,
 * opname, mode offline, RBAC, dan integrasi marketplace lewat toko simulasi (jalur webhook yang sama dengan marketplace asli).
 *
 * Jalankan terhadap database SEKALI PAKAI yang sudah dimigrasi:
 *   DATABASE_URL=postgres://.../pos_check pnpm check:flows
 * Skrip menolak berjalan bila host bukan lokal atau nama database tidak mengandung "check", agar data sungguhan aman.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const raw = process.env.DATABASE_URL ?? "";
const parsed = raw ? new URL(raw) : null;
if (!parsed || !["127.0.0.1", "localhost"].includes(parsed.hostname) || !parsed.pathname.includes("check")) {
  console.error("Ditolak: DATABASE_URL harus database lokal sekali pakai (host localhost, nama mengandung \"check\").");
  process.exit(1);
}
process.env.BETTER_AUTH_SECRET ??= "x".repeat(40);
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
process.env.PAYMENT_PROVIDER = "mock";
process.env.SHOPEE_PARTNER_ID = "1000001";
process.env.SHOPEE_PARTNER_KEY = "partner-key-uji-0123456789";
// SMTP tiruan di mesin ini (lihat bagian "Lupa password").
const { createServer } = await import("node:net");
const inbox: string[] = [];
const smtp = createServer((socket) => {
  let data = false;
  let message = "";
  socket.write("220 uji ESMTP\r\n");
  socket.on("data", (chunk) => {
    for (const line of chunk.toString().split("\r\n").filter((l, i, all) => l || i < all.length - 1)) {
      if (data) {
        message += `${line}\n`;
        if (line === ".") {
          data = false;
          inbox.push(message);
          message = "";
          socket.write("250 ok\r\n");
        }
      } else if (/^(EHLO|HELO)/i.test(line)) socket.write("250 uji\r\n");
      else if (/^DATA/i.test(line)) (data = true), socket.write("354 lanjut\r\n");
      else if (/^QUIT/i.test(line)) socket.end("221 selesai\r\n");
      else socket.write("250 ok\r\n");
    }
  });
  socket.on("error", () => null);
});
await new Promise<void>((resolve) => smtp.listen(0, "127.0.0.1", resolve));
process.env.SMTP_HOST = "127.0.0.1";
process.env.SMTP_PORT = String((smtp.address() as { port: number }).port);
process.env.SMTP_FROM = "POS <no-reply@check.test>";

const { and, eq } = await import("drizzle-orm");
const { db } = await import("../../src/server/db");
const s = await import("../../src/server/db/schema");
const { ALL_PERMISSIONS } = await import("../../src/server/rbac/permissions");
const { loadAccess } = await import("../../src/server/rbac/access");
const { createProduct } = await import("../../src/server/services/product.service");
const sale = await import("../../src/server/services/sale.service");
const { createReturn } = await import("../../src/server/services/return.service");
const orders = await import("../../src/server/services/online-order.service");
const transfer = await import("../../src/server/services/transfer.service");
const opname = await import("../../src/server/services/opname.service");
const offline = await import("../../src/server/services/offline.service");
const qris = await import("../../src/server/services/pos-qris.service");
const users = await import("../../src/server/services/user.service");
const { createVoucher } = await import("../../src/server/services/voucher.service");
const { createCustomer } = await import("../../src/server/services/customer.service");
const mp = await import("../../src/server/services/marketplace.service");
const { MarketplaceError } = await import("../../src/server/marketplace/types");
type Actor = import("../../src/server/api/context").Actor;

const tag = Date.now().toString(36).toUpperCase().slice(-6);
const failures: string[] = [];
let passed = 0;
async function step(name: string, run: () => Promise<void>) {
  try {
    await run();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures.push(name);
    console.log(`  ✗ ${name}\n      ${(error as Error).message.split("\n").slice(0, 3).join(" | ")}`);
  }
}
const rejects = async (p: Promise<unknown>, code: string) => {
  await assert.rejects(p, (e: { code?: string }) => e.code === code, `harus ditolak dengan ${code}`);
};

// ── Data dasar ──────────────────────────────────────────────────────────

async function makeRole(name: string, permissions: string[], isSystem = false) {
  const [role] = await db.insert(s.roles).values({ name: `${name} ${tag}`, isSystem }).returning();
  await db.insert(s.rolePermissions).values(permissions.map((permission) => ({ roleId: role.id, permission })));
  return role;
}
async function makeActor(name: string, roleId: string, branchId: string | null = null): Promise<Actor> {
  const id = randomUUID();
  const email = `${name.toLowerCase().replaceAll(" ", ".")}.${tag}@check.test`.toLowerCase();
  await db.insert(s.user).values({ id, name, email, emailVerified: true });
  await db.insert(s.account).values({ id: randomUUID(), accountId: id, providerId: "credential", userId: id, password: "x" });
  await db.insert(s.userRoleAssignments).values({ userId: id, roleId, branchId });
  return { type: "USER", userId: id, user: { id, name, email }, access: await loadAccess(id), ip: null, userAgent: "flows" };
}

const ownerRole = await makeRole("Owner", ALL_PERMISSIONS, true);
const owner = await makeActor("Pemilik", ownerRole.id);
const [store, store2] = await db
  .insert(s.branches)
  .values([
    { code: `A${tag}`, name: `Toko A ${tag}`, type: "STORE" as const },
    { code: `B${tag}`, name: `Toko B ${tag}`, type: "STORE" as const },
  ])
  .returning();
await createProduct(owner, {
  name: `Kaos Uji ${tag}`,
  status: "ACTIVE",
  options: [{ name: "Ukuran", values: ["M", "L"] }],
  variants: ["M", "L"].map((size) => ({ optionValues: [size], price: 100_000, costPrice: 40_000, initialStock: [{ branchId: store.id, qty: 40 }] })),
} as Parameters<typeof createProduct>[1]);
const variants = await db
  .select({ id: s.productVariants.id, sku: s.productVariants.sku })
  .from(s.productVariants)
  .innerJoin(s.products, eq(s.products.id, s.productVariants.productId))
  .where(eq(s.products.name, `Kaos Uji ${tag}`));
const [v1, v2] = variants;
const level = async (variantId: string, branchId = store.id) => {
  const [l] = await db.select().from(s.inventoryLevels).where(and(eq(s.inventoryLevels.variantId, variantId), eq(s.inventoryLevels.branchId, branchId)));
  return { onHand: l?.onHand ?? 0, reserved: l?.reserved ?? 0 };
};
const orderOf = async (externalOrderNo: string) => {
  const [o] = await db.select().from(s.onlineOrders).where(eq(s.onlineOrders.externalOrderNo, externalOrderNo));
  return o;
};

console.log("\nKasir");
const shift = await sale.openShift(owner, { branchId: store.id, openingCash: 50_000 });

await step("checkout tunai memotong stok & kembalian benar", async () => {
  const before = await level(v1.id);
  const r = await sale.checkout(owner, { branchId: store.id, idempotencyKey: randomUUID(), items: [{ variantId: v1.id, qty: 2 }], payments: [{ method: "CASH", amount: 200_000, tendered: 250_000 }] });
  assert.equal(r.status, "PAID");
  assert.equal(r.payments[0].change, 50_000);
  assert.equal((await level(v1.id)).onHand, before.onHand - 2);
});
await step("idempotency: kunci sama tidak menggandakan transaksi", async () => {
  const key = randomUUID();
  const input = { branchId: store.id, idempotencyKey: key, items: [{ variantId: v1.id, qty: 1 }], payments: [{ method: "CASH" as const, amount: 100_000 }] };
  const before = await level(v1.id);
  const [a, b] = await Promise.all([sale.checkout(owner, input), sale.checkout(owner, input)]);
  assert.equal(a.id, b.id);
  assert.equal((await level(v1.id)).onHand, before.onHand - 1);
});
await step("stok tidak bisa minus", async () => {
  await rejects(sale.checkout(owner, { branchId: store.id, idempotencyKey: randomUUID(), items: [{ variantId: v1.id, qty: 9999 }], payments: [{ method: "CASH", amount: 999_900_000 }] }), "INSUFFICIENT_STOCK");
});
await step("void mengembalikan stok & kuota voucher", async () => {
  const code = `V${tag}`;
  const v = await createVoucher(owner, { code, name: "Uji", valueType: "NOMINAL", value: 10_000, startsAt: new Date(Date.now() - 60_000).toISOString(), quotaTotal: 1, productScope: "ALL", customerScope: "ALL", status: "ACTIVE" });
  const before = await level(v1.id);
  const r = await sale.checkout(owner, { branchId: store.id, idempotencyKey: randomUUID(), voucherCode: code, items: [{ variantId: v1.id, qty: 1 }], payments: [{ method: "CASH", amount: 90_000 }] });
  await rejects(sale.checkout(owner, { branchId: store.id, idempotencyKey: randomUUID(), voucherCode: code, items: [{ variantId: v1.id, qty: 1 }], payments: [{ method: "CASH", amount: 90_000 }] }), "VOUCHER_EXHAUSTED");
  await sale.voidSale(owner, r.id, "uji void");
  assert.equal((await level(v1.id)).onHand, before.onHand);
  const [row] = await db.select({ used: s.vouchers.quotaUsed }).from(s.vouchers).where(eq(s.vouchers.id, v.id));
  assert.equal(row.used, 0);
});
await step("retur sebagian: poin ditarik, stok kembali, tidak bisa melebihi qty", async () => {
  const c = await createCustomer(owner, { name: "Pelanggan Uji", phone: `0812${String(Date.now()).slice(-8)}`, isMember: true, consent: true } as Parameters<typeof createCustomer>[1]);
  const r = await sale.checkout(owner, { branchId: store.id, idempotencyKey: randomUUID(), customerId: c.id, items: [{ variantId: v2.id, qty: 3 }], payments: [{ method: "CASH", amount: 300_000 }] });
  const before = await level(v2.id);
  const item = r.items[0];
  const ret = await createReturn(owner, r.id, { items: [{ saleItemId: item.id, qty: 1, restock: true }], refundMethod: "CASH", reasonCode: "SIZE", reason: "ukuran" });
  assert.equal(ret.refundAmount, 100_000);
  assert.equal((await level(v2.id)).onHand, before.onHand + 1);
  await rejects(createReturn(owner, r.id, { items: [{ saleItemId: item.id, qty: 5, restock: true }], refundMethod: "CASH", reasonCode: "SIZE", reason: "ukuran" }), "RETURN_INVALID");
});
await step("QRIS kasir: dibayar → lunas; dibatalkan → stok kembali", async () => {
  const before = await level(v1.id);
  const paid = await qris.startQrisCheckout(owner, { branchId: store.id, idempotencyKey: randomUUID(), items: [{ variantId: v1.id, qty: 1 }] });
  assert.equal(paid.sale.status, "PENDING");
  assert.equal((await qris.simulateQris(owner, paid.sale.id)).sale.status, "PAID");
  const cancelled = await qris.startQrisCheckout(owner, { branchId: store.id, idempotencyKey: randomUUID(), items: [{ variantId: v1.id, qty: 1 }] });
  assert.equal((await qris.cancelQris(owner, cancelled.sale.id)).sale.status, "VOIDED");
  assert.equal((await level(v1.id)).onHand, before.onHand - 1);
});
await step("mode offline: harga bertanda tangan sah, harga dipalsukan ditolak", async () => {
  const pack = await offline.offlinePack(owner, store.id);
  const item = pack.items.find((i) => i.variantId === v1.id)!;
  const base = { branchId: store.id, shiftId: shift.id, localRef: "OFF-1", createdAt: new Date().toISOString(), packIssuedAt: pack.issuedAt };
  const ok = await offline.syncOfflineSale(owner, { ...base, idempotencyKey: randomUUID(), items: [{ variantId: v1.id, qty: 1, unitPrice: item.price, sig: item.sig }], payments: [{ method: "CASH", amount: item.price }] });
  assert.equal(ok.sale.status, "PAID");
  await rejects(offline.syncOfflineSale(owner, { ...base, idempotencyKey: randomUUID(), items: [{ variantId: v1.id, qty: 1, unitPrice: 1000, sig: item.sig }], payments: [{ method: "CASH", amount: 1000 }] }), "OFFLINE_PRICE_INVALID");
});
await step("tutup shift: kas seharusnya menghitung penjualan tunai dikurangi refund", async () => {
  const summary = await sale.getShiftSummary(owner, shift.id);
  const cash = summary.payments.find((p) => p.method === "CASH")!.amount;
  assert.equal(summary.expectedCash, 50_000 + cash - summary.cashRefund);
  const closed = await sale.closeShift(owner, shift.id, { countedCash: summary.expectedCash });
  assert.equal(closed.difference, 0);
});

console.log("\nStok");
await step("transfer: kirim mengurangi asal, terima sebagian mencatat selisih", async () => {
  const before = await level(v1.id);
  const t = await transfer.createTransfer(owner, { fromBranchId: store.id, toBranchId: store2.id, items: [{ variantId: v1.id, qty: 5 }] });
  await transfer.sendTransfer(owner, t.id);
  assert.equal((await level(v1.id)).onHand, before.onHand - 5);
  await transfer.receiveTransfer(owner, t.id, { items: [{ variantId: v1.id, qtyReceived: 4 }] });
  assert.equal((await level(v1.id, store2.id)).onHand, 4);
});
await step("opname sebagian: selisih dibukukan", async () => {
  const before = await level(v2.id);
  const o = await opname.createOpname(owner, { branchId: store.id, mode: "PARTIAL" });
  await opname.countItem(owner, o.id, { variantId: v2.id, qty: before.onHand - 1 });
  await opname.postOpname(owner, o.id);
  assert.equal((await level(v2.id)).onHand, before.onHand - 1);
});
await step("opname penuh: barang berstok yang tidak dihitung menjadi 0", async () => {
  const o = await opname.createOpname(owner, { branchId: store2.id, mode: "FULL" });
  await opname.countItem(owner, o.id, { variantId: v2.id, qty: 0 });
  await opname.postOpname(owner, o.id);
  assert.equal((await level(v1.id, store2.id)).onHand, 0);
});

console.log("\nOrder online manual");
await step("reservasi → lunas → kirim memotong stok fisik; batal melepas reservasi", async () => {
  const before = await level(v1.id);
  const base = { branchId: store.id, channel: "WHATSAPP" as const, recipientName: "Budi", recipientPhone: "0812", shippingAddress: "Jl. Uji", shippingFee: 10_000, paymentDeadlineHours: 24, items: [{ variantId: v1.id, qty: 2 }] };
  const a = await orders.createOrder(owner, base);
  assert.equal((await level(v1.id)).reserved, before.reserved + 2);
  await orders.markPaidManual(owner, a.id, { method: "TRANSFER" });
  await orders.advanceOrder(owner, a.id, "ship", { courier: "JNE", trackingNo: "JNE1" });
  const shipped = await level(v1.id);
  assert.deepEqual(shipped, { onHand: before.onHand - 2, reserved: before.reserved });
  const b = await orders.createOrder(owner, base);
  await orders.cancelOrder(owner, b.id, "batal uji");
  assert.deepEqual(await level(v1.id), shipped);
});

console.log("\nMarketplace (toko simulasi, jalur webhook)");
const started = await mp.startConnect(owner, { provider: "mock", branchId: store.id });
const connId = started.connectionId!;
const connRow = async () => (await db.select().from(s.marketplaceConnections).where(eq(s.marketplaceConnections.id, connId)))[0];
await mp.updateConnection(owner, connId, { stockBuffer: 2 });
const conn = await connRow();
const signed = async (orderSn: string) => {
  const { createMockAdapter } = await import("../../src/server/marketplace/mock");
  const body = JSON.stringify({ shopId: conn.externalShopId, orderSn });
  return mp.handleMarketplaceWebhook("mock", body, new Headers({ "x-mock-signature": createMockAdapter()!.sign(body) }), "");
};

await step("SKU sama terpetakan otomatis", async () => {
  const c = await mp.getConnection(connId);
  assert.ok(c.stats.mapped >= 2);
  assert.ok((await mp.listListings(connId, { filter: "all", q: variants[0].sku, page: 1, pageSize: 5 })).data[0].variantId);
});
let firstOrder = "";
await step("order dibayar masuk lewat webhook & stok ter-reservasi", async () => {
  const r = await mp.createMockOrder(connId, { status: "PAID", qty: 1 });
  firstOrder = r.orderSn;
  const o = await orderOf(firstOrder);
  assert.equal(o.status, "PAID");
  assert.ok(o.saleId);
});
await step("webhook ganda & bersamaan tidak menggandakan order/reservasi", async () => {
  const items = await db.select().from(s.onlineOrderItems).where(eq(s.onlineOrderItems.orderId, (await orderOf(firstOrder)).id));
  const before = await level(items[0].variantId);
  await Promise.all([signed(firstOrder), signed(firstOrder), signed(firstOrder)]);
  assert.deepEqual(await level(items[0].variantId), before);
  const rows = await db.select().from(s.onlineOrders).where(eq(s.onlineOrders.externalOrderNo, firstOrder));
  assert.equal(rows.length, 1);
});
await step("order baru dalam webhook bersamaan hanya dibuat sekali", async () => {
  const r = await mp.createMockOrder(connId, { status: "UNPAID", qty: 1 });
  await Promise.all([signed(r.orderSn), signed(r.orderSn)]);
  assert.equal((await db.select().from(s.onlineOrders).where(eq(s.onlineOrders.externalOrderNo, r.orderSn))).length, 1);
  await mp.setMockOrderStatus(connId, r.orderSn, "CANCELLED");
  assert.equal((await orderOf(r.orderSn)).status, "CANCELLED");
});
await step("signature webhook salah ditolak", async () => {
  const body = JSON.stringify({ shopId: conn.externalShopId, orderSn: firstOrder });
  await assert.rejects(mp.handleMarketplaceWebhook("mock", body, new Headers({ "x-mock-signature": "0".repeat(64) }), ""), (e) => e instanceof MarketplaceError && e.kind === "AUTH");
  // Panjang sama tetapi karakter multi-byte: harus ditolak, bukan crash (500).
  await assert.rejects(mp.handleMarketplaceWebhook("mock", body, new Headers({ "x-mock-signature": "é".repeat(64) }), ""), (e) => e instanceof MarketplaceError && e.kind === "AUTH");
});
await step("alur status: dikirim memotong stok, selesai", async () => {
  const o = await orderOf(firstOrder);
  const [item] = await db.select().from(s.onlineOrderItems).where(eq(s.onlineOrderItems.orderId, o.id));
  const before = await level(item.variantId);
  await mp.setMockOrderStatus(connId, firstOrder, "SHIPPED");
  assert.deepEqual(await level(item.variantId), { onHand: before.onHand - item.qty, reserved: before.reserved - item.qty });
  assert.ok((await orderOf(firstOrder)).trackingNo);
  await mp.setMockOrderStatus(connId, firstOrder, "COMPLETED");
  assert.equal((await orderOf(firstOrder)).status, "COMPLETED");
});
await step("barang belum dipetakan: order tertunda, masuk otomatis setelah dipetakan", async () => {
  const r = await mp.createMockOrder(connId, { status: "PAID", qty: 1, unmapped: true });
  assert.equal(await orderOf(r.orderSn), undefined);
  assert.ok((await connRow()).retryOrderNos.includes(r.orderSn));
  // SKU di order simulasi tidak ada di katalog; petakan lewat listing "UNKNOWN-ITEM" lalu sinkron.
  await db.insert(s.marketplaceListings).values({ connectionId: connId, externalItemId: "UNKNOWN-ITEM", externalModelId: "0", externalSku: "SKU-TIDAK-ADA", name: "Barang lepas" }).onConflictDoNothing();
  const [listing] = await db.select().from(s.marketplaceListings).where(and(eq(s.marketplaceListings.connectionId, connId), eq(s.marketplaceListings.externalItemId, "UNKNOWN-ITEM")));
  await mp.mapListing(owner, listing.id, v1.id);
  await mp.syncConnection(connId, "orders");
  assert.equal((await orderOf(r.orderSn))?.status, "PAID");
  assert.ok(!(await connRow()).retryOrderNos.includes(r.orderSn));
});
await step("stok kurang: order ditunda, tidak membuat stok minus", async () => {
  const r = await mp.createMockOrder(connId, { status: "PAID", qty: 50 });
  assert.equal(await orderOf(r.orderSn), undefined);
  assert.ok((await connRow()).retryOrderNos.includes(r.orderSn));
  await db.update(s.mockMarketplaceOrders).set({ status: "CANCELLED", updatedAt: new Date() }).where(eq(s.mockMarketplaceOrders.orderSn, r.orderSn));
  await mp.syncConnection(connId, "orders");
  assert.ok(!(await connRow()).retryOrderNos.includes(r.orderSn));
});
await step("push stok = tersedia − buffer, hanya yang berubah", async () => {
  await mp.pushStock(connId, { force: true });
  const l = await level(v1.id);
  const [row] = await db.select().from(s.marketplaceListings).where(and(eq(s.marketplaceListings.connectionId, connId), eq(s.marketplaceListings.variantId, v1.id), eq(s.marketplaceListings.externalModelId, v1.id)));
  assert.equal(row.lastPushedQty, Math.max(l.onHand - l.reserved - 2, 0));
  assert.equal((await mp.pushStock(connId)).stats.pushed, 0);
});
await step("order lama yang sudah dikirim sebelum toko dihubungkan tidak memotong stok lagi", async () => {
  const orderSn = `OLD${tag}`;
  const old = new Date(Date.now() - 2 * 86_400_000);
  await db.insert(s.mockMarketplaceOrders).values({
    orderSn,
    shopId: conn.externalShopId,
    status: "COMPLETED",
    updatedAt: old,
    payload: { externalOrderNo: orderSn, createdAt: old.toISOString(), recipientName: "Lama", recipientPhone: "-", shippingAddress: "-", courier: null, trackingNo: "TRK", note: null, items: [{ externalItemId: (await db.select().from(s.marketplaceListings).where(and(eq(s.marketplaceListings.connectionId, connId), eq(s.marketplaceListings.variantId, v2.id))))[0].externalItemId, externalModelId: v2.id, sku: v2.sku, name: "x", qty: 3, unitPrice: 100_000 }] },
  });
  await db.update(s.marketplaceConnections).set({ ordersSyncedUntil: new Date(Date.now() - 3 * 86_400_000) }).where(eq(s.marketplaceConnections.id, connId));
  const before = await level(v2.id);
  await mp.syncConnection(connId, "orders");
  assert.deepEqual(await level(v2.id), before);
  assert.equal(await orderOf(orderSn), undefined);
});
await step("order marketplace tidak bisa dibatalkan lokal (status mengikuti marketplace)", async () => {
  const r = await mp.createMockOrder(connId, { status: "PAID", qty: 1 });
  const o = await orderOf(r.orderSn);
  await rejects(orders.cancelOrder(owner, o.id, "batal lokal"), "ORDER_FROM_MARKETPLACE");
  await mp.setMockOrderStatus(connId, r.orderSn, "CANCELLED");
  assert.equal((await orderOf(r.orderSn)).status, "CANCELLED");
});
await step("koneksi diputus: webhook diabaikan", async () => {
  await mp.disconnect(owner, connId);
  assert.equal((await signed(firstOrder)).outcome, "NO_ACTIVE_CONNECTION");
});

console.log("\nMarketplace (adapter Shopee + database, HTTP tiruan)");
const { encryptCredentials, decryptCredentials } = await import("../../src/server/marketplace/types");
const { createHmac } = await import("node:crypto");
const realFetch = globalThis.fetch;
let refreshCalls = 0;
let serverDown = false;
const shopId = `9${Date.now().toString().slice(-8)}`;
const expiring = { accessToken: "OLD", refreshToken: "RT-OLD", expiresAt: new Date(Date.now() + 60_000).toISOString() };
const [shop] = await db
  .insert(s.marketplaceConnections)
  .values({ provider: "shopee", channel: "SHOPEE", name: "Shopee Uji", externalShopId: shopId, branchId: store.id, credentialsEnc: encryptCredentials(expiring), createdBy: owner.userId, ordersSyncedUntil: new Date(Date.now() - 3_600_000) })
  .returning();
await db.insert(s.marketplaceListings).values({ connectionId: shop.id, externalItemId: "1", externalModelId: "10", externalSku: v1.sku, name: "Kaos", variantId: v1.id });
const shopeeOrder = `2611${tag}`;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(String(input));
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  if (serverDown) return new Response("<html>Bad Gateway</html>", { status: 502 });
  if (url.pathname === "/api/v2/auth/access_token/get") {
    refreshCalls++;
    await new Promise((r) => setTimeout(r, 50));
    // Refresh token sekali pakai, seperti Shopee sungguhan: pemakaian kedua ditolak.
    if (JSON.parse(String(init?.body)).refresh_token !== "RT-OLD") return json({ error: "error_auth", message: "refresh token invalid" });
    return json({ error: "", access_token: "NEW", refresh_token: "RT-NEW", expire_in: 14400 });
  }
  if (url.pathname === "/api/v2/order/get_order_list") return json({ error: "", response: { more: false, order_list: [{ order_sn: shopeeOrder }] } });
  if (url.pathname === "/api/v2/order/get_order_detail") {
    return json({ error: "", response: { order_list: [{ order_sn: shopeeOrder, order_status: "READY_TO_SHIP", create_time: Math.floor(Date.now() / 1000), update_time: Math.floor(Date.now() / 1000), item_list: [{ item_id: 1, model_id: 10, model_sku: v1.sku, item_name: "Kaos", model_quantity_purchased: 3, model_discounted_price: 33_333 }, { item_id: 1, model_id: 10, model_sku: v1.sku, item_name: "Kaos", model_quantity_purchased: 2, model_discounted_price: 33_334 }] }] } });
  }
  return json({ error: "", response: {} });
}) as typeof fetch;

await step("gangguan 5xx: jendela sinkron tidak maju, koneksi tidak putus, order tidak hilang", async () => {
  await db.update(s.marketplaceConnections).set({ credentialsEnc: encryptCredentials({ ...expiring, expiresAt: new Date(Date.now() + 3_600_000).toISOString() }) }).where(eq(s.marketplaceConnections.id, shop.id));
  serverDown = true;
  await assert.rejects(mp.syncConnection(shop.id, "orders"));
  serverDown = false;
  const [row] = await db.select().from(s.marketplaceConnections).where(eq(s.marketplaceConnections.id, shop.id));
  assert.equal(row.ordersSyncedUntil?.getTime(), shop.ordersSyncedUntil?.getTime());
  assert.equal(row.status, "ACTIVE");
  await db.update(s.marketplaceConnections).set({ credentialsEnc: encryptCredentials(expiring) }).where(eq(s.marketplaceConnections.id, shop.id));
});
await step("refresh token bersamaan: hanya sekali, token baru tersimpan, koneksi tetap aktif", async () => {
  const results = await Promise.allSettled([mp.syncConnection(shop.id, "orders"), mp.syncConnection(shop.id, "orders"), mp.syncConnection(shop.id, "orders")]);
  assert.equal(refreshCalls, 1);
  assert.ok(results.some((r) => r.status === "fulfilled"));
  const [row] = await db.select().from(s.marketplaceConnections).where(eq(s.marketplaceConnections.id, shop.id));
  assert.equal(decryptCredentials(row.credentialsEnc!).refreshToken, "RT-NEW");
  assert.equal(row.status, "ACTIVE");
});
await step("order Shopee: baris SKU sama digabung, total persis sama dengan marketplace", async () => {
  const o = await orderOf(shopeeOrder);
  assert.equal(o.total, 3 * 33_333 + 2 * 33_334);
  const items = await db.select().from(s.onlineOrderItems).where(eq(s.onlineOrderItems.orderId, o.id));
  assert.equal(items.length, 1);
  assert.equal(items[0].qty, 5);
  assert.equal(items[0].lineTotal, o.total);
});
await step("webhook Shopee: tanda tangan URL publik diterima, URL internal ditolak", async () => {
  const url = `${process.env.BETTER_AUTH_URL}/api/marketplace/webhook/shopee`;
  const body = JSON.stringify({ code: 3, shop_id: Number(shopId), data: { ordersn: shopeeOrder } });
  const sig = (u: string) => createHmac("sha256", process.env.SHOPEE_PARTNER_KEY!).update(`${u}|${body}`).digest("hex");
  assert.equal((await mp.handleMarketplaceWebhook("shopee", body, new Headers({ authorization: sig(url) }), url)).outcome, "PROCESSED");
  await assert.rejects(mp.handleMarketplaceWebhook("shopee", body, new Headers({ authorization: sig("http://10.0.0.5:3000/api/marketplace/webhook/shopee") }), url), (e) => e instanceof MarketplaceError && e.kind === "AUTH");
});
globalThis.fetch = realFetch;

console.log("\nIdempotensi & balapan");
const { app } = await import("../../src/server/api/app");
const { createApiKey } = await import("../../src/server/services/api-key.service");
const payments = await import("../../src/server/services/payment.service");
const { mockProvider } = await import("../../src/server/payments/provider");
const raceRole = await makeRole("Kasir Balapan", ["pos:access", "inventory:adjust", "product:read", "inventory:read", "sale:read", "pos:refund"]);
const racer = await makeActor("Kasir Balapan", raceRole.id, store2.id);
const raceShift = await sale.openShift(racer, { branchId: store2.id, openingCash: 0 });
const apiKey = (await createApiKey(owner, { name: "uji" })).key;
const post = (path: string, body: unknown, key?: string) =>
  app.request(`/api/v1${path}`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": apiKey, ...(key ? { "idempotency-key": key } : {}) }, body: JSON.stringify(body) });
const cash = (branchId: string, variantId: string, qty: number, key = randomUUID(), actor = racer) =>
  sale.checkout(actor, { branchId, idempotencyKey: key, items: [{ variantId, qty }], payments: [{ method: "CASH", amount: qty * 100_000 }] });

const setStock = (onHand: number) =>
  db.insert(s.inventoryLevels).values({ branchId: store2.id, variantId: v2.id, onHand }).onConflictDoUpdate({ target: [s.inventoryLevels.branchId, s.inventoryLevels.variantId], set: { onHand, reserved: 0 } });

await step("oversell: 8 kasir berebut 3 stok terakhir, tepat 3 berhasil dan stok tepat 0", async () => {
  await setStock(3);
  const results = await Promise.allSettled(Array.from({ length: 8 }, () => cash(store2.id, v2.id, 1)));
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 3);
  assert.deepEqual(await level(v2.id, store2.id), { onHand: 0, reserved: 0 });
});
await step("kunci sama untuk keranjang berbeda ditolak, bukan mengembalikan transaksi lama", async () => {
  await setStock(20);
  const key = randomUUID();
  await cash(store2.id, v2.id, 1, key);
  await rejects(cash(store2.id, v2.id, 2, key), "IDEMPOTENCY_KEY_REUSED");
});
await step("bayar tunai dengan kunci QRIS yang belum lunas tidak dianggap lunas", async () => {
  const key = randomUUID();
  await qris.startQrisCheckout(racer, { branchId: store2.id, idempotencyKey: key, items: [{ variantId: v2.id, qty: 1 }] });
  await rejects(cash(store2.id, v2.id, 1, key), "SALE_NOT_PAID");
});
await step("QRIS klik ganda bersamaan: satu transaksi, satu tagihan gateway", async () => {
  const key = randomUUID();
  const input = { branchId: store2.id, idempotencyKey: key, items: [{ variantId: v2.id, qty: 1 }] };
  const before = await level(v2.id, store2.id);
  const [a, b] = await Promise.all([qris.startQrisCheckout(racer, input), qris.startQrisCheckout(racer, input)]);
  assert.equal(a.sale.id, b.sale.id);
  const intents = await db.select().from(s.paymentIntents).where(eq(s.paymentIntents.referenceId, a.sale.id));
  assert.equal(intents.length, 1);
  assert.equal((await level(v2.id, store2.id)).onHand, before.onHand - 1);
});
await step("pelanggan membayar dua QR: lunas sekali, pembayaran kedua masuk audit untuk refund", async () => {
  const order = await orders.createOrder(owner, { branchId: store.id, channel: "WHATSAPP", recipientName: "Ani", recipientPhone: "0813", shippingAddress: "Jl. Uji", shippingFee: 0, paymentDeadlineHours: 24, items: [{ variantId: v1.id, qty: 1 }] });
  const first = await orders.createQrisPayment(owner, order.id);
  // QR pertama dipaksa lewat agar QR kedua dibuat, seperti pelanggan menyimpan QR lama.
  await db.update(s.paymentIntents).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(s.paymentIntents.id, first.payment!.id));
  const second = await orders.createQrisPayment(owner, order.id);
  assert.notEqual(first.payment!.id, second.payment!.id);
  const mock = mockProvider()!;
  const pay = (gatewayOrderId: string) => payments.handleGatewayNotification("mock", mock.buildNotification(gatewayOrderId, order.total));
  assert.equal((await pay(second.payment!.gatewayOrderId)).outcome, "PAID");
  assert.equal((await pay(first.payment!.gatewayOrderId)).outcome, "DUPLICATE_PAYMENT");
  assert.equal((await pay(first.payment!.gatewayOrderId)).outcome, "DUPLICATE");
  const sales = await db.select().from(s.sales).where(eq(s.sales.idempotencyKey, `online-order:${order.id}`));
  assert.equal(sales.length, 1);
  const flagged = await db.select().from(s.auditLogs).where(and(eq(s.auditLogs.action, "payment_attention"), eq(s.auditLogs.entityId, order.id)));
  assert.equal(flagged.length, 1);
});
await step("tutup shift saat transaksi berjalan: kas tetap cocok, tidak ada transaksi menyusup", async () => {
  await db.update(s.sales).set({ status: "VOIDED" }).where(and(eq(s.sales.shiftId, raceShift.id), eq(s.sales.status, "PENDING")));
  const racing = Array.from({ length: 6 }, () => cash(store2.id, v2.id, 1).catch(() => null));
  await new Promise((r) => setTimeout(r, 5));
  const closed = await sale.closeShift(racer, raceShift.id, { countedCash: 0 });
  await Promise.all(racing);
  const rows = await db.select({ total: s.sales.total }).from(s.sales).where(and(eq(s.sales.shiftId, raceShift.id), eq(s.sales.status, "PAID")));
  assert.equal(closed.expectedCash, rows.reduce((t, r) => t + r.total, 0));
});
await step("API: kunci sama diputar ulang tanpa efek ganda, juga saat bersamaan", async () => {
  const before = await level(v1.id);
  const body = { branchId: store.id, type: "RECEIPT", reason: "Surat jalan uji", items: [{ variantId: v1.id, qtyChange: 5 }] };
  const key = randomUUID();
  const responses = await Promise.all([post("/inventory/adjustments", body, key), post("/inventory/adjustments", body, key), post("/inventory/adjustments", body, key)]);
  assert.ok(responses.some((r) => r.ok), responses.map((r) => r.status).join());
  assert.ok(responses.every((r) => r.ok || r.status === 409));
  assert.equal((await level(v1.id)).onHand, before.onHand + 5);
  await new Promise((r) => setTimeout(r, 50));
  const replay = await post("/inventory/adjustments", body, key);
  assert.equal(replay.headers.get("idempotent-replayed"), "true");
  assert.equal((await level(v1.id)).onHand, before.onHand + 5);
  assert.equal((await post("/inventory/adjustments", { ...body, reason: "Isi lain" }, key)).status, 422);
});
await step("API: permintaan gagal melepas kunci sehingga bisa diulang", async () => {
  const key = randomUUID();
  const bad = { branchId: store.id, type: "ADJUSTMENT", reason: "Koreksi uji", items: [{ variantId: v1.id, qtyChange: -99_999 }] };
  assert.equal((await post("/inventory/adjustments", bad, key)).status, 409);
  const [row] = await db.select().from(s.idempotencyKeys).where(eq(s.idempotencyKeys.key, key));
  assert.equal(row, undefined);
});
await step("API: order online dikirim dua kali hanya jadi satu order & satu reservasi", async () => {
  const body = { branchId: store.id, channel: "WHATSAPP", recipientName: "Rani", recipientPhone: "08140000", shippingAddress: "Jl. Uji Coba No. 1", shippingFee: 0, paymentDeadlineHours: 24, items: [{ variantId: v1.id, qty: 2 }] };
  const before = await level(v1.id);
  const key = randomUUID();
  const a = await post("/online-orders", body, key);
  const b = await post("/online-orders", body, key);
  assert.equal(a.status, 201, await a.clone().text());
  assert.equal(((await a.json()) as { data: { id: string } }).data.id, ((await b.json()) as { data: { id: string } }).data.id);
  assert.equal((await level(v1.id)).reserved, before.reserved + 2);
});

console.log("\nRBAC & eskalasi hak akses");
const adminRole = await makeRole("Admin", ["user:read", "user:create", "user:update", "role:read"]);
const admin = await makeActor("Admin Uji", adminRole.id);
const cashierRole = await makeRole("Kasir", ["pos:access"]);
const cashier = await makeActor("Kasir Uji", cashierRole.id, store.id);
const branchHrRole = await makeRole("HR Cabang", ["user:read", "user:update", "user:create"]);
const branchHr = await makeActor("HR Cabang Uji", branchHrRole.id, store.id);
const superRole = await makeRole("Super", ["user:read", "user:update", "role:update", "api_key:create", "setting:update"]);

await step("Admin tidak bisa mereset password / menonaktifkan / mengganti role Owner", async () => {
  await rejects(users.resetUserPassword(admin, owner.userId, "password-baru-123"), "PERMISSION_ESCALATION");
  await rejects(users.updateUser(admin, owner.userId, { isActive: false }), "PERMISSION_ESCALATION");
  await rejects(users.updateUser(admin, owner.userId, { assignments: [] }), "PERMISSION_ESCALATION");
});
await step("Admin tidak bisa memberi role Owner atau role berhak admin yang tidak ia miliki", async () => {
  await rejects(users.updateUser(admin, cashier.userId, { assignments: [{ roleId: ownerRole.id, branchId: null }] }), "PERMISSION_ESCALATION");
  await rejects(users.updateUser(admin, cashier.userId, { assignments: [{ roleId: superRole.id, branchId: null }] }), "PERMISSION_ESCALATION");
});
await step("Admin tetap bisa menugaskan Kasir (alur normal)", async () => {
  await users.updateUser(admin, cashier.userId, { assignments: [{ roleId: cashierRole.id, branchId: store2.id }] });
  await users.updateUser(admin, cashier.userId, { assignments: [{ roleId: cashierRole.id, branchId: store.id }] });
});
await step("pengguna tidak bisa mengubah role-nya sendiri", async () => {
  await rejects(users.updateUser(admin, admin.userId, { assignments: [{ roleId: cashierRole.id, branchId: null }] }), "CANNOT_EDIT_OWN_ROLES");
});
await step("pengelola satu cabang tidak bisa memberi akses global / cabang lain", async () => {
  await rejects(users.updateUser(branchHr, cashier.userId, { assignments: [{ roleId: cashierRole.id, branchId: null }] }), "PERMISSION_ESCALATION");
  await rejects(users.updateUser(branchHr, cashier.userId, { assignments: [{ roleId: cashierRole.id, branchId: store2.id }] }), "PERMISSION_ESCALATION");
});
await step("reset password memutus sesi aktif pengguna itu", async () => {
  await db.insert(s.session).values({ id: randomUUID(), token: randomUUID(), userId: cashier.userId, expiresAt: new Date(Date.now() + 3_600_000), createdAt: new Date(), updatedAt: new Date() });
  await users.resetUserPassword(admin, cashier.userId, "password-baru-123");
  assert.equal((await db.select().from(s.session).where(eq(s.session.userId, cashier.userId))).length, 0);
});
await step("kasir cabang A tidak bisa berjualan di cabang B", async () => {
  await rejects(sale.openShift(cashier, { branchId: store2.id, openingCash: 0 }), "FORBIDDEN");
});

console.log("\nLupa password lewat SMTP");
const authPost = (path: string, body: unknown) =>
  app.request(`/api/auth${path}`, { method: "POST", headers: { "content-type": "application/json", origin: process.env.BETTER_AUTH_URL! }, body: JSON.stringify(body) });
const waitMail = async () => {
  for (let i = 0; i < 40 && !inbox.length; i++) await new Promise((r) => setTimeout(r, 50));
  return inbox.shift();
};
await step("konfigurasi publik memberi tahu lupa password aktif", async () => {
  assert.deepEqual(await (await app.request("/api/public/config")).json(), { passwordReset: true });
});
await step("email tidak terdaftar: respons sama, tidak ada email terkirim", async () => {
  const r = await authPost("/request-password-reset", { email: "tidak-ada@check.test", redirectTo: `${process.env.BETTER_AUTH_URL}/reset-password` });
  assert.equal(r.status, 200);
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(inbox.length, 0);
});
await step("tautan dari email mengganti password dan memutus sesi; tautan tidak bisa dipakai dua kali", async () => {
  const target = await makeActor("Lupa Uji", cashierRole.id, store.id);
  await db.insert(s.session).values({ id: randomUUID(), token: randomUUID(), userId: target.userId, expiresAt: new Date(Date.now() + 3_600_000), createdAt: new Date(), updatedAt: new Date() });
  const r = await authPost("/request-password-reset", { email: target.user.email, redirectTo: `${process.env.BETTER_AUTH_URL}/reset-password` });
  assert.equal(r.status, 200, await r.clone().text());
  const mail = (await waitMail())!.replace(/=\r?\n/g, "").replace(/=3D/g, "=");
  const token = mail.match(/reset-password\/([^?\s]+)/)?.[1];
  assert.ok(token, "tautan ada di email");
  assert.equal((await authPost("/reset-password", { newPassword: "password-baru-dari-email", token })).status, 200);
  assert.equal((await db.select().from(s.session).where(eq(s.session.userId, target.userId))).length, 0);
  assert.equal((await authPost("/reset-password", { newPassword: "password-lain-lagi-123", token })).status, 400);
  assert.equal((await authPost("/sign-in/email", { email: target.user.email, password: "password-baru-dari-email" })).status, 200);
});

console.log(`\n${passed} lulus, ${failures.length} gagal.`);
if (failures.length) console.log(failures.map((f) => `  - ${f}`).join("\n"));
process.exit(failures.length ? 1 : 0);
