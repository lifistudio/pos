/**
 * Seed: role bawaan, tier member, akun Owner — ditambah cabang & produk contoh bila mode demo.
 * Jalankan: `pnpm db:seed` (idempoten untuk role/cabang/owner; produk contoh hanya dibuat bila katalog kosong).
 * Mode demo: SEED_DEMO=true (default di development). Produksi (NODE_ENV=production) default SEED_DEMO=false:
 * hanya role, tier, dan Owner — cabang & produk dibuat sendiri dari aplikasi.
 * Kredensial Owner diambil dari SEED_OWNER_EMAIL / SEED_OWNER_PASSWORD di .env — tidak pernah di-hardcode.
 */
import "dotenv/config";
import { count, eq, inArray } from "drizzle-orm";
import { auth } from "@/server/auth/auth";
import { db } from "@/server/db";
import { account, branches, brands, categories, inventoryLevels, membershipTiers, products, rolePermissions, roles, user, userRoleAssignments } from "@/server/db/schema";
import { DEFAULT_ROLES } from "@/server/rbac/permissions";
import { nameKey } from "@/lib/names";
import { createProduct } from "@/server/services/product.service";
import { loadAccess } from "@/server/rbac/access";
import type { Actor } from "@/server/api/context";

async function seedRoles() {
  for (const def of DEFAULT_ROLES) {
    const [existing] = await db.select().from(roles).where(eq(roles.name, def.name));
    const roleId =
      existing?.id ??
      (await db.insert(roles).values({ name: def.name, description: def.description, isSystem: def.isSystem ?? false }).returning())[0].id;
    // Owner selalu disinkronkan ke katalog terbaru; role lain hanya diisi saat pertama dibuat agar ubahan admin tidak tertimpa.
    if (!existing || def.isSystem) {
      await db.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
      await db.insert(rolePermissions).values(def.permissions.map((permission) => ({ roleId, permission })));
    }
  }
  console.log(`✓ ${DEFAULT_ROLES.length} role bawaan`);
}

async function seedBranches() {
  const data = [
    { code: "JKT", name: "Jakarta — Kemang", type: "STORE" as const, address: "Jl. Kemang Raya No. 10, Jakarta Selatan" },
    { code: "BDG", name: "Bandung — Dago", type: "STORE" as const, address: "Jl. Ir. H. Juanda No. 45, Bandung" },
    { code: "GDG", name: "Gudang Pusat", type: "WAREHOUSE" as const, address: "Kawasan Industri Pulogadung, Jakarta Timur" },
  ];
  await db.insert(branches).values(data).onConflictDoNothing({ target: branches.code });
  console.log(`✓ ${data.length} cabang`);
  return db.select().from(branches).where(inArray(branches.code, data.map((d) => d.code)));
}

async function seedOwner() {
  const email = process.env.SEED_OWNER_EMAIL?.toLowerCase();
  const password = process.env.SEED_OWNER_PASSWORD;
  if (!email || !password) throw new Error("Isi SEED_OWNER_EMAIL dan SEED_OWNER_PASSWORD di .env");
  if (!demo && password.length < 12) throw new Error("SEED_OWNER_PASSWORD minimal 12 karakter untuk produksi.");

  const [existing] = await db.select().from(user).where(eq(user.email, email));
  const userId = existing?.id ?? crypto.randomUUID();
  if (!existing) {
    const ctx = await auth.$context;
    await db.insert(user).values({ id: userId, name: "Owner", email, emailVerified: true });
    await db.insert(account).values({
      id: crypto.randomUUID(),
      accountId: userId,
      providerId: "credential",
      userId,
      password: await ctx.password.hash(password),
    });
  }
  const [owner] = await db.select().from(roles).where(eq(roles.name, "Owner"));
  await db.insert(userRoleAssignments).values({ userId, roleId: owner.id, branchId: null }).onConflictDoNothing();
  console.log(`✓ akun Owner (${email})`);
  return userId;
}

