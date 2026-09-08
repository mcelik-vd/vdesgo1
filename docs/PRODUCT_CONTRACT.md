# Product Contract

## Product Definition
A product is the canonical commercial item sold through distribution channels. Product data must support variants, barcode lookup, accounting, and pricing controls.

## Core Product Attributes
- product_id
- tenant_id
- sku
- barcode
- name
- description
- category_id
- brand
- unit_of_measure
- package_quantity
- weight
- vat_rate
- status
- created_by
- created_at
- updated_at

**Cross-reference:** whether customer discounts (see `PRICING_RULES.md` "Customer Discount &
Invoice Pricing Contract") are calculated pre- or post-`vat_rate` is an explicit OPEN QUESTION,
not decided in this document.

## Variant Model
Products may have variations such as:
- size
- weight
- packaging
- unit count
- regional variant

Example:
- Krutos 60g
- Krutos 100g
- Krutos 200g

These should be modeled as product variants tied to a base product, not hardcoded in app logic.

## Product Lifecycle
- draft
- active
- inactive
- discontinued
- blocked

## Business Rules
- **Products are VD Gıda owned (tenant_id = VD_GIDA).** All distributors reference the same central product catalog.
- A SKU must be unique within the VD Gıda catalog (global uniqueness).
- A product barcode must be unique within the VD Gıda catalog (global uniqueness).
- Product status controls whether it can be sold, returned, or priced.
- Product pricing cannot be applied when product is inactive or blocked.
- Distributors cannot create their own products; must use central VD Gıda catalog.
- All products are visible to all distributors (read-only).
- Product pricing is centrally managed by VD Gıda, not by distributors.

## Relationships
- product belongs to category (both VD Gıda owned)
- product has many variants
- product has many price list entries (VD Gıda manages)
- product has many inventory records (per distributor warehouse)
- product has many order items (per distributor orders)
- product has many returns (per distributor)

## Tenant Scoping
Products are explicitly NOT tenant-scoped to individual distributors. Products are tenant-scoped to VD Gıda only. This ensures:
- Single source of truth for product definitions
- Consistent barcode/SKU across all distributors
- Unified inventory visibility
- Centralized pricing authority

## Relationship to Promotions
A product may be referenced by a promotion in two distinct roles (see `PROMOTION_MODEL.md`):
- as a **qualifying product** (counts toward a promotion's condition, e.g. "buy 10 koli")
- as a **reward product** (given free as the promotion's reward, which may be the same product or
  a different one)

Products do not carry promotion data themselves; the relationship is owned entirely by the
promotion entities, consistent with VD Gıda retaining sole promotion authority (Decision 11).
