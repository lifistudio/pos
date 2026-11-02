/**
 * Pemeriksaan adapter Shopee dengan fetch tiruan (tanpa akun sungguhan): `pnpm check:marketplace`.
 * Memeriksa signature v2, OAuth, pemetaan order/katalog, resi, update stok, webhook, dan klasifikasi error.
 */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

process.env.DATABASE_URL ??= "postgres://check:check@localhost:5432/check";
process.env.BETTER_AUTH_SECRET ??= "x".repeat(40);
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
process.env.SHOPEE_PARTNER_ID = "1000001";
process.env.SHOPEE_PARTNER_KEY = "partner-key-uji-0123456789";
process.env.SHOPEE_ENV = "sandbox";

const { createShopeeAdapter } = await import("../../src/server/marketplace/shopee");
const { MarketplaceError } = await import("../../src/server/marketplace/types");

const ID = process.env.SHOPEE_PARTNER_ID;
const KEY = process.env.SHOPEE_PARTNER_KEY;
const sign = (base: string) => createHmac("sha256", KEY).update(base).digest("hex");
const adapter = createShopeeAdapter()!;
const ctx = { shopId: "55", credentials: { accessToken: "AT", refreshToken: "RT", expiresAt: new Date(Date.now() + 3_600_000).toISOString() } };

type Reply = { status?: number; body: unknown };
const calls: { path: string; q: URLSearchParams; body: string | null }[] = [];
let override: Reply | null = null;
const ok = (response: unknown): Reply => ({ body: { error: "", message: "", response } });

function route(path: string, q: URLSearchParams): Reply {
  switch (path) {
    case "/api/v2/auth/token/get":
    case "/api/v2/auth/access_token/get":
      return { body: { error: "", access_token: "AT2", refresh_token: "RT2", expire_in: 14400 } };
    case "/api/v2/shop/get_shop_info":
      return { body: { error: "", shop_name: "Toko Uji" } };
    case "/api/v2/order/get_order_list":
      return ok(q.get("cursor") ? { more: false, order_list: [{ order_sn: "B" }] } : { more: true, next_cursor: "C2", order_list: [{ order_sn: "A" }] });
    case "/api/v2/order/get_order_detail":
      return ok({
        order_list: [
          {
            order_sn: "A",
            order_status: "READY_TO_SHIP",
            create_time: 1700000000,
            update_time: 1700000100,
            recipient_address: { name: "Budi", phone: "****99", full_address: "Bandung" },
            shipping_carrier: "SPX Express",
            item_list: [{ item_id: 1, model_id: 10, model_sku: "KAOS-M", item_name: "Kaos", model_name: "M", model_quantity_purchased: 2, model_discounted_price: 95000 }],
          },
          { order_sn: "B", order_status: "SHIPPED", create_time: 1700000000, update_time: 1700000200, item_list: [] },
        ],
      });
    case "/api/v2/logistics/get_tracking_number":
      assert.equal(q.get("order_sn"), "B", "resi hanya diminta untuk order yang sudah dikirim");
      return ok({ tracking_number: "SPXID123" });
    case "/api/v2/product/get_item_list":
      return ok({ item: [{ item_id: 1 }, { item_id: 2 }], has_next_page: false });
    case "/api/v2/product/get_item_base_info":
      return ok({ item_list: [{ item_id: 1, item_name: "Kaos", has_model: true }, { item_id: 2, item_name: "Topi", item_sku: "TOPI", has_model: false, stock_info_v2: { summary_info: { total_available_stock: 7 } } }] });
    case "/api/v2/product/get_model_list":
      return ok({ model: [{ model_id: 10, model_sku: "KAOS-M", model_name: "M", stock_info_v2: { summary_info: { total_available_stock: 3 } } }] });
    case "/api/v2/product/update_stock":
      return ok({ failure_list: [{ model_id: 11, failed_reason: "model tidak ada" }] });
    default:
      return { status: 404, body: { error: "error_not_found", message: path } };
  }
}

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(String(input));
  assert.equal(url.host, "partner.test-stable.shopeemobile.com", "sandbox memakai host uji");
  const ts = url.searchParams.get("timestamp")!;
  const token = url.searchParams.get("access_token");
  const base = `${ID}${url.pathname}${ts}${token ? `${token}${url.searchParams.get("shop_id")}` : ""}`;
  assert.equal(url.searchParams.get("sign"), sign(base), `sign salah untuk ${url.pathname}`);
  calls.push({ path: url.pathname, q: url.searchParams, body: (init?.body as string) ?? null });
  const reply = override ?? route(url.pathname, url.searchParams);
  return new Response(typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body), { status: reply.status ?? 200 });
}) as typeof fetch;

