# Promotion Model

## Status
Discovery / Domain Design — NOT implemented in code or SQL yet.

## Relationship to Existing Architecture
This document extends, and does not replace, the centralized pricing model defined in
`PRICING_RULES.md`, `PRICING_DECISION_SUMMARY.md`, and `BUSINESS_DECISIONS_v1.md` (Decision 9).

**Authority Chain (unchanged, promotion is an additional stage, not a new authority):**

```
CENTRAL PRICE AUTHORITY (VD Gıda)
        ↓
PRICE RESOLUTION (base/volume/distributor/customer/campaign price)
        ↓
PROMOTION ELIGIBILITY CHECK (this document)
        ↓
PROMOTION ENGINE (calculates free goods / discount)
        ↓
ORDER TOTAL (price − promotion effect)
        ↓
PRICE + PROMOTION SNAPSHOT (immutable, stored on order)
        ↓
INVENTORY LEDGER (physical movement for paid + free units)
        ↓
INVOICE / ERP INTEGRATION (OPEN QUESTION — see PROMOTION_RULES.md §5)
        ↓
AUDIT
```

**Critical rule (unchanged from Decision 9):** Promotion authority belongs exclusively to VD Gıda.
Distributors and sales representatives can only view and (optionally) request an exception; they
cannot create, edit, or silently override a promotion's calculated result.

---

## Domain Concepts

### Promotion
A promotion is a VD Gıda-defined rule set that automatically grants a reward (free goods and/or
discount) when a qualifying condition is met during order/sale creation.

A promotion is composed of:
- **Conditions** — what must be true for the promotion to apply (quantity, basket amount, distinct
  SKU count, product group volume, mix-and-match combination)
- **Rewards** — what the customer receives (free units of a product, percentage discount, fixed
  discount)
- **Targets** — who the promotion applies to (all customers, a specific customer, a specific
  distributor)
- **Validity window** — start date, end date, active/inactive status

### Promotion Application
The result of evaluating a promotion against a specific order at the moment the order was created.
This is the **immutable snapshot** — the promotion's live definition may change later, but the
application record never changes.

### Promotion Override Request
A distributor or sales representative may request an exception (e.g., apply a promotion outside
its normal eligibility, or grant extra free goods). This is not a self-service action — it always
goes through an approval workflow and is fully audited.

---

## Supported Promotion Types (Domain Coverage)

All types below (A–K from the business requirement) are modeled generically through
**conditions + rewards + targets**, not as separate hardcoded promotion tables per type. This
avoids one-table-per-type sprawl and lets VD Gıda combine primitives freely.

| Type | Business Example | Modeled As |
|---|---|---|
| A) Buy X Get Y Free (same/different/selected product) | 10 al → 1 bedava | 1 condition (`min_quantity_product`) + 1 reward (`free_goods`, `reward_product_id` may differ from purchased product) |
| B) Quantity-based % discount | 10 koli → %10 | 1 condition (`min_quantity_product`) + 1 reward (`percentage_discount`) |
| C) Distinct SKU count promotion | 8 farklı SKU → 1 ücretsiz | 1 condition (`min_distinct_sku`) + 1 reward (`free_goods`) |
| D) Basket amount threshold | 10.000 TL → %5 | 1 condition (`min_basket_amount`) + 1 reward (`percentage_discount` or `free_goods`) |
| E) Mixed product bundle (A+B+C → D free) | 5+5+5 → 1 D bedava | Multiple `promotion_product_rules` (role=qualifying) feeding one combined `min_quantity_group` condition + 1 reward |
| F) Product group promotion | Grup toplamı 20 koli → 2 bedava | `promotion_product_rules` referencing a product group + `min_quantity_group` condition |
| G) Mix & Match | 3+3+4 → 1 D bedava | Same mechanism as E — condition aggregates quantity across an explicit product set |
| H) Customer-specific promotion | Müşteri ABC özel | `promotion_targets` row with `target_type=specific_customer` |
| I) Distributor-specific promotion | Distribütör özel | `promotion_targets` row with `target_type=specific_distributor` |
| J) Date range | 01.09–30.09 | `valid_from` / `valid_to` / `status` on `promotions` |
| K) Minimum order | Min miktar/tutar | Same `promotion_conditions` mechanism as B/D |
| L) Tiered promotion (multiple thresholds, one promotion) | 5→%5, 10→%8, 20→%12 or 10→1 bedava, 20→2 bedava, 30→3 bedava | Multiple `(promotion_conditions, promotion_rewards)` pairs sharing the same `promotion_id`, linked by a shared `tier_level` — see §"Tiered Promotions" below |
| M) Fixed amount discount | 20 koli → 500 TL indirim | 1 condition (`min_quantity_product`) + 1 reward (`reward_type=fixed_discount`, `discount_amount=500`) — already supported by the existing `promotion_rewards.reward_type` enum, called out here explicitly for coverage clarity |

