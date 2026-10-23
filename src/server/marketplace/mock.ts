import "server-only";
import { createHmac } from "node:crypto";
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/server/db";
import { mockMarketplaceOrders, products, productVariants } from "@/server/db/schema";
import { env } from "@/server/env";
import { MarketplaceError, safeEqualHex, type AdapterContext, type MarketplaceAdapter, type MpListing, type MpOrder } from "./types";

/**
 * Toko simulasi untuk development & demo (tidak aktif di production). Katalognya = varian aktif Konten
 * (SKU sama → terpetakan otomatis); order disimpan di `mock_marketplace_orders` dan perubahan status
 * dikirim sebagai webhook bertanda tangan HMAC ke jalur yang sama dengan marketplace sungguhan.
 */
class MockMarketplaceAdapter implements MarketplaceAdapter {
  readonly provider = "mock";
  readonly channel = "OTHER" as const;
  readonly label = "Toko simulasi (dev)";
  readonly oauth = false;

  async listUpdatedOrders(ctx: AdapterContext, from: Date, to: Date) {
    const rows = await db
      .select({ sn: mockMarketplaceOrders.orderSn })
      .from(mockMarketplaceOrders)
      .where(and(eq(mockMarketplaceOrders.shopId, ctx.shopId), gte(mockMarketplaceOrders.updatedAt, from), lte(mockMarketplaceOrders.updatedAt, to)));
    return rows.map((r) => r.sn);
  }

  async getOrders(ctx: AdapterContext, orderNos: string[]): Promise<MpOrder[]> {
    if (!orderNos.length) return [];
    const rows = await db
      .select()
      .from(mockMarketplaceOrders)
      .where(and(eq(mockMarketplaceOrders.shopId, ctx.shopId), inArray(mockMarketplaceOrders.orderSn, orderNos)));
    return rows.map((r) => {
      const p = r.payload as Omit<MpOrder, "createdAt" | "updatedAt" | "status"> & { createdAt: string };
      return { ...p, status: r.status as MpOrder["status"], createdAt: new Date(p.createdAt), updatedAt: r.updatedAt };
    });
  }

  async listListings(): Promise<MpListing[]> {
    const rows = await db
      .select({ productId: products.id, variantId: productVariants.id, sku: productVariants.sku, productName: products.name, title: productVariants.title })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(and(eq(products.status, "ACTIVE"), eq(productVariants.isActive, true)))
      .orderBy(asc(products.name))
      .limit(500);
    return rows.map((r) => ({ externalItemId: r.productId, externalModelId: r.variantId, sku: r.sku, name: r.title === "Default" ? r.productName : `${r.productName} · ${r.title}`, stock: null }));
  }

  async updateStock() {
    return { failed: [] };
  }

  sign(body: string) {
    return createHmac("sha256", env.BETTER_AUTH_SECRET).update(`mock-marketplace|${body}`).digest("hex");
  }

  parseWebhook(rawBody: string, headers: Headers) {
    if (!safeEqualHex(this.sign(rawBody), headers.get("x-mock-signature") ?? "")) throw new MarketplaceError("Signature simulator tidak valid.", "AUTH");
    const body = JSON.parse(rawBody) as { shopId: string; orderSn: string };
    return { shopId: body.shopId, orderNos: [body.orderSn] };
  }
}

const instance = new MockMarketplaceAdapter();
export const createMockAdapter = () => (env.NODE_ENV === "production" ? null : instance);
export type { MockMarketplaceAdapter };
