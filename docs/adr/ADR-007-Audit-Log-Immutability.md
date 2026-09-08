# ADR-007: Audit Log Immutability

## Status
Accepted

## Context
Financial and stock operations require trustworthy traceability. The system must answer who did what and when.

## Decision
Implement immutable audit logging for all critical changes, and prohibit normal user modification of audit data.

## Rationale
- supports investigations and financial review
- meets ERP-grade accountability requirements
- preserves trust in price, stock, payment, and risk actions

## Consequences
- audit events must be append-only and protected
- audit policies must be explicit and reviewed
- audit data should be separated from business record updates

## Open Questions
- OPEN QUESTION: Is dedicated immutable audit storage required for compliance or is application-level append-only storage sufficient for the initial release?
