# Promotion Rules

## Status
Discovery / Business Rule level. No production code, SQL, or migration exists yet.

## Authority (Confirms and Extends Decision 9 — Centralized Pricing)

**VD Gıda is the sole authority for promotions**, exactly as it is for pricing. This is not a new
authority model — it is the same authority extended to a new commercial mechanism.

| Actor | Can view active promotions | Can view promotion conditions | Can create/edit a promotion | Can override system-calculated result | Can request an exception |
|---|---|---|---|---|---|
| VD Gıda Admin / Marketing | ✅ | ✅ | ✅ | ✅ (with own audit trail) | N/A |
| Distributor Admin | ✅ | ✅ | ❌ | ❌ | ✅ (request only) |
| Sales Representative | ✅ | ✅ | ❌ | ❌ | ✅ (request only, subject to approval policy — see ROLE_PERMISSION_MATRIX.md) |

Every promotion exception request and every approval/rejection decision is audited (§7).

---

## 1. Order of Operations (Critical Rule)

Promotion evaluation happens **after** price resolution, never instead of it, and never before it.

```
1. Customer determined
2. Distributor determined
3. Products + quantities determined
4. PRICE RESOLUTION (Decision 9 — base/volume/distributor/customer/campaign price)
5. Active promotions looked up (tenant = VD Gıda, target match, date range active)
6. Eligibility checked against each candidate promotion's conditions
7. Conflicting/overlapping promotions resolved (§3 — OPEN QUESTION on exact rule)
8. Promotion reward(s) calculated
9. Applied to order (new line item for free goods, and/or discount applied to totals)
10. Snapshot recorded (`promotion_applications`, per PROMOTION_MODEL.md)
11. Inventory ledger movement created for all physical units, including free ones (§10)
12. Audit entry recorded (§7)
```

**This confirms the requirement in the task:** promotion never replaces or bypasses the pricing
system; it is strictly a downstream stage that operates on the already-resolved price.

---

## 2. Promotion Types — Business Rule Summary

All types are supported via the generic condition/reward/target model in `PROMOTION_MODEL.md`. No
type-specific business rule contradicts another; the type list is a coverage checklist, not a
technical constraint on the data model. Summary confirmed rules:

- A promotion's reward product **may be the same product that was purchased, or a different,
  specifically selected product.** Both are supported by `reward_product_id` being independent of
  the condition's `product_id`.
- A promotion may reference a **product group** (existing category, e.g. "Krutos Grubu") or an
  **ad-hoc product set** defined only for that promotion (bundle/mix-and-match types). Both are
  supported via `promotion_product_rules`.
- A promotion may target **all customers, one specific customer, or one specific distributor**,
  but ownership of the promotion definition never leaves VD Gıda regardless of target.
- A promotion always has a validity window (`valid_from`/`valid_to`) and a status
  (`draft`/`active`/`inactive`/`expired`/`archived`).
- A promotion may define a minimum quantity and/or minimum basket amount as its condition.

---

## 3. Promotion Conflict, Stacking, and Priority — OPEN QUESTIONS

**This section intentionally does not decide the business rule.** The task explicitly requires
this. Below is the analysis requested, followed by the specific open questions.

### Scenario Analyzed

```
Order: 10 koli Krutos 60g

Promotion 1: "10 koli al → 1 koli bedava"
Promotion 2: "10 koli al → %5 iskonto"

Both conditions are satisfied simultaneously by the same order line.
```

**Possible resolution models (none selected — for evaluation only):**

| Model | Description | Consequence |
|---|---|---|
| **Exclusive (best-of)** | System evaluates all eligible promotions and applies only the single most advantageous one to the customer | Simple to reason about, prevents "stacking abuse", but requires a clear definition of "most advantageous" (free goods vs. % discount are not directly comparable without a valuation rule) |
| **Stackable (both apply)** | Both promotions apply to the same order line, compounding the benefit | Requires an explicit `stacking_mode` per promotion and a defined stacking order; risk of unintended cumulative discounting beyond minimum price floor |
| **Priority-based** | Promotions have a `priority` value; higher-priority promotion applies, others are suppressed for the same qualifying units | Requires VD Gıda to assign and maintain priority values across potentially many active promotions |
| **Mutually exclusive groups** | VD Gıda explicitly tags promotions as belonging to a group where only one member of the group can apply at a time | Most explicit and safest, but adds a configuration burden per promotion |
| **First-match / rule order** | Promotions evaluated in a fixed order (e.g., creation order), first satisfied condition wins | Simple but arbitrary; likely to produce results VD Gıda did not intend |

**Fields already present in the domain model to support any of these outcomes without schema
change:** `promotions.priority` (nullable), `promotions.stacking_mode` (nullable enum:
`exclusive`/`stackable`/`best_of`).

### RECOMMENDED BUSINESS DECISION (Pending VD Gıda Approval)

Given VD Gıda's centralized commercial control model (Decision 9) and the goal of predictable
margin control, the recommended model is:

**Default: EXCLUSIVE, with explicit opt-in stacking.**

- By default, only **one** promotion applies per qualifying order line/basket — the one with the
  highest `priority` value (higher number = higher priority, matching the task's own example:
  100 > 50 > 10).
- Two promotions may combine on the same order **only if** VD Gıda explicitly links them as
  mutually stackable (opt-in). Absence of an explicit link means mutual exclusion by default —
  this prevents unintended cumulative discounting.
