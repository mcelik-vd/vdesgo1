# Data Model

## Data Model Principles
- The system of record is PostgreSQL.
- Geospatial data uses PostGIS.
- All critical tenant data is isolated by tenant_id.
- Inventory is derived from movement history, not manually incremented.
- Financial and stock actions are transactional and auditable.

## Primary Entities
- tenants
- organizations
- users
- roles
- permissions
- user_roles
- role_permissions
- distributors
- distributor_users
- territories
- user_territories
- products
- product_categories
- product_variants
- product_barcodes
- warehouses
- warehouse_locations
- vehicles
- vehicle_users
- inventory
- inventory_movements
- inventory_transfers
- inventory_transfer_items
- inventory_count_documents
- inventory_count_items
- customers
- customer_addresses
- customer_contacts
- customer_locations
- sales_representatives
- sales_rep_customers
- price_lists
- price_list_items
- customer_prices
- discount_rules
- campaigns
- price_override_approvals
- promotions
- promotion_conditions
- promotion_rewards
- promotion_targets
- promotion_product_rules
- promotion_applications
- promotion_override_requests
- orders
- order_items
- order_status_history
- invoices
- invoice_items
- shipments
- shipment_items
- purchases
- purchase_items
- returns
- return_items
- payments
- accounts
- account_transactions
- visits
- visit_locations
- routes
- route_stops
- targets
- bonuses
- approvals
- approval_steps
- notifications
- audit_logs
- system_events

## Generic Design Guidance
Only include an entity if it is required to support the domain and core flows.
Where the same concept can be represented without a separate table, prefer a single table with flags, types, or normalized references.

## Required Core Fields Pattern
Every tenant-owned entity should include at minimum:
- id
- tenant_id
- created_by
- created_at
- updated_by
- updated_at
- status
- is_deleted (soft delete or canceled state)

## Customer Discount Fields (On Existing `customers` Entity — No New Table)
Added per the Customer Discount & Invoice Pricing Contract (see `PRICING_RULES.md`):
- `cash_discount_percentage`
- `term_discount_percentage`
- `customer_discount_1_percentage`
- `customer_discount_2_percentage`
- `customer_discount_3_percentage`
- `cash_discount_is_active`, `term_discount_is_active`, `customer_discount_1/2/3_is_active`

All nullable, all VD Gıda-owned/editable only. No dedicated table added — change history is
covered by the existing generic `audit_logs` mechanism, consistent with the no-unnecessary-table
principle applied throughout this project.

## Customer Discount Snapshot Fields (On Existing `order_items` Entity — Extends, Does Not Duplicate)
`order_items` already carries price and promotion-linkage fields (Decision 9, Decision 11). Added
for customer discounts specifically:
- `customer_discount_1_percentage_snapshot` / `_amount_snapshot`
- `customer_discount_2_percentage_snapshot` / `_amount_snapshot`
- `customer_discount_3_percentage_snapshot` / `_amount_snapshot`
- `customer_discount_1/2/3_selected_snapshot` (records which defined rates were selected, not
  merely available)
- `payment_discount_type_snapshot`, `payment_discount_percentage_snapshot` / `_amount_snapshot`
- `final_unit_price_snapshot`

See `PRICING_RULES.md` for full field-by-field rationale and the remaining OPEN QUESTIONS
(product-line versus invoice-total scope for other discount mechanisms, precision/rounding, and
e-fatura/KDV presentation requirements). Customer Discount 1/2/3 sequencing, promotion ordering,
and KDV-exclusive calculation are finalized by Decision 19 and Decision 20.

## Customer Default Assignment Fields (On Existing `customers` Entity — No New Table)
- `default_sales_representative_id` — FK to `sales_representatives`; used to prefill a new
  order/invoice after customer selection.
- `default_warehouse_id` — FK to `warehouses`; used to prefill the same transaction independently.

`sales_rep_customers` remains the customer portfolio-assignment relation. These two fields do not
replace it: they identify the one default prefill value for the current customer profile. A default
does not lock a transaction: selected sales representative and warehouse are stored on the
order/invoice transaction and may each differ from the default. See `SALES_RULES.md`.

## Territory Assignment Model (Decision 30)
- `territories` is a tenant-owned operational-area entity.
- `user_territories` is the N:N junction between `users` and `territories`.
- `sales_representatives.territory_id` and `warehouses.territory_id` reference `territories`.
- Manual Sales Representative/Warehouse selection is constrained to records in the active tenant
  whose `territory_id` is in the user's active territory assignments.

## Transaction Assignment Snapshot (Existing `orders` Entity — Extends, Does Not Duplicate)
`orders` must retain the actual `sales_representative_id` and `warehouse_id` selected for that
transaction, plus `default_sales_representative_id_snapshot` and `default_warehouse_id_snapshot`
to distinguish system-prefilled values from final user selections. The equivalent invoice snapshot
uses the `invoices` entity and is inherited directly from the approved order under Decision 23;
customer defaults are not re-read during conversion.

## Invoice Inheritance and Invoice Total Discount (Decision 23 / 25)
`invoices` and `invoice_items` are required entities. An invoice is created from an approved order
and inherits its selected representative, warehouse, customer defaults, price, discount, and
promotion snapshots; it does not re-read customer defaults or re-evaluate pricing.

`invoices` needs `order_id` (source order), selected-representative/warehouse snapshots, inherited
commercial snapshot references, and `invoice_discount_amount_snapshot` for the separate fixed-TL
Distributor Admin invoice-total discount. `invoice_items` copies the order-item commercial
snapshots needed for historical reconstruction. Detailed field cardinality belongs to Phase 1 ER
design; no generic discount entity is introduced.

## Ledger Reservation and Vehicle Documents (Decision 24 / 26)
`inventory_reservations` is deliberately absent: reservation/release are ledger movement types.
`inventory_transfers` / `inventory_transfer_items` document vehicle/custody transfer;
`inventory_count_documents` / `inventory_count_items` document vehicle count shortages, surpluses,
and damage before related ledger movements are validated.

## Note on Price Snapshot (Consistency Fix)
`price_snapshot` is **not** a separate table. The snapshot is fields embedded directly on
`order_items` (unit_price, unit_price_source, unit_price_timestamp, override fields — see
`DATABASE_DESIGN.md`). `price_override_approvals` is the only additional pricing table, added
above. This clarification resolves a previously flagged inconsistency between this document and
`DATABASE_DESIGN.md` (DISCOVERY AUDIT v2, §10/§16).

## Note on Promotion Snapshot (Consistency Principle)
Similarly, `promotion_applications` (listed above) serves as the promotion snapshot; no separate
`promotion_snapshots` table exists, for the same reason (see `PROMOTION_MODEL.md` redundancy
check).

## Open Questions
- OPEN QUESTION: Is soft delete preferred over cancellation status for all key records?
- OPEN QUESTION: Should customer locations be separate or embedded in customer addresses?
- OPEN QUESTION: Should inventory status be enumerated or store a separate table for status values?
- OPEN QUESTION: Promotion stacking/conflict resolution model (see `PROMOTION_RULES.md` §3) —
  affects whether `promotions.priority` / `stacking_mode` are ever populated.
