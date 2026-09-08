# Database Design

## Database Choice
PostgreSQL is the canonical system of record. PostGIS supports GPS and location operations.

## Core Database Principles
1. Shared Database, Shared Schema is used under ADR-010.
2. Every distributor-owned operational entity carries mandatory `tenant_id`.
3. PostgreSQL RLS is the primary tenant-isolation boundary; application checks are defense in depth.
4. VD Gıda is platform-level. Controlled cross-tenant platform reads are audited; on-behalf-of writes
   require explicit target `tenant_id`.
5. Foreign keys, business identity constraints, lifecycle/status constraints, and tenant consistency
   are enforced in Phase 1 schema design.
6. Inventory is derived from immutable ledger movements; direct mutation is forbidden.
7. Critical domain events are immutable audit records.

## Entity Relationships by Domain

### Tenant and Territory
- `tenants` -> `distributors`, `users`, `warehouses`, `customers`, `sales_representatives`
- `tenants` -> `territories`
- `users` <-> `territories` through `user_territories`
- `territories` -> `sales_representatives`, `warehouses`
- Manual assignment candidate rule: `tenant_id = active_tenant AND territory_id IN (user_active_territories)`.
  RLS remains the mandatory tenant boundary; territory only narrows the tenant result set.

### Customer Assignment
- `customers.default_sales_representative_id` -> `sales_representatives`
- `customers.default_warehouse_id` -> `warehouses`
- `orders.sales_representative_id` / `orders.warehouse_id` are actual selected values.
- `orders.default_sales_representative_id_snapshot` /
  `orders.default_warehouse_id_snapshot` preserve automatic prefill values.
- Customer default values and final transaction values are distinct.

### Order, Invoice, Pricing, Promotion
- `orders` -> `order_items`, `order_status_history`, `approvals`, `payments`,
  `promotion_applications`
- `invoices.order_id` -> `orders` (required source; invoice inherits approved Order snapshot)
- `invoice_items.invoice_id` -> `invoices`
- `invoice_items.order_item_id` -> `order_items`
- `invoices.invoice_discount_amount_snapshot` is the separate fixed-TL Distributor Admin discount at
  final pre-KDV stage.
- Price snapshots are embedded in `order_items`; promotion snapshots use `promotion_applications`.
- Customer Discount 1/2/3 are line-level fields. Invoice-total discount remains separate.

### Inventory, Reservation, Vehicle
- `warehouses` / `vehicles` -> `inventory`, `inventory_movements`
- `inventory_transfers` -> `inventory_transfer_items` -> `inventory_movements`
- `inventory_count_documents` -> `inventory_count_items` -> `inventory_movements`
- Reservation/release are `inventory_movements` types; no mutable reservation table exists.
- Inventory transfer/count document results link to ledger movements by reference.

### Central Pricing and Promotion
- VD Gıda-owned: `price_lists`, `price_list_items`, `customer_prices`, `discount_rules`,
  `campaigns`, `price_override_approvals`.
- VD Gıda-owned promotion model: `promotions`, `promotion_conditions`, `promotion_rewards`,
  `promotion_targets`, `promotion_product_rules`, `promotion_applications`, and
  `promotion_override_requests`.

## Key Design Rules
- Orders require valid customer, tenant, representative, warehouse, and centrally resolved pricing.
- Invoice copies approved Order assignment/pricing/promotion snapshots; no recalculation occurs.
- Direct stock mutation and negative stock are forbidden.
- Reservation begins Draft-to-Confirmed and is released according to Decision 26.
- Every financial, stock, cross-tenant, assignment, and price/promotion exception action is auditable.

## Open Questions
- OPEN QUESTION: Expected customer/inventory scale for first production deployment.
- OPEN QUESTION: Dedicated append-only audit storage versus hybrid event-table architecture.
- OPEN QUESTION: Combined versus split ledger movement for paid and promotion-free goods.
- OPEN QUESTION: Tenant-consistent FK enforcement strategy (composite FK, RLS-only, or another
  Phase 1 approved method).
