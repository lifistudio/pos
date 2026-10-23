import "server-only";
import { canonicalCourier } from "@/lib/couriers";
import { and, asc, count, desc, eq, ilike, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/server/db";
import {
  branches,
  inventoryLevels,
  marketplaceConnections,
  marketplaceListings,
  marketplaceSyncLogs,
  mockMarketplaceOrders,
  onlineOrderItems,
  onlineOrders,
  products,
  productVariants,
  type TaxSnapshot,
} from "@/server/db/schema";
import type { Actor } from "@/server/api/context";
import { ApiError, badRequest, conflict, forbidden, notFound } from "@/server/api/errors";
import { toPageMeta } from "@/server/api/pagination";
import { env } from "@/server/env";
import { getAdapter, marketplaceAdapters, PLANNED_PROVIDERS } from "@/server/marketplace";
import { createMockAdapter } from "@/server/marketplace/mock";
import {
  decryptCredentials,
  encryptCredentials,
  MarketplaceError,
  signState,
  verifyState,
  type AdapterContext,
  type MarketplaceAdapter,
  type MpOrder,
} from "@/server/marketplace/types";
import { can } from "@/server/rbac/access";
import { computeTotals } from "@/lib/pricing";
import { writeAudit } from "./audit.service";
import { reserveStock } from "./inventory.service";
import { nextDocNumber } from "./numbering";
import { advanceOrderTx, cancelOrderTx, confirmOrderPayment } from "./online-order.service";

type Connection = typeof marketplaceConnections.$inferSelect;
type SyncKind = (typeof marketplaceSyncLogs.$inferInsert)["kind"];
type Issue = { ref: string; message: string };

/** Kolom aman untuk client (tanpa kredensial). */
const publicColumns = {
  id: marketplaceConnections.id,
  provider: marketplaceConnections.provider,
  channel: marketplaceConnections.channel,
  name: marketplaceConnections.name,
  externalShopId: marketplaceConnections.externalShopId,
  branchId: marketplaceConnections.branchId,
  branchName: branches.name,
  status: marketplaceConnections.status,
  pullOrders: marketplaceConnections.pullOrders,
  pushStock: marketplaceConnections.pushStock,
  stockBuffer: marketplaceConnections.stockBuffer,
  tokenExpiresAt: marketplaceConnections.tokenExpiresAt,
  ordersSyncedUntil: marketplaceConnections.ordersSyncedUntil,
  lastSyncAt: marketplaceConnections.lastSyncAt,
  lastError: marketplaceConnections.lastError,
  retryCount: sql<number>`jsonb_array_length(${marketplaceConnections.retryOrderNos})::int`,
  createdAt: marketplaceConnections.createdAt,
};

function requireManage(actor: Actor) {
  if (!can(actor.access, "marketplace:manage")) throw forbidden("marketplace:manage");
}

// ── Penyedia & koneksi ──────────────────────────────────────────────────

export function listProviders() {
  return [
    ...marketplaceAdapters().map((a) => ({ provider: a.provider, label: a.label, channel: a.channel, oauth: a.oauth, available: true })),
    ...PLANNED_PROVIDERS.map((p) => ({ provider: p.provider, label: p.label, channel: "OTHER" as const, oauth: true, available: false })),
    // Shopee tampil walau belum dikonfigurasi, agar admin tahu cara mengaktifkannya.
    ...(getAdapter("shopee") ? [] : [{ provider: "shopee", label: "Shopee (atur SHOPEE_PARTNER_ID/KEY)", channel: "SHOPEE" as const, oauth: true, available: false }]),
    ...(getAdapter("tiktok") ? [] : [{ provider: "tiktok", label: "TikTok Shop / Tokopedia (atur TIKTOK_APP_KEY/SECRET/SERVICE_ID)", channel: "TIKTOK" as const, oauth: true, available: false }]),
  ];
}

export async function listConnections() {
  return db.select(publicColumns).from(marketplaceConnections).innerJoin(branches, eq(branches.id, marketplaceConnections.branchId)).orderBy(asc(marketplaceConnections.createdAt));
}

export async function getConnection(id: string) {
  const [row] = await db.select(publicColumns).from(marketplaceConnections).innerJoin(branches, eq(branches.id, marketplaceConnections.branchId)).where(eq(marketplaceConnections.id, id));
  if (!row) throw notFound("Koneksi marketplace");
  const [[stats], logs] = await Promise.all([
    db
      .select({
        listings: sql<number>`count(*)::int`,
        mapped: sql<number>`count(*) filter (where ${marketplaceListings.variantId} is not null)::int`,
      })
      .from(marketplaceListings)
      .where(eq(marketplaceListings.connectionId, id)),
    db.select().from(marketplaceSyncLogs).where(eq(marketplaceSyncLogs.connectionId, id)).orderBy(desc(marketplaceSyncLogs.startedAt)).limit(15),
  ]);
  return { ...row, stats: { ...stats, unmapped: stats.listings - stats.mapped }, logs, simulator: row.provider === "mock" && !!createMockAdapter() };
}

/**
 * Mulai menghubungkan toko. OAuth (Shopee) → URL otorisasi dengan state bertanda tangan;
 * simulator → koneksi langsung dibuat.
 */
export async function startConnect(actor: Actor, input: { provider: string; branchId: string }) {
  requireManage(actor);
  const adapter = getAdapter(input.provider);
  if (!adapter) throw badRequest("PROVIDER_UNAVAILABLE", "Marketplace ini belum tersedia di server.");
  const [branch] = await db.select({ id: branches.id }).from(branches).where(eq(branches.id, input.branchId));
  if (!branch) throw notFound("Cabang");
  if (adapter.oauth) {
    const state = signState({ userId: actor.userId, branchId: input.branchId, provider: adapter.provider });
    const redirect = `${new URL(env.BETTER_AUTH_URL).origin}/api/v1/marketplace/oauth/${adapter.provider}/callback?state=${encodeURIComponent(state)}`;
    return { authorizeUrl: adapter.authorizeUrl!(redirect), connectionId: null };
  }
  const shopId = `DEMO-${Date.now().toString(36).toUpperCase()}`;
  const [conn] = await db
    .insert(marketplaceConnections)
    .values({ provider: adapter.provider, channel: adapter.channel, name: `Toko simulasi ${shopId.slice(-4)}`, externalShopId: shopId, branchId: input.branchId, createdBy: actor.userId, ordersSyncedUntil: new Date() })
    .returning({ id: marketplaceConnections.id });
  await writeAudit(actor, { action: "connect", entity: "marketplace", entityId: conn.id, after: { provider: adapter.provider, shopId } });
  await syncListings(conn.id);
  return { authorizeUrl: null, connectionId: conn.id };
}

export async function completeOAuth(actor: Actor, provider: string, params: URLSearchParams) {
  requireManage(actor);
  const state = verifyState(params.get("state") ?? "");
  if (!state || state.provider !== provider || state.userId !== actor.userId) throw new ApiError(400, "OAUTH_STATE_INVALID", "Sesi penghubungan kedaluwarsa atau tidak valid. Ulangi dari halaman Marketplace.");
  const adapter = getAdapter(provider);
  if (!adapter?.exchangeCode) throw badRequest("PROVIDER_UNAVAILABLE", "Marketplace ini belum tersedia di server.");
  const { shopId, shopName, credentials } = await adapter.exchangeCode(params);
  const [conn] = await db
    .insert(marketplaceConnections)
    .values({
      provider,
      channel: adapter.channel,
      name: shopName,
      externalShopId: shopId,
      branchId: state.branchId,
      credentialsEnc: encryptCredentials(credentials),
      tokenExpiresAt: new Date(credentials.expiresAt),
      createdBy: actor.userId,
      ordersSyncedUntil: new Date(Date.now() - 3 * 86_400_000),
    })
    .onConflictDoUpdate({
      target: [marketplaceConnections.provider, marketplaceConnections.externalShopId],
      set: { credentialsEnc: encryptCredentials(credentials), tokenExpiresAt: new Date(credentials.expiresAt), status: "ACTIVE", lastError: null, name: shopName, updatedAt: new Date() },
    })
    .returning({ id: marketplaceConnections.id });
  await writeAudit(actor, { action: "connect", entity: "marketplace", entityId: conn.id, after: { provider, shopId } });
  await syncListings(conn.id).catch(() => null);
  return conn.id;
}

export async function updateConnection(actor: Actor, id: string, input: { name?: string; branchId?: string; pullOrders?: boolean; pushStock?: boolean; stockBuffer?: number; status?: "ACTIVE" | "PAUSED" }) {
  requireManage(actor);
  const [updated] = await db
    .update(marketplaceConnections)
    .set({ ...input, updatedAt: new Date(), ...(input.status === "ACTIVE" ? { lastError: null } : {}) })
    .where(and(eq(marketplaceConnections.id, id), sql`${marketplaceConnections.status} <> 'DISCONNECTED'`))
    .returning({ id: marketplaceConnections.id });
  if (!updated) throw notFound("Koneksi marketplace");
  // Cabang/buffer berubah → angka stok di marketplace harus dihitung ulang.
  if (input.branchId !== undefined || input.stockBuffer !== undefined) await db.update(marketplaceListings).set({ lastPushedQty: null }).where(eq(marketplaceListings.connectionId, id));
  await writeAudit(actor, { action: "update", entity: "marketplace", entityId: id, after: input });
  return getConnection(id);
}

export async function disconnect(actor: Actor, id: string) {
  requireManage(actor);
  await db.update(marketplaceConnections).set({ status: "DISCONNECTED", credentialsEnc: null, tokenExpiresAt: null, updatedAt: new Date() }).where(eq(marketplaceConnections.id, id));
  await writeAudit(actor, { action: "disconnect", entity: "marketplace", entityId: id });
  return getConnection(id);
}

// ── Kredensial & log ────────────────────────────────────────────────────

async function context(conn: Connection, adapter: MarketplaceAdapter): Promise<AdapterContext> {
  if (!adapter.oauth) return { shopId: conn.externalShopId, credentials: null };
  if (!conn.credentialsEnc) throw new MarketplaceError("Toko belum terhubung. Hubungkan ulang.", "AUTH");
  let credentials = decryptCredentials(conn.credentialsEnc);
  // Perbarui token 5 menit sebelum kedaluwarsa.
  if (new Date(credentials.expiresAt).getTime() - Date.now() < 5 * 60_000 && adapter.refresh) {
    credentials = await adapter.refresh({ shopId: conn.externalShopId, credentials });
    await db
      .update(marketplaceConnections)
      .set({ credentialsEnc: encryptCredentials(credentials), tokenExpiresAt: new Date(credentials.expiresAt), updatedAt: new Date() })
      .where(eq(marketplaceConnections.id, conn.id));
  }
  return { shopId: conn.externalShopId, credentials };
}

async function loadConnection(id: string) {
  const [conn] = await db.select().from(marketplaceConnections).where(eq(marketplaceConnections.id, id));
  if (!conn) throw notFound("Koneksi marketplace");
  const adapter = getAdapter(conn.provider);
  if (!adapter) throw conflict("PROVIDER_UNAVAILABLE", "Adapter marketplace ini tidak aktif di server.");
  return { conn, adapter };
}

/** Jalankan satu jenis sinkron + catat log; error auth menandai koneksi ERROR agar admin menghubungkan ulang. */
async function withLog<T extends { stats: Record<string, number>; issues: Issue[] }>(connId: string, kind: SyncKind, run: () => Promise<T>) {
  const [log] = await db.insert(marketplaceSyncLogs).values({ connectionId: connId, kind, status: "OK" }).returning({ id: marketplaceSyncLogs.id });
  try {
    const result = await run();
    await db
      .update(marketplaceSyncLogs)
      .set({ status: result.issues.length ? "PARTIAL" : "OK", stats: result.stats, issues: result.issues.slice(0, 50), finishedAt: new Date() })
      .where(eq(marketplaceSyncLogs.id, log.id));
    await db.update(marketplaceConnections).set({ lastSyncAt: new Date(), lastError: null }).where(eq(marketplaceConnections.id, connId));
    return result;
  } catch (error) {
    const message = (error as Error).message;
    await db.update(marketplaceSyncLogs).set({ status: "FAILED", error: message, finishedAt: new Date() }).where(eq(marketplaceSyncLogs.id, log.id));
    await db
      .update(marketplaceConnections)
      .set({ lastError: message, lastSyncAt: new Date(), ...(error instanceof MarketplaceError && error.kind === "AUTH" ? { status: "ERROR" as const } : {}) })
      .where(eq(marketplaceConnections.id, connId));
    throw error;
  }
}

// ── Listing & pemetaan SKU ──────────────────────────────────────────────

/** Tarik katalog marketplace, simpan, lalu petakan otomatis lewat SKU yang sama (tidak menimpa pemetaan manual). */
export async function syncListings(connId: string) {
  const { conn, adapter } = await loadConnection(connId);
  return withLog(connId, "LISTINGS", async () => {
    const listings = await adapter.listListings(await context(conn, adapter));
    for (let i = 0; i < listings.length; i += 200) {
      const chunk = listings.slice(i, i + 200);
      await db
        .insert(marketplaceListings)
        .values(chunk.map((l) => ({ connectionId: connId, externalItemId: l.externalItemId, externalModelId: l.externalModelId, externalSku: l.sku, name: l.name, marketplaceStock: l.stock })))
        .onConflictDoUpdate({
          target: [marketplaceListings.connectionId, marketplaceListings.externalItemId, marketplaceListings.externalModelId],
          set: { externalSku: sql`excluded.external_sku`, name: sql`excluded.name`, marketplaceStock: sql`excluded.marketplace_stock`, updatedAt: new Date() },
        });
    }
    // Satu UPDATE untuk pemetaan otomatis (SKU tidak peka huruf besar).
    const mapped = await db.execute<{ id: string }>(sql`
      update marketplace_listings ml set variant_id = pv.id, updated_at = now()
      from product_variants pv
      where ml.connection_id = ${connId} and not ml.manual_mapping and ml.external_sku is not null
        and upper(pv.sku) = upper(ml.external_sku) and ml.variant_id is distinct from pv.id
      returning ml.id`);
    const [{ unmapped }] = await db
      .select({ unmapped: count() })
      .from(marketplaceListings)
      .where(and(eq(marketplaceListings.connectionId, connId), isNull(marketplaceListings.variantId)));
    return { stats: { listings: listings.length, autoMapped: mapped.length, unmapped }, issues: [] as Issue[] };
  });
}

export async function listListings(connId: string, params: { filter?: "all" | "mapped" | "unmapped"; q?: string; page: number; pageSize: number }) {
  const filters: (SQL | undefined)[] = [eq(marketplaceListings.connectionId, connId)];
  if (params.filter === "mapped") filters.push(isNotNull(marketplaceListings.variantId));
  if (params.filter === "unmapped") filters.push(isNull(marketplaceListings.variantId));
  if (params.q) filters.push(or(ilike(marketplaceListings.name, `%${params.q}%`), ilike(marketplaceListings.externalSku, `%${params.q}%`)));
  const where = and(...filters);
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: marketplaceListings.id,
        externalItemId: marketplaceListings.externalItemId,
        externalModelId: marketplaceListings.externalModelId,
        externalSku: marketplaceListings.externalSku,
        name: marketplaceListings.name,
        variantId: marketplaceListings.variantId,
        manualMapping: marketplaceListings.manualMapping,
        marketplaceStock: marketplaceListings.marketplaceStock,
        lastPushedQty: marketplaceListings.lastPushedQty,
        lastPushedAt: marketplaceListings.lastPushedAt,
        variantSku: productVariants.sku,
        variantLabel: sql<string | null>`case when ${productVariants.id} is null then null when ${productVariants.title} = 'Default' then ${products.name} else ${products.name} || ' · ' || ${productVariants.title} end`,
      })
      .from(marketplaceListings)
      .leftJoin(productVariants, eq(productVariants.id, marketplaceListings.variantId))
      .leftJoin(products, eq(products.id, productVariants.productId))
      .where(where)
      .orderBy(sql`${marketplaceListings.variantId} is not null`, asc(marketplaceListings.name))
      .limit(params.pageSize)
      .offset((params.page - 1) * params.pageSize),
    db.select({ total: count() }).from(marketplaceListings).where(where),
  ]);
  return { data: rows, meta: toPageMeta(params.page, params.pageSize, total) };
}

