# Business Rules

## Tenant Isolation
- Every critical table must include tenant_id.
- A user may only access records belonging to their tenant scope.
- Distributor A cannot view Distributor B data.

## Inventory Rules
- Stock can only change through inventory movements.
- No direct mutation of stock quantity is allowed.
- Each stock movement must be linked to a source document, reason, and action type.
- Transactional operations must be atomic.

## Sales Rules
- An order must reference a valid customer, sales representative, and distributor.
- Order status transitions must be controlled by business rules.
- Only authorized users may approve, reject, or cancel orders.

## Pricing Rules

**VD Gıda is the sole owner and authority of all pricing and commercial terms.**

### Core Pricing Rules
- Pricing is centrally defined by VD Gıda, not by distributors or sales reps
- Distributors cannot unilaterally change prices
- Sales representatives cannot override prices without formal approval
- All pricing structures are pre-defined: volume-based, distributor-specific, customer-specific, campaigns, time-limited
- At order creation, system applies price automatically (read-only to field user)
- Price is captured and locked on order (immutable snapshot)
- If price override needed, formal approval workflow required
- Approval thresholds are configurable by VD Gıda (0-5% auto, 5-10% manager, 10%+ executive, 20%+ central)
- All price changes are audited and logged
- Historical prices preserved for past orders (no retroactive changes)
- Minimum price enforcement is centralized (no discounting below minimum without approval)
- Discounts must record approval context and actor details

## Promotion Rules

**VD Gıda is the sole owner and authority of all promotions and campaigns** (same authority model
as pricing — see full detail in `PROMOTION_RULES.md`).

- Promotions are evaluated strictly after price resolution, never instead of it.
- Distributors and sales representatives can view promotions but cannot create, edit, or override
  a system-calculated promotion result.
- Any exception requires a formal `promotion_override_requests` approval workflow.
- A free-goods reward is a real physical unit and must be tracked in the inventory movement
  ledger identically to a paid unit (no "free stock" exception to ADR-004).
- Negative stock prohibition (Decision 6) applies to the combined paid+free quantity.
- Promotion result is captured as an immutable snapshot (`promotion_applications`) at order
  creation time; later changes to the promotion do not affect past orders.
- All promotion changes and applications are audited.
- Promotion stacking/conflict resolution rule is NOT yet decided — see OPEN QUESTIONS.

## Risk and Credit Rules
- Credit limit checks must be enforced before order creation or collection approval when required.
- Risk status may be derived from overdue balances and payment behavior.
- Collection actions must be linked to customer accounts.

## Audit Rules
- All critical updates must create an audit log entry.
- Audit logs must be immutable from normal user action.
- Audit should store previous and new values when applicable.

## Open Questions
- OPEN QUESTION: Which order types require automatic approval and which require manager approval?
- OPEN QUESTION: Which risk thresholds are used for distribution and field sales?
- OPEN QUESTION: What defines a customer as high-risk or blocked?
- OPEN QUESTION: Promotion stacking/conflict resolution model — can multiple eligible promotions
  apply to the same order simultaneously? (See `PROMOTION_RULES.md` §3.)
