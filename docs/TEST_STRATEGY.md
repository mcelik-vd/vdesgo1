# Test Strategy

## Test Levels
- Unit tests
- Integration tests
- API tests
- Database tests
- Business rule tests
- Permission tests
- Tenant isolation tests
- Golden tests
- End-to-end tests

## Critical Rule Tests
- Stock cannot become negative.
- Unauthorized users cannot approve orders.
- Minimum price rules must be enforced.
- Risk limits must be checked before risky commercial actions.
- Vehicle stock must decrease on sale or transfer.
- Returns must restore correct stock.
- Distributor A cannot access Distributor B records.
- Critical updates must create audit logs.

## Golden Tests
- stock 100, sale 20 -> expected 80
- stock 100, sale 20, return 5 -> expected 85
- order with invalid price -> rejection
- discount above threshold without approval -> rejection

## Promotion Golden Tests (Finalized Contract — 27 Tests)

Tests are grouped by whether they are fully specifiable today, conditionally specifiable pending a
RECOMMENDED BUSINESS DECISION's approval, or fully blocked by a genuine OPEN QUESTION.

**Mapping note:** A later requirements pass listed 14 golden scenarios independently (TEST 1–14 in
that pass). All 14 map onto tests already present below: TEST1→TEST-001, TEST2→TEST-002,
TEST3→TEST-003, TEST4→TEST-004, TEST5→TEST-007, TEST6→TEST-010, TEST7→TEST-008,
TEST8→TEST-013, TEST9→TEST-027 (new, order cancellation — distinct from TEST-019 promotion
deactivation), TEST10→TEST-023, TEST11→TEST-015, TEST12→TEST-016, TEST13→TEST-014,
TEST14→TEST-018/general negative-stock test. Net-new scenarios added in this update: tiered
promotion (TEST-025), explicit fixed-amount discount (TEST-026), and promotional order
cancellation (TEST-027, distinct from the pre-existing promotion-deactivation test TEST-019).

### Fully Specifiable (Ready to Implement Once Coding Begins)

- **TEST-001 (Buy X Get Y — Single Free Unit):** 10 koli → 1 koli bedava (same SKU). Expected: 10
  paid `order_items` + 1 free `order_items` (linked via `promotion_application_id`), 11 physical
  inventory movement units.
- **TEST-002 (Buy X Get Multiple Y):** 20 koli → 3 koli bedava. Expected: 20 paid, 3 free, 23
  physical inventory movement units; `max_reward_quantity` respected if a lower cap is configured.
- **TEST-003 (Quantity % Discount):** 5 koli → %5 discount. Expected: 5 paid units, no free
  `order_items` row, order total reduced by 5% relative to the centrally resolved price.
- **TEST-004 (Distinct SKU Count):** Basket contains 8 distinct SKUs → 1 free unit of a designated
  reward product. Expected: reward applied once per qualifying basket, not per SKU.
- **TEST-005 (Basket Amount Threshold):** Basket total ≥ 10.000 TL → %5 discount tier; ≥ 25.000 TL
  → %10 tier. Expected: correct tier selected based on basket total at evaluation time.
- **TEST-006 (Mixed Bundle):** Product A + B + C purchased together → Product D free. Expected:
  `promotion_product_rules` correctly aggregates A+B+C as qualifying, D appears as its own reward
  `order_items` row.
- **TEST-007 (Mix & Match):** 3 of A + 3 of B + 4 of C (10 total) → 1 of D free. Expected: combined
  quantity across A/B/C correctly evaluated against `min_quantity_group`.
- **TEST-008 (Customer-Specific Promotion):** Promotion targets Customer ABC only. Expected: ABC's
  order qualifies; an identical order from a different customer does not.
- **TEST-009 (Distributor-Specific Promotion):** Promotion targets Distributor A only. Expected:
  Distributor A's order qualifies; an identical order under Distributor B does not.
- **TEST-010 (Date Range Enforcement):** Order placed outside `valid_from`/`valid_to`. Expected:
  promotion not applied, no reward, no `promotion_applications` row created.
- **TEST-011 (Minimum Order Not Met):** Order below the promotion's `min_quantity`/`min_amount`.
  Expected: promotion not applied.
