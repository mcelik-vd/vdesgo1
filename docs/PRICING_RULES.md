# Pricing Rules

## Authority & Governance
**VD Gıda is the sole owner and authority of all pricing and commercial terms.**

Distributors and sales representatives cannot unilaterally change prices. All pricing is defined, managed, and enforced centrally by VD Gıda through VDesgo.

## Pricing Components (All Centrally Defined)
- base price (VD Gıda sets)
- distributor price (VD Gıda sets per distributor if needed)
- customer price (VD Gıda approves per customer if needed)
- region price (VD Gıda defines)
- campaign price (VD Gıda manages)
- special price (VD Gıda approves)
- minimum price (VD Gıda enforces)
- discount (VD Gıda defines and approves)
- bonus (VD Gıda manages)
- **customer discount profile** (VD Gıda defines per customer — the concrete, structural form of
  the "customer-specific discounts" already listed above; see "Customer Discount & Invoice Pricing
  Contract" section below for full detail)

## Pricing Policy Principle
Pricing logic must be configuration-driven and not hardcoded in the UI or static business code. All pricing decisions originate from VD Gıda's central policy engine, not from distributor or field-level inputs.

## Price Resolution at Order Time
When an order is created, system applies price in this sequence (all pre-defined by VD Gıda):
1. Is there a customer-specific price? → Apply
2. Is there an active campaign? → Apply campaign price
3. Is there a distributor-specific price? → Apply
4. Is there volume-based pricing? → Apply based on quantity
5. Is there a region-based price? → Apply
6. → Apply standard list price

**System applies price automatically. Field user cannot override without formal approval.**

## Discount Model (All Centrally Managed)
All discounts are defined and approved by VD Gıda:
- Percentage discounts
- Fixed amount discounts
- Campaign-based discounts
- Customer-specific discounts
- Product-specific discounts
- Time-limited discounts
- Approval-required discounts

## Approval Rules for Price Overrides
If a field user needs to override the system price, approval workflow applies:

**Approval thresholds (configurable by VD Gıda):**
- 0–5% discount: Automatic
- 5–10% discount: Sales manager approval
- 10%+ discount: Distributor executive approval
- >20% discount: VD Gıda central approval

**All price overrides are fully audited and logged.**

## Related Updates
- Price snapshot captured at order time (immutable)
- Historical prices preserved for old orders
- Price changes do not affect past orders
- All price decisions logged in audit_logs
- No unilateral price changes by distributors or sales reps

## Relationship to Promotions
Promotions (see `PROMOTION_RULES.md`) are evaluated strictly **after** this price resolution
engine produces a final price. Promotions never change the resolved unit price; they add a
separate, independently-tracked reward (free goods and/or discount) on top of it. Pricing
authority and promotion authority are both held exclusively by VD Gıda, but they are distinct
mechanisms with distinct snapshot and audit records.

**Confirmed sequence (see `PROMOTION_RULES.md` §18):** base price → distributor/customer price →
campaign price (all three still within this document's price resolution engine) → promotion
evaluation (separate stage, downstream). Campaign price and a promotion reward may both apply to
the same order — they are not mutually exclusive alternatives.

---

## Customer Discount & Invoice Pricing Contract

**Status:** Discovery / Business Rule level. No production code, SQL, or migration exists yet.
**Conflict check performed:** This is a structural refinement of the already-approved
"customer-specific discount" pricing component (see Pricing Components list above) — it does not
introduce a new pricing authority, does not alter Decision 9, and does not conflict with any
existing ADR. **NO CONFLICT FOUND.**

### Authority (Unchanged — Confirms Decision 9)
VD Gıda is the sole authority that can define, change, activate, or deactivate a customer's
discount fields. Distributors may view and request; sales representatives may view and, where the
invoice screen allows, select which *already-defined* discount to apply — neither can change a
discount's rate.

### Customer Discount Fields (Defined on the Customer Record)
Five independent, VD Gıda-owned fields, per customer:

| Field | Business Name | Notes |
|---|---|---|
| `cash_discount_percentage` | Peşin İskonto | Applied only when invoice payment type = cash |
| `term_discount_percentage` | Vadeli İskonto | Applied only when invoice payment type = term |
| `customer_discount_1_percentage` | Müşteri İskontosu 1 | Independent standing discount |
| `customer_discount_2_percentage` | Müşteri İskontosu 2 | Independent standing discount |
| `customer_discount_3_percentage` | Müşteri İskontosu 3 | Independent standing discount |

Each field has a corresponding `*_is_active` flag. VD Gıda can activate/deactivate a defined
rate without discarding its commercial history; an inactive rate cannot be selected for a new
invoice. Historical invoice snapshots remain unchanged.

**Modeled as fields on the existing `customers` entity, not a new table.** These are standing
attributes of a customer's commercial terms, conceptually identical in ownership/audit pattern to
any other customer field (e.g., credit limit) — the existing generic `audit_logs` mechanism
(entity_type=`customer`, old_value/new_value per field) already covers change tracking without a
dedicated table. See `DATA_MODEL.md` for the field listing and `DATABASE_DESIGN.md` for the
relationship note.

### CONFIRMED Rule: Cash vs. Term Discount Are Mutually Exclusive
Per the business requirement itself (stated as a design rule, not left open): a single invoice
uses **at most one** of `cash_discount_percentage` OR `term_discount_percentage`, selected by the
invoice's payment type. The two are never applied together on the same invoice. **Conflict check:
no existing document addresses payment-type-based discounting; NO CONFLICT FOUND with any prior
decision.**

### Discount Source Tagging (Confirmed Design, Not a Business Decision)
Each discount line on an invoice/order is distinguishable by which snapshot field group it
occupies — no single generic "discount_source" enum is needed because the structure itself
separates sources:

| Source | Where It Lives | Authority |
|---|---|---|
| `CENTRAL_PRICE` | `order_items.unit_price` (existing) | VD Gıda (Decision 9) |
| `CUSTOMER_DISCOUNT` | New `order_items` fields (see snapshot below) | VD Gıda (this section) |
| `PROMOTION_ENGINE` | `promotion_applications` (existing, linked via `promotion_application_id`) | VD Gıda (Decision 11) |
| `PRICE_OVERRIDE_APPROVAL` | `price_override_approvals` (existing) | Approval workflow (Decision 9) |

This lets reporting answer "what was the central price / customer discount / promotion effect /
manual override" independently, per the business requirement's explicit ask.

### Invoice/Order Item Snapshot (Extends Existing Fields — No Duplication)
`order_items` already carries `unit_price`, `unit_price_source`, `unit_price_timestamp` (Decision
9) and links to `promotion_applications` (Decision 11) and `price_override_approvals` (Decision 9)
for the other two sources. **Only the customer-discount portion is new** and requires additional
fields, since up to five independent discount lines can apply simultaneously (unlike price or
promotion, which resolve to one value):

| New Field | Notes |
|---|---|
| `customer_discount_1_percentage_snapshot` / `_amount_snapshot` | Immutable copy of whichever value was active at order time |
| `customer_discount_2_percentage_snapshot` / `_amount_snapshot` | Same pattern |
| `customer_discount_3_percentage_snapshot` / `_amount_snapshot` | Same pattern |
| `customer_discount_1/2/3_selected_snapshot` | Boolean per discount, proving which VD Gıda-defined rates the sales representative selected |
| `payment_discount_type_snapshot` | `none` / `cash` / `term` |
| `payment_discount_percentage_snapshot` / `_amount_snapshot` | Reflects whichever of cash/term applied, per the mutual-exclusivity rule above |
| `final_unit_price_snapshot` | Net price after the finalized mandatory discount sequence; discount scope and rounding remain open |

For Decision 20, `final_unit_price_snapshot` preserves the unrounded KDV-exclusive calculation
value used by subsequent stages; a separate display value may present it at exactly two decimals.
This is not invoice/general-total discount data.

**Immutability guarantee (mirrors Decision 9 exactly):** if VD Gıda later changes a customer's
discount percentages, these snapshot fields on already-created orders are never updated.

## FINAL CUSTOMER DISCOUNT CALCULATION CONTRACT

This section finalizes the customer-discount commercial rules. It supersedes the resolved items in
the prior open-question list without changing Decisions 1–17, centralized pricing authority, or
the Promotion Engine architecture.

### Invoice Selection and Authority
- A sales representative may select any subset of the customer's already-defined Customer Discount
  1, 2, and 3 at invoice creation, including all three together.
- The representative controls only whether a defined discount is selected; they may never create,
  change, increase, decrease, or bypass its VD Gıda-defined percentage.
- Cash and term discounts remain mutually exclusive: the invoice applies cash **or** term discount,
  never both. The applicable payment discount may be used together with selected Customer Discount
  1/2/3 values.

### Mandatory Calculation Sequence

All monetary calculations use the KDV-exclusive gross/list amount. The mandatory order is:

```
GROSS / LIST PRICE (KDV EXCLUSIVE)
        ↓
PROMOTION
        ↓
CUSTOMER DISCOUNT 1 (if selected)
        ↓
CUSTOMER DISCOUNT 2 (if selected)
        ↓
CUSTOMER DISCOUNT 3 (if selected)
        ↓
PAYMENT DISCOUNT (CASH OR TERM)
        ↓
AUTHORIZED MANUAL DISCOUNT (if applicable)
        ↓
NET KDV-EXCLUSIVE AMOUNT
        ↓
KDV (using `products.vat_rate`)
        ↓
INVOICE TOTAL
```

Promotion is therefore evaluated before customer/payment discounts. This preserves the existing
Promotion Engine as a separate, downstream commercial mechanism: the engine determines its own
effect first; customer/payment discounts are calculated from the remaining eligible amount.

### Cascading Customer Discounts

Customer Discount 1/2/3 are applied sequentially against the remaining amount; their percentages
must never be added together as a single percentage. For example, 100.00 TL with 10%, 5%, and 3%
selected becomes 90.00 TL, then 85.50 TL, then 82.935 TL before KDV.

### Integrity and Snapshot Rules
- There is no commercial upper percentage ceiling for combined discounts. No arbitrary 30%, 50%,
  or similar cap may be introduced without a new explicit business decision.
- This is not a waiver of integrity controls: final net amount must not be negative, discount
  amounts must be valid monetary values, and decimal/rounding behavior must be deterministic.
- The invoice/order snapshot records which Customer Discount 1/2/3 values were selected and the
  percentage and amount actually applied, not merely the values defined on the customer record.
- Customer discount definition changes never alter a previously created order/invoice snapshot.

### Separate Invoice-Total Discount Mechanism

Customer Discount 1/2/3 are **product-line (`order_items`) mechanisms**. They apply only to the
line on which they are selected and never change another product line's calculation. VDesgo must
also support a separately defined invoice/general-total discount mechanism for the invoice total.
It is deliberately not modeled as a Customer Discount field, Promotion, or Manual Price Override;
these are distinct commercial mechanisms and must remain separately auditable and snapshotted.

**Decision 25 — Confirmed:** invoice/general-total discount is a separate mechanism that may
combine with other discounts. It is a fixed TL amount (not a percentage), applied by a Distributor
Admin only, against the invoice subtotal immediately before KDV calculation. It is never stored as
a Customer Discount 1/2/3 field, Promotion, or price override.

The invoice snapshot must retain `invoice_discount_amount_snapshot`, the actor, and the
pre-discount subtotal so the final invoice calculation is reconstructible. Exact entity fields and
final invoice rounding remain Phase 1 design detail; no generic discount entity or extra table is
introduced here.

### Remaining Open Questions (Customer Discount)
1. OPEN QUESTION: What decimal precision and final legal/accounting rounding rule applies to KDV
        and invoice/e-fatura values? Intermediate customer-discount calculation is explicitly not
        rounded, but the mandated final invoice rounding behavior has not been supplied.
2. OPEN QUESTION: The technical calculation is KDV-exclusive, but any Turkish e-fatura/KDV legal
   presentation or rounding requirement still requires ACCOUNTING REVIEW REQUIRED confirmation.
