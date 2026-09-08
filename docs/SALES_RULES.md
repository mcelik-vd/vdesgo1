# Sales Rules

## Order Flow
- Draft
- Submitted
- Approved
- Rejected
- Preparing
- Dispatched
- Delivered
- Cancelled
- Returned

## Pricing at Order Time
**Critical Rule: Pricing is immutable and centrally managed.**

## Customer-Based Sales Representative and Warehouse Selection

This flow applies equally to Order and Invoice creation. It precedes pricing and does not change
the finalized Decision 20 calculation sequence.

1. User selects customer.
2. System resolves and displays `default_sales_representative_id` and `default_warehouse_id` from
    the current customer profile.
3. User may independently select another sales representative and/or warehouse from the permitted
    choices.
4. Changing sales representative never automatically changes warehouse; changing warehouse never
    automatically changes sales representative.
5. On customer change, system requests confirmation, clears prior manual representative/warehouse
    overrides and applied discounts, then resolves the new customer's defaults and discount profile.
6. System retains both initial defaults and final selected values as transaction snapshot/audit
    data; a later customer-profile change never changes historical order/invoice data.
7. The existing pricing, promotion, customer discount, payment discount, manual discount, and KDV
    flow then proceeds unchanged.

When an order is created:
1. System automatically resolves applicable price (pre-defined by VD Gıda)
2. Price is displayed to sales rep (read-only)
3. Price cannot be changed by sales rep, customer, or distributor
4. Price is captured and locked on the order (snapshot)
5. Active promotions are evaluated after price resolution, per `PROMOTION_RULES.md` §18.
6. Sales representative selects active Customer Discount 1/2/3 independently for each order item;
   selected discounts apply sequentially against that line's remaining KDV-exclusive amount, using
   only VD Gıda-defined rates.
7. Cash or term payment discount applies after the selected Customer Discount 1/2/3 stages; both
    may never apply together.
8. If price override needed, authorized manual discount approval workflow applies after promotion,
   customer, and payment discount stages.
9. Net KDV-exclusive amount is calculated without intermediate rounding, then KDV is calculated
    using product `vat_rate`; displayed monetary values use two decimals.
10. All price, customer discount, promotion, and manual override results are snapshotted and
    audited. See `PRICING_RULES.md` "FINAL CUSTOMER DISCOUNT CALCULATION CONTRACT".

## Order-to-Invoice Inheritance (Decision 23 — Confirmed)

When an approved order becomes an invoice, the invoice inherits the order's approved snapshot:
customer, selected sales representative, selected warehouse, initially resolved customer defaults,
price/discount breakdown, promotion applications, and other commercial snapshots. Customer-card
defaults are not re-read. The invoice therefore represents the approved order terms, not a new
pricing or assignment decision.

## Invoice Total Discount (Decision 25 — Confirmed)

After all line-level pricing, promotions, customer/payment discounts, and any authorized manual
discount have produced the KDV-exclusive invoice subtotal, a Distributor Admin may apply a separate
fixed-TL invoice-total discount. It is the final pre-KDV stage, may combine with other discounts,
and must be snapshotted/audited independently.

**This ensures:**
- Consistent pricing across all distributors
- Prevention of unauthorized discounting
- Fair customer treatment
- Centralized margin control

## Sales Actor Model
- customer
- sales representative
- distributor
- warehouse
- vehicle
- price (centrally defined)
- price override (with approval)
- discount (centrally defined)
- campaign (centrally managed)
- payment

## Commercial Rules
- Each order must be tied to a valid customer and active sales representative.
- Price is automatically resolved from VD Gıda's central pricing tables.
- Price override must be approved according to VD Gıda-defined policy.
- Stock reservation is created when order transitions Draft → Confirmed; see `INVENTORY_RULES.md`.

## Customer and Sales Logic
- Each customer has visit history, last order, last payment, risk exposure, and potential score.
- Customer churn risk is derived from recency and behavioral patterns.
- Sales reps have daily and monthly performance metrics.

## Open Questions
- OPEN QUESTION: What is the exact policy for order approval thresholds by order value or discount value?
- OPEN QUESTION: Which sales metric is the final target metric for each distributor and sales rep?
- OPEN QUESTION: When a user changes customer after manually selecting sales representative and/or
    warehouse, this is resolved by Decision 29: confirmation is required and prior manual selections
    and applied discounts are cleared before new customer defaults are resolved.
- RESOLVED BY Decision 23: Order-to-invoice conversion copies approved order snapshots; customer
    defaults are not re-resolved.
- OPEN QUESTION: How does a selected warehouse change affect stock reservation and shipment
    behavior?
- OPEN QUESTION: Does an actual sales-representative change affect commission/bonus attribution?
