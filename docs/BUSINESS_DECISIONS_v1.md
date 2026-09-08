# VDesgo Business Decisions v1

**Date:** 2026-08-30  
**Status:** DRAFT - Awaiting Business Confirmation  
**Purpose:** Resolve 10 critical architectural decisions from DISCOVERY AUDIT v1

---

## Decision Summary

| #  | Topic | Decision | Impact |
|---|---|---|---|
| 1 | Tenant Model | Each Distributor = Separate Tenant | Fundamental data isolation, schema design, authorization |
| 2 | Product Ownership | Central Catalog (VD Gıda owned) | Single source of truth, unified inventory tracking |
| 3 | Customer Ownership | Transferable between distributors | Flexibility in customer management, history preservation |
| 4 | Sales Rep | Single distributor at a time | Simplified assignment, clear accountability |
| 5 | Vehicle | Mobile warehouse (Depo→Araç→Müşteri) | Field sales execution, inventory tracking |
| 6 | Negative Stock | Forbidden (system prevents) | Inventory accuracy, prevents over-selling |
| 7 | Sales Types | Order + Direct vehicle sales | Flexibility for different sales scenarios |
| 8 | Offline Operations | Whitelist model (read offline, validated write) | Data integrity while supporting field connectivity |
| 9 | Pricing | Centralized pricing (no distributor flexibility) | ⚠️ CONFIRMATION NEEDED |
| 10 | VD Gıda Access | Full visibility to all distributor data | Central oversight and monitoring |
| 11 | Promotion Engine | Centralized promotion authority (VD Gıda), additive layer over pricing | See `PROMOTION_MODEL.md` / `PROMOTION_RULES.md` — conflict/stacking rule remains OPEN QUESTION |
| 12 | Promotion Conflict/Stacking | **RECOMMENDED** (not yet approved): Exclusive-by-default, priority tiebreak, explicit opt-in stacking | See `PROMOTION_RULES.md` §3 — ⚠️ CONFIRMATION NEEDED |
| 13 | Insufficient Reward Stock | **RECOMMENDED** (not yet approved): Fulfill paid portion, withhold unfulfilled reward, surface + audit, do not block order | See `PROMOTION_RULES.md` §10 — ⚠️ CONFIRMATION NEEDED |
| 14 | Campaign vs. Promotion Sequencing | Confirmed (architectural, follows from Decision 9): campaign price resolves first, promotion evaluates second; both may apply together | See `PROMOTION_RULES.md` §18 |
| 15 | Promotional Order Item Modeling | Confirmed (architectural): reward always creates a separate `order_items` row, never modifies the paid item | See `PROMOTION_RULES.md` §19 — invoice `unit_price` value remains ACCOUNTING REVIEW REQUIRED |
| 16 | Tiered Promotions | Confirmed (architectural): modeled via shared `tier_level` on `promotion_conditions`/`promotion_rewards`, no new table; highest qualifying tier applies exclusively | See `PROMOTION_MODEL.md` §"Tiered Promotions" |
| 17 | Manual Discount vs. System Promotion | Confirmed (architectural/audit): sales-rep manual discounts always use `price_override_approvals`, never `promotion_applications` | See `PROMOTION_RULES.md` §22 |
| 18 | Customer Discount & Invoice Pricing Contract | Confirmed structural refinement: 5 standing fields on `customers`, VD Gıda sole authority, cash/term mutually exclusive | Calculation/combination rules finalized by Decision 19; line-vs-total scope and rounding remain OPEN |
| 19 | Customer Discount Calculation & Invoice Application | Confirmed commercial rules: selectable Customer Discount 1/2/3 apply cascadingly; promotion first; cash/term combines but remains mutually exclusive; KDV follows discounts | See `PRICING_RULES.md` "FINAL CUSTOMER DISCOUNT CALCULATION CONTRACT" |
| 20 | Customer Discount Scope, Order and Precision | Confirmed: line-level scope, D1→D2→D3→cash/term sequence, no intermediate rounding, 2-decimal presentation | Separate invoice-total discount remains an OPEN mechanism; see `PRICING_RULES.md` |
| 21 | Customer-Based Transaction Assignment | Confirmed: customer defaults prefill sales representative/warehouse; users may override each independently; transaction snapshots preserve defaults and selections | Selectable scope, customer-change handling, and order-to-invoice inheritance remain OPEN |
| 22 | Tenant Isolation and RLS Strategy | Confirmed: shared database/shared schema; distributor `tenant_id` mandatory; PostgreSQL RLS enforces isolation; VD Gıda is platform owner | See ADR-010 |
| 23 | Order-to-Invoice Inheritance | Confirmed: approved order’s representative, warehouse, price, promotion, and assignment snapshots copy to invoice; customer defaults are not re-read | Adds `invoices` / `invoice_items` entity design |
| 24 | Vehicle End-of-Day and Custody Transfer | Confirmed: unsold stock remains in vehicle; vehicle/rep change uses ledger transfer; count differences use vehicle count-difference document | See `INVENTORY_RULES.md` |
| 25 | Invoice Total Discount | Confirmed: separate final pre-KDV, fixed-TL discount; Distributor Admin only; may combine with other discounts | See `PRICING_RULES.md` |
| 26 | Reservation Lifecycle | Confirmed: reservation is ledger-based at Draft→Confirmed; release on shipment/invoice, cancellation, or undelivered partial quantity | See `INVENTORY_RULES.md` |
| 27 | Control Center Desktop Workspace | Confirmed: concurrent child work windows with independent state, taskbar minimize/restore, active-window focus, and unsaved-change protection | Router/state persistence and multi-instance exceptions remain OPEN | 
| 28 | Workspace State and Instance Architecture | Confirmed: layout persists, unsaved form data remains in memory, static workspace URL, list windows single-instance, transaction/detail windows multi-instance | See `SYSTEM_ARCHITECTURE.md` |
| 29 | Customer Assignment Override and Reset | Confirmed: tenant-scoped selections, Distributor Admin may maintain own customer defaults, customer change confirms then resets overrides/discounts | Region-role model remains OPEN |
| 30 | Territory Assignment and Selection Scope | Confirmed: territories and user-territories constrain SR/WH selection within active tenant | See `DOMAIN_MODEL.md` and `API_CONTRACT.md` |

