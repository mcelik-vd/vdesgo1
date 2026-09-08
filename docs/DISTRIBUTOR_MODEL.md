# Distributor Model

## Purpose
Distributor is the core commercial operating unit under the platform.

## Main Responsibilities
- own business operations within a tenant scope
- maintain warehouses, vehicles, and customer portfolios
- manage local sales representative assignments
- execute pricing, target, and collection rules as defined by VD Gıda
- report to VD Gıda corporate dashboard

**NOTE: Distributors do NOT set prices; all pricing and commercial terms are defined centrally by VD Gıda.**

## Core Data
- distributor_id
- tenant_id
- name
- legal_name
- status
- region
- contact_person
- phone
- email
- address
- tax_information
- created_at
- updated_at

## Related Entities
- warehouses
- vehicles
- sales reps
- customers
- products (read-only, references central VD Gıda catalog)
- orders (using VD Gıda-defined pricing)
- shipments
- returns
- accounts

## Pricing & Commercial Governance
**Distributors do NOT manage their own pricing.** All pricing is centrally defined by VD Gıda.

Examples of what distributors CANNOT do:
- Cannot decide "Krutos 60g = 95 TL"
- Cannot create their own price list
- Cannot run independent campaigns
- Cannot offer discounts without approval
- Cannot set customer-specific prices

Examples of what VD Gıda CAN do for distributors:
- Set different base prices per distributor (if needed)
- Set customer-specific prices (if needed)
- Create campaigns for all distributors
- Define volume-based pricing
- Manage discount approvals
- Enforce minimum prices
- Control pricing authority

This centralization ensures:
- Consistency across distribution network
- Prevention of unauthorized discounting
- Centralized margin control
- Audit and compliance
- Fair competitive practice

## Promotions & Campaigns Governance
Same authority model as pricing (Decision 11): distributors can **view** active promotions and
their conditions, but cannot create, edit, or override a system-calculated promotion result
(free goods quantity, discount percentage). A distributor may submit a
`promotion_override_requests` exception request, which requires approval and is fully audited.
See `PROMOTION_RULES.md` for full detail.