// ── OAuth ───────────────────────────────────────────────────────────────
const authz = new URL(adapter.authorizeUrl!("https://pos.test/cb?state=S"));
assert.equal(authz.pathname, "/api/v2/shop/auth_partner");
assert.equal(authz.searchParams.get("sign"), sign(`${ID}/api/v2/shop/auth_partner${authz.searchParams.get("timestamp")}`));
const conn = await adapter.exchangeCode!(new URLSearchParams({ code: "C", shop_id: "55" }));
assert.equal(conn.shopId, "55");
assert.equal(conn.shopName, "Toko Uji");
assert.equal(conn.credentials.accessToken, "AT2");
assert.equal((await adapter.refresh!(ctx)).refreshToken, "RT2");

// ── Order ───────────────────────────────────────────────────────────────
assert.deepEqual(await adapter.listUpdatedOrders(ctx, new Date(1700000000000), new Date(1700003600000)), ["A", "B"], "paginasi cursor");
const orders = await adapter.getOrders(ctx, ["A", "B"]);
assert.equal(orders[0].status, "PAID");
assert.deepEqual(orders[0].items[0], { externalItemId: "1", externalModelId: "10", sku: "KAOS-M", name: "Kaos · M", qty: 2, unitPrice: 95000 });
assert.equal(orders[0].trackingNo, null);
assert.equal(orders[1].status, "SHIPPED");
assert.equal(orders[1].trackingNo, "SPXID123", "resi diambil terpisah");

// ── Rentang panjang dipecah per 15 hari ─────────────────────────────────
calls.length = 0;
await adapter.listUpdatedOrders(ctx, new Date(0), new Date(20 * 86_400_000));
const ranges = calls.filter((c) => !c.q.get("cursor")).map((c) => Number(c.q.get("time_to")) - Number(c.q.get("time_from")));
assert.ok(ranges.length === 2 && ranges.every((r) => r <= 15 * 86_400), "rentang maks 15 hari per permintaan");

// ── Katalog & stok ──────────────────────────────────────────────────────
const listings = await adapter.listListings(ctx);
assert.deepEqual(listings.map((l) => [l.externalItemId, l.externalModelId, l.sku, l.stock]), [["1", "10", "KAOS-M", 3], ["2", "0", "TOPI", 7]]);
calls.length = 0;
const { failed } = await adapter.updateStock(ctx, [
  { externalItemId: "1", externalModelId: "10", qty: 4 },
  { externalItemId: "1", externalModelId: "11", qty: 0 },
]);
assert.deepEqual(JSON.parse(calls[0].body!), { item_id: 1, stock_list: [{ model_id: 10, seller_stock: [{ stock: 4 }] }, { model_id: 11, seller_stock: [{ stock: 0 }] }] });
assert.deepEqual(failed, [{ ref: "1/11", message: "model tidak ada" }]);

// ── Webhook ─────────────────────────────────────────────────────────────
const url = "https://pos.test/api/marketplace/webhook/shopee";
const raw = JSON.stringify({ code: 3, shop_id: 55, data: { ordersn: "A", status: "READY_TO_SHIP" } });
const hook = (body: string, signature = sign(`${url}|${body}`)) => adapter.parseWebhook(body, new Headers({ authorization: signature }), url);
assert.deepEqual(hook(raw), { shopId: "55", orderNos: ["A"] });
assert.equal(hook(JSON.stringify({ code: 1, shop_id: 55 })), null, "event lain diabaikan");
assert.equal(hook("bukan json"), null, "body rusak tidak membuat crash");
assert.throws(() => hook(raw, "0".repeat(64)), MarketplaceError);
assert.throws(() => adapter.parseWebhook(raw, new Headers({ authorization: sign(`http://10.0.0.5:3000/x|${raw}`) }), url), MarketplaceError, "URL internal tidak cocok");

// ── Error: gangguan server tidak boleh terbaca "tidak ada order" ────────
const kindOf = async (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof MarketplaceError ? e.kind : "other"));
override = { status: 502, body: "<html>Bad Gateway</html>" };
assert.equal(await kindOf(adapter.listUpdatedOrders(ctx, new Date(0), new Date(1000))), "REMOTE");
override = { status: 200, body: "<html>bukan json</html>" };
assert.equal(await kindOf(adapter.listUpdatedOrders(ctx, new Date(0), new Date(1000))), "REMOTE");
assert.equal(await kindOf(adapter.refresh!(ctx)), "REMOTE", "refresh saat gangguan tidak memutus koneksi");
override = { status: 429, body: {} };
assert.equal(await kindOf(adapter.listUpdatedOrders(ctx, new Date(0), new Date(1000))), "RATE_LIMIT");
override = { body: { error: "error_auth", message: "Invalid access_token" } };
assert.equal(await kindOf(adapter.listUpdatedOrders(ctx, new Date(0), new Date(1000))), "AUTH");
override = null;

console.log("adapter Shopee: semua pemeriksaan lulus");