---

## Decision 1: Tenant Model

**Decision:** Each Distributor = Separate Tenant (with VD Gıda as central coordinator)

**Model:**
```
VDesgo Platform
      │
   VD Gıda
   (Central/Admin)
      │
 ┌────┼────┬────┐
 │    │    │    │
 A    B    C    D
(Distributor Tenants)
```

**Technical Implementation:**
- Table schema includes `tenant_id` on all entities
- PostgreSQL row-level security (RLS) enforces tenant isolation
- VD Gıda = special admin tenant with cross-tenant read access
- Each distributor cannot query other tenant data

**Business Impact:**
- Distributor A cannot access Distributor B's customers, orders, or stock
- VD Gıda sees aggregate data across all distributors
- Supports future SaaS model with external distributors

**Related Documents to Update:**
- [x] DOMAIN_MODEL.md - clarify tenant definition
- [x] SYSTEM_ARCHITECTURE.md - confirm hierarchy
- [x] DATABASE_DESIGN.md - schema-per-tenant or shared database

---

## Decision 2: Product Ownership

**Decision:** Central Catalog (VD Gıda Owned)

**Model:**
```
VD Gıda Product Catalog
├── Krutos 60g
├── Krutos 100g
├── Krutos Baharatlı
└── ...

Product → Distributor Inventory
Product → Distributor Price (later)
Product → Distributor Campaign (later)
```

**Technical Implementation:**
- Products are `tenant_id = VD_GIDA` (central tenant)
- All distributors reference same product master data
- Pricing is per-distributor (later phase)
- Barcode and SKU unique within central catalog

**Business Impact:**
- Single version of truth for product definitions
- Consistent SKU/barcode across all distributors
- Simplified supply chain from manufacturer to distributor
- Future: inventory visibility by product across all warehouses

**Related Documents to Update:**
- [x] PRODUCT_CONTRACT.md - products are VD Gıda owned
- [x] DATA_MODEL.md - products table has no distributor_id
- [x] PRICING_RULES.md - prepare for future multi-distributor pricing

---

## Decision 3: Customer Ownership

**Decision:** Transferable Between Distributors (with history preservation)

**Model:**
```
Customer ABC
├── Current Owner: Distributor A
│   └── Current Sales Rep: Mehmet
│   └── Current Orders: [Order A1, A2, A3]
│
└── History
    ├── Previous Owner: None
    └── All Past Orders/Payments preserved
    
(If transferred to B later)

Customer ABC
├── Current Owner: Distributor B
│   └── Current Sales Rep: Fatih
│   └── Current Orders: [Order B1, B2]
│
└── History
    ├── Previous Owner: Distributor A (2026-01-01 to 2026-08-30)
    │   ├── Orders: A1, A2, A3 (still visible in history)
    │   └── Payments: PA1, PA2 (still visible in history)
    └── Current Orders: B1, B2
```

**Technical Implementation:**
- Customer has `current_distributor_id`
- Customer has `created_at` and `transferred_at` audit fields
- All orders/payments retain original distributor reference
- VD Gıda can see full customer history across distributors
- Each distributor sees only their "current" customers but shared customers see history

