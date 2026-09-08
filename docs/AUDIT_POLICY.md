# Audit Policy

## Audit Objective
Audit must provide trusted evidence for all critical business changes.

## Audit Scope
- **ALL price changes** (base price, distributor price, customer price, campaign price, discount approval, price override)
- **price override requests** (who requested, who approved/rejected, discount %, rationale)
- **ALL promotion changes** (created, modified, activated, deactivated, deleted/archived)
- **promotion applied to an order** (linked to `promotion_applications`)
- **promotion override requests** (who requested, who approved/rejected, requested reward, rationale)
- **promotion cancellation impact on in-flight orders** (audit must show the promotion's status at
  the time each affected order was created, to prove past orders were unaffected by a later change)
- **promotional order cancellation** (audit must show `promotion_applications.status` transition to
  `reversed`, tied to the cancelling user and the reversed inventory movements)
- **manual discount vs. system-generated promotion** (these must never share an `entity_type` or
  be recorded in the same table — `price_override_approvals` for manual, `promotion_applications`
  for system-generated — see `PROMOTION_RULES.md` §22)
- **customer discount profile changes** (cash/term discount, customer discount 1/2/3 — old value,
  new value, actor, timestamp; see `PRICING_RULES.md` "Customer Discount & Invoice Pricing
  Contract")
- **customer discount applied to an invoice/order** (which of the five fields were selected/
  applied at invoice time, their applied percentages/amounts, payment discount, and by whom,
  distinct from the profile-definition audit entry above)
- **invoice pricing reconstruction** (the audit/snapshot combination must distinguish central
  price, promotion effect, payment discount, Customer Discount 1/2/3, and authorized manual
  discount so the final invoice amount can be reconstructed)
- **line-level customer discount application** (Customer Discount 1, 2, 3, cash, and term
  discounts must be distinguishable per order item with selector, percentage, base amount, result,
  and the unrounded calculation value used by the next stage)
- **customer default assignment changes** (customer, old/new default sales representative, old/new
  default warehouse, actor, timestamp)
- **order/invoice assignment resolution and override** (system-resolved default representative /
  warehouse, final selected representative / warehouse, actor, timestamp, and whether each value
  was manually overridden)
- **customer change hard reset** (prior customer, new customer, confirmation actor, cleared manual
  representative/warehouse selections, and cleared discount/promotion calculation state)
- **platform cross-tenant access** (acting VD Gıda user, platform role/claim, target tenant,
  read/write action, timestamp; on-behalf-of write must retain explicit target tenant)
- **invoice inheritance** (source order, copied assignment/commercial snapshots, invoice actor,
  timestamp)
- **invoice total discount** (Distributor Admin actor, fixed-TL amount, pre-KDV subtotal, resulting
  net KDV-exclusive subtotal; distinct from line-level discounts and price override)
- **vehicle custody transfer and count difference document** (source/destination vehicle or
  custodian, count results, reason, actor, validated ledger references)
- permission changes
- stock movement and adjustments
- customer credit and risk changes
- order approval or cancellation
- payment collection and reversal
- shipment and return status changes
- user logins and role assignments

## Audit Record Fields
- audit_id
- tenant_id
- entity_type
- entity_id
- action_type
- actor_user_id
- actor_role_id
- old_value
- new_value
- reason
- ip_address
- device_id
- created_at

## Policy
- audit logs are append-only
- normal users cannot delete or modify audit records
- critical actions must be traceable to the source user and device
- audit is required for all financial and stock-affecting events

## Open Questions
- OPEN QUESTION: Is an external immutable log storage required for financial compliance?
- OPEN QUESTION: What is the retention policy for audit logs for production use?
- OPEN QUESTION: Which user actions are classified as critical enough for mandatory audit entries?
