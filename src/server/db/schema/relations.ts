import { relations } from "drizzle-orm";
import { user } from "./auth";
import {
  brands,
  categories,
  inventoryLevels,
  productOptions,
  productOptionValues,
  products,
  productVariants,
  stockMovements,
  variantOptionValues,
} from "./catalog";
import { branches, rolePermissions, roles, userRoleAssignments } from "./core";
import { customers, membershipTiers, pointLedger, voucherTargets, voucherUsages, vouchers } from "./crm";
import { onlineOrderItems, onlineOrders } from "./orders";
import { saleItems, salePayments, saleReturnItems, saleReturns, sales, shifts } from "./sales";
import { stockOpnameItems, stockOpnames, stockTransferItems, stockTransfers } from "./stock-ops";

export const userRelations = relations(user, ({ many }) => ({
  roleAssignments: many(userRoleAssignments),
}));

export const roleRelations = relations(roles, ({ many }) => ({
  permissions: many(rolePermissions),
  assignments: many(userRoleAssignments),
}));

export const rolePermissionRelations = relations(rolePermissions, ({ one }) => ({
  role: one(roles, { fields: [rolePermissions.roleId], references: [roles.id] }),
}));

export const userRoleAssignmentRelations = relations(userRoleAssignments, ({ one }) => ({
  user: one(user, { fields: [userRoleAssignments.userId], references: [user.id] }),
  role: one(roles, { fields: [userRoleAssignments.roleId], references: [roles.id] }),
  branch: one(branches, { fields: [userRoleAssignments.branchId], references: [branches.id] }),
}));

export const categoryRelations = relations(categories, ({ one, many }) => ({
  parent: one(categories, { fields: [categories.parentId], references: [categories.id], relationName: "tree" }),
  children: many(categories, { relationName: "tree" }),
  products: many(products),
}));

export const brandRelations = relations(brands, ({ many }) => ({
  products: many(products),
}));

export const productRelations = relations(products, ({ one, many }) => ({
  category: one(categories, { fields: [products.categoryId], references: [categories.id] }),
  brand: one(brands, { fields: [products.brandId], references: [brands.id] }),
  options: many(productOptions),
  variants: many(productVariants),
}));

export const productOptionRelations = relations(productOptions, ({ one, many }) => ({
  product: one(products, { fields: [productOptions.productId], references: [products.id] }),
  values: many(productOptionValues),
}));

export const productOptionValueRelations = relations(productOptionValues, ({ one }) => ({
  option: one(productOptions, { fields: [productOptionValues.optionId], references: [productOptions.id] }),
}));

export const productVariantRelations = relations(productVariants, ({ one, many }) => ({
  product: one(products, { fields: [productVariants.productId], references: [products.id] }),
  optionValues: many(variantOptionValues),
  inventory: many(inventoryLevels),
}));

export const variantOptionValueRelations = relations(variantOptionValues, ({ one }) => ({
  variant: one(productVariants, { fields: [variantOptionValues.variantId], references: [productVariants.id] }),
  optionValue: one(productOptionValues, {
    fields: [variantOptionValues.optionValueId],
    references: [productOptionValues.id],
  }),
}));

export const inventoryLevelRelations = relations(inventoryLevels, ({ one }) => ({
  branch: one(branches, { fields: [inventoryLevels.branchId], references: [branches.id] }),
  variant: one(productVariants, { fields: [inventoryLevels.variantId], references: [productVariants.id] }),
}));

export const stockMovementRelations = relations(stockMovements, ({ one }) => ({
  branch: one(branches, { fields: [stockMovements.branchId], references: [branches.id] }),
  variant: one(productVariants, { fields: [stockMovements.variantId], references: [productVariants.id] }),
  actor: one(user, { fields: [stockMovements.actorId], references: [user.id] }),
}));

export const shiftRelations = relations(shifts, ({ one, many }) => ({
  branch: one(branches, { fields: [shifts.branchId], references: [branches.id] }),
  user: one(user, { fields: [shifts.userId], references: [user.id] }),
  sales: many(sales),
}));

export const saleRelations = relations(sales, ({ one, many }) => ({
  branch: one(branches, { fields: [sales.branchId], references: [branches.id] }),
  shift: one(shifts, { fields: [sales.shiftId], references: [shifts.id] }),
  cashier: one(user, { fields: [sales.cashierId], references: [user.id] }),
  customer: one(customers, { fields: [sales.customerId], references: [customers.id] }),
  items: many(saleItems),
  payments: many(salePayments),
  returns: many(saleReturns),
}));