**Business Impact:**
- Flexibility to reassign underperforming customer
- Sales rep change doesn't lose customer data
- VD Gıda can track customer lifecycle
- Risk and credit history follows customer

**Related Documents to Update:**
- [x] DISTRIBUTOR_MODEL.md - customer transfer process
- [x] DOMAIN_MODEL.md - customer ownership clarified
- [x] Create new CUSTOMER_LIFECYCLE.md for transfer scenarios

---

## Decision 4: Sales Representative

**Decision:** Single Distributor at a Time (can change over time)

**Model:**
```
Sales Rep: Mehmet
├── 2026-01-01 to 2026-08-30: Distributor A
│   ├── Customers: [Cust1, Cust2, Cust3]
│   └── Orders: [Order1, Order2]
│
├── 2026-08-31 to TBD: Distributor B
│   ├── Customers: [Cust4, Cust5]
│   └── Orders: [Order3, Order4]
│
└── History
    └── All previous assignments tracked
```

**Technical Implementation:**
- SalesRep has `current_distributor_id`
- SalesRep has `assigned_at` and `reassigned_at` fields
- Customer-SalesRep relationship tracked in `sales_rep_customers`
- When rep reassigned: customers can follow or be reassigned separately
- All orders retain original sales rep reference

**Business Impact:**
- Clear accountability for sales rep performance
- Simplified territory management
- When rep leaves: customers can be reassigned cleanly
- History preserved for audit/analytics

**Related Documents to Update:**
- [x] DOMAIN_MODEL.md - clarify sales rep tenure
- [x] SALES_RULES.md - sales rep accountability
- [x] Create SALES_REP_LIFECYCLE.md

---

## Decision 5: Vehicle as Mobile Warehouse

**Decision:** Yes - Depo → Araç → Müşteri Hierarchy

**Model:**
```
Depo (Warehouse)
   │
   ├── Krutos 60g: 5,000 units
   │   └── TRANSFER: 500 units → Vehicle 01
   │
Vehicle 01
   └── Krutos 60g: 500 units
       ├── SALE: 20 units → Customer ABC
       │
       └── Vehicle: 480 units

End of Day:
   ├── Option A: Return unsold to warehouse
   │   └── Warehouse: 5,480 units
   │   └── Vehicle: 0 units
   │
   └── Option B: Keep in vehicle for next day
       └── Vehicle: 480 units
```

**Technical Implementation:**
- Vehicle has `inventory` table just like warehouse
- Vehicle has `vehicle_id` instead of `warehouse_id`
- All movements use same `inventory_movements` ledger
- Movement types: warehouse_to_vehicle, vehicle_to_warehouse, vehicle_to_customer, etc.
- Stock derived from movements, never direct mutation

**Business Impact:**
- Field sales execution without returning to warehouse
- Real-time stock tracking in field
- Supports end-of-day reconciliation
- Vehicle can serve multiple customers without warehouse trip

**Related Documents to Update:**
- [x] ADR-005 - already good
- [x] INVENTORY_RULES.md - clarify vehicle transfer process
- [x] SALES_RULES.md - vehicle-based sales flow

---

## Decision 6: Negative Stock

**Decision:** Forbidden (System Prevents)

**Rule:**
- If warehouse has 10 units and customer needs 15, system rejects the transaction
- Sales rep cannot complete the sale
- Error message: "Insufficient stock. Available: 10, Requested: 15"

**Exception Process (Future):**
- Special "Stock Adjustment" operation (requires manager approval)
- Audit-logged, full traceability
- Not part of MVP

**Technical Implementation:**
- All inventory_movements validated: `quantity_available >= quantity_requested`
- Transaction rolled back if validation fails
- No system-level negative stock allowed

**Business Impact:**
- Prevents over-selling
- Ensures accurate inventory
- Simplifies reconciliation
- Reduces customer complaints about unfulfilled orders

**Related Documents to Update:**
- [x] INVENTORY_RULES.md - enforce no negative stock
- [x] BUSINESS_RULES.md - add negative stock rule
- [x] TEST_STRATEGY.md - add golden test for over-sale prevention

---

## Decision 7: Sales Types

**Decision:** Support Both Order + Direct Vehicle Sales

**Model A - Standard Order:**
```
Customer ABC
   │
   ├── Order Created (Draft)
   ├── Order Submitted
   ├── Order Approved
   ├── Stock Reserved
   ├── Order Preparing
   ├── Order Dispatched
   └── Order Delivered
```

**Model B - Direct Vehicle Sale:**
```
Customer ABC (at field)
   │
   ├── Sale Created (Direct)
   ├── Stock Deducted (Vehicle)
   ├── Payment Captured
   └── Sale Completed
```