**Design principle confirmed:** E and G (mixed bundle, mix & match) are the same underlying
mechanism — a condition that aggregates quantity across an explicit, promotion-defined product
set, rather than a single product or a pre-existing product category. This is why
`promotion_product_rules` exists as a separate table from `promotion_conditions`: conditions store
the threshold math, product rules enumerate exactly which products count toward it.

### Tiered Promotions (Type L) — No New Table Required

A tiered promotion (e.g., 5→%5, 10→%8, 20→%12) is modeled as **multiple
`(promotion_conditions, promotion_rewards)` pairs under the same `promotion_id`**, matched by a
shared `tier_level` field added to both tables (see Entity Model below). This avoids a dedicated
`promotion_tiers` table — a tier is nothing more than an additional condition/reward pair.

**Confirmed evaluation rule (architectural, not a business ambiguity):** tiers within a single
promotion are evaluated together and only the **highest tier whose condition is satisfied**
applies — tiers are mutually exclusive by mathematical definition (an order satisfying the 20-koli
tier necessarily also satisfies the 10-koli and 5-koli tiers, but only the 20-koli reward is
granted, not all three cumulatively). This is a direct consequence of what "tier" means and does
not require the same business sign-off as cross-promotion stacking (§3) — it is confirmed here.

---

## Entity Model (Domain-Level — No SQL Yet)

Seven tables are proposed. Each is justified individually below per the "no unnecessary table"
principle. `promotion_snapshots` (requested in the task) is **deliberately not created as a
separate table** — its purpose is fully covered by `promotion_applications` (see justification
below), avoiding a redundant entity.

### 1. `promotions` (header)

**Why needed:** Single source of truth for a promotion's identity, validity window, and status.
Every other promotion table hangs off this one.

| Field | Notes |
|---|---|
| id | PK |
| tenant_id | Always `VD_GIDA` (promotions are centrally owned, same pattern as `products`, `price_lists`) |
| code | Optional human-readable business code, unique within VD Gıda scope |
| name | Display name |
| description | Free text |
| promotion_type | High-level category label for UI/reporting (`buy_x_get_y`, `quantity_discount`, `basket_threshold`, `sku_count`, `product_group`, `mix_and_match`) — **does not drive behavior**, behavior comes from conditions/rewards |
| priority | Nullable integer — see PROMOTION_RULES.md §3 (OPEN QUESTION on necessity) |
| stacking_mode | Nullable enum (`exclusive`, `stackable`, `best_of`) — see PROMOTION_RULES.md §3 (OPEN QUESTION) |
| status | `draft`, `active`, `inactive`, `expired`, `archived` |
| valid_from / valid_to | Validity window |
| version | Integer, incremented on any rule change — required for offline conflict detection (see PROMOTION_RULES.md §12) |
| created_by / created_at / updated_by / updated_at | Standard audit fields |

