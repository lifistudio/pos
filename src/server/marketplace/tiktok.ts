import "server-only";
import { createHmac } from "node:crypto";
import { env } from "@/server/env";
import { MarketplaceError, safeEqualHex, type AdapterContext, type Credentials, type MarketplaceAdapter, type MpListing, type MpOrder, type MpOrderStatus } from "./types";

/**
 * Adapter TikTok Shop Partner API (versi 202309) — juga melayani toko Tokopedia yang sudah bergabung ke TikTok Shop.
 * - Signature: HMAC-SHA256(app_secret, app_secret + path + (query terurut, tanpa sign & access_token: key+value) + body + app_secret).
 * - Token seller di header `x-tts-access-token`; konteks toko lewat `shop_cipher` (disimpan di Credentials.extra).
 * - Webhook: header Authorization = HMAC-SHA256(app_secret, app_key + body mentah).
 * BELUM diuji terhadap akun TikTok Shop sungguhan — lihat docs/DECISIONS.md ADR-023.
 */
export const TIKTOK_HOSTS = {
  api: "https://open-api.tiktokglobalshop.com",
  auth: "https://auth.tiktok-shops.com",
  authorize: "https://services.tiktokshop.com/open/authorize",
};

type Envelope<T> = { code?: number; message?: string; request_id?: string; data?: T };

const STATUS: Record<string, MpOrderStatus> = {
  UNPAID: "UNPAID",
  ON_HOLD: "PAID",
  AWAITING_SHIPMENT: "PAID",
  PARTIALLY_SHIPPING: "PAID",
  AWAITING_COLLECTION: "PAID",
  IN_TRANSIT: "SHIPPED",
  DELIVERED: "SHIPPED",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
};

/** Kode error TikTok yang berarti token/otorisasi bermasalah → koneksi perlu dihubungkan ulang. */
const AUTH_CODES = new Set([105001, 105002, 105003, 105005, 106001, 36004004]);

export function tiktokSign(secret: string, path: string, query: Record<string, string>, body: string) {
  const sorted = Object.keys(query)
    .filter((k) => k !== "sign" && k !== "access_token")
    .sort()
    .map((k) => `${k}${query[k]}`)
    .join("");
  return createHmac("sha256", secret).update(`${secret}${path}${sorted}${body}${secret}`).digest("hex");
}

const toAmount = (v: unknown) => Math.round(Number(v ?? 0));

export class TikTokShopAdapter implements MarketplaceAdapter {
  readonly provider = "tiktok";
  readonly channel = "TIKTOK" as const;
  readonly label = "TikTok Shop / Tokopedia";
  readonly oauth = true;

  constructor(
    private readonly appKey: string,
    private readonly appSecret: string,
    private readonly serviceId: string,
    private readonly hosts = TIKTOK_HOSTS,
  ) {}

  private async call<T>(path: string, opts: { method?: "GET" | "POST"; query?: Record<string, string | number>; body?: unknown; ctx?: AdapterContext; shopScoped?: boolean }) {
    const query: Record<string, string> = { app_key: this.appKey, timestamp: String(Math.floor(Date.now() / 1000)) };
    for (const [k, v] of Object.entries(opts.query ?? {})) query[k] = String(v);
    const cipher = opts.ctx?.credentials?.extra?.shopCipher;
    if (opts.shopScoped !== false && cipher) query.shop_cipher = cipher;
    const body = opts.body === undefined ? "" : JSON.stringify(opts.body);
    query.sign = tiktokSign(this.appSecret, path, query, body);
    const res = await fetch(`${this.hosts.api}${path}?${new URLSearchParams(query)}`, {
      method: opts.method ?? "GET",
      headers: { "Content-Type": "application/json", ...(opts.ctx?.credentials ? { "x-tts-access-token": opts.ctx.credentials.accessToken } : {}) },
      body: body || undefined,
      signal: AbortSignal.timeout(20_000),
    });
    const data = (await res.json().catch(() => ({}))) as Envelope<T>;
    if (res.status === 429 || /rate limit|too many/i.test(data.message ?? "")) throw new MarketplaceError("Batas permintaan TikTok Shop tercapai. Coba lagi sebentar.", "RATE_LIMIT");
    if (data.code !== 0) {
      throw new MarketplaceError(`TikTok Shop: ${data.message || `kode ${data.code ?? res.status}`}`, AUTH_CODES.has(Number(data.code)) || res.status === 401 ? "AUTH" : "REMOTE");
    }
    return data.data as T;
  }