**Technical Implementation:**
- Order and Sale are separate entities
- Order has full workflow (states, approvals)
- Sale is simpler (direct stock deduction + payment)
- Both create inventory movements
- Both create accounting entries

**Business Impact:**
- Flexibility for different sales scenarios
- Field rep can complete instant sales
- Route-based distributors can do direct sales
- Maintains audit trail for both

**Related Documents to Update:**
- [x] SALES_RULES.md - add direct sale flow
- [x] DATA_MODEL.md - add sales table
- [x] API_CONTRACT.md - add sales endpoints

---

## Decision 8: Offline Mobile Operations

**Decision:** Whitelist Model (Offline-Safe Operations Defined)

**Allowed Offline (Read + Write with Sync Validation):**
- Customer view/search
- Product view/search  
- Price view
- Customer visit start
- Order creation (Draft)
- Order notes
- GPS recording
- Photos
- Vehicle stock view
- Payment capture (initiate)

**Blocked Offline (Requires Online Verification):**
- Price/discount override
- Approval authority
- Credit limit changes
- Stock adjustment/correction
- Vehicle stock transfer (warehouse ↔ vehicle)
- User/permission changes
- Critical payment finalization

**Technical Implementation:**
- Mobile app stores operations in local queue
- Fields marked `sync_required=true` block local action
- On server sync: validate prices, check credit, verify approvals
- Idempotent sync using `operation_id` + timestamp

**Business Impact:**
- Field reps work offline without losing data
- Data validated before final commitment
- Prevents stale price/credit info being used
- Supports low-connectivity field areas

**Related Documents to Update:**
- [x] MOBILE_APP_CONTRACT.md - define operation whitelist
- [x] ADR-006 - specify blocked vs allowed operations
- [x] API_CONTRACT.md - add sync endpoints

---

## Decision 9: Centralized Pricing Authority

**✅ CONFIRMED - Centralized Pricing Model**

**Key Principle:**
VD Gıda is the owner and sole authority of pricing and commercial terms engine.

Distributors and sales representatives cannot change prices unilaterally.

However, the centralized system supports multiple pre-defined pricing structures:

```
VD Gıda Pricing Authority
├── Standard List Price
├── Volume-Based Pricing
├── Customer Segment Pricing
├── Campaign Pricing
├── Seasonal Pricing
├── Distributor-Specific Pricing (if approved by VD Gıda)
├── Special Customer Pricing (if approved by VD Gıda)
├── Centrally Defined Discounts
├── Minimum Sale Price
└── Special Price requiring Authorized Approval
```

**What "Centralized" Does NOT Mean:**
- ❌ "One single price for all" (rigid)
- ❌ "No pricing flexibility" (inflexible)
- ❌ "Distributors have zero input" (top-down only)

**What "Centralized" DOES Mean:**
- ✅ VD Gıda owns the price definition and governance
- ✅ Distributors cannot unilaterally change prices
- ✅ Sales representatives cannot override prices without approval
- ✅ All pricing rules managed by VDesgo central system
- ✅ Different distributors can have different prices for same product, **but only if VD Gıda defines it**
- ✅ Customer-specific pricing possible, **but must be defined by VD Gıda**
- ✅ Campaigns managed by VD Gıda
- ✅ Unauthorized price override is strictly forbidden

**11 Core Rules for Centralized Pricing:**

1. **Price Ownership:** VD Gıda owns all pricing and commercial terms
2. **Distributor Constraint:** Distributors cannot change prices arbitrarily
3. **Sales Rep Constraint:** Sales representatives cannot override prices without authorization
4. **Rule Engine:** Pricing rules managed by VDesgo central system
5. **Multi-Distributor Pricing:** If Distributor A needs different price than B, VD Gıda defines it
6. **Customer Special Pricing:** If Customer ABC needs special rate, VD Gıda approves and defines it
7. **Campaign Management:** All campaigns defined and managed by VD Gıda
8. **Price Snapshot:** At order creation, the applied price is captured as immutable snapshot
9. **No Retroactive Changes:** If VD Gıda changes price later, old orders retain original price
10. **Audit Trail:** All price changes logged in audit_logs
11. **Approval Workflow:** Price overrides requiring special approval follow defined workflow

**Technical Implementation:**
```
Order Creation Flow:

1. Customer ABC + Product Krutos 60g
2. System looks up applicable price:
   - Is there customer-specific price? → Use it
   - Is there distributor-specific price? → Use it
   - Is there campaign price? → Use it
   - Is there volume-based price? → Use it
   - → Use standard list price
3. Apply price (readonly from customer/rep perspective)
4. Snapshot price + conditions on order
5. Order approved with locked price
6. Even if VD Gıda changes prices later, this order keeps original snapshot
```