export async function mapListing(actor: Actor, listingId: string, variantId: string | null) {
  requireManage(actor);
  const [row] = await db
    .update(marketplaceListings)
    .set({ variantId, manualMapping: variantId !== null, lastPushedQty: null, updatedAt: new Date() })
    .where(eq(marketplaceListings.id, listingId))
    .returning({ id: marketplaceListings.id, connectionId: marketplaceListings.connectionId });
  if (!row) throw notFound("Listing");
  await writeAudit(actor, { action: "map_listing", entity: "marketplace", entityId: row.connectionId, after: { listingId, variantId } });
  return row;
}

// ── Push stok ───────────────────────────────────────────────────────────

/**
 * Kirim stok tersedia (on_hand − reserved − buffer, min 0) cabang sumber untuk listing yang terpetakan.
 * Hanya baris yang angkanya berubah sejak push terakhir yang dikirim (`force` = kirim semua).
 */
export async function pushStock(connId: string, opts: { force?: boolean } = {}) {
  const { conn, adapter } = await loadConnection(connId);
  return withLog(connId, "STOCK", async () => {
    const rows = await db
      .select({
        id: marketplaceListings.id,
        externalItemId: marketplaceListings.externalItemId,
        externalModelId: marketplaceListings.externalModelId,
        lastPushedQty: marketplaceListings.lastPushedQty,
        qty: sql<number>`greatest(coalesce(${inventoryLevels.onHand} - ${inventoryLevels.reserved}, 0) - ${conn.stockBuffer}, 0)::int`,
      })
      .from(marketplaceListings)
      .leftJoin(inventoryLevels, and(eq(inventoryLevels.variantId, marketplaceListings.variantId), eq(inventoryLevels.branchId, conn.branchId)))
      .where(and(eq(marketplaceListings.connectionId, connId), isNotNull(marketplaceListings.variantId)));
    const changed = rows.filter((r) => opts.force || r.lastPushedQty !== r.qty);
    if (!changed.length) return { stats: { mapped: rows.length, pushed: 0, unchanged: rows.length, failed: 0 }, issues: [] as Issue[] };
    const { failed } = await adapter.updateStock(await context(conn, adapter), changed);
    const failedRefs = new Set(failed.map((f) => f.ref));
    const ok = changed.filter((r) => !failedRefs.has(`${r.externalItemId}/${r.externalModelId}`));
    if (ok.length) {
      const values = sql.join(
        ok.map((r) => sql`(${r.id}::uuid, ${r.qty}::int)`),
        sql`, `,
      );
      await db.execute(sql`update marketplace_listings ml set last_pushed_qty = v.qty, last_pushed_at = now(), marketplace_stock = v.qty from (values ${values}) as v(id, qty) where ml.id = v.id`);
    }
    return { stats: { mapped: rows.length, pushed: ok.length, unchanged: rows.length - changed.length, failed: failed.length }, issues: failed };
  });
}

