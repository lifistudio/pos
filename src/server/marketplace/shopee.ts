import "server-only";
import { createHmac } from "node:crypto";
import { env } from "@/server/env";
import { MarketplaceError, safeEqualHex, type AdapterContext, type Credentials, type MarketplaceAdapter, type MpListing, type MpOrder, type MpOrderStatus } from "./types";

/**
 * Adapter Shopee Open Platform API v2.
 * Signature: HMAC-SHA256(partner_key, partner_id + path + timestamp [+ access_token + shop_id]) — panduan developer Shopee.
 * Push: header Authorization = HMAC-SHA256(partner_key, url + "|" + body).
 * BELUM diuji terhadap akun sandbox (butuh partner_id/partner_key) — lihat docs/DECISIONS.md ADR-020.
 */
const HOST = { live: "https://partner.shopeemobile.com", sandbox: "https://partner.test-stable.shopeemobile.com" } as const;

type ShopeeResponse<T> = { error?: string; message?: string; request_id?: string; response?: T } & Record<string, unknown>;

const STATUS: Record<string, MpOrderStatus> = {
  UNPAID: "UNPAID",
  INVOICE_PENDING: "UNPAID",
  READY_TO_SHIP: "PAID",
  PROCESSED: "PAID",
  RETRY_SHIP: "PAID",
  SHIPPED: "SHIPPED",
  TO_CONFIRM_RECEIVE: "SHIPPED",
  TO_RETURN: "SHIPPED",
  COMPLETED: "COMPLETED",
  IN_CANCEL: "PAID",
  CANCELLED: "CANCELLED",
};

class ShopeeAdapter implements MarketplaceAdapter {
  readonly provider = "shopee";
  readonly channel = "SHOPEE" as const;
  readonly label = "Shopee";
  readonly oauth = true;
  private readonly host = HOST[env.SHOPEE_ENV];

  constructor(
    private readonly partnerId: string,
    private readonly partnerKey: string,
  ) {}

  private sign(base: string) {
    return createHmac("sha256", this.partnerKey).update(base).digest("hex");
  }

