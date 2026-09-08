# Domain Model

## Root Aggregate: Platform
The platform owns global governance. VD Gıda is the platform owner; each distributor is a separate,
isolated tenant under ADR-010 / Decision 22.

Entities:
- Platform
- Organization
- Tenant
- User
- Role
- Permission
- Territory

## Core Business Domain

### Tenant
A tenant is a distributor commercial operating unit. Distributor-owned operations use mandatory
`tenant_id` and PostgreSQL RLS. VD Gıda is platform-level, not a distributor tenant.

### Distributor
A distributor owns its tenant-scoped warehouses, vehicles, customers, routes, sales representatives,
orders, shipments, returns, accounts, and local operations. It cannot set central product prices or
promotion rules.

### Territory
A territory is a tenant-scoped operational area. Users may belong to multiple active territories;
Sales Representatives and Warehouses belong to one territory. Territory restricts manual selection
within a tenant and never expands access beyond the tenant boundary.

### Warehouse
A warehouse is a distributor-controlled inventory location. It has a territory and may be central,
return, transit, temporary, or a vehicle warehouse location.

### Vehicle
A vehicle is a mobile warehouse. Its inventory is ledger-derived. Unsold stock remains in the
vehicle at day end. Custody or vehicle changes use auditable transfer documents; count difference
and damage use count documents and ledger movements.

### Sales Representative
A Sales Representative is a tenant-scoped field commercial actor assigned to customers, routes, and
a territory. A customer has one default representative for transaction prefill; transaction selection
can differ within authorized scope.

### Customer
A customer is a distributor-owned commercial counterpart with addresses, locations, contacts,
credit/risk/payment behavior, order/visit/payment history, and a VD Gıda-defined discount profile.
It references one default Sales Representative and one default Warehouse for Order/Invoice prefill.
Defaults never alter an already-created transaction snapshot.

### Product
A product is VD Gıda-owned central catalog data. Distributors use it read-only in their operations;
product variants, barcodes, pricing, stock, orders, returns, and promotions reference it.

### Inventory
Inventory is real-time product state for warehouse or vehicle, derived solely from immutable ledger
movements. Direct quantity mutation and negative stock are forbidden. Reservation/release are ledger
movements created on Draft-to-Confirmed and resolved on shipment/invoice, cancellation, or partial
delivery.

### Order and Invoice
An Order is the commercial agreement with customer, selected representative, warehouse, price,
promotion, discount, and status history. An Invoice inherits an approved Order's snapshots; it never
re-reads customer defaults or re-evaluates price/promotion during conversion.

### Payment, Visit, Approval
Payment records collection against customer account/order. Visit records field activity, timing,
location, notes, photos, and optional GPS validation. Approval governs sensitive exceptions such as
price overrides, credit exceptions, returns, shipments, and promotion exceptions.

## Relationships Between Major Aggregates
- Distributor tenant owns warehouses, vehicles, customers, sales representatives, territories,
  orders, invoices, inventory documents, and accounts.
- Territory owns user assignments and scopes manual Sales Representative/Warehouse selection.
- Customer references default Sales Representative/Warehouse; Order/Invoice retains final selections
  and default snapshots independently.
- Warehouse/Vehicle owns inventory state and movement history.
- Order owns items and status history; Invoice inherits approved Order snapshots and items.
- Product participates in pricing, inventory, orders, promotions, and returns as VD Gıda master data.
- Payment belongs to customer account and order/invoice commercial context.

## Open Questions
- OPEN QUESTION: Customer transfer history representation between distributors remains to be finalized.
- OPEN QUESTION: Are vehicles ever shared across tenant sub-entities? Current Decisions model them
  tenant-scoped.
- OPEN QUESTION: Are customer risk/payment records shared after customer transfer?