**Optional usage-limit fields (not yet confirmed as needed — see PROMOTION_RULES.md §17):** if
usage limits are confirmed required, candidate fields are `max_usage_per_customer`,
`max_usage_per_distributor`, `max_usage_total`, `usage_period` (nullable, all default to
unlimited/null). No dedicated usage-counter table is added; usage is derived by counting
`promotion_applications` rows at evaluation time.

**Tenant isolation:** Always VD Gıda-owned. Distributors reference (read-only), never own a row here — consistent with Decision 2 (Product Ownership) and Decision 9 (Pricing Authority).

### 2. `promotion_conditions`

**Why needed:** Separates "what must be true to qualify" from the reward. A promotion can have
one condition (simple types) or reference a shared aggregated condition (bundle types).

| Field | Notes |
|---|---|
| id | PK |
| promotion_id | FK → `promotions`, indexed |
| condition_type | `min_quantity_product`, `min_quantity_group`, `min_distinct_sku`, `min_basket_amount` |
| product_id | FK → `products`, nullable (used when condition is product-specific) |
| product_group_ref | Nullable — references a set defined via `promotion_product_rules` (used for F/E/G types) |
| min_quantity | Nullable numeric |
| min_amount | Nullable numeric |
| tier_level | Nullable integer, default 1 — groups this condition with the matching `promotion_rewards.tier_level` row(s) for tiered promotions (Type L); single-tier promotions simply use tier_level=1 |

**Index:** `(promotion_id)`.

### 3. `promotion_rewards`

**Why needed:** Separates "what is given" from "what triggers it." A single condition could in
theory support multiple rewards (e.g., free goods + discount) — kept as a distinct table rather
than columns on `promotions` to support this without schema changes later.

| Field | Notes |
|---|---|
| id | PK |
| promotion_id | FK → `promotions`, indexed |
| reward_type | `free_goods`, `percentage_discount`, `fixed_discount` |
| reward_product_id | FK → `products`, nullable — the product given for free (may equal or differ from the purchased product) |
| reward_quantity | Nullable — free unit count |
| discount_percentage | Nullable |
| discount_amount | Nullable |
| max_reward_quantity | Nullable — caps tiered rewards (e.g., "20 koli → 3 koli bedava" ceiling) |
| tier_level | Nullable integer, default 1 — matches the corresponding `promotion_conditions.tier_level` for tiered promotions (Type L) |

**Index:** `(promotion_id)`.

### 4. `promotion_targets`

**Why needed:** Encodes types H (customer-specific) and I (distributor-specific) without
duplicating the entire promotion definition per customer/distributor. Default (no row, or
`target_type=all`) means the promotion applies platform-wide subject to conditions.

| Field | Notes |
|---|---|
| id | PK |
| promotion_id | FK → `promotions`, indexed |
| target_type | `all`, `specific_customer`, `specific_distributor` |
| customer_id | FK → `customers`, nullable |
| distributor_id | FK → `distributors`, nullable |

**Unique constraint (candidate):** `(promotion_id, target_type, customer_id, distributor_id)` to
prevent duplicate target rows.

**Tenant isolation note:** Even though a promotion targets a specific distributor, the promotion
row itself remains VD Gıda-owned. The distributor cannot edit it — this is a *scope* restriction,
not an *ownership* transfer.

### 5. `promotion_product_rules`

**Why needed:** Required specifically for bundle/mix-and-match types (E, G) and product-group
types (F), where the qualifying "basket" is a promotion-defined set of products that is not
necessarily an existing product category. Also used to explicitly exclude specific products from
an otherwise broad condition if needed.

| Field | Notes |
|---|---|
| id | PK |
| promotion_id | FK → `promotions`, indexed |
| role | `qualifying` (counts toward the condition), `excluded` (explicitly does not count) |
| product_id | FK → `products`, nullable |
| product_category_id | FK → `product_categories`, nullable (used when the group is an existing category, e.g., "Krutos Grubu") |

**Relationship to `promotion_conditions`:** `promotion_conditions.product_group_ref` points
conceptually to the set of rows in this table sharing the same `promotion_id`; the condition
stores the threshold math (e.g., "sum of qualifying quantities ≥ 15"), this table enumerates the
members of that set.

