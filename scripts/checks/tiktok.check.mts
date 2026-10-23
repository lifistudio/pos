/**
 * Pemeriksaan adapter TikTok Shop dengan fetch tiruan (tanpa akun sungguhan):
 * `pnpm check:marketplace`. Memeriksa signature 202309, alur OAuth, pemetaan order/katalog,
 * format update stok, verifikasi webhook, dan klasifikasi error.
 */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

// env.ts memvalidasi saat import — isi nilai tiruan agar adapter bisa dimuat tanpa .env.
process.env.DATABASE_URL ??= "postgres://check:check@localhost:5432/check";
process.env.BETTER_AUTH_SECRET ??= "x".repeat(40);
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";

const { TikTokShopAdapter, tiktokSign } = await import("../../src/server/marketplace/tiktok");
const { MarketplaceError } = await import("../../src/server/marketplace/types");

const KEY = "appkey123";
const SECRET = "secret-abcdefghij";
const hosts = { api: "https://api.test", auth: "https://auth.test", authorize: "https://authz.test/open/authorize" };
const adapter = new TikTokShopAdapter(KEY, SECRET, "svc-77", hosts);

// ── Signature ───────────────────────────────────────────────────────────
const manual = createHmac("sha256", SECRET).update(`${SECRET}/order/202309/orders/searchapp_key${KEY}page_size100shop_cipherCIPHtimestamp1700000000{"a":1}${SECRET}`).digest("hex");
assert.equal(tiktokSign(SECRET, "/order/202309/orders/search", { timestamp: "1700000000", app_key: KEY, shop_cipher: "CIPH", page_size: "100", sign: "abaikan", access_token: "abaikan" }, '{"a":1}'), manual);

// ── Fetch tiruan ────────────────────────────────────────────────────────
const calls: { url: URL; body: string | null; headers: Record<string, string> }[] = [];
let failAuth = false;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(String(input));
  const body = (init?.body as string) ?? null;
  const headers = (init?.headers ?? {}) as Record<string, string>;
  calls.push({ url, body, headers });
  const ok = (data: unknown) => new Response(JSON.stringify({ code: 0, message: "Success", data }), { status: 200 });
  if (url.host === "api.test") {
    // Setiap panggilan API wajib bertanda tangan benar.
    const q = Object.fromEntries(url.searchParams);
    assert.equal(q.sign, tiktokSign(SECRET, url.pathname, q, body ?? ""), `sign salah untuk ${url.pathname}`);
    if (failAuth) return new Response(JSON.stringify({ code: 105001, message: "access token is invalid" }), { status: 200 });
  }
  switch (url.pathname) {
    case "/api/v2/token/get":
      assert.equal(url.searchParams.get("auth_code"), "AUTHCODE");
      return ok({ access_token: "AT1", refresh_token: "RT1", access_token_expire_in: 1900000000, seller_name: "Toko Uji" });
    case "/api/v2/token/refresh":
      return ok({ access_token: "AT2", refresh_token: "RT2", access_token_expire_in: 1900000500 });
    case "/authorization/202309/shops":
      assert.equal(url.searchParams.get("shop_cipher"), null, "daftar toko tidak butuh cipher");
      return ok({ shops: [{ id: "SG1", name: "SG", cipher: "C-SG", region: "SG" }, { id: "ID1", name: "Toko Uji ID", cipher: "C-ID", region: "ID" }] });
    case "/logistics/202309/warehouses":
      return ok({ warehouses: [{ id: "W-RET", type: "RETURN_WAREHOUSE" }, { id: "W-1", type: "SALES_WAREHOUSE", is_default: true, effect_status: "ENABLED" }] });
    case "/order/202309/orders/search": {
      const page = url.searchParams.get("page_token");
      return ok(page ? { orders: [{ id: "O3" }] } : { orders: [{ id: "O1" }, { id: "O2" }], next_page_token: "P2" });
    }
    case "/order/202309/orders":
      return ok({
        orders: [
          {
            id: "O1",
            status: "AWAITING_SHIPMENT",
            create_time: 1700000000,
            update_time: 1700000100,
            recipient_address: { name: "Budi", phone_number: "(+62)812****99", full_address: "Jl. Uji 1, Bandung" },
            shipping_provider: "J&T",
            tracking_number: "",
            line_items: [
              { product_id: "P1", sku_id: "S1", seller_sku: "KEC-HTM-M", product_name: "Kaos", sku_name: "Hitam, M", sale_price: "139000.00" },
              { product_id: "P1", sku_id: "S1", seller_sku: "KEC-HTM-M", product_name: "Kaos", sku_name: "Hitam, M", sale_price: "139000.00" },
              { product_id: "P9", sku_id: "S9", seller_sku: "GIFT", product_name: "Stiker", sale_price: "0", is_gift: true },
            ],
          },
          { id: "O2", status: "IN_TRANSIT", create_time: 1700000000, update_time: 1700000200, tracking_number: "JT123", line_items: [] },
        ],
      });
    case "/product/202309/products/search":
      return ok({
        products: [
          { id: "P1", title: "Kaos", skus: [{ id: "S1", seller_sku: "KEC-HTM-M", sales_attributes: [{ value_name: "Hitam" }, { value_name: "M" }], inventory: [{ quantity: 4 }, { quantity: 1 }] }] },
          { id: "P2", title: "Topi", skus: [{ id: "S2", seller_sku: "TBL" }] },
        ],
      });
    default:
      if (url.pathname.endsWith("/inventory/update")) return ok({});
      return new Response(JSON.stringify({ code: 404, message: "unknown" }), { status: 404 });
  }
}) as typeof fetch;