- If priorities are equal and neither is explicitly stackable: the promotion with the earlier
  `created_at` wins. This is a deterministic technical tiebreaker, not a business rule, and does
  not itself require separate business approval.
- `priority` is **optional**; if unset, it defaults to the lowest priority (0). It only matters as
  a tiebreaker among mutually-exclusive, simultaneously-eligible promotions — it has no effect on
  promotions explicitly marked stackable with each other.
- Campaign price (part of price resolution, Decision 9) and Promotion reward are **not** part of
  this stacking pool — they are sequential, different-mechanism stages that always both apply
  together (see §18, Campaign vs. Promotion Separation).

**Rationale:** Exclusive-by-default is the safest starting posture for a centralized commercial
control model — it prevents accidental compounding margin loss from unplanned promotion
combinations, while explicit opt-in stacking still allows VD Gıda marketing to intentionally
combine specific promotions when genuinely desired.

**This is a RECOMMENDATION, not a DECISION.** It requires explicit VD Gıda business sign-off
before implementation. Until approved, the underlying conflict-resolution behavior remains
formally OPEN, and the questions below stand.

### OPEN QUESTIONS (Decision 3 — Conflict/Stacking)

- OPEN QUESTION: Can more than one promotion apply to the same order/order line simultaneously, or
  is only one promotion ever applied per qualifying unit?
- OPEN QUESTION: If only one applies, is it selected by priority, by "most advantageous to
  customer", by mutual-exclusion grouping, or by another rule?
- OPEN QUESTION: If "most advantageous" is the rule, how is a free-goods reward compared in value
  to a percentage-discount reward for ranking purposes?
- OPEN QUESTION: Is `priority` a required field on every promotion, or only used as a tiebreaker
  when other rules don't resolve a conflict?
- OPEN QUESTION: Can VD Gıda mark two specific promotions as mutually exclusive even if their
  conditions don't otherwise overlap?

**No default behavior should be assumed or implemented until this is resolved** — an incorrect
default (e.g., silently stacking) could create unintended margin loss.

---

## 2a. Real-World Sales Scenarios (Worked Examples)

These scenarios confirm the domain model and rule set against concrete cases; none of them require
a new entity or contradict the model in `PROMOTION_MODEL.md`.

### Scenario 1 — Simple Buy X Get Y
```
Order: 10 koli Product A
Promotion: 10 → 1 free (same SKU)
Result: 10 paid order_items row + 1 free order_items row (linked via promotion_application_id)
Physical shipment: 11 koli
Inventory ledger: 11 units deducted total (paid + free, see §10)
```

### Scenario 2 — Quantity Percentage Discount (No Free Goods)
```
Order: 5 koli Product A
Promotion: 5 → 5% discount
Unit price: comes from central price resolution (Decision 9), UNCHANGED by the promotion
Promotion effect: 5% discount applied to the order line total, recorded in
  promotion_applications.discount_percentage_snapshot
No free-goods order_item is created — this scenario has no reward_product_id
```

### Scenario 3 — Distinct SKU Count Reward
```
Basket: 8 distinct SKUs (1+ unit each)
Promotion: 8 distinct SKUs → Product X free
Result: Product X appears as its own order_item (quantity 1, free), even though X may not have
  been part of the original 8 SKUs purchased
Invoice/accounting representation of the 0-TL line: OPEN QUESTION, see §5 and §18 (ACCOUNTING
  REVIEW REQUIRED)
```

### Scenario 4 — Mix & Match Across Two Products, Reward is a Third Product
```
Order: 10 koli Product A + 10 koli Product B
Promotion: (A or B combined) ≥ 20 koli → 2 koli Product C free
promotion_product_rules: role=qualifying for both A and B (promotion_id shared)
promotion_conditions: min_quantity_group = 20 (aggregated across A+B)
promotion_rewards: reward_product_id = C, reward_quantity = 2
Result: 2 free units of C, tracked as their own order_item(s) and ledger movement
```

### Scenario 5 — Vehicle Instant Sale
```
Vehicle stock: sufficient for 10 paid + 1 free (Buy 10 Get 1 Free)
Sales rep sells 10 koli directly from the vehicle
Engine applies the same evaluation as a standard order (§9) — no separate vehicle logic
Ledger: vehicle_id-scoped movement(s) totaling 11 units deducted (see §11 for full detail)
```

### Scenario 6 — Customer-Specific Promotion Enforcement
```
Promotion: targets ONLY Customer ABC (promotion_targets.target_type = specific_customer)
Customer ABC orders 10 koli → qualifies, 2 koli free
Customer XYZ orders the identical 10 koli → does NOT qualify (target mismatch), no reward,
  no promotion_applications row created for this order
```

---

## 4. Promotion and Central Pricing — Non-Contradiction Confirmed

| Central Pricing Authority (Decision 9) | Promotion Authority (this document) | Conflict? |
|---|---|---|
| VD Gıda sets base/volume/distributor/customer/campaign price | VD Gıda sets promotion conditions/rewards | ❌ No — same authority, additive stage |
| Distributor cannot change price | Distributor cannot change promotion result | ❌ No — same restriction pattern |
| Sales rep cannot override price without approval | Sales rep cannot override promotion without approval | ❌ No — same restriction pattern |
| Price override → `price_override_approvals` | Promotion override → `promotion_override_requests` | ❌ No — parallel, separate tables, same approval philosophy |
| Price is snapshotted immutably on order | Promotion result is snapshotted immutably (`promotion_applications`) | ❌ No — consistent pattern |
| All price changes audited | All promotion changes and applications audited | ❌ No — consistent pattern |