**Example Scenarios:**

**Scenario A:** Volume-Based Pricing (Pre-defined by VD Gıda)
```
Krutos 60g - Standard: 95 TL
Krutos 60g - Volume 1000+: 93 TL
Krutos 60g - Volume 5000+: 90 TL

Sales Rep tries to order 1000 units:
- System auto-applies: 93 TL per unit
- Sales Rep sees: 93 TL (cannot change)
- Order snapshot: 93 TL × 1000 = 93,000 TL
```

**Scenario B:** Distributor-Specific Pricing (Approved by VD Gıda)
```
Krutos 60g - Standard: 95 TL
Krutos 60g - Distributor A: 97 TL (higher cost region)
Krutos 60g - Distributor B: 92 TL (lower cost region)

Distributor A's rep orders:
- System applies: 97 TL (pre-defined by VD Gıda)
- Rep cannot change
- Order locked at 97 TL
```

**Scenario C:** Special Customer Pricing (Approved by VD Gıda)
```
Customer ABC (Distributor A) - Special: 88 TL
Customer XYZ (Distributor A) - Standard: 95 TL

Distributor A's rep orders for ABC:
- System applies: 88 TL
- For XYZ: 95 TL
- Both pre-defined and immutable at order time
```

**Scenario D:** Campaign Pricing (Managed by VD Gıda)
```
Campaign: "Summer 2026"
- Active: 2026-06-01 to 2026-08-31
- Product: Krutos 60g
- Price: 85 TL (override)
- Auto-applied to all distributors

Sales rep orders Krutos during campaign:
- System applies: 85 TL
- Cannot be overridden
- Campaign ends → reverts to standard price
```

**Scenario E:** Unauthorized Price Override Attempt
```
Sales Rep tries to sell at 80 TL when standard is 95 TL:
- System rejects: "Price override requires approval"
- Rep submits override request
- Approval workflow checks:
  - Discount % = 15.8%
  - Required approval level = Manager
  - Manager approves → Price override granted and logged
  - Manager rejects → Order proceeds at standard price
```

**Related Documents to Update:**
- [x] PRICING_RULES.md - clarify centralized authority
- [x] ROLE_PERMISSION_MATRIX.md - who can override prices
- [x] BUSINESS_RULES.md - add pricing rules
- [x] SALES_RULES.md - pricing applied at order time
- [x] DATA_MODEL.md - price snapshot fields
- [x] DATABASE_DESIGN.md - price history/versioning
- [x] AUDIT_POLICY.md - price change auditing
- [x] SECURITY_MODEL.md - price override authorization

---

## Decision 10: VD Gıda Central Access

---

## Decision 11: Promotion Engine (Centralized, Additive to Pricing)

**Decision:** VD Gıda owns a centralized promotion/campaign engine. Promotions are evaluated
**after** price resolution (Decision 9) and never replace or bypass it. Full domain model and
business rules are documented separately in `PROMOTION_MODEL.md` and `PROMOTION_RULES.md` (kept
separate from this decisions log due to their size).

**Authority pattern (identical to Decision 9):**
- VD Gıda creates/edits/activates/deactivates promotions
- Distributors and sales representatives can view but not edit
- Exceptions go through `promotion_override_requests` (approval + audit), mirroring
  `price_override_approvals`

**What remains OPEN (not decided here):**
- Promotion stacking/conflict resolution when multiple promotions qualify simultaneously
- Invoice/e-fatura representation of free goods
- Insufficient-stock behavior specific to a promotional reward product
- Offline promotion version conflict resolution at sync time

**Related Documents:**
- [x] `PROMOTION_MODEL.md` — new, entity/domain model
- [x] `PROMOTION_RULES.md` — new, business rules and open questions
- [x] `adr/ADR-009-Promotion-Engine-Architecture.md` — new
- [x] `DATA_MODEL.md`, `DATABASE_DESIGN.md`, `BUSINESS_RULES.md`, `PRICING_RULES.md`,
      `SALES_RULES.md`, `INVENTORY_RULES.md`, `DISTRIBUTOR_MODEL.md`,
      `ROLE_PERMISSION_MATRIX.md`, `SECURITY_MODEL.md`, `AUDIT_POLICY.md`,
      `MOBILE_APP_CONTRACT.md`, `API_CONTRACT.md`, `TEST_STRATEGY.md`,
      `IMPLEMENTATION_ROADMAP.md` — updated with cross-references

---

## Decision 12: Promotion Conflict/Stacking — RECOMMENDED (Pending Approval)