export const saleReturnRelations = relations(saleReturns, ({ one, many }) => ({
  sale: one(sales, { fields: [saleReturns.saleId], references: [sales.id] }),
  branch: one(branches, { fields: [saleReturns.branchId], references: [branches.id] }),
  createdByUser: one(user, { fields: [saleReturns.createdBy], references: [user.id] }),
  items: many(saleReturnItems),
}));

export const saleReturnItemRelations = relations(saleReturnItems, ({ one }) => ({
  return: one(saleReturns, { fields: [saleReturnItems.returnId], references: [saleReturns.id] }),
  saleItem: one(saleItems, { fields: [saleReturnItems.saleItemId], references: [saleItems.id] }),
}));

export const saleItemRelations = relations(saleItems, ({ one }) => ({
  sale: one(sales, { fields: [saleItems.saleId], references: [sales.id] }),
  variant: one(productVariants, { fields: [saleItems.variantId], references: [productVariants.id] }),
}));

export const salePaymentRelations = relations(salePayments, ({ one }) => ({
  sale: one(sales, { fields: [salePayments.saleId], references: [sales.id] }),
}));

export const customerRelations = relations(customers, ({ one, many }) => ({
  tier: one(membershipTiers, { fields: [customers.tierId], references: [membershipTiers.id] }),
  points: many(pointLedger),
  sales: many(sales),
}));

export const pointLedgerRelations = relations(pointLedger, ({ one }) => ({
  customer: one(customers, { fields: [pointLedger.customerId], references: [customers.id] }),
}));

export const voucherRelations = relations(vouchers, ({ many }) => ({
  targets: many(voucherTargets),
  usages: many(voucherUsages),
}));

export const voucherTargetRelations = relations(voucherTargets, ({ one }) => ({
  voucher: one(vouchers, { fields: [voucherTargets.voucherId], references: [vouchers.id] }),
}));

export const voucherUsageRelations = relations(voucherUsages, ({ one }) => ({
  voucher: one(vouchers, { fields: [voucherUsages.voucherId], references: [vouchers.id] }),
  customer: one(customers, { fields: [voucherUsages.customerId], references: [customers.id] }),
}));

export const stockTransferRelations = relations(stockTransfers, ({ one, many }) => ({
  fromBranch: one(branches, { fields: [stockTransfers.fromBranchId], references: [branches.id], relationName: "transferFrom" }),
  toBranch: one(branches, { fields: [stockTransfers.toBranchId], references: [branches.id], relationName: "transferTo" }),
  items: many(stockTransferItems),
}));

export const stockTransferItemRelations = relations(stockTransferItems, ({ one }) => ({
  transfer: one(stockTransfers, { fields: [stockTransferItems.transferId], references: [stockTransfers.id] }),
  variant: one(productVariants, { fields: [stockTransferItems.variantId], references: [productVariants.id] }),
}));

export const stockOpnameRelations = relations(stockOpnames, ({ one, many }) => ({
  branch: one(branches, { fields: [stockOpnames.branchId], references: [branches.id] }),
  items: many(stockOpnameItems),
}));

export const stockOpnameItemRelations = relations(stockOpnameItems, ({ one }) => ({
  opname: one(stockOpnames, { fields: [stockOpnameItems.opnameId], references: [stockOpnames.id] }),
  variant: one(productVariants, { fields: [stockOpnameItems.variantId], references: [productVariants.id] }),
}));

export const onlineOrderRelations = relations(onlineOrders, ({ one, many }) => ({
  branch: one(branches, { fields: [onlineOrders.branchId], references: [branches.id] }),
  customer: one(customers, { fields: [onlineOrders.customerId], references: [customers.id] }),
  sale: one(sales, { fields: [onlineOrders.saleId], references: [sales.id] }),
  createdByUser: one(user, { fields: [onlineOrders.createdBy], references: [user.id] }),
  items: many(onlineOrderItems),
}));

export const onlineOrderItemRelations = relations(onlineOrderItems, ({ one }) => ({
  order: one(onlineOrders, { fields: [onlineOrderItems.orderId], references: [onlineOrders.id] }),
}));