**Conclusion: No architectural contradiction found.** Promotion is confirmed as an additive stage
that sits strictly between price resolution and order total calculation, per §1.

---

## 5. Invoice / Order Line Representation — OPEN QUESTION

Three options analyzed, per the task's requirement not to assume tax/accounting treatment:

**Option A:** 10 koli invoiced at full price; the 1 free koli is shown as a promotion annotation
on the same line (no separate line item), reducing the effective unit economics only in reporting,
not on the invoice line itself.

**Option B:** 11 line items are created — 10 at normal unit price, 1 at 0 TL explicitly tagged as
a promotional line, both appearing on the order/invoice.

**Option C:** Some other model driven by e-invoice (e-fatura) / accounting integration
requirements not yet known (e.g., free goods may need to be invoiced at value with an equal
offsetting discount line, for VAT/KDV compliance reasons in some jurisdictions).

**No option is selected.** This requires input from accounting/e-fatura integration and is
explicitly out of scope for a technical or domain-only decision.

### OPEN QUESTIONS (Decision 5 — Invoicing)

- OPEN QUESTION: Which of Option A/B/C (or a variant) reflects VD Gıda's actual accounting and
  e-fatura requirements?
- OPEN QUESTION: Does Turkish e-fatura/KDV regulation require free goods to appear as a priced
  line with an offsetting discount, rather than a 0 TL line? (Requires mali müşavir / accounting
  confirmation — not a technical decision.)
- OPEN QUESTION: Does the answer differ for free goods of the *same* SKU vs. a *different* SKU?

**What is decided regardless of the above:** the physical inventory movement for the free unit
always occurs (§10) — this is independent of how it is eventually represented on an invoice.

---

## 6. Promotion Snapshot on Order (Confirmed, Not Open)

At the moment a promotion is applied to an order, the following is captured immutably in
`promotion_applications` (see `PROMOTION_MODEL.md` for full field list):

```
promotion_id
promotion_version
promotion_name_snapshot
promotion_type_snapshot
promotion_rule_snapshot (full JSON of conditions/rewards as evaluated)
qualifying_quantity
free_quantity
reward_product_id_snapshot
discount_percentage_snapshot
discount_amount
applied_at
applied_by
```

**Rule (mirrors Decision 9 price snapshot rule exactly):** If VD Gıda later edits or deletes the
promotion, the order's historical `promotion_applications` record is never changed. This is a
DECIDED rule, not open — it follows directly from the existing, already-confirmed pricing
immutability principle and applies it consistently to promotions.

---

## 7. Promotion Audit Scope (Confirmed, Not Open)

The following actions must produce an audit log entry, following the same `audit_logs` structure
used for pricing (see `AUDIT_POLICY.md`):

- promotion created
- promotion modified (any condition, reward, target, or validity field)
- promotion activated
- promotion deactivated
- promotion deleted / archived
- promotion applied to an order (via `promotion_applications`, which is itself an append-only
  audit-equivalent record, but a corresponding `audit_logs` entry is still created for
  cross-domain audit queries)
- promotion manually overridden by an authorized user
- promotion override requested
- promotion override approved
- promotion override rejected

This is a direct extension of the existing `AUDIT_POLICY.md` scope — no new audit mechanism is
introduced, only new `entity_type` values (`promotion`, `promotion_application`,
`promotion_override_request`).

---

## 8. Promotion Management (Domain/Contract Only — No UI)

VD Gıda's future promotion management capability (create, select type, select
product/group, set minimum quantity, set free product, set discount %, select customer, select
distributor, set date range, set priority, activate/deactivate, description) maps directly onto
the entity model in `PROMOTION_MODEL.md`:

| UI Capability (future) | Backing Entity |
|---|---|
| Create promotion, description, date range, active/inactive | `promotions` |
| Select product/group + minimum quantity | `promotion_conditions` + `promotion_product_rules` |
| Set free product + quantity, or discount % | `promotion_rewards` |
| Select customer / distributor | `promotion_targets` |
| Set priority | `promotions.priority` (pending §3 resolution) |

No frontend or API implementation is included in this phase.

---

## 9. Promotion Engine — Evaluation Flow (Documented, Not Implemented)

This is the same 12-step sequence as §1, restated here as the canonical "Promotion Engine" flow
referenced elsewhere in the documentation set:

1. Determine customer
2. Determine distributor
3. Determine products in the order
4. Determine quantities per product
5. Resolve price (Decision 9 engine — unchanged, runs first)
6. Find active promotions (status=active, valid_from ≤ now ≤ valid_to, target matches
   customer/distributor/all)
7. Check eligibility against each candidate's conditions
8. Resolve conflicts among eligible candidates (§3 — pending decision)
9. Calculate reward result(s)
10. Apply to order (line items / discount total)
11. Create snapshot (`promotion_applications`)
12. Create inventory ledger movement(s) for all physical units (§10)
13. Create audit log entry (§7)

---

## 10. Promotion and Inventory

**Confirmed rule:** A free unit is a real physical unit and must be tracked identically to a paid
unit in the inventory ledger (per ADR-004 — no exception for promotional stock). There is no
concept of "free stock" that bypasses the movement ledger.