**Status:** ⚠️ NOT YET APPROVED. See full analysis in `PROMOTION_RULES.md` §3.

**Recommendation:** Default to EXCLUSIVE (only the highest-`priority` eligible promotion applies);
two promotions combine only if VD Gıda explicitly marks them as mutually stackable (opt-in).
Equal-priority, non-stackable ties resolve by earliest `created_at`.

**Why not marked DECIDED:** This changes real commercial outcomes (which reward a customer
receives) and must be explicitly signed off by VD Gıda business ownership, consistent with the
principle established throughout this project that commercial thresholds/behaviors are never
assumed.

---

## Decision 13: Insufficient Reward Stock — RECOMMENDED (Pending Approval)

**Status:** ⚠️ NOT YET APPROVED. See full analysis in `PROMOTION_RULES.md` §10.

**Recommendation:** Fulfill the paid quantity normally; withhold the unfulfilled portion of the
free reward if the specific reward product is out of stock; surface this to the sales
representative/order confirmation; audit the shortfall. Do not block the entire order.

**Why not marked DECIDED:** Same rationale as Decision 12 — a customer-facing commercial outcome
requiring explicit sign-off.

---

## Decision 14: Campaign vs. Promotion Sequencing — Confirmed

**Status:** ✅ CONFIRMED (architectural clarification, not a new commercial decision — it follows
directly from the already-approved Decision 9).

`campaigns` affect the resolved **unit price** (part of price resolution). `promotions` affect the
**reward** (free goods/discount) calculated after price resolution. Both may apply to the same
order simultaneously, since they act on different aspects sequentially. Full detail:
`PROMOTION_RULES.md` §18.

**Remaining open item:** whether VD Gıda needs visibility/alerting when a campaign-priced order
also qualifies for a promotion (compounding commercial effect) — tracked as an OPEN QUESTION in
`PROMOTION_RULES.md` §18, not blocking.

---

## Decision 15: Promotional Order Item Modeling — Confirmed

**Status:** ✅ CONFIRMED (architectural/domain-modeling decision, not a commercial one).

A promotion reward always produces a separate `order_items` row (`is_promotional=true`, linked via
`promotion_application_id`) rather than modifying the paid item. Full detail:
`PROMOTION_RULES.md` §19.

**Remaining open item:** the `unit_price` value stored on that row for invoicing purposes is
ACCOUNTING REVIEW REQUIRED, not a technical decision.

---

## Decision 16: Tiered Promotions — Confirmed

**Status:** ✅ CONFIRMED (architectural/domain-modeling decision, not a commercial one).

A tiered promotion (e.g., 5→%5, 10→%8, 20→%12) is modeled via a shared `tier_level` field added to
both `promotion_conditions` and `promotion_rewards`, rather than a new `promotion_tiers` table. The
highest tier whose condition is satisfied applies exclusively — tiers within one promotion are
mutually exclusive by mathematical definition, not by a business stacking policy (Decision 12 does
not apply here). Full detail: `PROMOTION_MODEL.md` §"Tiered Promotions", `PROMOTION_RULES.md` §2.

---

## Decision 17: Manual Discount vs. System-Generated Promotion — Confirmed

**Status:** ✅ CONFIRMED (architectural/audit-design decision, not a commercial one).

A sales representative's ad-hoc manual discount (via `price_override_approvals`, Decision 9) is
never recorded as a `promotion_applications` row, regardless of similar monetary effect. The two
mechanisms have distinct authority models, distinct tables, and distinct `audit_logs` entity_type
values. Conflating them would corrupt promotion usage/cost reporting with discounts that were never
part of any campaign. Full detail: `PROMOTION_RULES.md` §22.

---

## Decision 18: Customer Discount & Invoice Pricing Contract

**Status:** ✅ CONFIRMED structural refinement. Calculation rules are finalized by Decision 19.

**Conflict check performed against Decision 9, 16, 17, and all ADRs: NO CONFLICT FOUND.** This
feature is the concrete structural realization of the "customer-specific discounts" pricing
component already listed in `PRICING_RULES.md` prior to this pass — it does not introduce a new
pricing authority and does not alter any existing ADR.

**Confirmed:**
- Five standing discount fields on the existing `customers` entity (no new table): cash discount,
  term discount, customer discount 1/2/3. VD Gıda is the sole authority to define/change/
  activate/deactivate them.
- Cash and term discount are mutually exclusive on a single invoice (stated directly by the
  business requirement, not an agent-invented rule).
- Distinct from Promotion (Decision 11) and from Manual Discount/Price Override (Decision 17) —
  four fully separate mechanisms: Central Price → Customer Discount → Promotion → Manual
  Override, each independently audited and independently traceable in reporting.
