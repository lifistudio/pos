# Rancangan Database (PostgreSQL)

> Status: **v0.2**. Source of truth: `src/server/db/schema/*.ts` (Drizzle) + migrasi di `src/server/db/migrations`. Perbarui dokumen ini bila schema berubah.
>
> **Sudah dibuat (migrasi 0000–0001):** `user`, `session`, `account`, `verification` (Better Auth; PK `text`), `branches`, `roles`, `role_permissions` (string `resource:action`, katalog di kode), `user_role_assignments`, `api_keys`, `audit_logs`, `categories`, `products`, `product_options`, `product_option_values`, `product_variants` (kolom `title` = label gabungan nilai opsi), `variant_option_values`, `inventory_levels` (CHECK `on_hand >= 0`, `0 <= reserved <= on_hand`), `stock_movements`. Ekstensi `pg_trgm`.
> Perbedaan dari rencana di bawah: tabel `permissions` tidak dibuat (katalog permission di kode); `product_images`, harga per cabang, dan bundle belum dibuat.
> **Migrasi 0002_sales:** `shifts` (unique parsial: satu OPEN per user+cabang), `sales` (`number` & `idempotency_key` unik, `tax_snapshot` jsonb, status PAID/VOIDED, `channel` default POS), `sale_items` (snapshot nama/SKU/harga/HPP, CHECK qty > 0), `sale_payments` (enum metode, `tendered`, `change`, `reference`), `number_sequences` (penomoran atomik via UPSERT). Belum: `registers`, `sale_returns`, `online_order_details`, `payment_events`.
> **Migrasi 0003_crm_vouchers:** `membership_tiers`, `customers` (HP unik, `member_no` unik, CHECK poin ≥ 0, trigram nama), `point_ledger`, `vouchers` (kode unik huruf besar, CHECK nilai & kuota), `voucher_targets` (unik per voucher+tipe+target+exclusion), `voucher_usages` (unik per sale). `sales` + kolom customer/diskon/voucher/poin.
> **Belum dibuat:** transfer/opname, supplier/PO, settings, notifications, jobs, `customer_addresses`, `voucher_codes` (kode massal).

Konvensi: PK `uuid` (v7, urut waktu), kolom `snake_case`, `created_at`/`updated_at` `timestamptz` (UTC), soft delete via `archived_at` untuk master data. Uang `bigint` (rupiah). Persen `integer` basis poin.

## Identitas & Akses
- `users` — nama, email, phone, status, pin_hash, two_factor_enabled (+ tabel bawaan Better Auth: `sessions`, `accounts`, `verifications`, `two_factors`, `api_keys`)
- `roles` — name, description, is_system (Owner terkunci)
- `permissions` — resource, action (seed dari kode)
- `role_permissions` — role_id, permission_id
- `user_role_assignments` — user_id, role_id, branch_id (NULL = semua cabang)
- `audit_logs` — actor_id, actor_type (user/api_key/system), action, entity, entity_id, before (jsonb), after (jsonb), ip, user_agent, created_at — partisi per bulan bila besar

## Cabang
- `branches` — code, name, type (STORE/WAREHOUSE/ONLINE), address, phone, timezone, tax_settings (jsonb), receipt_settings (jsonb), is_active
- `registers` — branch_id, name (perangkat kasir)
- `sales_channels` — code (POS, WEBSITE, SHOPEE, ...), name

## Produk
- `categories` — parent_id, name, slug, sort_order (maks 3 level)
- ✅ `brands` (0014) — name, name_key (unik, nama dinormalisasi), trigram index pada name
- `products` — name, slug, description, category_id, **brand_id → brands** (0014; kolom teks `brand` dihapus di 0015), status, tax_class, weight_gram, has_variants
- ✅ `product_images` (migrasi 0012/0013) — product_id PK (satu thumbnail per produk), provider (`cloudinary`/`database`), external_id (public_id Cloudinary), data bytea (hanya provider database), mime, width, height, bytes, hash (versi). `products.image_url` = URL siap tampil
- `product_options` — product_id, name (Warna), position
- `product_option_values` — option_id, value (Hitam), position
- `product_variants` — product_id, sku (unique + unique `upper(sku)`), barcode (unique; juga tidak boleh sama dengan SKU varian lain — dicek service), price, compare_at_price, cost_price, weight_gram, is_active
- `variant_option_values` — variant_id, option_value_id
- `branch_variant_prices` — branch_id, variant_id, price (override, P1)
- `product_bundles` — bundle_variant_id, component_variant_id, qty (P1)