### RECOMMENDED BUSINESS DECISION (Pending VD Gıda Approval) — Insufficient Reward Stock

Recommended model: **paid portion is fulfilled, the order is NOT blocked, the free reward is
not granted if unavailable, and the shortfall is surfaced to the user and audited (not a silent
failure).**

- The paid quantity sale proceeds normally — a real, fulfillable sale is never blocked because of
  an unrelated stock shortage on a different reward SKU.
- If the specific reward product cannot be fulfilled (fully or partially) due to insufficient
  stock, the unfulfilled free-goods portion is simply not granted for the missing quantity.
- The sales representative and the order confirmation must clearly display that the promotion
  could not be (fully) honored due to stock availability.
- A `promotion_applications` row is still created, with `free_quantity` reflecting only the
  quantity actually fulfilled (which may be zero), fully audited.
- **Rejected as the recommended default:** blocking the entire paid order (penalizes a real sale
  for an unrelated shortage) and indefinitely holding the order (adds operational complexity not
  justified for MVP).

**This is a RECOMMENDATION, not a DECISION**, and requires explicit VD Gıda business sign-off
before implementation. The formal open questions below stand until that approval is given.

### Example

```
Warehouse: 100 koli Krutos 60g

Order: 10 koli paid + 1 koli promotional (Buy 10 Get 1 Free)

Ledger entries:
  movement_type = 'sale', quantity_delta = -10, reference = order_item (paid)
  movement_type = 'sale', quantity_delta = -1,  reference = promotion_application (free)
    (or: single 'sale' movement of -11 with a linked promotion_application reference —
     exact modeling choice deferred to schema design phase)

Warehouse after: 89 koli
```

**Rules confirmed (consistent with Decision 6 — Negative Stock Forbidden):**
- Stock check (available ≥ requested) applies to the **combined total** (paid + free units), not
  just the paid quantity.
- Negative stock remains forbidden for promotional units exactly as for paid units.
- Vehicle stock checks apply identically (§11).
- Reservation (where applicable, pending Discovery Audit v2 resolution of reservation lifecycle)
  must reserve the combined total, not just the paid quantity.
- A return of a promotionally-obtained free unit must be handled by the same return process as a
  paid unit — the ledger does not distinguish "free" units as non-returnable by default.

### OPEN QUESTIONS (Decision 10 — Stock Sufficiency)

- OPEN QUESTION: If a promotion is satisfied by the paid quantity, but the warehouse/vehicle has
  insufficient stock to fulfill the *free* unit specifically (e.g., enough Krutos 60g for the
  purchase, but the free reward product is a different, out-of-stock SKU), what happens?
  - Is the whole order blocked?
  - Is the paid portion fulfilled and the promotion silently dropped?
  - Is the promotion partially fulfilled (fewer free units than entitled)?
- OPEN QUESTION: Is the ledger modeled as one combined movement (paid+free) or two separate
  movements (one per reason)? This affects reporting granularity (§16) and is a schema-design-time
  decision, not a business decision — deferred to Phase 1.
- OPEN QUESTION: Can a return reverse only the paid portion, only the free portion, or must it
  always be all-or-nothing for a promotionally-linked order line?

---

## 11. Promotion and Vehicle Instant Sale (Araçtan Anlık Satış)

**Confirmed:** The Promotion Engine (§9) runs identically for direct vehicle sales (Decision 7,
Sales Type B) as it does for standard orders. There is no separate promotion logic for field sales.

### Example (as specified in the task)

```
Vehicle stock: 12 koli Krutos 60g

Customer purchase: 10 koli (direct vehicle sale)

Active promotion: "10 koli al → 1 koli bedava"

Engine result:
  10 koli paid
  1 koli free (same SKU in this example)
  Total physical movement: 11 koli

Ledger entry: vehicle_id = <vehicle>, movement_type = 'sale',
              quantity_delta = -11, reference_type = 'promotion_application' (for the free unit
              portion) and 'order'/'sale' (for the paid portion) — exact single-vs-split movement
              modeling is the same open question as §10.

Vehicle stock after: 1 koli
```