- **TEST-012 (Vehicle Instant Sale):** Direct vehicle sale of 10 koli with an active "10 al 1
  bedava" promotion. Expected: 11 physical units deducted from vehicle inventory, 1 tagged
  promotional, same evaluation engine as a standard order.
- **TEST-025 (Tiered Promotion):** Promotion defines tiers 5→%5, 10→%8, 20→%12 (shared
  `tier_level` across `promotion_conditions`/`promotion_rewards` pairs, see `PROMOTION_MODEL.md`).
  Order of 12 koli → expected: the 10-koli tier (%8) applies, NOT the 5-koli tier (%5) and NOT
  both cumulatively; an order of 25 koli → expected: the 20-koli tier (%12) applies exclusively.
- **TEST-026 (Fixed Amount Discount):** 20 koli → 500 TL fixed discount (`reward_type=
  fixed_discount`). Expected: order total reduced by exactly 500 TL, independent of unit price,
  no free `order_items` row created.
- **TEST-016 (Promotion Snapshot Immutability):** Promotion rule changed by VD Gıda after an order
  was placed under the original rule. Expected: the original order's `promotion_applications`
  snapshot is provably unchanged (byte-for-byte `promotion_rule_snapshot` comparison).
- **TEST-017 (Price + Campaign + Promotion Interaction):** Order qualifies for both an active
  campaign price AND a promotion reward. Expected: campaign price resolves first (Decision 9),
  promotion evaluates against that resolved price/quantity second (§18) — both apply, sequentially,
  without either mechanism altering the other's inputs.
- **TEST-018 (Free Goods Inventory Ledger):** Confirms §10 — a promotional unit produces a real
  `inventory_movements` entry, negative stock prohibition applies to the combined paid+free
  quantity.
- **TEST-019 (Promotion Cancellation):** Promotion deactivated (status → inactive) by VD Gıda.
  Expected: new orders placed after deactivation do not qualify; orders placed before deactivation
  keep their existing `promotion_applications` snapshot unaffected.
- **TEST-020 (Unauthorized Override Attempt):** Sales representative attempts to apply a
  promotion the order does not qualify for, without going through `promotion_override_requests`.
  Expected: rejection, no silent override possible.
- **TEST-021 (Audit Trail Completeness):** Promotion created, applied to an order, override
  requested and approved. Expected: each action produces a distinct, immutable `audit_logs` entry
  with correct `entity_type` (`promotion`, `promotion_application`, `promotion_override_request`).

### Conditionally Specifiable (Pending Approval of a RECOMMENDED BUSINESS DECISION)

- **TEST-013 (Promotion Stacking/Conflict):** Order qualifies for two promotions simultaneously.
  **Expected result per the §3 RECOMMENDED model (not yet approved):** the higher-`priority`
  promotion applies exclusively unless the two are explicitly marked mutually stackable. **This
  test cannot be finalized as a passing contract until VD Gıda approves the §3 recommendation.**
- **TEST-014 (Insufficient Reward Stock):** Paid quantity available, reward product out of stock.
  **Expected result per the §10 RECOMMENDED model (not yet approved):** paid portion is fulfilled,
  free reward is withheld for the unfulfilled quantity, shortfall is surfaced and audited, order is
  NOT blocked. **This test cannot be finalized as a passing contract until VD Gıda approves the
  §10 recommendation.**

### Blocked (Genuine Open Question, No Recommendation Given)

- **TEST-015 (Offline Promotion Conflict):** Sale created offline using a locally-cached promotion
  version that has since changed on the server. Expected result at sync time is **undecided** —
  see `PROMOTION_RULES.md` §12. Placeholder test only.
- **TEST-022 (Maximum Promotion Usage Limit):** Customer/distributor/period usage limit reached.
  Expected result is **undecided** — see `PROMOTION_RULES.md` §17 (whether this capability is even
  required for MVP is itself unresolved). Placeholder test only.
- **TEST-023 (Partial Order / Partial Return with Promotional Line):** A promotionally-linked order
  is partially returned, causing the remaining paid quantity to fall below the promotion's
  qualifying threshold. Whether the free-goods reward is reversed, kept, or proportionally
  recalculated is undecided — see `PROMOTION_RULES.md` §21 (Partial Return and Promotion
  Requalification). Placeholder test only.