// ── Tarik order ─────────────────────────────────────────────────────────

const RANK: Record<string, number> = { PENDING_PAYMENT: 0, PAID: 1, PACKED: 2, SHIPPED: 3, COMPLETED: 4 };

/**
 * Buat/perbarui order online dari order marketplace (idempoten per kanal + nomor order).
 * Barang belum dipetakan atau stok kurang → order dilewati, dicatat, dan dicoba lagi sinkron berikutnya.
 */
async function upsertOrder(conn: Connection, mp: MpOrder): Promise<{ result: "created" | "updated" | "unchanged" | "skipped"; issue?: Issue }> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: onlineOrders.id, status: onlineOrders.status, total: onlineOrders.total, trackingNo: onlineOrders.trackingNo })
      .from(onlineOrders)
      .where(and(eq(onlineOrders.channel, conn.channel), eq(onlineOrders.externalOrderNo, mp.externalOrderNo)));

    let orderId = existing?.id;
    let status = existing?.status;
    let created = false;
    if (!existing) {
      if (mp.status === "CANCELLED") return { result: "unchanged" as const };
      const listings = await tx
        .select({ itemId: marketplaceListings.externalItemId, modelId: marketplaceListings.externalModelId, variantId: marketplaceListings.variantId })
        .from(marketplaceListings)
        .where(eq(marketplaceListings.connectionId, conn.id));
      const variantOf = new Map(listings.map((l) => [`${l.itemId}/${l.modelId}`, l.variantId]));
      const unmapped = mp.items.filter((i) => !variantOf.get(`${i.externalItemId}/${i.externalModelId}`));
      if (unmapped.length) {
        return { result: "skipped" as const, issue: { ref: mp.externalOrderNo, message: `Barang belum dipetakan: ${unmapped.map((u) => u.sku ?? u.name).join(", ")}` } };
      }
      // Gabungkan baris varian yang sama; harga dari marketplace (bisa berbeda dari harga toko).
      const lines = new Map<string, { variantId: string; qty: number; amount: number; name: string }>();
      for (const i of mp.items) {
        const variantId = variantOf.get(`${i.externalItemId}/${i.externalModelId}`)!;
        const cur = lines.get(variantId) ?? { variantId, qty: 0, amount: 0, name: i.name };
        cur.qty += i.qty;
        cur.amount += i.unitPrice * i.qty;
        lines.set(variantId, cur);
      }
      const variants = await tx
        .select({ id: productVariants.id, sku: productVariants.sku, title: productVariants.title, productName: products.name })
        .from(productVariants)
        .innerJoin(products, eq(products.id, productVariants.productId))
        .where(inArray(productVariants.id, [...lines.keys()]));
      const [branch] = await tx.select().from(branches).where(eq(branches.id, conn.branchId));
      const s = branch.settings ?? {};
      const tax: TaxSnapshot = { enabled: !!s.taxEnabled, rateBps: s.taxRateBps ?? 0, inclusive: true }; // harga marketplace sudah termasuk pajak
      const priced = [...lines.values()].map((l) => ({ ...l, unitPrice: Math.round(l.amount / l.qty) }));
      const totals = computeTotals(priced.map((l) => ({ unitPrice: l.unitPrice, qty: l.qty })), tax);
      try {
        await reserveStock(tx, priced.map((l) => ({ branchId: conn.branchId, variantId: l.variantId, qty: l.qty })));
      } catch (error) {
        if (error instanceof ApiError && error.code === "INSUFFICIENT_STOCK") {
          return { result: "skipped" as const, issue: { ref: mp.externalOrderNo, message: `Stok tersedia di ${branch.name} tidak cukup. Sesuaikan stok lalu sinkron ulang.` } };
        }
        throw error;
      }
      const number = await nextDocNumber(tx, "ORD", branch);
      const [order] = await tx
        .insert(onlineOrders)
        .values({
          number,
          branchId: conn.branchId,
          channel: conn.channel,
          externalOrderNo: mp.externalOrderNo,
          connectionId: conn.id,
          recipientName: mp.recipientName,
          recipientPhone: mp.recipientPhone,
          shippingAddress: mp.shippingAddress,
          courier: canonicalCourier(mp.courier),
          trackingNo: mp.trackingNo,
          subtotal: totals.subtotal,
          taxTotal: totals.taxTotal,
          total: totals.total,
          taxSnapshot: tax,
          note: mp.note,
          // Marketplace yang membatalkan order belum dibayar; batas lokal hanya pengaman.
          reservedUntil: new Date(Date.now() + 30 * 86_400_000),
          createdBy: conn.createdBy,
          createdAt: mp.createdAt,
        })
        .returning({ id: onlineOrders.id });
      await tx.insert(onlineOrderItems).values(
        priced.map((l) => {
          const v = variants.find((x) => x.id === l.variantId)!;
          return { orderId: order.id, variantId: l.variantId, productName: v.productName, variantTitle: v.title, sku: v.sku, qty: l.qty, unitPrice: l.unitPrice, lineTotal: l.amount };
        }),
      );
      await writeAudit(null, { action: "import", entity: "online_order", entityId: order.id, after: { number, provider: conn.provider, externalOrderNo: mp.externalOrderNo } }, tx);
      orderId = order.id;
      status = "PENDING_PAYMENT";
      created = true;
    }

    // Ikuti status marketplace (hanya maju; batal hanya sebelum dikirim).
    const before = status!;
    const target = { UNPAID: "PENDING_PAYMENT", PAID: "PAID", SHIPPED: "SHIPPED", COMPLETED: "COMPLETED", CANCELLED: "CANCELLED" }[mp.status];
    if (target === "CANCELLED") {
      if (["PENDING_PAYMENT", "PAID", "PACKED"].includes(status!)) {
        await cancelOrderTx(tx, null, orderId!, `Dibatalkan di ${conn.name}`);
        status = "CANCELLED";
      } else if (status !== "CANCELLED") {
        return { result: "updated" as const, issue: { ref: mp.externalOrderNo, message: "Dibatalkan di marketplace setelah dikirim — proses retur secara manual." } };
      }
    } else if (status !== "CANCELLED" && RANK[target] > RANK[status!]) {
      if (status === "PENDING_PAYMENT") {
        const [o] = await tx.select({ total: onlineOrders.total }).from(onlineOrders).where(eq(onlineOrders.id, orderId!));
        await confirmOrderPayment(tx, orderId!, { method: "MARKETPLACE", reference: `${conn.name} ${mp.externalOrderNo}`, amount: o.total });
        status = "PAID";
      }
      if (RANK[target] >= RANK.SHIPPED && RANK[status!] < RANK.SHIPPED) {
        await advanceOrderTx(tx, null, orderId!, "ship", { courier: mp.courier, trackingNo: mp.trackingNo });
        status = "SHIPPED";
      }
      if (target === "COMPLETED" && status === "SHIPPED") {
        await advanceOrderTx(tx, null, orderId!, "complete");
        status = "COMPLETED";
      }
    } else if (mp.trackingNo && mp.trackingNo !== existing?.trackingNo) {
      await tx.update(onlineOrders).set({ trackingNo: mp.trackingNo, courier: mp.courier, updatedAt: new Date() }).where(eq(onlineOrders.id, orderId!));
      return { result: "updated" as const };
    }
    return { result: created ? ("created" as const) : before !== status ? ("updated" as const) : ("unchanged" as const) };
  });
}

