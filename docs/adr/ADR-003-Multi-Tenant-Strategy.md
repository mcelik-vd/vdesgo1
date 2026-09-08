# ADR-003: Multi-Tenant Strategy

## Status
Accepted

## Context
VD Gıda operates as a platform owner and multiple distributors must remain isolated from each other.

## Decision
Adopt a strict tenant-aware model where every critical entity includes tenant_id and backend access is filtered by tenant context.

## Rationale
- prevents unauthorized cross-distributor access
- aligns with ERP and commercial isolation rules
- enables corporate oversight without exposing local data

## Consequences
- all business logic and repository access must enforce tenant scope
- cross-tenant operations must be tightly controlled and audited
- data modeling and tests must specifically cover isolation

## Follow-up Decision
The database topology is resolved by `ADR-010-Tenant-Isolation-Strategy.md`: VDesgo uses Shared
Database, Shared Schema with mandatory distributor `tenant_id` and PostgreSQL RLS enforcement.