## Stok
- `inventory_levels` — branch_id, variant_id, on_hand, reserved, reorder_point — **unique(branch_id, variant_id)**, `CHECK` sesuai setting oversell
- `stock_movements` — branch_id, variant_id, qty_change (+/-), type (RECEIPT, SALE, RETURN, TRANSFER_OUT, TRANSFER_IN, ADJUSTMENT, OPNAME, RESERVE, RELEASE), reference_type, reference_id, unit_cost, balance_after, reason, actor_id, created_at — ledger append-only
- ✅ `stock_transfers` (migrasi 0004) — number unik, from_branch_id ≠ to_branch_id, status DRAFT/IN_TRANSIT/RECEIVED/CANCELLED, note, receive_note, created/sent/received/cancelled _by + _at
- ✅ `stock_transfer_items` — PK (transfer_id, variant_id), qty_sent > 0, qty_received NULL atau 0..qty_sent
- ✅ `stock_opnames` — number unik, branch_id, mode PARTIAL/FULL, status COUNTING/POSTED/CANCELLED, note, created_by, posted_by, posted_at — unique index parsial `stock_opnames_one_counting_per_branch` (satu COUNTING per cabang)
- ✅ `stock_opname_items` — PK (opname_id, variant_id), counted_qty ≥ 0, system_qty & difference (diisi saat posting), counted_by, updated_at
- `stock_adjustments` (+ items) — reason
- `suppliers`, `purchase_orders` (+ items), `goods_receipts` (+ items) — P1

## Penjualan
- `shifts` — register_id, user_id, opened_at, closed_at, opening_cash, counted_cash, expected_cash
- `sales` — number, branch_id, channel_id, register_id?, shift_id?, customer_id?, cashier_id, status (DRAFT, PENDING_PAYMENT, PAID, VOIDED, REFUNDED, PARTIALLY_REFUNDED), subtotal, discount_total, tax_total, total, idempotency_key (unique), external_order_no
- `sale_items` — sale_id, variant_id, name_snapshot, sku_snapshot, qty, unit_price, cost_price_snapshot, discount_allocated, tax_amount, line_total
- `sale_payments` — sale_id, method, provider, amount, status, provider_ref, paid_at
- ✅ `sales` tambahan (migrasi 0005): points_redeemed, points_discount, refund_total (CHECK 0..total); `sale_items.returned_qty` (CHECK 0..qty)
- ✅ `sale_returns` — number unik, sale_id, branch_id, shift_id (refund tunai), created_by, refund_method, refund_amount, points_reversed, points_restored, reason, reference
- ✅ `sales` tambahan (0008): manual_discount, manual_discount_reason, manual_discount_approved_by, void_approved_by; `sale_returns`: reason_code (enum `return_reason`), approved_by
- ✅ `sale_return_items` — return_id, sale_item_id, variant_id, qty > 0, amount, restock (layak jual → stok kembali)
- ✅ `online_orders` (migrasi 0006) — number unik, branch_id (sumber stok), channel, external_order_no (unik per kanal), status, customer_id?, recipient_name/phone, shipping_address, courier, tracking_no, shipping_fee, subtotal, tax_total, total, tax_snapshot, reserved_until (batas bayar), sale_id (unik, diisi saat lunas), *_at per tahap, cancel_reason
- ✅ `online_order_items` — PK (order_id, variant_id), snapshot nama/SKU, qty, unit_price, line_total
- ✅ `payment_intents` — provider + gateway_order_id unik, reference_type/id, method, amount, status (PENDING/PAID/EXPIRED/FAILED/CANCELLED), provider_ref, qr_string, expires_at, paid_at
- ✅ `payment_events` — provider + event_key unik (idempotensi webhook), intent_id, payload jsonb, outcome
- ✅ `sales.shipping_fee` — ongkir order online (tidak ikut dasar PPN & retur)
- ✅ `sales.status` + `PENDING` (migrasi 0007) — transaksi kasir menunggu QRIS dinamis; stok/voucher/poin tukar sudah dikunci, belum ada baris `sale_payments`. `payment_intents.reference_type` = `online_order` atau `pos_sale`.
- Reservasi: `inventory_levels.reserved` naik saat order dibuat, turun saat batal/kedaluwarsa/dikirim (tidak masuk ledger; on_hand baru turun saat dikirim)

## Customer & Member
- `customers` — phone (unique), name, email, birth_date, member_no (unique), tier_id, consent_at, anonymized_at
- `customer_addresses`
- `membership_tiers` — name, min_spend, period_months, discount_bps, point_multiplier
- `point_ledger` — customer_id, change, type (EARN, REDEEM, EXPIRE, ADJUST), sale_id?, expires_at, balance_after

