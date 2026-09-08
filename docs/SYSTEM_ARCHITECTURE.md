# System Architecture

## Architecture Style
Initial design is a modular monolith because the business domain is large but not yet fragmented enough to justify microservices at day one.

## Core Layers
- API Layer
- Application Service Layer
- Domain Layer
- Repository / Data Access Layer
- Infrastructure Layer
- Auth / Authorization Layer
- Background Job Layer
- Integration Layer
- Reporting Layer

## Control Center Desktop Workspace

The React + TypeScript Control Center is a desktop-first workspace, not a route-replacement-only
SPA. Dashboard remains available as the module-launching and workspace-management surface while
module work windows may stay open concurrently.

### Window Manager Contract
- A central Window Manager owns the list of open work windows, active window id, minimized windows,
    window position/size, z-order, and window state (`open`, `minimized`, `maximized`, `restored`,
    `closed`, `active`, `inactive`).
- Module launch activates an already-open list window rather than creating a redundant second
    instance. List modules are single instance; transaction/detail work windows are multiple instance.
- New windows open with a bounded cascade/offset so they do not fully cover one another. Users may
    drag, resize, minimize, maximize/restore, and close a window inside the workspace.
- Window layout (position, size, z-order, and open/minimized/maximized status) persists through
    browser refresh/session using browser-local storage or user preferences. Unsaved form data remains
    in memory and is never persisted as workspace layout.
- A minimized window remains alive in a taskbar-like workspace area; restoring it preserves its
    position, size, form state, and unsaved work where technically feasible.
- Activating a window brings it to the foreground. Maximize/restore preserves the previous bounds.
- Closing a window with unsaved changes requires confirmation; unsaved work must not be silently
    discarded.
- Workspace URL remains static (for example, `/workspace`). Window actions do not push entries to
    browser history. Browser routes remain available for navigation/deep links, but route changes
    need not destroy an already-open workspace window.
- A global unsaved-work guard uses standard browser `beforeunload` behavior for refresh, browser
    navigation, and tab closure; internal window close remains confirmation-driven.

### Work Window Scope
Customers, Orders, Invoices, Inventory, Products, Accounts, Sales Representatives, and Warehouses
may remain open concurrently. Order and Invoice work windows retain in-progress forms while the
user opens supporting windows, such as Customer search, Product, or Inventory.

## Runtime Components
- PostgreSQL + PostGIS primary database
- Redis for cache, queue, temporary session or sync tasks
- FastAPI backend
- React + TypeScript control center web app
- React Native + TypeScript field app
- background worker for sync and notifications

## Module Boundaries
The design is modular by business domain, not by technical feature alone.

Key modules:
- tenants
- auth
- users
- roles
- distributors
- products
- customers
- warehouses
- inventory
- vehicles
- sales
- orders
- purchases
- deliveries
- payments
- risks
- visits
- routes
- reports
- notifications
- audit
- integrations
- ai

## Multi-Tenant Topology
Platform
└── VD Gıda
    └── Distributor A
        ├── warehouse
        ├── vehicles
        ├── sales reps
        ├── customers
        └── orders

## Core Domain Flow
VD Gıda
→ distributor order or purchase request
→ warehouse preparation
→ shipment
→ distributor stock or vehicle stock
→ sales representative
→ customer
→ order
→ collection
→ report
→ control center

## Control Center Responsibilities
- distributor performance monitoring
- stock overview
- sales and target tracking
- risk and collection monitoring
- dashboarding and reporting

## Field App Responsibilities
- route selection
- customer list and search
- visit recording
- GPS validation
- order entry
- payment capture
- count and stock difference tracking
- offline operation and synchronization

## Open Questions
- RESOLVED BY ADR-010 / Decision 22: Shared Database, Shared Schema with mandatory distributor
    `tenant_id` and PostgreSQL RLS.
- OPEN QUESTION: Should the platform support distributor-managed sub-tenant roles beyond the initial internal org model?
- OPEN QUESTION: How will business event subscriptions and async jobs be managed in the modular monolith?
- RESOLVED BY Decision 28: list modules are single instance; transaction/detail windows are
    multiple instance; layout persists but unsaved form data remains in memory.