### 6. `promotion_applications` (serves as the snapshot table)

**Why needed:** This is the immutable record of what actually happened when a promotion was
evaluated against a real order. **This table replaces the separately-requested
`promotion_snapshots` table** — creating both would mean storing the same "applied result" data
twice. `promotion_applications` already captures the full snapshot payload (rule content, reward
result, timestamps), so a second snapshot table would be pure redundancy.

| Field | Notes |
|---|---|
| id | PK |
| order_id | FK → `orders`, indexed |
| order_item_id | FK → `order_items`, nullable (a free-goods reward may generate its own line item rather than modifying an existing one) |
| promotion_id | FK → `promotions` (kept for traceability, but not relied upon for historical accuracy — see next field) |
| promotion_version | Snapshot of `promotions.version` at the moment of application |
| promotion_name_snapshot | Immutable copy of the name at apply time |
| promotion_type_snapshot | Immutable copy of the type at apply time |
| promotion_rule_snapshot | JSONB — full condition/reward payload as evaluated, immutable |
| qualifying_quantity | Quantity that satisfied the condition |
| free_quantity | Nullable — units given free |
| reward_product_id_snapshot | Nullable — product id of the free good, captured even if the product is later discontinued |
| discount_percentage_snapshot | Nullable |
| discount_amount | Computed monetary effect |
| applied_at | Timestamp |
| applied_by | User id or `system` |
| status | `applied`, `reversed` (for cancellations/returns) |
| base_price_snapshot | Unit price BEFORE promotion effect, at order time (mirrors the already-resolved central price, Decision 9) — explicit traceability field requested for base_price/promotion_discount/final_price auditability |
| final_price_snapshot | Unit price AFTER promotion discount effect (percentage/fixed), at order time |

**Indexes:** `(order_id)`, `(promotion_id)`.

**Immutability guarantee (mirrors Decision 9 pricing snapshot rule):** If VD Gıda later changes or
deletes the promotion, rows in this table are never updated. This is the same pattern already
established for `order_items` price snapshot fields.

**Confirmed relationship to `order_items` (see PROMOTION_RULES.md §19):** A free-goods reward
always produces its own, separate `order_items` row (never modifies the paid item's quantity or
price). That row carries `promotion_application_id` (FK back to this table) and an
`is_promotional`/free-goods flag. `unit_price` on that row for invoicing purposes is
ACCOUNTING REVIEW REQUIRED (see PROMOTION_RULES.md §25), not decided here.

**Usage counter note:** No dedicated `promotion_usage` counter table is added. Aggregate
usage ("kampanya kaç kez kullanıldı", "kaç koli bedava verildi") is derived by querying/aggregating
`promotion_applications` rows (COUNT/SUM by promotion_id, customer_id, distributor_id, or date
range). See PROMOTION_RULES.md §17 for the reporting/limit-enforcement analysis and the remaining
OPEN QUESTION on whether a materialized counter is later needed for concurrency-safe limit
enforcement.

### 7. `promotion_override_requests`

**Why needed:** Business requirement explicitly allows a distributor/sales rep to *request* an
exception (apply a promotion outside its normal eligibility, or grant extra free goods), but this
must never be a silent, self-approved action — it requires an approval workflow, matching the
existing `price_override_approvals` pattern (Decision 9).