## Voucher
- `vouchers` — code (unique, citext), name, value_type (NOMINAL/PERCENT), value, max_discount, min_spend, max_spend, starts_at, ends_at, quota_total, quota_used, quota_per_customer, member_only, stackable, status
- `voucher_targets` — voucher_id, target_type (CATEGORY, PRODUCT, VARIANT, CUSTOMER, TIER, BRANCH, CHANNEL), target_id, is_exclusion
- `voucher_codes` — voucher_id, code, used_at (untuk kode unik massal)
- `voucher_usages` — voucher_id, sale_id, customer_id, discount_amount, status (APPLIED/REVERSED)

## Lainnya
- ✅ `marketplace_connections` (migrasi 0009/0010) — provider, channel, external_shop_id (unik per provider), branch_id (sumber stok), status, pull_orders, push_stock, stock_buffer, credentials_enc (AES-256-GCM), token_expires_at, orders_synced_until, retry_order_nos jsonb, last_sync_at, last_error
- ✅ `marketplace_listings` — connection_id + external_item_id + external_model_id unik, external_sku, name, variant_id (pemetaan), manual_mapping, marketplace_stock, last_pushed_qty/at
- ✅ `marketplace_sync_logs` — kind (ORDERS/STOCK/LISTINGS/WEBHOOK), status (OK/PARTIAL/FAILED), stats jsonb, issues jsonb, error
- ✅ `mock_marketplace_orders` — toko simulasi (dev)
- ✅ `online_orders.connection_id` — order dari marketplace (null = input manual)
- ✅ `sales` tambahan (0011): offline_ref, synced_at, offline_shortfall jsonb — transaksi dari mode offline kasir
- ✅ `approval_pins` (migrasi 0008) — user_id PK, pin_hash (scrypt), salt, updated_at
- ✅ `approval_grants` — izin PIN sekali pakai: permission, branch_id, requested_by, approved_by, expires_at, used_at, used_for
- ✅ `app_settings` — key (PK), value jsonb, updated_by, updated_at — kini berisi `store_policy` (tukar poin & retur)
- ✅ `number_sequences` juga menyimpan counter global `SKU` dan `EAN13` untuk kode otomatis
- ✅ `sale_payments.terminal` jsonb (0018) — data mesin EDC terintegrasi: provider, approvalCode, rrn, terminalId, merchantId, traceNo, batchNo, cardType, maskedPan (**hanya 4 digit terakhir**; divalidasi API). Null = dicatat manual
- ✅ OAuth untuk MCP (0019): `oauth_clients` (client_id teks acak, redirect_uris[], auth_method, secret_hash), `oauth_codes` (hash kode sekali pakai, PKCE challenge, kedaluwarsa 5 menit), `oauth_tokens` (hash access & refresh unik, `family_id` untuk rotasi/deteksi pemakaian ulang, rotated_at, revoked_at). Enum `audit_actor_type` + `OAUTH`
- `payment_provider_configs` (kredensial terenkripsi), `notifications`, `import_jobs`, `report_jobs`
- `daily_sales_summary` — ringkasan per cabang/hari/kanal untuk dashboard (diisi job)

## Index penting
- `product_variants(sku)`, `product_variants(barcode)`, trigram pada `products.name` & `product_variants.sku`
- `inventory_levels(branch_id, variant_id)`, `stock_movements(variant_id, branch_id, created_at desc)`
- `sales(branch_id, created_at desc)`, `sales(customer_id, created_at desc)`, `sale_items(variant_id)`
- `voucher_usages(voucher_id, created_at)`, `voucher_targets(voucher_id)`
- Foreign key yang dipakai join/filter/hapus ber-index (0017). FK audit ke `user` (created_by, approved_by, …) sengaja tanpa index.
- `oauth_tokens(access_hash)` & `(refresh_hash)` unik, `(user_id, client_id)`, `(family_id)`, `(client_id)`; `oauth_codes(client_id)`, `(user_id)` (0019).
- Nama unik tanpa beda huruf besar/kecil: `upper(product_variants.sku)`, `lower(roles.name)`, `lower(membership_tiers.name)`, `brands.name_key` (0012/0016).

## Idempotensi (0020)
- `idempotency_keys`: PK (user_id, key), menyimpan hash permintaan dan respons sukses. Dibersihkan setelah 24 jam.
- `payment_intents_one_pending_uq`: indeks unik parsial, satu QR aktif per dokumen.