  private async token(path: "/api/v2/token/get" | "/api/v2/token/refresh", params: Record<string, string>) {
    const qs = new URLSearchParams({ app_key: this.appKey, app_secret: this.appSecret, ...params });
    const res = await fetch(`${this.hosts.auth}${path}?${qs}`, { signal: AbortSignal.timeout(15_000) });
    const data = (await res.json().catch(() => ({}))) as Envelope<{ access_token?: string; refresh_token?: string; access_token_expire_in?: number; seller_name?: string }>;
    if (data.code !== 0 || !data.data?.access_token || !data.data.refresh_token) throw new MarketplaceError(`TikTok Shop: ${data.message || "token tidak diterima"}`, "AUTH");
    const d = data.data;
    // access_token_expire_in = waktu kedaluwarsa (unix detik).
    const expiresAt = d.access_token_expire_in && d.access_token_expire_in > 1e9 ? new Date(d.access_token_expire_in * 1000) : new Date(Date.now() + 6 * 86_400_000);
    return { accessToken: d.access_token!, refreshToken: d.refresh_token!, expiresAt: expiresAt.toISOString(), sellerName: d.seller_name };
  }

  /** Redirect URL didaftarkan di Partner Center; `state` (CSRF) diambil dari redirect yang disiapkan service. */
  authorizeUrl(redirectUrl: string) {
    const state = new URL(redirectUrl).searchParams.get("state") ?? "";
    return `${this.hosts.authorize}?${new URLSearchParams({ service_id: this.serviceId, state })}`;
  }

  async exchangeCode(params: URLSearchParams) {
    const code = params.get("code") ?? params.get("auth_code");
    if (!code) throw new MarketplaceError("Callback TikTok Shop tidak membawa code.", "AUTH");
    const t = await this.token("/api/v2/token/get", { auth_code: code, grant_type: "authorized_code" });
    const base: Credentials = { accessToken: t.accessToken, refreshToken: t.refreshToken, expiresAt: t.expiresAt };
    // Toko & cipher: satu aplikasi seller bisa punya satu toko per wilayah; Indonesia diprioritaskan.
    const { shops } = await this.call<{ shops: { id: string; name: string; cipher: string; region: string }[] }>("/authorization/202309/shops", { ctx: { shopId: "", credentials: base }, shopScoped: false });
    const shop = shops.find((s) => s.region === "ID") ?? shops[0];
    if (!shop) throw new MarketplaceError("Akun ini tidak punya toko TikTok Shop yang terotorisasi.", "AUTH");
    const credentials: Credentials = { ...base, extra: { shopCipher: shop.cipher } };
    const warehouse = await this.defaultWarehouse({ shopId: shop.id, credentials }).catch(() => null);
    if (warehouse) credentials.extra!.warehouseId = warehouse;
    return { shopId: shop.id, shopName: shop.name || t.sellerName || `TikTok Shop ${shop.id}`, credentials };
  }

  private async defaultWarehouse(ctx: AdapterContext) {
    const { warehouses } = await this.call<{ warehouses: { id: string; is_default?: boolean; type?: string; effect_status?: string }[] }>("/logistics/202309/warehouses", { ctx });
    const sales = warehouses.filter((w) => (w.type ?? "SALES_WAREHOUSE") === "SALES_WAREHOUSE" && (w.effect_status ?? "ENABLED") === "ENABLED");
    return (sales.find((w) => w.is_default) ?? sales[0])?.id ?? null;
  }

  async refresh(ctx: AdapterContext) {
    if (!ctx.credentials) throw new MarketplaceError("Belum ada token.", "AUTH");
    const t = await this.token("/api/v2/token/refresh", { refresh_token: ctx.credentials.refreshToken, grant_type: "refresh_token" });
    return { accessToken: t.accessToken, refreshToken: t.refreshToken, expiresAt: t.expiresAt, extra: ctx.credentials.extra };
  }

  async listUpdatedOrders(ctx: AdapterContext, from: Date, to: Date) {
    const ids: string[] = [];
    let pageToken = "";
    for (let page = 0; page < 100; page++) {
      const data = await this.call<{ orders?: { id: string }[]; next_page_token?: string }>("/order/202309/orders/search", {
        method: "POST",
        ctx,
        query: { page_size: 100, ...(pageToken ? { page_token: pageToken } : {}) },
        body: { update_time_ge: Math.floor(from.getTime() / 1000), update_time_lt: Math.floor(to.getTime() / 1000) },
      });
      ids.push(...(data.orders ?? []).map((o) => o.id));
      if (!data.next_page_token) break;
      pageToken = data.next_page_token;
    }
    return [...new Set(ids)];
  }

