# Role Permission Matrix

## Core Roles
- Platform Admin
- VD Gıda Admin
- VD Gıda Sales Manager
- VD Gıda Warehouse Manager
- Distributor Admin
- Distributor Sales Manager
- Distributor Warehouse Manager
- Distributor Finance
- Sales Representative

## Permission Types
- view
- create
- update
- delete
- approve
- export

## Example Access Matrix
| Role | Customers | Inventory | Orders | Prices | Discounts | Customer Discounts | Promotions | Approvals | Payments |
|---|---|---|---|---|---|---|---|---|---|
| Platform Admin | Full | Full | Full | Full | Full | Full | Full | Full | Full |
| VD Gıda Admin | Full tenant view | Full tenant view | Full tenant view | **Full - OWNER** | **Full - DEFINE** | **Full - OWNER** | **Full - OWNER** | Full | Full |
| VD Gıda Sales Manager | Full tenant view | View | View | **View only** | **Define (delegated)** | **Define (delegated)** | **Define (delegated)** | Can approve | View |
| Distributor Admin | Local only | Local only | Local only | **View only** | **Cannot define** | **View only, can request exception** | **View only, can request exception** | Can approve local | Local only |
| Sales Manager (Dist) | Local only | Local only | Local only | **View only** | **Cannot override** | **View only** | **View only, can approve local exception requests** | Can approve local | Local only |
| Sales Representative | Own + assigned | Own vehicle | Own + assigned | **View only** | **Request only** | **View + select defined discount at invoice time only, cannot change rate** | **View only, can request exception** | No | Own |
| Warehouse Manager | View | Full local | Limited | **View only** | **Cannot override** | **View only** | Limited | No |

**KEY CHANGE:** Prices column now shows centralized authority.

- VD Gıda Admin: FULL - owns and manages all pricing
- VD Gıda Sales Manager: View only + can delegate discount authority
- Distributor Admins: View ONLY - cannot change prices
- Sales Reps: View ONLY - cannot override prices
- All overrides require formal approval workflow

**Promotions column follows the identical governance pattern as Prices** (Decision 11): VD Gıda
owns creation/edit/activation; all other roles are view-only with an optional, audited exception
request path via `promotion_override_requests`.

**Invoice Total Discount (Decision 25):** Distributor Admin may apply the separate fixed-TL
invoice-total discount at the final pre-KDV stage. No other role receives this authority from this
decision; it is separate from Price Override and Customer Discount selection.

## Customer Default Assignment and Transaction Selection
- VD Gıda Admin and Distributor Admin may define/change default sales representative and default
	warehouse for customers in their own permitted tenant scope.
- A Sales Representative creating an order/invoice may change the prefilled representative and
	warehouse independently, but only within active tenant and active territory scope.
- This selection does not grant the Sales Representative authority to edit the customer-profile
	defaults themselves.

## RBAC Principles
- permissions are assigned through roles
- roles are tenant-aware
- authorization is checked at backend service level
- UI cannot be the single enforcement point
- operational approval rules must be policy-driven

## Open Questions
- OPEN QUESTION: Will permission scopes be global or granular per distributor sub-unit?
- OPEN QUESTION: Which roles will be allowed to override discount limits automatically?
- OPEN QUESTION: Should approval steps be dynamic or static for each workflow type?
- RESOLVED BY Decision 29: manual Sales Representative and Warehouse selection is restricted to
	the active distributor tenant pool; cross-tenant selection is blocked by RLS and authorization.
- RESOLVED BY Decision 29: Distributor Admin may change defaults for customers in its own tenant.
- RESOLVED BY Decision 30: Sales Representative/Warehouse selection is additionally restricted to
	`territory_id IN (user_active_territories)` within the active tenant.
