# ADR-006: Offline Mobile Synchronization

## Status
Accepted

## Context
Field sales representatives may operate in areas with no network access. Orders, visits, and payments must still be captured while offline.

## Decision
Use an offline-first synchronization model with local operation records, server-side validation, and idempotent sync processing.

## Rationale
- supports field operations in low-connectivity areas
- reduces data loss risk
- ensures server validation before final commit
- supports retry-safe processing

## Consequences
- local operations must contain metadata and sync state
- every sync operation must be idempotent
- conflict handling must be explicit and traceable

## Open Questions
- OPEN QUESTION: Which operations are allowed offline without prior server verification, and which require online confirmation before finalization?