- **TEST-024 (Duplicate Sync / Idempotency):** The same offline-created promotional sale is synced
  twice (e.g., due to a retry). Expected: no duplicate `promotion_applications` row and no duplicate
  inventory movement — this relies on the general offline idempotency mechanism (ADR-006), which
  itself has open duplicate-detection questions per DISCOVERY AUDIT v2 §12. Placeholder test only,
  pending resolution of the general (not promotion-specific) offline idempotency design.

### Fully Specifiable (Continued — Order Cancellation)

- **TEST-027 (Promotional Order Cancellation):** An order carrying an applied promotion (free
  goods + inventory movement) is cancelled. Expected (per `PROMOTION_RULES.md` §20, confirmed):
  `promotion_applications.status` → `reversed`; all paid AND free inventory movements reversed via
  the standard cancellation ledger mechanism; discount amount reversed as part of order total;
  full audit trail recorded. Note: whether this restores a usage-limit counter is a separate,
  still-open sub-question (§20) and is NOT part of this test's pass/fail criteria.

**Summary:** 18 of 27 tests (TEST-001–012, 016–021, 025–027) are fully specifiable today. 2
(TEST-013, TEST-014) require only a business sign-off on an already-drafted recommendation. 5
(TEST-015, TEST-022, TEST-023, TEST-024, and the usage-limit-restoration sub-question of TEST-027)
remain genuinely blocked pending decisions outside this task's authority to make.


## Open Questions
- OPEN QUESTION: Which business rules are required to be formalized as golden regression tests before first production release?
- OPEN QUESTION: Which API tests are mandatory for each core module in MVP?
- OPEN QUESTION: What is the target test coverage for financial and stock transaction flows?
- OPEN QUESTION: TEST-013/014 require VD Gıda approval of the RECOMMENDED BUSINESS DECISIONs in
  `PROMOTION_RULES.md` §3 and §10 before they can be finalized as passing test contracts.
- OPEN QUESTION: TEST-015/022/023/024 remain fully blocked pending resolution of their respective
  `PROMOTION_RULES.md` open questions (§12, §17, §21, and general offline idempotency).
- OPEN QUESTION: TEST-027's usage-limit-restoration sub-question remains blocked pending
  resolution of `PROMOTION_RULES.md` §20's open sub-question, itself dependent on §17.

## Customer Discount Golden Tests (New — Does Not Modify Any Promotion Test Above)

### Fully Specifiable Today

- **TEST-CD-001 (Cash Discount Applied):** Customer has `cash_discount_percentage=5%`. Invoice
  created with payment type = cash. Expected: 5% discount applied, snapshotted on
  `payment_discount_type_snapshot=cash`.
- **TEST-CD-002 (Term Discount Applied):** Customer has `term_discount_percentage=2%`. Invoice
  created with payment type = term. Expected: 2% discount applied, snapshotted on
  `payment_discount_type_snapshot=term`.
- **TEST-CD-003 (Cash and Term Never Simultaneous):** Attempt to apply both cash and term discount
  on the same invoice. Expected: rejected — only one payment-type discount may apply per the
  CONFIRMED mutual-exclusivity rule in `PRICING_RULES.md`.
- **TEST-CD-004 (Customer Discount 1 Applied):** `customer_discount_1_percentage` set → applied,
  snapshotted independently of discounts 2/3.
- **TEST-CD-005 (Customer Discount 2 Applied):** Same pattern for discount 2.
- **TEST-CD-006 (Customer Discount 3 Applied):** Same pattern for discount 3.
- **TEST-CD-008 (Sales Rep Cannot Change Rate):** Sales representative attempts to modify a
  customer's discount percentage from the invoice screen. Expected: rejected — rate can only be
  viewed/selected, never changed, by a sales representative.
- **TEST-CD-009 (Snapshot Immutability):** Invoice created using a customer's discount profile at
  time T. VD Gıda later changes the customer's discount percentages. Expected: the original
  invoice's snapshot fields remain unchanged (mirrors Decision 9/15 snapshot immutability).
- **TEST-CD-011 (Manual Discount Not Conflated with Customer Discount):** A sales rep's manual
  price override and a customer's standing discount both apply effects to the same order.
  Expected: recorded in distinct tables (`price_override_approvals` vs. `customers`/`order_items`
  snapshot fields) with distinct `audit_logs` entity_type values — never merged into one record.
