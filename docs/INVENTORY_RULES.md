# Inventory Rules

## Inventory Core Principle
Inventory is not a standalone mutable number. It is a result of an immutable ledger of movements.

## Movement Types
- purchase
- sale
- transfer
- return
- adjustment
- damage
- count difference
- reservation
- release

## Inventory States
- available
- reserved
- in transit
- damaged
- returned
- blocked

## Inventory Ledger Model
Every stock change creates an inventory movement record with:
- movement_id
- tenant_id
- warehouse_id or vehicle_id
- product_variant_id
- movement_type
- quantity_delta
- quantity_before
- quantity_after
- reason_code
- reference_type
- reference_id
- created_by
- created_at
- status

## Calculation Rule
Current stock = sum of all validated movement deltas for a specific inventory record.

## Critical Business Rule
No user may set `stock_quantity = 500` directly. Only through movement generation and validation.

## Reservation Lifecycle (Decision 26 — Confirmed)

- Reservation is represented by validated `reservation` and `release` entries in the Inventory
	Movement Ledger; there is no separate mutable `inventory_reservations` record.
- A reservation is created when an order transitions from Draft to Confirmed.
- Reservation is released in exactly these cases:
	1. Shipment/invoice is issued and dispatched: the reserved quantity is released and the actual
		 outbound stock movement is posted.
	2. Order is cancelled: the reservation is released and stock becomes available again.
	3. Partial delivery: delivered quantity posts as an actual outbound movement; the undelivered
		 reserved quantity is released back to available stock.
- Every reservation, release, and actual movement is linked to its order/shipment/invoice reference
	and audit context. Negative stock remains forbidden throughout.

## Vehicle End-of-Day, Custody Transfer, and Count Difference (Decision 24 — Confirmed)

- Unsold vehicle stock remains at the vehicle mobile-warehouse location at end of day. It is never
	automatically transferred back to a fixed warehouse.
- When a vehicle or its responsible sales representative changes, the current vehicle stock is
	transferred through an `inventory_transfer` document and corresponding ledger entries. The
	transfer document records source vehicle/custodian, destination vehicle/custodian, actor,
	timestamp, and reason; physical quantity is never reassigned by direct mutation.
- Vehicle count shortages, surpluses, and damaged stock create an `inventory_count_document` with
	item-level results. Validated count differences post `count difference` or `damage` ledger
	entries and remain auditable.
- The vehicle remains a real inventory location; all sale, transfer, reservation, release, and
	count-difference controls apply as they do to a fixed warehouse.

## Promotional (Free Goods) Stock Rule
A free unit granted by a promotion (see `PROMOTION_RULES.md`) is a real physical unit. It must
produce an inventory movement identical in kind to a paid unit's movement — there is no "free
stock" exemption from this ledger. The movement links to the `promotion_applications` record via
`reference_type`/`reference_id`. Negative stock prohibition applies to the combined paid+free
quantity requested, not just the paid portion.

## Open Questions
- OPEN QUESTION: What is the exact stock behavior for damaged goods returned to warehouse?
- OPEN QUESTION: How are negative stock situations handled when partial delivery or return is pending?