**Confirmed rule:** Vehicle stock sufficiency check (§10's combined-total rule) applies before the
sale completes — the same negative-stock prohibition holds for vehicle inventory as for warehouse
inventory (Decision 6, unchanged).

---

## 12. Offline Mobile Promotion — Analysis and OPEN QUESTIONS

**This mirrors the exact structure of the already-decided offline pricing model (Decision 8 /
PRICING_RULES.md), extended to promotions. No new offline architecture is introduced — the same
offline-first pattern with server-side final validation applies.**

### Scenario Analyzed (as specified in the task)

```
Sales rep is offline.
Device's last-synced promotion: "10 koli al → 1 koli bedava" (version N)
VD Gıda has since changed the promotion on the server to version N+1 (or deactivated it).
Sales rep completes an offline sale using version N.
```

### Mechanisms Available in the Domain Model (already included, not yet decided how to use)

- `promotions.version` — allows the server to detect that the device's cached promotion is stale
  at sync time.
- `valid_from` / `valid_to` — allows evaluating whether the promotion was valid at the **offline
  transaction timestamp**, regardless of when sync occurs (this is the same principle already
  established for price snapshots: the price/promotion that matters is the one valid at
  transaction time, not at sync time).
- A device-side `synced_at` / `last_known_promotion_version` (mobile sync metadata, not a new
  server table) would let the app show the sales rep an accurate "as of last sync" promotion list.

### What Is Consistent With Already-Decided Offline Rules (Not Open)

- Per Decision 8, a sales order/sale created offline is provisional until server-side validation.
- Per the pricing precedent, the transaction timestamp — not the sync timestamp — determines which
  price/promotion *should* have applied.

### OPEN QUESTIONS (Decision 12 — Offline Promotion Conflict)

- OPEN QUESTION: If the promotion was valid at the offline transaction timestamp (per the device's
  cached version) but was deactivated or changed on the server before sync occurs, does the server
  honor the promotion as it existed at transaction time, or does it re-evaluate using the
  server's current (post-change) rules?
- OPEN QUESTION: If the server rejects/adjusts the promotion at sync time, how is this
  communicated back to the sales rep, and can the customer-facing total change after the sale
  appeared complete in the field?
- OPEN QUESTION: Is a grace period needed (e.g., promotions changed less than X hours ago are still
  honored for pending offline transactions)?
- OPEN QUESTION: Does device replacement (already an open question in DISCOVERY AUDIT v2) also
  reset cached promotion state, and if so, how does a pending offline sale on the old device
  reconcile?

**No default is assumed.** This is explicitly the same category of risk already flagged as RED in
DISCOVERY AUDIT v2 §12 (Offline stale price/stock) — promotions inherit that same open risk and do
not introduce a new one, but they do not resolve it either.

---

## 13. Reporting — MVP vs. Later Phase

| Report | Phase |
|---|---|
| Which promotion was used, how many times | MVP |
| Which customer used which promotion | MVP |
| Total free units given (by product) | MVP |
| Total discount amount from promotions | MVP |
| Which distributor / sales rep applied a promotion | MVP |
| Promotion cost (monetary value of free goods + discounts) | Later phase (requires cost/margin data not yet modeled) |
| Campaign-driven sales uplift (before/after comparison) | Later phase (requires baseline sales analytics) |
| Product-level promotion usage trends | Later phase |
| Promotion ROI | Later phase (requires cost data + uplift analysis, both later-phase dependencies) |

This split follows the existing `MODULE_MAP.md` MVP-focus principle: reports needing only
`promotion_applications` data are MVP; reports needing cost/margin or trend-baseline data are
later phase.

---

## 14. Priority Field — OPEN QUESTION (Cross-reference to §3)

Whether a numeric `priority` system (e.g., 100 = major campaign, 50 = normal, 10 = minor) is
required depends entirely on the resolution of §3 (stacking/conflict model). If the eventual model
is "mutually exclusive groups" or "first-match by explicit business rule", a numeric priority may
not be needed at all. The field exists in the domain model as an option, not a commitment.

**OPEN QUESTION: Should priority be a required field on every promotion, an optional tiebreaker, or
unnecessary entirely under the eventual conflict-resolution model?**

---

## 15–16. UX and Reporting Detail

Not elaborated further here — UI/UX design and detailed reporting field lists are explicitly out of
scope for this discovery/domain phase per the task instructions ("henüz UI tasarımını kodlama").

---

## 17. Promotion Usage Limits — Evaluation and OPEN QUESTIONS

The business requirement raises six distinct limit dimensions (expanded from four in the prior
pass to explicitly cover quantity and free-goods ceilings). Each is evaluated independently — no
assumption is made that any of them is required for MVP.

| Limit Type | Example | Assessment |
|---|---|---|
| Order limit | Max free units grantable within a single order | Already supported by `promotion_rewards.max_reward_quantity` (existing field) — no new entity needed |
| Customer limit | Customer can use a promotion max N times total or per period | NOT currently modeled — would require either a new counter field or a derived count query against `promotion_applications` (filtered by customer_id + promotion_id) |
| Distributor limit | Distributor's total promotion usage capped | Same as above — derivable from `promotion_applications` filtered by distributor, no new table strictly required if a query-time count is acceptable |
| Campaign-wide limit | Promotion has a total usage/budget ceiling across ALL customers/distributors (e.g., "first 1,000 uses only") | Same derivation approach — COUNT across all `promotion_applications` for the promotion_id, no new table required for MVP |
| Quantity limit | Customer capped at max 100 koli total under this promotion, regardless of order count | Same derivation approach — SUM of `qualifying_quantity` across a customer's `promotion_applications` rows |
| Free goods limit | Campaign-wide cap of, e.g., max 10,000 free koli distributed | Same derivation approach — SUM of `free_quantity` across all `promotion_applications` for the promotion_id |
| Date-period limit | E.g., "max 10 times per month" | Requires a defined period boundary (calendar month? rolling 30 days?) — not yet specified |

**Recommended approach if this capability is confirmed as needed:** avoid a new dedicated
"usage counter" table for MVP; derive all six dimensions from `promotion_applications` at
evaluation time (COUNT/SUM query filtered by promotion_id + customer_id/distributor_id + date
range). This avoids adding an eighth promotion table for a capability that may not be required at
all. If performance/concurrency later requires a denormalized counter (e.g., to prevent a race
condition where two simultaneous orders both pass a "only 1 use left" check), that is a
schema-design-time optimization, not a Discovery-phase concern — flagged as an explicit OPEN
QUESTION below rather than assumed either way.

### OPEN QUESTIONS (Usage Limits)
- OPEN QUESTION: Is any usage limit (order/customer/distributor/campaign/quantity/free-goods/
  period) actually required for MVP, or is this a later-phase capability?
- OPEN QUESTION: If required, what are the actual limit values and which dimension(s) apply per
  promotion?
- OPEN QUESTION: What happens when a usage limit is reached mid-order — is the promotion simply
  not applied (silently), or does the system need to notify the sales rep/customer explicitly?
- OPEN QUESTION: Does enforcing a campaign-wide or free-goods-total limit require a
  concurrency-safe (e.g., row-locked or denormalized-counter) mechanism rather than a plain COUNT
  query, given multiple simultaneous orders could otherwise both pass a near-exhausted limit?

**No fields are added to the schema for this capability beyond what already exists
(`max_reward_quantity`) until the above is resolved**, consistent with the no-unnecessary-table
principle.

---

## 18. Campaign vs. Promotion — Separation and Sequencing (Confirmed)

This is **not** a new open question — it follows directly from architecture already established
in `PRICING_RULES.md` and `SALES_RULES.md`, restated here explicitly for clarity as requested.

**Definitive separation of responsibility:**

| Concept | Owned By | Affects | Table |
|---|---|---|---|
| `campaigns` | VD Gıda | **Unit price** — campaign price is one of the inputs to price resolution (Decision 9), alongside base/volume/distributor/customer price | `campaigns` (pricing domain) |
| `promotions` | VD Gıda | **Reward** — free goods and/or a promotion-specific discount, calculated on top of the already-resolved price | `promotions` (promotion domain) |

**Confirmed sequence on a single order (does not change per this task):**

```
1. Base price
2. → Distributor-specific / customer-specific price adjustment (if defined)
3. → Campaign price (if an active campaign applies) — this is still PRICE RESOLUTION (Decision 9)
4. → PROMOTION EVALUATION (this document) — runs against the already-resolved price/quantity,
     never re-opens or changes steps 1–3
5. → Order total = (resolved price × quantity) − promotion discount, plus any free order_items
```

**Can campaign price and a promotion both apply to the same order? — CONFIRMED: YES.** They are
not alternatives to each other; a campaign changes what the customer pays per unit, a promotion
adds a reward on top. There is no architectural conflict because they operate on different
aspects (price vs. reward) at different, sequential stages.

**What remains open:** whether the *combined* commercial effect of an active campaign price
**plus** a promotion reward on the same order should itself be subject to a stacking-style review
(e.g., a deeply discounted campaign price stacked with a generous free-goods promotion could
exceed intended margin, even though neither individually violates a rule). This is flagged as a
risk, not resolved here.

### OPEN QUESTION (Campaign + Promotion Combined Effect)
- OPEN QUESTION: Should VD Gıda have visibility/alerting when a campaign-priced order also
  qualifies for a promotion, given the compounding commercial effect, even though both are
  individually authorized?

---

## 19. Order Item Modeling for Promotional Rewards (Confirmed — Architectural, Not Business)

This is a domain-modeling decision, not a commercial one, and is therefore confirmed here rather
than left open (consistent with how the price-snapshot-on-order_items decision was previously
made without requiring separate business sign-off).

**Decision: A promotion reward (free goods) always creates a SEPARATE `order_items` row — it
never modifies the quantity or price of the paid order item it was triggered by.**

| Field | Paid order_item | Promotional (reward) order_item |
|---|---|---|
| quantity | Ordered quantity | Reward quantity (from `promotion_rewards.reward_quantity`) |
| unit_price | Resolved price (Decision 9) | 0, or accounting-determined value — see §5/§25 (ACCOUNTING REVIEW REQUIRED) |
| discount_percentage | N/A unless independently discounted | N/A (reward is not itself discounted) |
| promotion_application_id | Null | FK → `promotion_applications` (identifies which promotion produced this line) |
| is_promotional / free_goods flag | false | true |
| inventory movement | Standard `sale` movement | Same movement type as a paid sale (§10) — no separate "free" movement type, only the linking reference differs |

**Rationale:**
- Keeps the paid order item's price/discount fields exactly as resolved by the pricing engine —
  no risk of a promotion accidentally corrupting the pricing snapshot.
- Makes reporting trivial: any query for "free goods given" simply filters
  `order_items.is_promotional = true`, joined to `promotion_applications`.
- Matches the already-established pattern of `promotion_applications.order_item_id` being
  nullable and independent from the paid item (see `PROMOTION_MODEL.md` §6).

**What remains open:** the exact `unit_price` value shown on this line for invoicing purposes
(0 TL vs. priced-with-offsetting-discount) — this is an ACCOUNTING REVIEW REQUIRED item, not an
architectural one (see §5, §25).

---

## 20. Order Cancellation Impact on Promotion (Confirmed, With One Open Sub-Question)

**Confirmed rule (derived from existing generic order-cancellation and ledger-reversal
principles — not a new promotion-specific mechanism):**

When an order carrying a `promotion_applications` row is cancelled:
- The `promotion_applications.status` transitions from `applied` to `reversed` (the row itself is
  never deleted — consistent with append-only audit principles).
- Every inventory movement created for that order (paid AND free units, per §10) is reversed using
  the same cancellation/return ledger mechanism used for ordinary paid units — there is no special
  "promotion cancellation" movement type.
- Any discount amount applied is reversed as part of the order's total reversal — the promotion
  does not need its own separate financial reversal process.
- The reversal is fully audited (§7), tied to the cancelling user, order, and original
  `promotion_application_id`.

**This is confirmed because it requires no new mechanism** — it is the direct, necessary
consequence of (a) the immutable-but-reversible snapshot model already established for pricing and
promotions, and (b) the existing generic order-cancellation/ledger-reversal behavior that applies
regardless of whether a promotion was involved.

### OPEN QUESTION (Order Cancellation — Usage Counter Interaction)
- OPEN QUESTION: If usage limits (§17) are eventually implemented, does cancelling an order
  restore ("give back") the customer's/campaign's usage count, or does a cancelled attempt still
  count against the limit? This cannot be answered until §17 itself is resolved.

---

## 21. Partial Return and Promotion Requalification (OPEN QUESTION)

This is explicitly **not** decided here, per the task's requirement to avoid assumption on this
specific scenario.

### Scenario Analyzed
```
Order: 10 koli paid + 1 koli free (Buy 10 Get 1 Free)
Customer later returns 2 koli of the paid portion.
Remaining paid quantity: 8 koli — now BELOW the promotion's 10-koli qualifying threshold.
```

**Three possible treatments (none selected):**
| Option | Description |
|---|---|
| A — No recalculation | The original promotion snapshot stands; the customer keeps the free koli regardless of the later partial return, because the snapshot was correct *at order time* (consistent with the general immutable-snapshot principle) |
| B — Full clawback | The free koli must also be returned/reversed because the qualifying condition is no longer met post-return |
| C — Proportional recalculation | The system recalculates as if the return had been known at order time (e.g., an 8-koli order may qualify for a different tier or no promotion at all), adjusting the free quantity accordingly |

**Tension with existing confirmed rules:** Option A appears most consistent with the
already-established immutable-snapshot principle (§6, §19 — "later changes don't affect past
orders"), but a return is a *new* event, not a retroactive edit to the *original* promotion — so
this is a genuinely distinct question from promotion-rule-change immutability, not resolved by the
same principle. It is not assumed here.

### OPEN QUESTIONS (Partial Return)
- OPEN QUESTION: If a return causes the remaining paid quantity to fall below the promotion's
  qualifying threshold, is the free-goods reward reversed, kept, or proportionally recalculated
  (Option A/B/C above)?
- OPEN QUESTION: Does the answer differ between a percentage-discount promotion (where a partial
  clawback is a simple monetary adjustment) and a free-goods promotion (where clawback means the
  customer must physically return a product they may have already consumed)?
- OPEN QUESTION: Is a returned *free* unit itself (as opposed to a returned paid unit) handled
  identically to a returned paid unit in the inventory ledger, or does it require special handling
  since it was never actually paid for?

---

## 22. Manual Discount vs. System-Generated Promotion (Confirmed Separation)

**Confirmed rule:** A sales representative's ad-hoc manual discount request (e.g., "let me give
this customer 5% off") is **never** recorded as a `promotion_applications` row, regardless of how
similar its monetary effect looks to a promotion's discount.

| | Manual Discount | System-Generated Promotion |
|---|---|---|
| Trigger | Human judgment, requested case-by-case | Automatic, rule-based, evaluated by the engine (§9) |
| Authority | Requires `price_override_approvals` workflow (Decision 9) | Defined entirely by VD Gıda in advance via `promotions`/`promotion_conditions`/`promotion_rewards` |
| Audit entity_type | `price_override_approval` | `promotion_application` |
| Record table | `price_override_approvals` | `promotion_applications` |
| Reusability | One-time, tied to a specific order/negotiation | Reusable rule applied to any qualifying order automatically |

**Why this matters:** Conflating the two would corrupt promotion usage reporting (§17, §28 in the
original task) with manual, ad-hoc discounts that were never part of any campaign, and would make
it impossible to answer "how much did campaign X actually cost" accurately. This separation is
confirmed as an architectural/audit-design rule, not a business ambiguity — it follows directly
from the two mechanisms already having distinct, previously-established tables (Decision 9's
`price_override_approvals` vs. this document's `promotion_applications`).

---

## 23. AI and Promotion Authority (Confirmed)

**Confirmed rule:** Any future AI/analytics capability (see `IMPLEMENTATION_ROADMAP.md` Phase 14–15)
may recommend, analyze, or surface insights about promotions (e.g., "this campaign is
underperforming," "this customer segment doesn't use promotions"), but **may not autonomously
create, modify, activate, deactivate, or apply a promotion rule**. Promotion rule authority remains
exclusively with VD Gıda (human decision-makers), identical in spirit to the pricing authority
principle (Decision 9). An AI recommendation to change a promotion must go through the same
creation/edit path a human marketing user would use — there is no AI-specific bypass.

---

## 24. Documentation Structure Decision — Why No Separate `PROMOTION_CONTRACT.md` or
`PROMOTION_DECISION_SUMMARY.md`

**Analysis performed, decision made not to create these files:**

- `PROMOTION_CONTRACT.md` was considered as a possible parallel to `PRODUCT_CONTRACT.md`
  (attribute/lifecycle contract for a single entity). However, promotions are not a single entity
  with a flat attribute contract — they are a multi-entity domain (7 tables) whose contract is
  already fully specified in `PROMOTION_MODEL.md` (entity-by-entity) and `PROMOTION_RULES.md`
  (business rules). A separate `PROMOTION_CONTRACT.md` would either duplicate these two documents
  or fragment information that belongs together. **Decision: not created.**
- `PROMOTION_DECISION_SUMMARY.md` was considered as a parallel to `PRICING_DECISION_SUMMARY.md`
  (which exists because the pricing authority decision was, at the time, a single pivotal
  confirmation needed in isolation). The promotion domain's decisions are instead tracked directly
  in `BUSINESS_DECISIONS_v1.md` (Decisions 11–15) and in the "Summary of All New Open Questions and
  Recommendations" section at the end of this document, avoiding a third place to look for the same
  information. **Decision: not created.**
- `adr/ADR-009-Promotion-Campaign-Engine.md` (the filename suggested in this task) is not created
  as a duplicate — `adr/ADR-009-Promotion-Engine-Architecture.md` already exists, covers the
  identical architectural scope (promotion engine as an additive layer over central pricing), and
  has already been extended once via an Addendum section in a prior pass. Creating a second ADR
  with a different filename for the same decision would violate the "no unnecessary document"
  principle and create a confusing dual source of truth.

---

## 25. Legal / Accounting — Explicitly Out of Scope for Decision

The following are **not** decided here and must not be assumed. These are marked
**ACCOUNTING REVIEW REQUIRED** rather than a generic open question, to make clear that a
technical/product decision cannot resolve them:

- ACCOUNTING REVIEW REQUIRED: KDV/VAT treatment of free (bedelsiz) goods under Turkish tax law.
- ACCOUNTING REVIEW REQUIRED: Whether e-fatura requires a priced line + offsetting discount vs. a
  genuine 0 TL line for promotional goods.
- ACCOUNTING REVIEW REQUIRED: Any statutory bookkeeping requirement for promotional cost
  recognition.
- ACCOUNTING REVIEW REQUIRED: The `unit_price` value to store on a promotional `order_items` row
  (§19) for invoicing purposes.

These require confirmation from a mali müşavir (accountant) or the eventual e-fatura/ERP
integration partner, not a technical or product decision. They are tracked here so they are not
lost, and must be resolved before invoice-generation logic (not part of this phase) is designed.

**Relationship between promotion reward, free goods, order item, inventory movement, and invoice
line (confirmed technical chain, independent of the accounting answer above):**

```
promotion_rewards (definition: what CAN be given)
        ↓ (evaluated at order time)
promotion_applications (snapshot: what WAS given, immutable)
        ↓
order_items (a distinct row, is_promotional=true, linked via promotion_application_id)
        ↓
inventory_movements (real stock deduction, same movement type as paid sale, §10)
        ↓
invoice line (representation TBD — ACCOUNTING REVIEW REQUIRED, §5/§20)
```

---

## Summary of All New Open Questions and Recommendations Introduced by Promotion Engine

### RECOMMENDED (Drafted, Awaiting VD Gıda Business Sign-off — Not Yet DECIDED)
1. Promotion stacking/conflict resolution model — RECOMMENDATION: exclusive-by-default, priority
   tiebreak, explicit opt-in stacking (§3, `BUSINESS_DECISIONS_v1.md` Decision 12)
2. Insufficient stock behavior when only the free-reward product is unavailable —
   RECOMMENDATION: fulfill paid portion, withhold unfulfilled reward, surface + audit, do not
   block order (§10, `BUSINESS_DECISIONS_v1.md` Decision 13)

### CONFIRMED (Architectural, Resolved in This Pass — Not Commercial Decisions)
3. Campaign vs. promotion sequencing and simultaneous applicability — CONFIRMED: sequential,
   both may apply (§18, `BUSINESS_DECISIONS_v1.md` Decision 14)
4. Promotional reward order-item modeling — CONFIRMED: always a separate `order_items` row (§19,
   `BUSINESS_DECISIONS_v1.md` Decision 15)

### STILL FULLY OPEN (No Recommendation — Requires Business/Legal Input Outside This Task's Scope)
5. Whether "most advantageous" comparison logic is needed, and how free-goods vs. discount are
   compared, if stacking or best-of logic is ever chosen over the §3 recommendation (§3)
6. Priority field necessity and semantics if a different conflict model is chosen instead of the
   §3 recommendation (§3, §14)
7. Mutually-exclusive promotion grouping mechanism, beyond the simple opt-in stacking link in the
   §3 recommendation (§3)
8. Invoice/e-fatura line representation for free goods — ACCOUNTING REVIEW REQUIRED (§5, §19, §20)
9. KDV/VAT and accounting treatment of free goods — ACCOUNTING REVIEW REQUIRED (§5, §20)
10. Single vs. split ledger movement modeling for paid+free units (§10 — deferred to schema phase,
    not a business decision)
11. Return handling for promotionally-obtained free units (§10)
12. Offline promotion version conflict resolution at sync time (§12)
13. Grace period for recently-changed promotions affecting in-flight offline transactions (§12)
14. Device replacement interaction with cached promotion state (§12)
15. Whether any promotion usage limit (order/customer/distributor/period) is required at all, and
    if so, its exact values (§17)
16. VD Gıda visibility/alerting when a campaign-priced order also qualifies for a promotion (§18)

**None of these block continued domain/documentation work.** Items 1–2 block only the two
conditionally-specifiable golden tests (TEST-013, TEST-014 in `TEST_STRATEGY.md`) until approved.
Items 5–16 block only the eventual PostgreSQL schema finalization and business-rule implementation
for the specific mechanics listed, consistent with how pricing's own open questions were treated
in DISCOVERY AUDIT v2.
consistent with how pricing's own open questions were treated in DISCOVERY AUDIT v2.