- **TEST-CD-012 (Audit Source Correctness):** An invoice applies central price + customer discount
  + promotion + manual override simultaneously. Expected: audit log and reporting can distinguish
  all four sources independently (CENTRAL_PRICE / CUSTOMER_DISCOUNT / PROMOTION_ENGINE /
  PRICE_OVERRIDE_APPROVAL).

### Finalized by Decision 19

- **TEST-CD-007 (Multiple Customer Discounts Combined):** Customer has Customer Discounts 1/2/3
  defined and selected. Expected: all selected discounts apply sequentially against the remaining
  KDV-exclusive amount, never as an additive percentage.
- **TEST-CD-010 (Customer Discount + Promotion Together):** Order qualifies for both a customer
  discount and a promotion. Expected: promotion applies first; payment discount and selected
  Customer Discount 1/2/3 then apply to the remaining eligible KDV-exclusive amount.

**Summary:** All 12 initial customer-discount tests (TEST-CD-001–012) are now fully specifiable
under Decisions 19–20. Customer Discount 1/2/3 scope is line-level; only a separately defined
invoice/general-total discount's coexistence, authority, and sequence remain open.

### Customer Discount Tests Finalized by Decision 19

- **TEST-CD-013 (1+2+3 Cascading):** KDV-exclusive base 100.00 TL; selected discounts 10%, 5%,
  3%. Expected: 90.00 TL → 85.50 TL → 82.935 TL before KDV; percentages must not be summed to
  18%.
- **TEST-CD-014 (Cash + Customer Discount 1):** KDV-exclusive base 100.00 TL; cash discount 5%,
  Customer Discount 1 10% selected. Expected: 95.00 TL → 85.50 TL before KDV.
- **TEST-CD-015 (Term + Customer Discount 1/2/3):** KDV-exclusive base 100.00 TL; term discount
  2%, Customer Discounts 1/2/3 at 10%, 5%, 3% selected. Expected: 98.00 TL → 88.20 TL → 83.79
  TL → 81.2763 TL before KDV.
- **TEST-CD-016 (Promotion Before Customer Discount):** KDV-exclusive gross 100.00 TL; promotion
  discount 10%, then selected Customer Discount 1 at 5%. Expected: 90.00 TL → 85.50 TL before
  KDV; reverse-order calculation is rejected.
- **TEST-CD-017 (Selection, Not Rate Editing):** Sales representative selects Customer Discount 1
  at its VD Gıda-defined 5% rate. Expected: selected snapshot=true and 5% applied; any submitted
  attempt to change it to another rate is rejected.
- **TEST-CD-018 (All Three Selected):** Sales representative selects all Customer Discounts 1/2/3.
  Expected: all three selected snapshots=true and all three are applied sequentially.
- **TEST-CD-019 (No Commercial Ceiling):** Valid defined discounts combine to more than an
  arbitrary threshold such as 30% while the result remains non-negative. Expected: calculation is
  permitted; no artificial commercial cap is applied.
- **TEST-CD-020 (KDV After Discounts):** KDV-exclusive gross 100.00 TL, 10% discount, `vat_rate`
  20%. Expected: net KDV-exclusive=90.00 TL, KDV=18.00 TL, invoice total=108.00 TL.
- **TEST-CD-021 (Snapshot After Definition Change):** Invoice uses selected Customer Discount 1 at
  5%; VD Gıda later changes the customer definition to 7%. Expected: invoice retains selected=5%
  and its original amount snapshot.
- **TEST-CD-022 (Audit Source Separation):** Invoice contains promotion, payment discount,
  customer discount, and authorized manual discount. Expected: auditable reconstruction preserves
  each source separately, never merging them into a generic discount record.

### Customer Discount Tests Finalized by Decision 20

- **TEST-CD-023 (Line-Level Customer Discount):** Product A at 100.00 TL selects Customer
  Discount 1 at 10%. Expected: only Product A's KDV-exclusive line becomes 90.00 TL.
- **TEST-CD-024 (Independent Lines):** Product A selects 10% then 5%; Product B selects 3%;
  Product C selects none. Expected: A=85.50 TL from 100.00 TL, B=97.00 TL from 100.00 TL,
  C=100.00 TL; no line influences another.