async function importOrders(conn: Connection, adapter: MarketplaceAdapter, ctx: AdapterContext, orderNos: string[]) {
  const stats = { fetched: 0, created: 0, updated: 0, unchanged: 0, skipped: 0 };
  const issues: Issue[] = [];
  const retry: string[] = [];
  const orders = await adapter.getOrders(ctx, orderNos);
  stats.fetched = orders.length;
  for (const mp of orders) {
    try {
      const r = await upsertOrder(conn, mp);
      stats[r.result]++;
      if (r.issue) issues.push(r.issue);
      if (r.result === "skipped") retry.push(mp.externalOrderNo);
    } catch (error) {
      stats.skipped++;
      retry.push(mp.externalOrderNo);
      issues.push({ ref: mp.externalOrderNo, message: (error as Error).message });
    }
  }
  return { stats, issues, retry };
}

/** Tarik order yang berubah sejak sinkron terakhir (+ jendela tumpang 10 menit) dan order yang tertunda. */
export async function pullOrders(connId: string) {
  const { conn, adapter } = await loadConnection(connId);
  return withLog(connId, "ORDERS", async () => {
    const ctx = await context(conn, adapter);
    const to = new Date();
    const from = new Date((conn.ordersSyncedUntil ?? new Date(Date.now() - 3 * 86_400_000)).getTime() - 10 * 60_000);
    const changed = await adapter.listUpdatedOrders(ctx, from, to);
    const orderNos = [...new Set([...changed, ...conn.retryOrderNos])];
    const { stats, issues, retry } = await importOrders(conn, adapter, ctx, orderNos);
    await db.update(marketplaceConnections).set({ ordersSyncedUntil: to, retryOrderNos: retry, updatedAt: new Date() }).where(eq(marketplaceConnections.id, connId));
    return { stats: { ...stats, retrying: retry.length }, issues };
  });
}