| Field | Notes |
|---|---|
| id | PK |
| order_id | FK → `orders`, indexed |
| promotion_id | FK → `promotions`, nullable (an override may propose applying a promotion the order doesn't naturally qualify for, or granting free goods with no underlying promotion at all) |
| override_type | `apply_ineligible_promotion`, `extra_free_goods`, `extra_discount` |
| requested_value | JSONB — requested reward detail |
| reason | Free text, required |
| requested_by | User id |
| requested_at | Timestamp |
| status | `pending`, `approved`, `rejected` |
| approved_by / approved_at | Nullable |
| rejected_by / rejected_at | Nullable |

**Index:** `(order_id)`, `(status)`.

**Relationship to existing `price_override_approvals`:** These are kept as separate tables because
they represent different domains (price override vs. promotion override) with different fields,
even though the approval *pattern* (request → approve/reject → audit) is identical. Combining them
into one generic "override_requests" polymorphic table was considered but rejected here to avoid
premature abstraction — this can be revisited in schema design phase if the pattern repeats a
third time.

---

## Requested Entity List vs. Actual Model (Explicit Mapping)

A commonly-suggested table list for a promotion engine includes more entities than are actually
needed here. Each candidate is evaluated individually — none are accepted by default.

| Requested Candidate | Verdict | Reasoning |
|---|---|---|
| `promotion` | ✅ Kept as `promotions` | Core header entity |
| `promotion_rule` | ❌ Not created | Would duplicate `promotion_conditions` + `promotion_rewards` — a "rule" is just a condition+reward pair, already modeled |
| `promotion_condition` | ✅ Kept as `promotion_conditions` | Distinct qualifying-threshold entity |
| `promotion_reward` | ✅ Kept as `promotion_rewards` | Distinct reward-definition entity |
| `promotion_tier` | ❌ Not created as a separate table | Modeled via `tier_level` field added to `promotion_conditions`/`promotion_rewards` — a tier is just another condition/reward pair, not a new concept requiring its own table |
| `promotion_product` | ✅ Kept as `promotion_product_rules` | Needed for bundle/mix-and-match/group qualifying-set enumeration |
| `promotion_product_group` | ❌ Not created as a separate table | An existing product group is referenced via `promotion_product_rules.product_category_id` (reuses `product_categories`, does not duplicate it); an ad-hoc group is simply multiple `promotion_product_rules` rows |
| `promotion_customer` | ✅ Kept as `promotion_targets` (generalized) | Generalized beyond customer-only to also cover distributor-specific and all-customer targeting, avoiding a customer-only table plus a separate distributor-only table |
| `promotion_usage` | ❌ Not created as a separate table (for MVP) | Usage counts are derived from `promotion_applications` via aggregation query; a dedicated counter table is a schema-design-time performance optimization, not a Discovery-phase requirement — see PROMOTION_RULES.md §17 open question on whether concurrency-safe enforcement later requires one |
| `promotion_application` | ✅ Kept as `promotion_applications` | Immutable snapshot record |
| `promotion_approval` | ✅ Kept as `promotion_override_requests` | Same approve/reject workflow pattern, named to match its actual scope (exception requests, not general "approval" of every promotion) |

**Net result: 7 tables, not 11.** Four candidates from a typical broad promotion-engine reading
were deliberately not created, each with an explicit reason above, consistent with the
"no unnecessary table" principle applied throughout this project.

---

## Entity Contract Summary

Consolidated view of all seven tables against the dimensions requested for domain validation.
No SQL/constraint syntax is specified — this is a domain-level contract only.

| Entity | Purpose | PK | Key FKs | Tenant Ownership | Lifecycle / Status | Key Constraints | Key Indexes | Audit | Snapshot Relationship |
|---|---|---|---|---|---|---|---|---|---|
| `promotions` | Promotion header, validity, governance | id | — | VD Gıda only | draft→active→inactive→expired→archived | code unique within VD Gıda scope (if used) | promotion_id-derived indexes on children; (status, valid_from, valid_to) for lookup | Every field change audited via `audit_logs` (`entity_type=promotion`) | Source of truth referenced by `promotion_applications`, but NOT relied upon for historical accuracy after the fact |
| `promotion_conditions` | Defines qualifying threshold(s) | id | promotion_id → promotions; product_id → products (nullable) | Inherits from parent promotion (VD Gıda) | Follows parent promotion lifecycle; no independent status | condition_type constrained to defined enum | (promotion_id) | Covered under parent promotion's audit trail | Frozen into `promotion_rule_snapshot` JSON at application time |
| `promotion_rewards` | Defines what is granted | id | promotion_id → promotions; reward_product_id → products (nullable) | Inherits from parent promotion | Follows parent promotion lifecycle | reward_type constrained to defined enum; max_reward_quantity ≥ reward_quantity when both set | (promotion_id) | Covered under parent promotion's audit trail | Frozen into `promotion_rule_snapshot`; specific granted values captured in `free_quantity`/`discount_percentage_snapshot` |
| `promotion_targets` | Defines who the promotion applies to | id | promotion_id → promotions; customer_id → customers (nullable); distributor_id → distributors (nullable) | Inherits from parent promotion | Follows parent promotion lifecycle | Candidate unique (promotion_id, target_type, customer_id, distributor_id) | (promotion_id) | Covered under parent promotion's audit trail | Not separately snapshotted — target match is evaluated at application time, result implied by which order/customer/distributor the application belongs to |
| `promotion_product_rules` | Enumerates qualifying/excluded product sets for bundle/group/mix-and-match types | id | promotion_id → promotions; product_id → products (nullable); product_category_id → product_categories (nullable) | Inherits from parent promotion | Follows parent promotion lifecycle | role constrained to `qualifying`/`excluded` | (promotion_id) | Covered under parent promotion's audit trail | Frozen into `promotion_rule_snapshot` JSON |
| `promotion_applications` | Immutable record of a promotion's result on a specific order (serves as the snapshot) | id | order_id → orders; order_item_id → order_items (nullable); promotion_id → promotions | N/A — tied to the order's tenant (distributor), not VD Gıda, since it belongs to a specific transaction | applied → reversed (on cancellation/return) | Never updated after creation except `status` transition to `reversed` | (order_id), (promotion_id) | Each creation/reversal produces an `audit_logs` entry (`entity_type=promotion_application`) | **Is** the snapshot — no separate `promotion_snapshots` table |
| `promotion_override_requests` | Exception request/approval workflow | id | order_id → orders; promotion_id → promotions (nullable) | Tied to the requesting distributor's order | pending → approved / rejected | override_type constrained to defined enum; reason required (not nullable) | (order_id), (status) | Request, approval, and rejection each produce a distinct `audit_logs` entry | Not itself a snapshot, but its outcome (if approved) feeds into a `promotion_applications` row |

## Redundancy Check (per audit discipline)

| Candidate | Verdict |
|---|---|
| Separate `promotion_snapshots` table | ❌ Not created — merged into `promotion_applications` |
| Separate table per promotion type (A–K) | ❌ Not created — all types modeled via conditions + rewards + targets + product rules |
| Generic polymorphic `override_requests` combining price + promotion overrides | 🟡 Considered, deferred — see `promotion_override_requests` note above |

---

## Relationship to Inventory (Summary — full rules in PROMOTION_RULES.md §10–11)

Free goods are **not** a separate inventory concept. A free-goods reward still results in a real
physical unit leaving the warehouse or vehicle, and therefore **must** produce an
`inventory_movements` ledger entry like any other outbound stock movement (per ADR-004 — no
exceptions for promotional stock). The movement record links back to the
`promotion_applications` row via `reference_type`/`reference_id`, consistent with the existing
ledger `reference_type`/`reference_id` pattern in `INVENTORY_RULES.md`.

---

## Open Questions Introduced by This Model

See `PROMOTION_RULES.md` for the full, categorized list. Summary of items that are genuinely new
(not previously covered by pricing decisions):

- Promotion stacking / combination rules (§3)
- Priority field necessity and semantics (§3, §14)
- Invoice/e-fatura line representation for free goods (§5)
- Insufficient stock behavior for a promotional reward (§10)
- Offline promotion version conflict resolution at sync time (§12)

None of these block the domain model above — the entity structure supports any resolution of
these questions without schema redesign (fields like `priority`, `stacking_mode`, and `version`
already exist to receive the eventual decision).
