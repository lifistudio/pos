CREATE INDEX "approval_grants_branch_idx" ON "approval_grants" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "user_role_assignments_branch_idx" ON "user_role_assignments" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "stock_movements_actor_idx" ON "stock_movements" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "variant_option_values_value_idx" ON "variant_option_values" USING btree ("option_value_id");--> statement-breakpoint
CREATE INDEX "voucher_usages_customer_only_idx" ON "voucher_usages" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "sale_return_items_variant_idx" ON "sale_return_items" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "sales_voucher_idx" ON "sales" USING btree ("voucher_id");--> statement-breakpoint
CREATE INDEX "stock_opname_items_variant_idx" ON "stock_opname_items" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "online_order_items_variant_idx" ON "online_order_items" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "online_orders_connection_idx" ON "online_orders" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "online_orders_customer_idx" ON "online_orders" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "marketplace_connections_branch_idx" ON "marketplace_connections" USING btree ("branch_id");