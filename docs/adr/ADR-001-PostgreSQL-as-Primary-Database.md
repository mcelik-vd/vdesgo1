# ADR-001: PostgreSQL as Primary Database

## Status
Accepted

## Context
The project requires a transactional system of record supporting ERP workflows, stock control, customer operations, and audit trails across a multi-tenant distributor model.

## Decision
Use PostgreSQL as the primary persistent database and PostGIS as the geospatial extension.

## Rationale
- transactional safety
- strong relational modeling support
- foreign key integrity
- JSONB support for flexible metadata
- advanced reporting capabilities
- geospatial support for GPS and route use cases
- clear fit for financial and inventory operations

## Consequences
- database schema design must enforce keys and constraints
- reporting and analytics may need materialized or aggregate views later
- PostGIS introduces geospatial operational requirements

## Open Questions
- OPEN QUESTION: Does the platform need a dedicated read replica for reporting in the first production release?