- Snapshot immutability applies identically to the existing pricing/promotion snapshot rules.

**Still open (full list in `PRICING_RULES.md`):**
1. Product-line vs. invoice-total application scope
2. Decimal precision and rounding stage/rule for sequential calculations and KDV
3. Turkish e-fatura/KDV legal presentation or rounding requirements (ACCOUNTING REVIEW REQUIRED)

Full detail: `PRICING_RULES.md` "Customer Discount & Invoice Pricing Contract".

---

## Decision 19: Customer Discount Calculation & Invoice Application

**Status:** ✅ CONFIRMED commercial decision.

- Sales representatives may individually select any combination of Customer Discount 1/2/3 that
   VD Gıda has predefined and activated for the customer; they cannot edit their rates.
- Selected Customer Discount 1/2/3 values apply sequentially against the remaining amount
   (cascading/compound), never as a summed percentage.
- Cash **or** term discount applies according to payment type, never both; the selected payment
   discount may combine with selected Customer Discount 1/2/3.
- Promotion applies first. The detailed customer/payment/manual discount order is finalized by
   Decision 20: Customer Discount 1 → Customer Discount 2 → Customer Discount 3 → cash or term
   discount → authorized manual discount. KDV is calculated only after all KDV-exclusive discounts.
- There is no commercial upper ceiling on combined discount percentage. Net amount must remain
   non-negative and monetary calculations must remain valid and deterministic.
- Customer discount definitions and actual selected/applied invoice values are immutable snapshots:
   later customer-card changes never modify historical orders/invoices.

**Still open (not changed by this decision):** product-line versus invoice-total discount scope,
decimal precision/rounding stage, and accounting/e-fatura presentation requirements.

Full detail: `PRICING_RULES.md` "FINAL CUSTOMER DISCOUNT CALCULATION CONTRACT".

---

## Decision 20: Customer Discount Scope, Order and Precision

**Status:** ✅ CONFIRMED commercial decision.

- Customer Discount 1/2/3 are product-line (`order_items`) discounts. Each line selects and
   calculates its own discounts; a line never changes another line's calculation.
- The mandatory order is Promotion → Customer Discount 1 → Customer Discount 2 → Customer
   Discount 3 → Cash **or** Term Discount → Authorized Manual Discount → Net KDV-exclusive amount
   → KDV → Invoice Total.
- Customer Discount 1/2/3 apply cascadingly. Cash and term remain mutually exclusive and apply
   only after the selected Customer Discount 1/2/3 stages.
- Promotion and customer discounts may both apply; promotion is always first.
- All calculations are KDV-exclusive. No intermediate decimal rounding is performed; subsequent
   discounts use the unrounded calculation value. UI/invoice display uses exactly two decimals.
- Sales representatives may select only active, VD Gıda-defined Customer Discount 1/2/3 rates;
   they cannot select inactive/undefined rates or modify a rate.
- A separately defined invoice/general-total discount is a distinct mechanism from line-level
   customer discounts and has not been given an authority, coexistence, or calculation-position
   decision by this record.
- Historical invoices retain immutable snapshots of source, selection, percentage, amount, and
   unrounded calculation results as required to reconstruct the finalized amount.

**Still open:** invoice/general-total discount coexistence/authority/sequence; statutory final
e-fatura/KDV rounding and presentation requirements. See `PRICING_RULES.md`.

---

## Decision 21: Customer-Based Transaction Assignment

**Status:** ✅ CONFIRMED business decision.

- Customer selection in either Order or Invoice creation resolves and displays the customer's
   default sales representative and default warehouse.
- A user may independently override either selection for that transaction. Changing one never
   automatically changes the other.
- Historical transaction data preserves customer defaults initially resolved and final selected
   representative/warehouse; later customer-profile changes never rewrite history.
- This assignment/prefill behavior occurs before and does not change the Decision 20 pricing and
   discount sequence.

**Still open:** selectable representative/warehouse RBAC scope; distributor authority to change
customer defaults; customer-change behavior after a manual override; order-to-invoice inheritance;
warehouse impact on reservations/shipments; commission/bonus impact.

Full detail: `SALES_RULES.md`, `ROLE_PERMISSION_MATRIX.md`, and `DATA_MODEL.md`.

---

## Decision 10: VD Gıda Central Access

**Decision A (Visibility):** Full Visibility - Yes ✅

VD Gıda can see:
- All distributors
- All warehouses
- All vehicles
- All sales representatives
- All customers
- All orders
- All shipments
- All payments
- All GPS/visits
- All stock levels
- All risk/credit

**Decision B (Distributor Isolation):** Strict Isolation - No ✅