/** Sinkron satu koneksi: order dulu (reservasi berubah), lalu stok. */
export async function syncConnection(connId: string, kind: "all" | "orders" | "stock" | "listings" = "all") {
  const { conn } = await loadConnection(connId);
  if (conn.status === "DISCONNECTED") throw conflict("DISCONNECTED", "Koneksi sudah diputus. Hubungkan ulang.");
  const result: Record<string, unknown> = {};
  if (kind === "listings") result.listings = (await syncListings(connId)).stats;
  if ((kind === "all" && conn.pullOrders) || kind === "orders") result.orders = (await pullOrders(connId)).stats;
  if ((kind === "all" && conn.pushStock) || kind === "stock") result.stock = (await pushStock(connId, { force: kind === "stock" })).stats;
  return result;
}

/** Cron: semua koneksi aktif. Error satu toko tidak menghentikan toko lain. */
export async function syncAll() {
  const conns = await db.select({ id: marketplaceConnections.id, name: marketplaceConnections.name }).from(marketplaceConnections).where(eq(marketplaceConnections.status, "ACTIVE"));
  const results = [];
  for (const c of conns) {
    try {
      results.push({ id: c.id, name: c.name, ok: true, result: await syncConnection(c.id) });
    } catch (error) {
      results.push({ id: c.id, name: c.name, ok: false, error: (error as Error).message });
    }
  }
  return results;
}