  async getOrders(ctx: AdapterContext, orderNos: string[]): Promise<MpOrder[]> {
    const out: MpOrder[] = [];
    for (let i = 0; i < orderNos.length; i += 50) {
      const data = await this.call<{ orders?: Record<string, unknown>[] }>("/order/202309/orders", { ctx, query: { ids: orderNos.slice(i, i + 50).join(",") } });
      for (const o of data.orders ?? []) {
        const addr = (o.recipient_address ?? {}) as { name?: string; phone_number?: string; full_address?: string };
        out.push({
          externalOrderNo: String(o.id),
          status: STATUS[String(o.status)] ?? "PAID",
          createdAt: new Date(Number(o.create_time) * 1000),
          updatedAt: new Date(Number(o.update_time ?? o.create_time) * 1000),
          recipientName: addr.name || "Pembeli TikTok Shop",
          recipientPhone: addr.phone_number || "-",
          shippingAddress: addr.full_address || "(alamat disamarkan TikTok Shop)",
          courier: (o.shipping_provider as string) || null,
          trackingNo: (o.tracking_number as string) || null,
          note: (o.buyer_message as string) || null,
          // Di 202309 tiap baris = 1 unit (quantity bila tersedia); baris SKU sama digabung saat impor.
          items: ((o.line_items as Record<string, unknown>[] | undefined) ?? [])
            .filter((it) => !it.is_gift && String(it.display_status ?? "") !== "CANCELLED")
            .map((it) => ({
              externalItemId: String(it.product_id),
              externalModelId: String(it.sku_id),
              sku: (it.seller_sku as string) || null,
              name: [it.product_name, it.sku_name].filter(Boolean).join(" · "),
              qty: Number(it.quantity ?? 1),
              unitPrice: toAmount(it.sale_price ?? it.original_price),
            })),
        });
      }
    }
    return out;
  }

  async listListings(ctx: AdapterContext): Promise<MpListing[]> {
    const out: MpListing[] = [];
    let pageToken = "";
    for (let page = 0; page < 200; page++) {
      const data = await this.call<{ products?: { id: string; title: string; skus?: { id: string; seller_sku?: string; sales_attributes?: { value_name?: string }[]; inventory?: { quantity?: number }[] }[] }[]; next_page_token?: string }>(
        "/product/202309/products/search",
        { method: "POST", ctx, query: { page_size: 100, ...(pageToken ? { page_token: pageToken } : {}) }, body: { status: "ACTIVATE" } },
      );
      for (const p of data.products ?? []) {
        for (const sku of p.skus ?? []) {
          const variant = (sku.sales_attributes ?? []).map((a) => a.value_name).filter(Boolean).join(" / ");
          out.push({
            externalItemId: p.id,
            externalModelId: sku.id,
            sku: sku.seller_sku || null,
            name: variant ? `${p.title} · ${variant}` : p.title,
            stock: (sku.inventory ?? []).reduce((s, w) => s + Number(w.quantity ?? 0), 0),
          });
        }
      }
      if (!data.next_page_token) break;
      pageToken = data.next_page_token;
    }
    return out;
  }

  async updateStock(ctx: AdapterContext, rows: { externalItemId: string; externalModelId: string; qty: number }[]) {
    const warehouseId = ctx.credentials?.extra?.warehouseId ?? (await this.defaultWarehouse(ctx));
    if (!warehouseId) throw new MarketplaceError("Gudang penjualan TikTok Shop tidak ditemukan. Atur gudang default di Seller Center.", "REMOTE");
    const failed: { ref: string; message: string }[] = [];
    const byProduct = new Map<string, typeof rows>();
    for (const r of rows) byProduct.set(r.externalItemId, [...(byProduct.get(r.externalItemId) ?? []), r]);
    for (const [productId, list] of byProduct) {
      try {
        await this.call(`/product/202309/products/${encodeURIComponent(productId)}/inventory/update`, {
          method: "POST",
          ctx,
          body: { skus: list.map((r) => ({ id: r.externalModelId, inventory: [{ warehouse_id: warehouseId, quantity: r.qty }] })) },
        });
      } catch (error) {
        if (error instanceof MarketplaceError && error.kind !== "REMOTE") throw error;
        for (const r of list) failed.push({ ref: `${productId}/${r.externalModelId}`, message: (error as Error).message });
      }
    }
    return { failed };
  }

  parseWebhook(rawBody: string, headers: Headers) {
    const expected = createHmac("sha256", this.appSecret).update(`${this.appKey}${rawBody}`).digest("hex");
    if (!safeEqualHex(expected, headers.get("authorization") ?? "")) throw new MarketplaceError("Signature webhook TikTok Shop tidak valid.", "AUTH");
    const body = JSON.parse(rawBody) as { type?: number; shop_id?: string | number; data?: { order_id?: string } };
    // type 1 = perubahan status order; event lain diabaikan.
    if (body.type !== 1 || !body.shop_id || !body.data?.order_id) return null;
    return { shopId: String(body.shop_id), orderNos: [String(body.data.order_id)] };
  }
}

export function createTikTokAdapter(): MarketplaceAdapter | null {
  return env.TIKTOK_APP_KEY && env.TIKTOK_APP_SECRET && env.TIKTOK_SERVICE_ID ? new TikTokShopAdapter(env.TIKTOK_APP_KEY, env.TIKTOK_APP_SECRET, env.TIKTOK_SERVICE_ID) : null;
}