Distributors CANNOT see:
- Distributor A cannot see Distributor B's customers
- Distributor A cannot see Distributor B's orders
- Distributor A cannot see Distributor B's stock
- Distributor A cannot see Distributor B's sales rep performance

**Technical Implementation:**
- VD Gıda = special admin tenant
- All queries include `WHERE tenant_id = current_tenant`
- VD Gıda tenant ID is special-cased in all queries
- Distributor tenants have no cross-tenant permissions

**Business Impact:**
- VD Gıda can monitor all operations
- Can generate aggregate reports
- Can detect fraud/anomalies
- Each distributor is isolated for data privacy
- Supports growth to external distributor network

**Related Documents to Update:**
- [x] SYSTEM_ARCHITECTURE.md - confirm hierarchy
- [x] ROLE_PERMISSION_MATRIX.md - VD Gıda Admin permissions
- [x] SECURITY_MODEL.md - tenant isolation enforcement

---

## Summary: What These 10 Decisions Mean

### System Architecture
```
VDesgo
  │
  ├── One PostgreSQL Database
  │   ├── All tenant data mixed
  │   └── Tenant isolation by row-level security (RLS)
  │
  ├── VD Gıda (Admin Tenant)
  │   ├── Owns product catalog
  │   ├── Sets base prices (centralized)
  │   ├── Sees all distributor data
  │   └── Cannot edit distributor operations
  │
  └── Distributor A, B, C (Regular Tenants)
      ├── Own customers
      ├── Own orders
      ├── Own vehicles/warehouses
      ├── Cannot see other distributors
      └── Can see aggregated VD Gıda data (prices, products)
```

### Data Isolation
- **By Tenant:** Distributor A data ≠ Distributor B data (strict)
- **By Central:** VD Gıda can see A+B+C (full visibility)

### Business Process
```
VD Gıda → Product Catalog → Distributor → Warehouse → Vehicle → Sales Rep → Customer → Order → Payment
```

### Impact on Roadmap
- **PHASE 1 (Architecture):** Schema design must enforce tenant_id on ALL tables
- **PHASE 2 (Auth):** RBAC must be tenant-aware; VD Gıda special case
- **PHASE 3 (Master Data):** Products created under VD Gıda tenant; Distributors reference
- **PHASE 4-8:** All operations respect tenant boundary
- **PHASE 10 (Control Center):** VD Gıda dashboard aggregates all tenants

---

## Next Steps

### 1. Confirm Decision 9 (Pricing) ⚠️

**Please clarify:** Can distributors have any pricing flexibility, or is pricing completely centralized?

### 2. Resolve Open Questions

With these 10 decisions, many OPEN QUESTIONS are resolved:
- Tenant hierarchy: DECIDED (Decision 1)
- Product ownership: DECIDED (Decision 2)
- Customer transfer: DECIDED (Decision 3)
- Sales rep tenure: DECIDED (Decision 4)
- Vehicle workflow: DECIDED (Decision 5)
- Negative stock: DECIDED (Decision 6)
- Order types: DECIDED (Decision 7)
- Offline operations: DECIDED (Decision 8)
- VD Gıda access: DECIDED (Decisions 10A+10B)

### 3. Update All Discovery Documents

Once Decision 9 is confirmed, update:
- DOMAIN_MODEL.md
- DATA_MODEL.md
- DATABASE_DESIGN.md
- DISTRIBUTOR_MODEL.md
- PRODUCT_CONTRACT.md
- SALES_RULES.md
- PRICING_RULES.md
- SYSTEM_ARCHITECTURE.md
- All relevant ADRs

### 4. Run DISCOVERY AUDIT v2

With all documents updated, re-run audit to confirm:
- RED count: 0
- YELLOW significantly reduced
- All contradictions resolved

### 5. Proceed to PostgreSQL Schema Design

Once AUDIT v2 is clean, begin database schema implementation.

---

## Document Status

- [x] DOMAIN_MODEL.md - needs update
- [x] DATA_MODEL.md - needs update
- [x] DATABASE_DESIGN.md - needs update
- [x] DISTRIBUTOR_MODEL.md - needs update
- [x] PRODUCT_CONTRACT.md - needs update
- [x] SALES_RULES.md - needs update
- [x] PRICING_RULES.md - needs update
- [x] SYSTEM_ARCHITECTURE.md - needs update
- [x] ROLE_PERMISSION_MATRIX.md - needs update
- [x] SECURITY_MODEL.md - needs update
- [x] MOBILE_APP_CONTRACT.md - needs update
- [x] All ADRs - may need clarification

---

**Prepared By:** Discovery Audit  
**Date:** 2026-08-30  
**Status:** PENDING DECISION 9 CONFIRMATION  
**Next Review:** Post-confirmation
