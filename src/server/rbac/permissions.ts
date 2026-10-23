/**
 * Katalog permission. Sumber kebenaran untuk RBAC: DB hanya menyimpan string `resource:action`.
 * Menambah fitur baru = menambah resource/action di sini, lalu centang di UI Role.
 * Aman diimport dari client (tanpa dependensi server) untuk matriks role & menyembunyikan aksi.
 */
export const RESOURCES = {
  dashboard: { label: "Dashboard", actions: ["read"] },
  product: { label: "Produk", actions: ["read", "create", "update", "delete", "export", "view_cost"] },
  category: { label: "Kategori", actions: ["read", "create", "update", "delete"] },
  brand: { label: "Merek", actions: ["read", "create", "update", "delete"] },
  inventory: { label: "Stok", actions: ["read", "adjust", "export"] },
  stock_transfer: { label: "Transfer stok", actions: ["read", "create", "approve"] },
  stock_opname: { label: "Stok opname", actions: ["read", "create", "approve"] },
  pos: { label: "Kasir (POS)", actions: ["access", "discount_manual", "void", "refund"] },
  sale: { label: "Transaksi", actions: ["read", "export"] },
  online_order: { label: "Order online", actions: ["read", "create", "update"] },
  marketplace: { label: "Marketplace", actions: ["read", "manage"] },
  customer: { label: "Customer", actions: ["read", "create", "update", "delete", "export"] },
  voucher: { label: "Voucher", actions: ["read", "create", "update", "delete"] },
  report: { label: "Laporan", actions: ["read", "export"] },
  branch: { label: "Cabang", actions: ["read", "create", "update", "delete"] },
  user: { label: "Pengguna", actions: ["read", "create", "update", "delete"] },
  role: { label: "Role & akses", actions: ["read", "create", "update", "delete"] },
  setting: { label: "Pengaturan", actions: ["read", "update"] },
  audit_log: { label: "Audit log", actions: ["read"] },
  api_key: { label: "API key & MCP", actions: ["read", "create", "delete"] },
  api_docs: { label: "Dokumentasi API", actions: ["read"] },
} as const satisfies Record<string, { label: string; actions: readonly string[] }>;

export type Resource = keyof typeof RESOURCES;
export type Permission = {
  [R in Resource]: `${R}:${(typeof RESOURCES)[R]["actions"][number]}`;
}[Resource];

export const ACTION_LABELS: Record<string, string> = {
  read: "Lihat",
  create: "Tambah",
  update: "Ubah",
  delete: "Hapus",
  export: "Ekspor",
  approve: "Setujui",
  adjust: "Sesuaikan",
  access: "Akses",
  view_cost: "Lihat HPP",
  discount_manual: "Diskon manual",
  void: "Void",
  refund: "Retur/refund",
};

export const ALL_PERMISSIONS: Permission[] = (Object.keys(RESOURCES) as Resource[]).flatMap((resource) =>
  RESOURCES[resource].actions.map((action) => `${resource}:${action}` as Permission),
);

export function isPermission(value: string): value is Permission {
  return (ALL_PERMISSIONS as string[]).includes(value);
}

const all = (resource: Resource) => RESOURCES[resource].actions.map((a) => `${resource}:${a}` as Permission);

/** Role bawaan (seed). Owner selalu mendapat semua permission dan terkunci. */
export const DEFAULT_ROLES: { name: string; description: string; isSystem?: boolean; permissions: Permission[] }[] = [
  {
    name: "Owner",
    description: "Akses penuh ke semua fitur dan cabang. Tidak bisa dihapus.",
    isSystem: true,
    permissions: ALL_PERMISSIONS,
  },
  {
    name: "Admin",
    description: "Kelola produk, promo, customer, laporan, dan pengguna. Tanpa pengaturan pembayaran & API key.",
    permissions: [
      "dashboard:read",
      ...all("product"),
      ...all("category"),
      ...all("brand"),
      ...all("inventory"),
      ...all("stock_transfer"),
      ...all("stock_opname"),
      ...all("sale"),
      ...all("online_order"),
      ...all("customer"),
      ...all("voucher"),
      ...all("report"),
      "branch:read",
      "user:read",
      "user:create",
      "user:update",
      "role:read",
      "setting:read",
      "audit_log:read",
      "api_docs:read",
    ],
  },
  {
    name: "MD",
    description: "Merchandiser: kelola produk dan stok di semua cabang.",
    permissions: [
      "dashboard:read",
      "product:read",
      "product:create",
      "product:update",
      "product:export",
      "product:view_cost",
      ...all("category"),
      ...all("brand"),
      ...all("inventory"),
      ...all("stock_transfer"),
      ...all("stock_opname"),
      "branch:read",
    ],
  },
  {
    name: "Kepala Toko",
    description: "Operasional cabang: approve void/refund, transfer masuk, opname, laporan cabang.",
    permissions: [
      "dashboard:read",
      "product:read",
      "inventory:read",
      "inventory:adjust",
      "stock_transfer:read",
      "stock_transfer:approve",
      ...all("stock_opname"),
      ...all("pos"),
      "sale:read",
      "customer:read",
      "customer:create",
      "customer:update",
      "voucher:read",
      "report:read",
      "branch:read",
      "user:read",
    ],
  },
  {
    name: "Kasir",
    description: "Layar kasir, shift, cek stok, dan daftar member.",
    permissions: ["pos:access", "product:read", "inventory:read", "customer:read", "customer:create", "voucher:read"],
  },
  {
    name: "Online Admin",
    description: "Kelola order dari kanal online dan cek stok semua cabang.",
    permissions: ["product:read", "inventory:read", ...all("online_order"), "customer:read", "customer:create", "voucher:read"],
  },
  {
    name: "Viewer",
    description: "Hanya melihat dashboard dan laporan.",
    permissions: ["dashboard:read", "report:read", "sale:read", "branch:read"],
  },
];