// ── Webhook ─────────────────────────────────────────────────────────────

/** Push dari marketplace: verifikasi signature, tarik order yang disebut, lalu perbarui stok toko itu. */
export async function handleMarketplaceWebhook(provider: string, rawBody: string, headers: Headers, url: string) {
  const adapter = getAdapter(provider);
  if (!adapter) throw new ApiError(404, "PROVIDER_INACTIVE", "Marketplace ini tidak aktif.");
  const event = adapter.parseWebhook(rawBody, headers, url);
  if (!event) return { outcome: "IGNORED" };
  const [conn] = await db
    .select()
    .from(marketplaceConnections)
    .where(and(eq(marketplaceConnections.provider, provider), eq(marketplaceConnections.externalShopId, event.shopId)));
  if (!conn || conn.status !== "ACTIVE" || !conn.pullOrders) return { outcome: "NO_ACTIVE_CONNECTION" };
  const result = await withLog(conn.id, "WEBHOOK", async () => {
    const { stats, issues, retry } = await importOrders(conn, adapter, await context(conn, adapter), event.orderNos);
    if (retry.length) {
      await db
        .update(marketplaceConnections)
        .set({ retryOrderNos: sql`(select coalesce(jsonb_agg(distinct x), '[]'::jsonb) from jsonb_array_elements_text(${marketplaceConnections.retryOrderNos} || ${JSON.stringify(retry)}::jsonb) x)` })
        .where(eq(marketplaceConnections.id, conn.id));
    }
    return { stats, issues };
  });
  if (conn.pushStock) await pushStock(conn.id).catch(() => null);
  return { outcome: "PROCESSED", stats: result.stats };
}