- **TEST-CD-025 (D1→D2→D3 Cascading):** 100.00 TL with 10%, 5%, and 3% selected. Expected:
  90.00 → 85.50 → 82.935 before cash/term and KDV; never an additive 18% calculation.
- **TEST-CD-026 (Cash Order):** 100.00 TL with D1=10%, D2=5%, D3=3%, cash=5%. Expected:
  100.00 → 90.00 → 85.50 → 82.935 → 78.78825 before KDV.
- **TEST-CD-027 (Term Order):** 100.00 TL with D1=10%, D2=5%, D3=3%, term=2%. Expected:
  100.00 → 90.00 → 85.50 → 82.935 → 81.2763 before KDV.
- **TEST-CD-028 (Cash/Term Mutual Exclusion):** Both cash and term selected on one line.
  Expected: rejection.
- **TEST-CD-029 (Promotion Before Customer Discounts):** 100.00 TL line receives a 10%
  promotion effect, then D1=5%, then cash=5%. Expected: 100.00 → 90.00 → 85.50 → 81.225
  before KDV.
- **TEST-CD-030 (No Intermediate Rounding):** 100.00 TL, D1=10%, D2=5%, D3=3%, cash=5%.
  Expected: cash discount uses 82.935, not a displayed 82.94 value; result=78.78825.
- **TEST-CD-031 (Two-Decimal Display):** Internal line result is 82.935. Expected: display may
  show 82.94 TL while internal calculation retains 82.935.
- **TEST-CD-032 (Display Value Never Reused):** 82.935 is displayed as 82.94 before a subsequent
  5% stage. Expected: stage uses 82.935 and yields 78.78825, not 78.793.
- **TEST-CD-033 (Sales Rep Cannot Change Defined Rate):** Sales representative selects active D1
  at 5% but submits 7%. Expected: rejection; only the stored active 5% may be selected.
- **TEST-CD-034 (Separate Invoice-Total Mechanism):** Invoice carries line-level Customer Discount
  data and a separately defined general-total discount. Expected: mechanisms remain distinct in
  model, snapshot, and audit. Coexistence/calculation behavior is intentionally not asserted until
  its OPEN QUESTIONS are resolved.
- **TEST-CD-035 (Profile Change Does Not Alter History):** A line snapshot used D1=5%; VD Gıda later
  changes D1 to 7%. Expected: historical invoice stays at selected/applied 5% and original amount.

## Customer-Based Sales Representative and Warehouse Assignment Golden Tests

- **TEST-SR-WH-001:** Customer selection resolves and displays its default sales representative.
- **TEST-SR-WH-002:** Customer selection resolves and displays its default warehouse.
- **TEST-SR-WH-003:** User changes the prefilled sales representative; selected value is retained.
- **TEST-SR-WH-004:** User changes the prefilled warehouse; selected value is retained.
- **TEST-SR-WH-005:** User independently changes both sales representative and warehouse.
- **TEST-SR-WH-006:** Sales-representative change does not automatically change warehouse.
- **TEST-SR-WH-007:** Warehouse change does not automatically change sales representative.
- **TEST-SR-WH-008:** Customer replacement resolves the new customer's default sales
  representative after confirmation; prior manual selection and applied discounts are cleared.
- **TEST-SR-WH-009:** Customer replacement resolves the new customer's default warehouse.
  after confirmation; prior manual selection and applied discounts are cleared.
- **TEST-SR-WH-010:** Actual selected sales representative and initially resolved default are
  preserved on the order transaction snapshot.
- **TEST-SR-WH-011:** Actual selected warehouse and initially resolved default are preserved on the
  order transaction snapshot.
- **TEST-SR-WH-012:** Later change to a customer default sales representative does not alter a
  historical order/invoice snapshot.
- **TEST-SR-WH-013:** Later change to a customer default warehouse does not alter a historical
  order/invoice snapshot.
- **TEST-SR-WH-014:** Selection outside the eventual sales-representative RBAC scope is rejected.
- **TEST-SR-WH-015:** Selection outside the eventual warehouse RBAC scope is rejected.
- **TEST-SR-WH-016:** Order and Invoice creation exhibit the same default-resolution and
  independent-override behavior. Order-to-invoice inheritance uses the approved order snapshot
  under Decision 23.
