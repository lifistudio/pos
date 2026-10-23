import "server-only";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Actor } from "@/server/api/context";
import { writeAudit } from "@/server/services/audit.service";

/** Pemanggil API v1 in-process dengan kredensial yang sama dengan klien MCP. */
export type CallApi = <T>(path: string, query?: Record<string, string | number | undefined>) => Promise<T>;

type Branch = { id: string; code: string; name: string };

const text = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });
const fail = (message: string) => ({ isError: true, content: [{ type: "text" as const, text: message }] });

/**
 * MCP server read-only untuk AI agent. Setiap tool memanggil REST API v1 (bukan database langsung),
 * sehingga permission, cakupan cabang, dan filter data sensitif (HPP, dll.) identik dengan UI.
 * Daftar tool & contoh pertanyaan: docs/MCP.md.
 */
export function createMcpServer(actor: Actor, callApi: CallApi) {
  const server = new McpServer(
    { name: "konten-pos", version: "1.0.0" },
    {
      instructions:
        "Data POS multi-cabang (produk, varian, stok per cabang, kartu stok). Semua uang dalam Rupiah (integer). " +
        "Gunakan list_branches untuk mengetahui kode cabang. Tool hanya membaca data; tidak ada perubahan yang dilakukan.",
    },
  );

  let branchCache: Branch[] | null = null;
  async function resolveBranch(code?: string) {
    if (!code) return undefined;
    branchCache ??= (await callApi<{ data: Branch[] }>("/branches")).data;
    const hit = branchCache.find((b) => b.code.toLowerCase() === code.toLowerCase() || b.name.toLowerCase().includes(code.toLowerCase()));
    if (!hit) throw new Error(`Cabang "${code}" tidak ditemukan atau tidak bisa diakses. Cabang tersedia: ${branchCache.map((b) => b.code).join(", ")}`);
    return hit.id;
  }

  /** Bungkus handler: audit setiap pemanggilan & ubah error API jadi pesan yang bisa dibaca agent. */
  function tool<S extends z.ZodRawShape>(
    name: string,
    config: { title: string; description: string; inputSchema: S },
    run: (args: z.infer<z.ZodObject<S>>) => Promise<unknown>,
  ) {
    server.registerTool(name, { ...config, annotations: { readOnlyHint: true, openWorldHint: false } }, (async (args: z.infer<z.ZodObject<S>>) => {
      void writeAudit(actor, { action: "mcp_tool", entity: "mcp", entityId: name, after: args }).catch(() => {});
      try {
        return text(await run(args));
      } catch (error) {
        return fail(error instanceof Error ? error.message : "Gagal memproses permintaan.");
      }
    }) as never);
  }

  tool(
    "list_branches",
    { title: "Daftar cabang", description: "Cabang yang bisa diakses pemilik API key, beserta kode dan tipenya (toko/gudang/online).", inputSchema: {} },
    async () => (await callApi<{ data: Branch[] }>("/branches")).data,
  );

  tool(
    "check_stock",
    {
      title: "Cek stok",
      description: "Cek stok per varian per cabang berdasarkan nama produk, SKU, atau barcode. Contoh: 'stok kaos hitam L di Bandung'.",
      inputSchema: {
        query: z.string().min(1).describe("Nama produk, SKU, atau barcode"),
        branch: z.string().optional().describe("Kode atau nama cabang, misal BDG. Kosongkan untuk semua cabang."),
      },
    },
    async ({ query, branch }) =>
      callApi("/inventory", { q: query, branchId: await resolveBranch(branch), pageSize: 50 }),
  );

  tool(
    "low_stock_report",
    {
      title: "Laporan stok menipis & habis",
      description: "Varian yang stoknya habis atau di bawah batas minimum, per cabang.",
      inputSchema: { branch: z.string().optional().describe("Kode atau nama cabang") },
    },
    async ({ branch }) => {
      const branchId = await resolveBranch(branch);
      const [low, out] = await Promise.all([
        callApi<{ data: unknown[]; meta: { total: number } }>("/inventory", { status: "low", branchId, pageSize: 100 }),
        callApi<{ data: unknown[]; meta: { total: number } }>("/inventory", { status: "out", branchId, pageSize: 100 }),
      ]);
      return { menipis: { total: low.meta.total, items: low.data }, habis: { total: out.meta.total, items: out.data } };
    },
  );

  tool(
    "inventory_summary",
    {
      title: "Ringkasan stok",
      description: "KPI stok: produk aktif, total unit, nilai stok, jumlah menipis/habis, stok per cabang, dan tren masuk/keluar 14 hari.",
      inputSchema: { branch: z.string().optional().describe("Kode atau nama cabang") },
    },
    async ({ branch }) => (await callApi<{ data: unknown }>("/dashboard/inventory-summary", { branchId: await resolveBranch(branch) })).data,
  );

  tool(
    "search_products",
    {
      title: "Cari produk",
      description: "Cari produk berdasarkan nama/SKU/barcode; mengembalikan harga, jumlah varian, status, dan total stok.",
      inputSchema: {
        query: z.string().optional(),
        status: z.enum(["ACTIVE", "DRAFT", "ARCHIVED"]).optional(),
        page: z.number().int().min(1).optional(),
      },
    },
    async ({ query, status, page }) => callApi("/products", { q: query, status, page, pageSize: 25 }),
  );

  tool(
    "get_product",
    {
      title: "Detail produk",
      description: "Detail satu produk: variasi, setiap varian (SKU, barcode, harga), dan stok per cabang.",
      inputSchema: { productId: z.string().uuid() },
    },
    async ({ productId }) => (await callApi<{ data: unknown }>(`/products/${productId}`)).data,
  );

  tool(
    "stock_movements",
    {
      title: "Kartu stok",
      description: "Riwayat pergerakan stok terbaru (penerimaan, penjualan, penyesuaian, transfer) untuk menjelaskan kenapa stok berubah.",
      inputSchema: {
        sku: z.string().optional().describe("SKU atau barcode varian"),
        branch: z.string().optional().describe("Kode atau nama cabang"),
        limit: z.number().int().min(1).max(100).optional(),
      },
    },
    async ({ sku, branch, limit }) => {
      let variantId: string | undefined;
      if (sku) {
        const { data } = await callApi<{ data: { id: string; sku: string; barcode: string | null }[] }>("/variants/search", { q: sku, limit: 5 });
        const exact = data.find((v) => v.sku.toLowerCase() === sku.toLowerCase() || v.barcode === sku) ?? data[0];
        if (!exact) throw new Error(`Varian dengan SKU/barcode "${sku}" tidak ditemukan.`);
        variantId = exact.id;
      }
      return callApi("/inventory/movements", { variantId, branchId: await resolveBranch(branch), limit: limit ?? 30 });
    },
  );

  tool(
    "sales_summary",
    {
      title: "Ringkasan penjualan",
      description:
        "Omzet bersih (dikurangi retur) & jumlah transaksi hari ini vs kemarin, total N hari terakhir, tren harian, produk terlaris (qty, omzet, laba bila boleh), dan porsi metode bayar. Contoh: 'omzet minggu ini per cabang', 'produk terlaris 30 hari'.",
      inputSchema: {
        days: z.number().int().min(1).max(90).optional().describe("Jumlah hari ke belakang, default 7"),
        branch: z.string().optional().describe("Kode atau nama cabang"),
      },
    },
    async ({ days, branch }) =>
      (await callApi<{ data: unknown }>("/dashboard/sales-summary", { days: days ?? 7, branchId: await resolveBranch(branch) })).data,
  );

  tool(
    "list_sales",
    {
      title: "Daftar transaksi",
      description: "Transaksi terbaru (nomor, waktu, cabang, kasir, metode bayar, total, status). Bisa difilter status & rentang tanggal ISO.",
      inputSchema: {
        branch: z.string().optional(),
        status: z.enum(["PENDING", "PAID", "VOIDED"]).optional(),
        from: z.string().datetime().optional().describe("ISO datetime, misal 2026-10-01T00:00:00+07:00"),
        to: z.string().datetime().optional(),
        page: z.number().int().min(1).optional(),
      },
    },
    async ({ branch, status, from, to, page }) =>
      callApi("/sales", { branchId: await resolveBranch(branch), status, from, to, page, pageSize: 50 }),
  );

  tool(
    "voucher_performance",
    {
      title: "Performa voucher",
      description:
        "Pemakaian voucher N hari terakhir per voucher: jumlah dipakai, customer unik, total potongan, omzet, rata-rata transaksi, sisa kuota; plus tren harian. Contoh: 'performa voucher 1 minggu terakhir'.",
      inputSchema: {
        days: z.number().int().min(1).max(365).optional().describe("Default 7"),
        code: z.string().optional().describe("Kode voucher tertentu (opsional)"),
      },
    },
    async ({ days, code }) => {
      let voucherId: string | undefined;
      if (code) {
        const { data } = await callApi<{ data: { id: string; code: string }[] }>("/vouchers", { q: code, pageSize: 5 });
        const hit = data.find((v) => v.code.toUpperCase() === code.toUpperCase());
        if (!hit) throw new Error(`Voucher "${code}" tidak ditemukan.`);
        voucherId = hit.id;
      }
      return (await callApi<{ data: unknown }>("/vouchers/performance", { days: days ?? 7, voucherId })).data;
    },
  );

  tool(
    "list_vouchers",
    {
      title: "Daftar voucher",
      description: "Voucher beserta status (aktif/terjadwal/dijeda/kuota habis/berakhir), nilai, kuota, total potongan & omzet sepanjang waktu.",
      inputSchema: { state: z.enum(["ACTIVE", "SCHEDULED", "PAUSED", "EXHAUSTED", "EXPIRED"]).optional() },
    },
    async ({ state }) => callApi("/vouchers", { state, pageSize: 50 }),
  );

  tool(
    "sales_report",
    {
      title: "Laporan penjualan",
      description:
        "Penjualan bersih (setelah retur) N hari terakhir per hari/cabang/kasir/kanal/kategori/produk/metode bayar: transaksi, unit, diskon, penjualan, retur, bersih, laba kotor (bila boleh lihat HPP). Contoh: 'kasir mana yang paling banyak menjual bulan ini?', 'kategori terlaris 30 hari'.",
      inputSchema: {
        groupBy: z.enum(["day", "branch", "cashier", "channel", "category", "product", "payment"]),
        days: z.number().int().min(1).max(366).optional().describe("Default 30"),
        branch: z.string().optional().describe("Kode cabang"),
      },
    },
    async ({ groupBy, days, branch }) => {
      const to = new Date(Date.now() + 60_000);
      const from = new Date(to.getTime() - (days ?? 30) * 86_400_000);
      return (await callApi<{ data: unknown }>("/reports/sales", { groupBy, from: from.toISOString(), to: to.toISOString(), branchId: await resolveBranch(branch) })).data;
    },
  );

  tool(
    "returns_report",
    {
      title: "Laporan retur",
      description: "Retur N hari terakhir per alasan/produk/pemroses/cabang: jumlah retur, unit, unit rusak, uang dikembalikan. Contoh: 'alasan retur terbanyak bulan ini'.",
      inputSchema: {
        groupBy: z.enum(["reason", "product", "cashier", "branch"]),
        days: z.number().int().min(1).max(366).optional().describe("Default 30"),
        branch: z.string().optional(),
      },
    },
    async ({ groupBy, days, branch }) => {
      const to = new Date(Date.now() + 60_000);
      const from = new Date(to.getTime() - (days ?? 30) * 86_400_000);
      return (await callApi<{ data: unknown }>("/reports/returns", { groupBy, from: from.toISOString(), to: to.toISOString(), branchId: await resolveBranch(branch) })).data;
    },
  );

  tool(
    "stock_report",
    {
      title: "Laporan stok",
      description:
        "Laporan persediaan. view=valuation: nilai stok saat ini per cabang/kategori/produk (unit, nilai jual, nilai modal bila boleh lihat HPP). " +
        "view=aging: umur stok per kelompok 0–30/31–60/61–90/>90 hari + barang lambat laku. " +
        "view=movements: mutasi N hari terakhir per jenis, atau saldo awal–masuk–keluar–terjual–saldo akhir per produk/kategori/cabang. " +
        "Contoh: 'berapa nilai stok cabang Bandung?', 'barang apa yang sudah 90 hari tidak laku?', 'produk dengan perputaran tertinggi bulan ini'.",
      inputSchema: {
        view: z.enum(["valuation", "aging", "movements"]),
        groupBy: z.enum(["branch", "category", "product", "type"]).optional().describe("valuation: branch|category|product (default branch). movements: type|product|category|branch (default type)."),
        days: z.number().int().min(1).max(366).optional().describe("Untuk movements, default 30"),
        branch: z.string().optional().describe("Kode cabang"),
      },
    },
    async ({ view, groupBy, days, branch }) => {
      const branchId = await resolveBranch(branch);
      if (view === "aging") return (await callApi<{ data: unknown }>("/reports/stock-aging", { branchId })).data;
      if (view === "valuation") {
        if (groupBy === "type") throw new Error("groupBy 'type' hanya untuk view=movements.");
        return (await callApi<{ data: unknown }>("/reports/stock-valuation", { groupBy: groupBy ?? "branch", branchId })).data;
      }
      const to = new Date(Date.now() + 60_000);
      const from = new Date(to.getTime() - (days ?? 30) * 86_400_000);
      return (await callApi<{ data: unknown }>("/reports/stock-movements", { groupBy: groupBy ?? "type", from: from.toISOString(), to: to.toISOString(), branchId })).data;
    },
  );

  tool(
    "shift_report",
    {
      title: "Laporan shift & selisih kas",
      description:
        "Shift kasir N hari terakhir: kas awal, tunai masuk, refund tunai, kas seharusnya, kas dihitung, selisih (negatif = kurang), transaksi, omzet, void, retur. " +
        "groupBy=cashier meringkas per kasir (total selisih, jumlah shift kurang). Contoh: 'kasir mana yang paling sering kurang kas bulan ini?', 'selisih kas shift kemarin'.",
      inputSchema: {
        groupBy: z.enum(["shift", "cashier"]),
        days: z.number().int().min(1).max(366).optional().describe("Default 30"),
        branch: z.string().optional(),
      },
    },
    async ({ groupBy, days, branch }) => {
      const to = new Date(Date.now() + 60_000);
      const from = new Date(to.getTime() - (days ?? 30) * 86_400_000);
      return (await callApi<{ data: unknown }>("/reports/shifts", { groupBy, from: from.toISOString(), to: to.toISOString(), branchId: await resolveBranch(branch) })).data;
    },
  );

  tool(
    "marketplace_status",
    {
      title: "Status marketplace",
      description:
        "Toko marketplace yang terhubung: status, sumber stok, sinkron terakhir, error, produk belum dipetakan, order tertunda. Contoh: 'apakah sinkron Shopee lancar?'.",
      inputSchema: {},
    },
    async () => {
      const { data } = await callApi<{ data: { id: string }[] }>("/marketplace/connections");
      const details = await Promise.all(data.map((c) => callApi<{ data: Record<string, unknown> }>(`/marketplace/connections/${c.id}`).then((r) => r.data)));
      return details.map((d) => ({ ...d, logs: (d.logs as unknown[]).slice(0, 5) }));
    },
  );

  tool(
    "list_online_orders",
    {
      title: "Order online",
      description:
        "Order dari kanal online (website, WhatsApp, Instagram, marketplace): status (menunggu bayar/dibayar/dikemas/dikirim/selesai/batal), penerima, sumber stok, total, kurir & resi, plus jumlah per status. Isi number untuk rincian barang & pembayaran. Contoh: 'berapa order yang belum dikirim?'.",
      inputSchema: {
        branch: z.string().optional().describe("Kode cabang sumber stok"),
        status: z.enum(["PENDING_PAYMENT", "PAID", "PACKED", "SHIPPED", "COMPLETED", "CANCELLED"]).optional(),
        channel: z.enum(["WEBSITE", "WHATSAPP", "INSTAGRAM", "SHOPEE", "TOKOPEDIA", "TIKTOK", "LAZADA", "OTHER"]).optional(),
        number: z.string().optional().describe("Nomor order (ORD/...) untuk rincian"),
      },
    },
    async ({ branch, status, channel, number }) => {
      const list = await callApi<{ data: { id: string; number: string }[] }>("/online-orders", { branchId: await resolveBranch(branch), status, channel, q: number, pageSize: 50 });
      if (!number) return list;
      const hit = list.data.find((o) => o.number.toUpperCase() === number.toUpperCase());
      if (!hit) throw new Error(`Order "${number}" tidak ditemukan.`);
      // Data penerima (HP, alamat) tidak dikirim utuh ke AI (UU PDP).
      const { data } = await callApi<{ data: Record<string, unknown> & { recipientPhone: string } }>(`/online-orders/${hit.id}`);
      return { ...data, recipientPhone: `${data.recipientPhone.slice(0, 4)}****${data.recipientPhone.slice(-3)}`, shippingAddress: "(disembunyikan)", payment: data.payment ? { ...(data.payment as object), qrString: undefined } : null };
    },
  );

  tool(
    "list_returns",
    {
      title: "Retur penjualan",
      description:
        "Retur dari pelanggan: nomor retur & struk asal, cabang, pemroses, alasan, jumlah barang (termasuk yang rusak), nominal & metode refund. Contoh: 'retur minggu ini apa saja dan alasannya?'.",
      inputSchema: {
        branch: z.string().optional().describe("Kode cabang"),
        days: z.number().int().min(1).max(365).optional().describe("N hari terakhir (default 30)"),
        query: z.string().optional().describe("Nomor retur atau nomor struk"),
      },
    },
    async ({ branch, days, query }) => {
      const from = new Date(Date.now() - (days ?? 30) * 86_400_000).toISOString();
      return callApi("/sale-returns", { branchId: await resolveBranch(branch), from, q: query, pageSize: 50 });
    },
  );

  tool(
    "list_transfers",
    {
      title: "Transfer stok antar cabang",
      description:
        "Daftar transfer stok (nomor, cabang asal → tujuan, status DRAFT/IN_TRANSIT/RECEIVED/CANCELLED, jumlah SKU & unit dikirim/diterima). Contoh: 'barang apa yang masih di perjalanan ke Bandung?'. Pakai number dari hasil untuk detail.",
      inputSchema: {
        branch: z.string().optional().describe("Kode cabang"),
        direction: z.enum(["in", "out"]).optional().describe("in = masuk ke cabang, out = keluar dari cabang (butuh branch)"),
        status: z.enum(["DRAFT", "IN_TRANSIT", "RECEIVED", "CANCELLED"]).optional(),
        number: z.string().optional().describe("Nomor transfer (TRF/...) untuk melihat rincian barang"),
      },
    },
    async ({ branch, direction, status, number }) => {
      const list = await callApi<{ data: { id: string; number: string }[] }>("/stock-transfers", {
        branchId: await resolveBranch(branch),
        direction: branch ? direction : undefined,
        status,
        pageSize: 50,
      });
      if (!number) return list;
      const hit = list.data.find((t) => t.number.toUpperCase() === number.toUpperCase());
      if (!hit) throw new Error(`Transfer "${number}" tidak ditemukan pada filter ini.`);
      return (await callApi<{ data: unknown }>(`/stock-transfers/${hit.id}`)).data;
    },
  );

  tool(
    "list_opnames",
    {
      title: "Stok opname",
      description:
        "Riwayat stok opname per cabang (status COUNTING/POSTED/CANCELLED, SKU dihitung, total lebih/kurang). Isi number untuk rincian selisih per barang. Contoh: 'hasil opname terakhir di Jakarta'.",
      inputSchema: {
        branch: z.string().optional().describe("Kode cabang"),
        status: z.enum(["COUNTING", "POSTED", "CANCELLED"]).optional(),
        number: z.string().optional().describe("Nomor opname (OPN/...) untuk rincian selisih"),
      },
    },
    async ({ branch, status, number }) => {
      const list = await callApi<{ data: { id: string; number: string }[] }>("/stock-opnames", { branchId: await resolveBranch(branch), status, pageSize: 50 });
      if (!number) return list;
      const hit = list.data.find((o) => o.number.toUpperCase() === number.toUpperCase());
      if (!hit) throw new Error(`Opname "${number}" tidak ditemukan pada filter ini.`);
      return (await callApi<{ data: unknown }>(`/stock-opnames/${hit.id}`)).data;
    },
  );

  tool(
    "customer_lookup",
    {
      title: "Cari customer",
      description: "Cari customer/member (nama, no. HP, no. member): tier, poin, total belanja, jumlah kunjungan. Nomor HP & email dimasking untuk privasi.",
      inputSchema: { query: z.string().min(2) },
    },
    async ({ query }) => {
      const res = await callApi<{ data: { phone: string; email: string | null }[] }>("/customers", { q: query, pageSize: 10 });
      // Data pribadi tidak dikirim utuh ke AI (UU PDP): mask nomor HP & sembunyikan email.
      return res.data.map((c) => ({ ...c, phone: c.phone.length > 8 ? `${c.phone.slice(0, 5)}****${c.phone.slice(-4)}` : "****", email: c.email ? "(disembunyikan)" : null }));
    },
  );

  return server;
}