// ── Simulator (development) ─────────────────────────────────────────────

async function sendMockWebhook(shopId: string, orderSn: string) {
  const mock = createMockAdapter();
  if (!mock) throw new ApiError(404, "SIMULATOR_DISABLED", "Simulator marketplace hanya ada di development.");
  const body = JSON.stringify({ shopId, orderSn });
  return handleMarketplaceWebhook("mock", body, new Headers({ "x-mock-signature": mock.sign(body) }), "");
}

/** Buat order baru di toko simulasi (barang acak yang terpetakan) lalu kirim webhook-nya. */
export async function createMockOrder(connId: string, input: { status?: "UNPAID" | "PAID"; qty?: number; unmapped?: boolean }) {
  const { conn } = await loadConnection(connId);
  if (conn.provider !== "mock") throw badRequest("NOT_SIMULATOR", "Hanya untuk toko simulasi.");
  const picks = await db
    .select({ itemId: marketplaceListings.externalItemId, modelId: marketplaceListings.externalModelId, sku: marketplaceListings.externalSku, name: marketplaceListings.name, price: productVariants.price })
    .from(marketplaceListings)
    .innerJoin(productVariants, eq(productVariants.id, marketplaceListings.variantId))
    .innerJoin(inventoryLevels, and(eq(inventoryLevels.variantId, productVariants.id), eq(inventoryLevels.branchId, conn.branchId)))
    .where(and(eq(marketplaceListings.connectionId, connId), sql`${inventoryLevels.onHand} - ${inventoryLevels.reserved} > 2`))
    .orderBy(sql`random()`)
    .limit(2);
  if (!picks.length) throw conflict("NO_STOCK", "Tidak ada barang terpetakan dengan stok cukup di cabang sumber.");
  const items = picks.map((p, i) => ({
    externalItemId: input.unmapped && i === 0 ? "UNKNOWN-ITEM" : p.itemId,
    externalModelId: input.unmapped && i === 0 ? "0" : p.modelId,
    sku: input.unmapped && i === 0 ? "SKU-TIDAK-ADA" : p.sku,
    name: p.name,
    qty: input.qty ?? 1,
    unitPrice: Math.round((p.price * 95) / 100), // harga marketplace sedikit berbeda
  }));
  const orderSn = `SIM${Date.now().toString(36).toUpperCase()}`;
  await db.insert(mockMarketplaceOrders).values({
    orderSn,
    shopId: conn.externalShopId,
    status: input.status ?? "PAID",
    payload: {
      externalOrderNo: orderSn,
      createdAt: new Date().toISOString(),
      recipientName: "Pembeli Simulasi",
      recipientPhone: "08xx****21",
      shippingAddress: "Jl. Simulasi No. 1, Bandung (alamat disamarkan)",
      courier: "SPX Express",
      trackingNo: null,
      note: null,
      items,
    },
  });
  return { orderSn, ...(await sendMockWebhook(conn.externalShopId, orderSn)) };
}

