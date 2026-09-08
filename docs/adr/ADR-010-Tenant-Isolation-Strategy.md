# ADR-010: Tenant Isolation Strategy

## Status
Accepted

## Context
VDesgo has VD Gıda as the platform owner with central oversight, while each distributor is an
independent tenant that must not access another distributor's operational data. The prior
multi-tenant ADR established tenant awareness but left the database topology unresolved.

## Decision
Use a **Shared Database, Shared Schema** topology.

- Each distributor is a tenant.
- Every distributor-owned operational record carries a mandatory `tenant_id` identifying its
  distributor tenant.
- PostgreSQL Row-Level Security (RLS) is the database enforcement layer for tenant isolation.
  Application-layer checks remain required as defense in depth, but are not the sole boundary.
- VD Gıda is a platform-level organization, not a distributor tenant. Platform administrators have
  a dedicated database role or verified JWT claim such as `platform_admin` that permits controlled,
  audited cross-tenant reads through RLS policy.
- When VD Gıda performs a write on behalf of a distributor, the target `tenant_id` is mandatory in
  the request context and is validated/audited. Platform access is not an implicit write bypass.

## Rationale
- Supports VD Gıda control-center reporting and cross-distributor visibility without cross-schema
  or cross-database aggregation complexity.
- Provides one migration/backup/operational surface while preserving database-level distributor
  isolation.
- Makes the intended platform-owner role explicit, resolving the prior ambiguity of treating VD
  Gıda both as a tenant and as a cross-tenant authority.

## Consequences
- All tenant-owned table designs must define `tenant_id`, tenant-aware foreign-key consistency,
  and RLS policies before implementation.
- Shared master data owned by VD Gıda (for example products, centrally managed pricing, and
  promotions) must be represented as platform-owned/shared data rather than as data owned by a
  distributor tenant.
- Platform-admin cross-tenant reads and on-behalf-of writes require audit context that identifies
  both the acting VD Gıda user and the target tenant.
- RLS policy implementation details belong to the Phase 1 schema design; this ADR contains no SQL.

## Open Questions
- OPEN QUESTION: Which exact database-role and JWT-claim propagation mechanism will be used to set
  trusted RLS session context?
- OPEN QUESTION: Which platform roles, beyond Platform Admin, may receive cross-tenant read scope?
- OPEN QUESTION: Are tenant-consistent foreign keys enforced through composite keys, RLS-only
  checks, or another approved database constraint strategy? Resolve during Phase 1 ER design.
