# API Contract

## API Principles
- RESTful API design
- versioned endpoints
- tenant-scoped authorization
- consistent validation and error handling
- standardized audit and event emission

## Base Path
/api/v1

## Major Resource Groups
- products
- customers
- orders
- inventory
- vehicles
- sales-representatives
- visits
- payments
- warehouses
- distributors
- routes
- campaigns
- promotions
- promotion-override-requests
- reports
- notifications
- approvals

## Contract Shape
A resource endpoint should have:
- list
- get by id
- create
- update
- delete or cancel
- status transition
- related entities

## API Rules
- UI must not be the only enforcement layer
- every mutating request must validate tenant and RBAC
- stock-affecting endpoints must take transactional control
- pricing and financial endpoints must run through approval and validation rules
- order-creation endpoints must invoke promotion evaluation after price resolution and return the
  applied promotion result (if any) alongside the resolved price (see `PROMOTION_RULES.md` §1)
- order/invoice-creation endpoints must return a discount breakdown distinguishing CENTRAL_PRICE,
  CUSTOMER_DISCOUNT, PROMOTION_ENGINE, and PRICE_OVERRIDE_APPROVAL sources (see `PRICING_RULES.md`
  "Customer Discount & Invoice Pricing Contract"); customer discount fields on the `customers`
  resource are writable only by VD Gıda roles
- the calculation breakdown must expose central/list price, promotion effect, cash-or-term payment
  discount, Customer Discount 1/2/3 selection and applied amounts, authorized manual discount,
  net KDV-exclusive amount, KDV, and final invoice total; these remain distinct sources and must
  not be merged into a generic discount entity
- Customer Discount 1/2/3 selections are per order item. Any separately defined invoice/general-
  total discount must be represented separately from these fields and from Promotion and Manual
  Price Override; its authority and calculation placement remain OPEN QUESTION
- Order/invoice assignment payload uses these exact wire fields:
  - `customer_id`: UUID
  - `default_sales_rep_id`: UUID
  - `selected_sales_rep_id`: UUID
  - `is_sr_override`: Boolean
  - `default_warehouse_id`: UUID
  - `selected_warehouse_id`: UUID
  - `is_wh_override`: Boolean

  Default fields express resolved customer defaults; selected fields express transaction choice and
  remain distinct for audit.
- Customer-selection responses must expose the current customer default sales representative,
  default warehouse, and discount profile required to prefill an Order/Invoice work window. The
  final selected representative/warehouse remain independent transaction values.
- Customer-change requests must explicitly confirm the Decision 29 hard-reset of overrides and
  applied discounts. API validates selected Sales Representative/Warehouse against the active
  tenant and the caller's active territories.

## Open Questions
- OPEN QUESTION: Will the system expose all write operations to the web app and field app directly through the same API version?
- OPEN QUESTION: Should reporting endpoints be separated from operational mutations to reduce load and risk?
- OPEN QUESTION: What is the exact API authentication flow for field app offline sync resumes?