/** Ubah status order simulasi (mis. dikirim, selesai, batal) lalu kirim webhook. */
export async function setMockOrderStatus(connId: string, orderSn: string, status: "PAID" | "SHIPPED" | "COMPLETED" | "CANCELLED") {
  const { conn } = await loadConnection(connId);
  const [row] = await db.select().from(mockMarketplaceOrders).where(and(eq(mockMarketplaceOrders.orderSn, orderSn), eq(mockMarketplaceOrders.shopId, conn.externalShopId)));
  if (!row) throw notFound("Order simulasi");
  const payload = { ...(row.payload as Record<string, unknown>), ...(status === "SHIPPED" ? { trackingNo: `SPXID${Date.now().toString().slice(-9)}` } : {}) };
  await db.update(mockMarketplaceOrders).set({ status, payload, updatedAt: new Date() }).where(eq(mockMarketplaceOrders.orderSn, orderSn));
  return sendMockWebhook(conn.externalShopId, orderSn);
}

export async function listMockOrders(connId: string) {
  const { conn } = await loadConnection(connId);
  return db
    .select({ orderSn: mockMarketplaceOrders.orderSn, status: mockMarketplaceOrders.status, updatedAt: mockMarketplaceOrders.updatedAt })
    .from(mockMarketplaceOrders)
    .where(eq(mockMarketplaceOrders.shopId, conn.externalShopId))
    .orderBy(desc(mockMarketplaceOrders.updatedAt))
    .limit(20);
}