  private async call<T>(path: string, opts: { method?: "GET" | "POST"; query?: Record<string, string | number>; body?: unknown; ctx?: AdapterContext }) {
    const ts = Math.floor(Date.now() / 1000);
    const access = opts.ctx?.credentials?.accessToken;
    const base = `${this.partnerId}${path}${ts}${access ? `${access}${opts.ctx!.shopId}` : ""}`;
    const qs = new URLSearchParams({ partner_id: this.partnerId, timestamp: String(ts), sign: this.sign(base) });
    if (access) {
      qs.set("access_token", access);
      qs.set("shop_id", opts.ctx!.shopId);
    }
    for (const [k, v] of Object.entries(opts.query ?? {})) qs.set(k, String(v));
    const res = await fetch(`${this.host}${path}?${qs}`, {
      method: opts.method ?? "GET",
      headers: { "Content-Type": "application/json" },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    const data = (await res.json().catch(() => ({}))) as ShopeeResponse<T>;
    if (res.status === 429 || data.error === "error_rate_limit") throw new MarketplaceError("Batas permintaan Shopee tercapai. Coba lagi sebentar.", "RATE_LIMIT");
    if (data.error) {
      const auth = /auth|token|sign|permission/i.test(data.error);
      throw new MarketplaceError(`Shopee: ${data.message || data.error}`, auth ? "AUTH" : "REMOTE");
    }
    return data;
  }

  authorizeUrl(redirectUrl: string) {
    const path = "/api/v2/shop/auth_partner";
    const ts = Math.floor(Date.now() / 1000);
    const qs = new URLSearchParams({ partner_id: this.partnerId, timestamp: String(ts), sign: this.sign(`${this.partnerId}${path}${ts}`), redirect: redirectUrl });
    return `${this.host}${path}?${qs}`;
  }

  private toCredentials(r: { access_token?: string; refresh_token?: string; expire_in?: number }): Credentials {
    if (!r.access_token || !r.refresh_token) throw new MarketplaceError("Shopee tidak mengembalikan token.", "AUTH");
    return { accessToken: r.access_token, refreshToken: r.refresh_token, expiresAt: new Date(Date.now() + (r.expire_in ?? 14_400) * 1000).toISOString() };
  }

  async exchangeCode(params: URLSearchParams) {
    const code = params.get("code");
    const shopId = params.get("shop_id");
    if (!code || !shopId) throw new MarketplaceError("Callback Shopee tidak membawa code/shop_id.", "AUTH");
    const data = await this.call<never>("/api/v2/auth/token/get", { method: "POST", body: { code, shop_id: Number(shopId), partner_id: Number(this.partnerId) } });
    const credentials = this.toCredentials(data as { access_token?: string; refresh_token?: string; expire_in?: number });
    const info = await this.call<never>("/api/v2/shop/get_shop_info", { ctx: { shopId, credentials } }).catch(() => null);
    return { shopId, shopName: String((info as { shop_name?: string } | null)?.shop_name ?? `Shopee ${shopId}`), credentials };
  }

  async refresh(ctx: AdapterContext) {
    if (!ctx.credentials) throw new MarketplaceError("Belum ada token.", "AUTH");
    const data = await this.call<never>("/api/v2/auth/access_token/get", {
      method: "POST",
      body: { refresh_token: ctx.credentials.refreshToken, shop_id: Number(ctx.shopId), partner_id: Number(this.partnerId) },
    });
    return this.toCredentials(data as { access_token?: string; refresh_token?: string; expire_in?: number });
  }

  async listUpdatedOrders(ctx: AdapterContext, from: Date, to: Date) {
    const out: string[] = [];
    // Rentang maks 15 hari per permintaan; dipecah bila lebih.
    for (let start = from.getTime(); start < to.getTime(); start += 15 * 86_400_000) {
      const end = Math.min(to.getTime(), start + 15 * 86_400_000);
      let cursor = "";
      for (let page = 0; page < 50; page++) {
        const { response } = await this.call<{ more: boolean; next_cursor: string; order_list: { order_sn: string }[] }>("/api/v2/order/get_order_list", {
          ctx,
          query: { time_range_field: "update_time", time_from: Math.floor(start / 1000), time_to: Math.floor(end / 1000), page_size: 100, cursor },
        });
        out.push(...(response?.order_list ?? []).map((o) => o.order_sn));
        if (!response?.more) break;
        cursor = response.next_cursor;
      }
    }
    return [...new Set(out)];
  }

  async getOrders(ctx: AdapterContext, orderNos: string[]): Promise<MpOrder[]> {
    const out: MpOrder[] = [];
    for (let i = 0; i < orderNos.length; i += 50) {
      const { response } = await this.call<{ order_list: Record<string, unknown>[] }>("/api/v2/order/get_order_detail", {
        ctx,
        query: { order_sn_list: orderNos.slice(i, i + 50).join(","), response_optional_fields: "item_list,recipient_address,shipping_carrier,note,package_list" },
      });
      for (const o of response?.order_list ?? []) {
        const addr = (o.recipient_address ?? {}) as { name?: string; phone?: string; full_address?: string };
        const pkg = ((o.package_list as { tracking_number?: string }[] | undefined) ?? [])[0];
        out.push({
          externalOrderNo: String(o.order_sn),
          status: STATUS[String(o.order_status)] ?? "PAID",
          createdAt: new Date(Number(o.create_time) * 1000),
          updatedAt: new Date(Number(o.update_time) * 1000),
          recipientName: addr.name || "Pembeli Shopee",
          recipientPhone: addr.phone || "-",
          shippingAddress: addr.full_address || "(alamat disamarkan Shopee)",
          courier: (o.shipping_carrier as string) || null,
          trackingNo: pkg?.tracking_number || null,
          note: (o.note as string) || null,
          items: ((o.item_list as Record<string, unknown>[] | undefined) ?? []).map((it) => ({
            externalItemId: String(it.item_id),
            externalModelId: String(it.model_id ?? 0),
            sku: ((it.model_sku as string) || (it.item_sku as string)) ?? null,
            name: [it.item_name, it.model_name].filter(Boolean).join(" · "),
            qty: Number(it.model_quantity_purchased ?? 0),
            unitPrice: Math.round(Number(it.model_discounted_price ?? it.model_original_price ?? 0)),
          })),
        });
      }
    }
    return out;
  }

  async listListings(ctx: AdapterContext): Promise<MpListing[]> {
    const itemIds: number[] = [];
    for (let offset = 0, page = 0; page < 100; page++) {
      const { response } = await this.call<{ item: { item_id: number }[]; has_next_page: boolean; next_offset: number }>("/api/v2/product/get_item_list", {
        ctx,
        query: { offset, page_size: 100, item_status: "NORMAL" },
      });
      itemIds.push(...(response?.item ?? []).map((i) => i.item_id));
      if (!response?.has_next_page) break;
      offset = response.next_offset;
    }
    const out: MpListing[] = [];
    for (let i = 0; i < itemIds.length; i += 50) {
      const { response } = await this.call<{ item_list: { item_id: number; item_name: string; item_sku?: string; has_model: boolean; stock_info_v2?: { summary_info?: { total_available_stock?: number } } }[] }>(
        "/api/v2/product/get_item_base_info",
        { ctx, query: { item_id_list: itemIds.slice(i, i + 50).join(",") } },
      );
      for (const item of response?.item_list ?? []) {
        if (!item.has_model) {
          out.push({ externalItemId: String(item.item_id), externalModelId: "0", sku: item.item_sku || null, name: item.item_name, stock: item.stock_info_v2?.summary_info?.total_available_stock ?? null });
          continue;
        }
        const { response: models } = await this.call<{ model: { model_id: number; model_sku?: string; model_name?: string; stock_info_v2?: { summary_info?: { total_available_stock?: number } } }[] }>(
          "/api/v2/product/get_model_list",
          { ctx, query: { item_id: item.item_id } },
        );
        for (const m of models?.model ?? []) {
          out.push({
            externalItemId: String(item.item_id),
            externalModelId: String(m.model_id),
            sku: m.model_sku || null,
            name: [item.item_name, m.model_name].filter(Boolean).join(" · "),
            stock: m.stock_info_v2?.summary_info?.total_available_stock ?? null,
          });
        }
      }
    }
    return out;
  }

  async updateStock(ctx: AdapterContext, rows: { externalItemId: string; externalModelId: string; qty: number }[]) {
    const failed: { ref: string; message: string }[] = [];
    const byItem = new Map<string, typeof rows>();
    for (const r of rows) byItem.set(r.externalItemId, [...(byItem.get(r.externalItemId) ?? []), r]);
    for (const [itemId, list] of byItem) {
      // Maks 50 model per permintaan.
      for (let i = 0; i < list.length; i += 50) {
        const chunk = list.slice(i, i + 50);
        try {
          const { response } = await this.call<{ failure_list?: { model_id: number; failed_reason: string }[] }>("/api/v2/product/update_stock", {
            method: "POST",
            ctx,
            body: { item_id: Number(itemId), stock_list: chunk.map((r) => ({ model_id: Number(r.externalModelId), seller_stock: [{ stock: r.qty }] })) },
          });
          for (const f of response?.failure_list ?? []) failed.push({ ref: `${itemId}/${f.model_id}`, message: f.failed_reason });
        } catch (error) {
          if (error instanceof MarketplaceError && error.kind !== "REMOTE") throw error;
          for (const r of chunk) failed.push({ ref: `${itemId}/${r.externalModelId}`, message: (error as Error).message });
        }
      }
    }
    return { failed };
  }

  parseWebhook(rawBody: string, headers: Headers, url: string) {
    const expected = this.sign(`${url}|${rawBody}`);
    const got = headers.get("authorization") ?? "";
    if (!safeEqualHex(expected, got)) throw new MarketplaceError("Signature push Shopee tidak valid.", "AUTH");
    const body = JSON.parse(rawBody) as { code?: number; shop_id?: number; data?: { ordersn?: string; order_sn?: string } };
    // code 3 = perubahan status order; event lain diabaikan.
    if (body.code !== 3 || !body.shop_id) return null;
    const sn = body.data?.ordersn ?? body.data?.order_sn;
    return sn ? { shopId: String(body.shop_id), orderNos: [sn] } : null;
  }
}

export function createShopeeAdapter(): MarketplaceAdapter | null {
  return env.SHOPEE_PARTNER_ID && env.SHOPEE_PARTNER_KEY ? new ShopeeAdapter(env.SHOPEE_PARTNER_ID, env.SHOPEE_PARTNER_KEY) : null;
}
