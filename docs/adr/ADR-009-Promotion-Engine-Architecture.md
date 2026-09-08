# ADR-009: Promotion Engine as an Additive Layer Over Central Pricing

## Status
Accepted

## Context
VD Gıda requires a flexible promotion/campaign engine (buy-X-get-Y-free, quantity discounts,
basket thresholds, product-group and mix-and-match bundles, customer/distributor-specific
promotions) that must not compromise the already-decided centralized pricing authority
(ADR/Decision 9 — Centralized Pricing Authority).

## Decision
Model promotions as a distinct domain (`promotions`, `promotion_conditions`,
`promotion_rewards`, `promotion_targets`, `promotion_product_rules`, `promotion_applications`,
`promotion_override_requests`) that is evaluated strictly **after** price resolution and strictly
**before** final order total and inventory ledger posting. Promotion authority is held exclusively
by VD Gıda, mirroring the existing pricing authority model exactly (same ownership pattern, same
override/approval pattern, same immutable snapshot pattern, same audit pattern).

## Rationale
- Reuses proven patterns from Decision 9 (authority, snapshot, override, audit) instead of
  inventing a parallel governance model — reduces conceptual and implementation risk.
- Keeps pricing and promotion as separate, independently reasoned-about stages, avoiding a single
  monolithic "pricing+promotion" engine that would be harder to test and audit in isolation.
- Generic condition/reward/target modeling (rather than one table per promotion type) supports all
  11 requested promotion types (A–K) without schema growth per new type, and allows VD Gıda to
  combine primitives for new campaign designs not yet anticipated.
- Free goods are treated as real inventory movements (no "free stock" concept), preserving
  ADR-004's ledger-as-source-of-truth guarantee without carve-outs.

## Consequences
- Order total calculation now has two sequential authority-governed stages (price, then
  promotion), both of which must independently validate before an order is finalized.
- Inventory ledger movement modeling must account for promotional (free) units using the same
  movement types as paid units, linked via `reference_type`/`reference_id` to
  `promotion_applications`.
- Conflict/stacking behavior between simultaneously-eligible promotions is **not** decided by this
  ADR and must not be implemented until resolved (see `PROMOTION_RULES.md` §3) — the schema
  reserves `priority` and `stacking_mode` fields to receive that decision without migration.
- Offline mobile promotion behavior inherits the same unresolved risk already flagged for offline
  pricing in DISCOVERY AUDIT v2 (stale price/stock) — this ADR does not resolve that risk, only
  confirms promotions use the identical mechanism (`version`, `valid_from`/`valid_to`) as pricing
  for future resolution.

## Open Questions
- OPEN QUESTION: What is the definitive promotion stacking/conflict resolution rule? (Tracked in
  `PROMOTION_RULES.md` §3.)
- OPEN QUESTION: Is a single combined ledger movement (paid+free) or two separate movements the
  correct modeling for a promotional sale? (Deferred to Phase 1 schema design.)
- OPEN QUESTION: How are free goods represented on an invoice/e-fatura line? (Tracked in
  `PROMOTION_RULES.md` §5 — requires accounting/e-fatura input, not a technical decision.)

## Addendum (Post-Finalization Pass)
- A RECOMMENDED (not yet approved) resolution for the stacking open question was drafted:
  exclusive-by-default with priority tiebreak and explicit opt-in stacking. See
  `PROMOTION_RULES.md` §3 and `BUSINESS_DECISIONS_v1.md` Decision 12. This ADR's status remains
  Accepted for the overall architecture; the stacking behavior itself is not yet ready for
  implementation pending business sign-off.
- The order-item modeling question (paid vs. reward line) is now confirmed as an architectural
  decision, not open: a promotion reward always creates a separate `order_items` row. See
  `PROMOTION_RULES.md` §19 and `BUSINESS_DECISIONS_v1.md` Decision 15.
- The campaign-vs-promotion sequencing question is confirmed (not new — restated for clarity):
  campaign price resolves within price resolution; promotion evaluates afterward; both may apply
  together. See `PROMOTION_RULES.md` §18 and `BUSINESS_DECISIONS_v1.md` Decision 14.