async function seedCatalog(ownerId: string, branchRows: { id: string; code: string }[]) {
  const [{ value }] = await db.select({ value: count() }).from(products);
  if (value > 0) {
    console.log("• katalog sudah berisi, contoh produk dilewati");
    return;
  }
  const [brand] = await db
    .insert(brands)
    .values({ name: "Konten", nameKey: nameKey("Konten") })
    .onConflictDoUpdate({ target: brands.nameKey, set: { updatedAt: new Date() } })
    .returning({ id: brands.id });
  const brandId = brand.id;
  const [apparel] = await db.insert(categories).values({ name: "Pakaian", slug: "pakaian" }).returning();
  const [tops] = await db.insert(categories).values({ name: "Atasan", slug: "atasan", parentId: apparel.id }).returning();
  const [outer] = await db.insert(categories).values({ name: "Outerwear", slug: "outerwear", parentId: apparel.id }).returning();
  const [acc] = await db.insert(categories).values({ name: "Aksesoris", slug: "aksesoris" }).returning();

  const actor: Actor = {
    type: "USER",
    userId: ownerId,
    user: { id: ownerId, name: "Seed", email: "" },
    access: await loadAccess(ownerId),
    ip: null,
    userAgent: "seed",
  };
  const byCode = Object.fromEntries(branchRows.map((b) => [b.code, b.id]));
  const stock = (jkt: number, bdg: number, gdg: number) => [
    { branchId: byCode.JKT, qty: jkt },
    { branchId: byCode.BDG, qty: bdg },
    { branchId: byCode.GDG, qty: gdg },
  ];

  const sizes = ["S", "M", "L", "XL"];
  const tee = [
    ["Hitam", 24, 18, 60],
    ["Putih", 20, 3, 48],
    ["Abu Misty", 6, 10, 30],
  ] as const;
  await createProduct(actor, {
    name: "Kaos Essential Cotton",
    categoryId: tops.id,
    brandId,
    status: "ACTIVE",
    weightGram: 220,
    options: [
      { name: "Warna", values: tee.map((t) => t[0]) },
      { name: "Ukuran", values: sizes },
    ],
    variants: tee.flatMap(([color, j, b, g]) =>
      sizes.map((size, i) => ({
        optionValues: [color, size],
        price: 149000,
        costPrice: 62000,
        initialStock: stock(Math.max(0, j - i * 5), Math.max(0, b - i * 4), g - i * 8),
      })),
    ),
  });

  await createProduct(actor, {
    name: "Hoodie Heavyweight",
    categoryId: outer.id,
    brandId,
    status: "ACTIVE",
    weightGram: 650,
    options: [
      { name: "Warna", values: ["Hitam", "Navy"] },
      { name: "Ukuran", values: ["M", "L", "XL"] },
    ],
    variants: ["Hitam", "Navy"].flatMap((color, c) =>
      ["M", "L", "XL"].map((size, i) => ({
        optionValues: [color, size],
        price: 389000,
        compareAtPrice: 459000,
        costPrice: 175000,
        initialStock: stock(8 - i * 3 - c, 5 - i * 2, 25 - i * 5),
      })),
    ),
  });

  await createProduct(actor, {
    name: "Topi Baseball Logo",
    categoryId: acc.id,
    brandId,
    status: "ACTIVE",
    options: [],
    variants: [{ optionValues: [], price: 99000, costPrice: 38000, initialStock: stock(15, 2, 40) }],
  });

  await createProduct(actor, {
    name: "Totebag Kanvas",
    categoryId: acc.id,
    brandId,
    status: "DRAFT",
    options: [],
    variants: [{ optionValues: [], price: 79000, costPrice: 27000, initialStock: stock(0, 0, 120) }],
  });

  // Batas minimum supaya status "menipis" terlihat di dashboard.
  await db.update(inventoryLevels).set({ reorderPoint: 5 });
  console.log("✓ kategori & 4 produk contoh dengan stok awal");
}

async function seedTiers() {
  const [{ value }] = await db.select({ value: count() }).from(membershipTiers);
  if (value > 0) return console.log("• tier member sudah ada");
  await db.insert(membershipTiers).values([
    { name: "Silver", minSpend: 0, discountBps: 0, pointsPer10k: 1 },
    { name: "Gold", minSpend: 2_000_000, discountBps: 500, pointsPer10k: 2 },
    { name: "Platinum", minSpend: 10_000_000, discountBps: 1000, pointsPer10k: 3 },
  ]);
  console.log("✓ 3 tier member (Silver, Gold, Platinum)");
}

const demo = (process.env.SEED_DEMO ?? (process.env.NODE_ENV === "production" ? "false" : "true")) === "true";

async function main() {
  console.log(demo ? "Mode demo: cabang & produk contoh ikut dibuat." : "Mode produksi: hanya role, tier member, dan akun Owner.");
  await seedRoles();
  await seedTiers();
  if (!demo) {
    await seedOwner();
    console.log("Selesai. Masuk sebagai Owner, lalu buat cabang di Pengaturan › Cabang.");
    process.exit(0);
  }
  const branchRows = await seedBranches();
  const ownerId = await seedOwner();
  await seedCatalog(ownerId, branchRows);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
