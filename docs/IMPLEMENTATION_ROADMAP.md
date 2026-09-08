# Implementation Roadmap

## PHASE 0: Discovery
- architecture review
- domain model review
- database model review
- tenant and RBAC review
- inventory and business rule review
- test strategy review
- docs and ADR review

## PHASE 1: Architecture + Database
- finalize schema design
- finalize key entities and constraints
- finalize tenant isolation model
- finalize audit and event model

## PHASE 2: Authentication + Tenant + RBAC
- auth and users
- roles and permissions
- tenant scopes
- organizations and distributor users

## PHASE 3: Master Data
- products
- categories
- customers
- distributors
- sales representatives

## PHASE 4: Warehouse + Inventory
- warehouses
- inventory
- stock movements
- count differences
- transfers

## PHASE 5: Orders + Sales
- order creation
- approval flow
- pricing evaluation
- promotion evaluation (see `PROMOTION_MODEL.md` / `PROMOTION_RULES.md` — runs after pricing,
  before stock reservation)
- stock reservation

## PHASE 6: Vehicle Inventory
- vehicle stock model
- mobile warehouse logic
- vehicle count and inventory difference

## PHASE 7: Purchasing + Shipment + Returns
- purchase requests
- transfers and shipments
- returns and return processing

## PHASE 8: Payments + Risk + Targets
- accounts
- payments
- collection
- risk evaluation
- targets and bonuses

## PHASE 9: CRM + Visits + GPS
- customer behavior
- visit history
- GPS validation
- route logic

## PHASE 10: Control Center
- dashboarding
- distributor score
- operational analytics

## PHASE 11: Reports + Dashboard
- sales reporting
- stock reporting
- financial reporting

## PHASE 12: VDesgo Field Mobile
- login
- dashboard
- route
- customer list
- order and payment

## PHASE 13: Offline Sync
- local queue
- idempotency
- delayed sync and retry

## PHASE 14: Advanced Analytics
- sales opportunity
- churn prediction
- stock forecasting

## PHASE 15: AI
- sales assistant
- product recommendation
- forecasting and route optimization
- promotion/campaign performance analysis (recommend/analyze only — AI may never autonomously
  create, modify, activate, deactivate, or apply a promotion rule; VD Gıda remains sole authority,
  see `PROMOTION_RULES.md` §23)

## Open Questions
- OPEN QUESTION: Which phases are mandatory for MVP and which are optional for later release?
- OPEN QUESTION: What is the agreed acceptance gate for each phase?
- OPEN QUESTION: Which systems should be included in the first production deployment as external integrations?
- OPEN QUESTION: Promotion stacking/conflict resolution, invoice representation of free goods, and
  offline promotion versioning (see `PROMOTION_RULES.md`) must be resolved before Phase 5's
  promotion evaluation step can be implemented.
- OPEN QUESTION: Phase 5's promotion evaluation step additionally requires VD Gıda's explicit
  sign-off on the RECOMMENDED BUSINESS DECISIONs in `PROMOTION_RULES.md` §3 (stacking) and §10
  (insufficient reward stock) — see `BUSINESS_DECISIONS_v1.md` Decisions 12–13.