- **TEST-SR-WH-017:** Manual Sales Representative/Warehouse selection lists exclude records outside
  the active distributor tenant.
- **TEST-SR-WH-018:** Changing customer on an active Order/Invoice with overrides or applied
  discounts requires confirmation.
- **TEST-SR-WH-019:** Accepting customer change clears manual Sales Representative/Warehouse
  overrides and applied discount state, then loads the new customer's defaults/profile.

## Desktop Workspace and Window Manager Golden Tests

- **TEST-WIN-001:** Customers, Orders, and Invoices module windows remain open concurrently.
- **TEST-WIN-002:** Launching an already-open module activates its existing work window rather
  than creating a redundant second module window.
- **TEST-WIN-003:** User can move a restored work window within workspace bounds.
- **TEST-WIN-004:** User can resize a restored work window while it remains usable and in bounds.
- **TEST-WIN-005:** Minimize keeps the work window alive and creates a taskbar-like entry.
- **TEST-WIN-006:** Selecting a minimized-window entry restores its prior window state.
- **TEST-WIN-007:** Minimize/restore preserves position, size, and unsaved form state.
- **TEST-WIN-008:** Activating a work window brings it to the foreground above inactive windows.
- **TEST-WIN-009:** Maximize then restore returns the work window to its prior bounds and form
  state.
- **TEST-WIN-010:** Closing a form with unsaved data requires confirmation and cannot silently
  discard the work; global browser `beforeunload` protection covers refresh, navigation, and tab
  closure while unsaved work exists.
- **TEST-WIN-011:** An Order work window remains usable while supporting module windows open.
- **TEST-WIN-012:** An Invoice work window remains usable while supporting module windows open.
- **TEST-WIN-013:** Customer selection in either work window updates default Sales Representative,
  Warehouse, and customer discount profile without changing Decision 20 pricing sequence.
- **TEST-WIN-014:** A list module such as Customers is single instance; relaunch activates it.
- **TEST-WIN-015:** Transaction/detail windows such as New Order, Invoice #100, and Invoice #101
  may coexist as distinct instances.
- **TEST-WIN-016:** Reload restores persisted layout state (bounds, z-order, open/minimized/
  maximized state) but does not restore unsaved in-memory form values.

## Decisions 22–26 Golden Tests

- **TEST-TENANT-001:** Distributor A attempts to read Distributor B operational data. Expected:
  PostgreSQL RLS denies access.
- **TEST-TENANT-002:** VD Gıda platform admin performs an audited cross-tenant read. Expected:
  access is permitted only through trusted platform-admin scope.
- **TEST-TENANT-003:** VD Gıda writes on behalf of Distributor A without explicit target
  `tenant_id`. Expected: rejection; no implicit tenant write is allowed.
- **TEST-INV-001:** Approved order converts to invoice after the customer default warehouse and
  representative change. Expected: invoice inherits order snapshots, never the new defaults.
- **TEST-INV-002:** Invoice inherits price, discounts, and promotion application snapshots.
  Expected: no price/promotion re-evaluation during conversion.
- **TEST-INV-003:** Distributor Admin applies fixed 500 TL invoice-total discount after line
  discounts and before KDV. Expected: it is separate from line-level customer discount, promotion,
  and manual price override.
- **TEST-INV-004:** Non-Distributor-Admin attempts to apply invoice-total discount. Expected:
  rejection.
- **TEST-VEH-001:** End-of-day vehicle with unsold stock. Expected: stock remains at vehicle
  location; no automatic vehicle-to-warehouse transfer ledger movement.
- **TEST-VEH-002:** Responsible representative changes while vehicle holds stock. Expected:
  auditable inventory transfer document and ledger movements record custody transfer.
- **TEST-VEH-003:** Vehicle count has shortage, surplus, and damaged item. Expected: vehicle count
  document records item results and validated count-difference/damage ledger movements.
- **TEST-RES-001:** Order transitions Draft to Confirmed. Expected: ledger reservation movement
  created for required available stock.
- **TEST-RES-002:** Confirmed order is cancelled. Expected: ledger release movement restores the
  reserved quantity to availability.
- **TEST-RES-003:** Partial delivery occurs. Expected: delivered quantity posts actual outbound
  movement and undelivered reserved quantity posts release movement.
