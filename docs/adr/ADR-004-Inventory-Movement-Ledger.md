# ADR-004: Inventory Movement Ledger

## Status
Accepted

## Context
Inventory accuracy is central to commercial trust. Direct stock mutation is unacceptable for money and product movement integrity.

## Decision
Use an inventory movement ledger as the source of truth for inventory state.

## Rationale
- every adjustment becomes traceable
- stock can be reconstructed and audited
- supports return, adjustment, transfer, damage, and count differences
- enforces financial and operational accountability

## Consequences
- stock state is derived from movement records and must not be manually overwritten
- inventory operations require validation and transaction boundaries
- stock reconciliation must be tested with golden scenarios

## Open Questions
- OPEN QUESTION: Should reservation entries be part of the same movement ledger or handled as a separate reservation table?