// ── OAuth ───────────────────────────────────────────────────────────────
const authz = new URL(adapter.authorizeUrl!("http://localhost:3000/api/v1/marketplace/oauth/tiktok/callback?state=ST.SIG"));
assert.equal(authz.searchParams.get("service_id"), "svc-77");
assert.equal(authz.searchParams.get("state"), "ST.SIG");
const conn = await adapter.exchangeCode!(new URLSearchParams({ code: "AUTHCODE", state: "ST.SIG" }));
assert.equal(conn.shopId, "ID1", "toko Indonesia diprioritaskan");
assert.equal(conn.credentials.extra?.shopCipher, "C-ID");
assert.equal(conn.credentials.extra?.warehouseId, "W-1", "gudang penjualan default");
assert.equal(conn.credentials.expiresAt, new Date(1900000000 * 1000).toISOString());
const ctx = { shopId: conn.shopId, credentials: conn.credentials };
const refreshed = await adapter.refresh!(ctx);
assert.equal(refreshed.accessToken, "AT2");
assert.equal(refreshed.extra?.shopCipher, "C-ID", "cipher tetap setelah refresh");

// ── Order ───────────────────────────────────────────────────────────────
const ids = await adapter.listUpdatedOrders(ctx, new Date(1700000000000), new Date(1700003600000));
assert.deepEqual(ids, ["O1", "O2", "O3"], "paginasi page_token");
const searchCall = calls.find((c) => c.url.pathname === "/order/202309/orders/search")!;
assert.deepEqual(JSON.parse(searchCall.body!), { update_time_ge: 1700000000, update_time_lt: 1700003600 });
assert.equal(searchCall.headers["x-tts-access-token"], "AT1");
assert.equal(searchCall.url.searchParams.get("shop_cipher"), "C-ID");
const orders = await adapter.getOrders(ctx, ["O1", "O2"]);
assert.equal(orders[0].status, "PAID");
assert.equal(orders[0].items.length, 2, "hadiah tidak ikut");
assert.equal(orders[0].items[0].unitPrice, 139000);
assert.equal(orders[0].items[0].sku, "KEC-HTM-M");
assert.equal(orders[0].trackingNo, null);
assert.equal(orders[1].status, "SHIPPED");
assert.equal(orders[1].trackingNo, "JT123");

// ── Katalog & stok ──────────────────────────────────────────────────────
const listings = await adapter.listListings(ctx);
assert.deepEqual(
  listings.map((l) => [l.externalItemId, l.externalModelId, l.sku, l.name, l.stock]),
  [
    ["P1", "S1", "KEC-HTM-M", "Kaos · Hitam / M", 5],
    ["P2", "S2", "TBL", "Topi", 0],
  ],
);
const { failed } = await adapter.updateStock(ctx, [
  { externalItemId: "P1", externalModelId: "S1", qty: 7 },
  { externalItemId: "P2", externalModelId: "S2", qty: 0 },
]);
assert.equal(failed.length, 0);
const inv = calls.filter((c) => c.url.pathname.endsWith("/inventory/update"));
assert.equal(inv.length, 2, "satu permintaan per produk");
assert.deepEqual(JSON.parse(inv[0].body!), { skus: [{ id: "S1", inventory: [{ warehouse_id: "W-1", quantity: 7 }] }] });

// ── Webhook ─────────────────────────────────────────────────────────────
const raw = JSON.stringify({ type: 1, shop_id: "ID1", timestamp: 1700000300, data: { order_id: "O1", order_status: "IN_TRANSIT" } });
const sig = createHmac("sha256", SECRET).update(KEY + raw).digest("hex");
assert.deepEqual(adapter.parseWebhook(raw, new Headers({ authorization: sig })), { shopId: "ID1", orderNos: ["O1"] });
assert.equal(adapter.parseWebhook(JSON.stringify({ type: 6, shop_id: "ID1", data: {} }), new Headers({ authorization: createHmac("sha256", SECRET).update(KEY + JSON.stringify({ type: 6, shop_id: "ID1", data: {} })).digest("hex") })), null);
assert.throws(() => adapter.parseWebhook(raw, new Headers({ authorization: "salah" })), MarketplaceError);

// ── Error token → AUTH (koneksi ditandai perlu dihubungkan ulang) ──────
failAuth = true;
await assert.rejects(adapter.listUpdatedOrders(ctx, new Date(0), new Date(1000)), (e: unknown) => e instanceof MarketplaceError && e.kind === "AUTH");

console.log("adapter TikTok Shop: semua pemeriksaan lulus");
