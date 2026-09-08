# ADR-002: Modular Monolith Architecture

## Status
Accepted

## Context
The domain is large but not yet mature enough to justify multiple independent services. The system also needs strong transaction integrity across inventory, order, payment, and customer operations.

## Decision
Use a modular monolith architecture during the initial implementation and structure modules by business domain.

## Rationale
- simpler domain transaction management
- lower operational complexity early
- better single-database cohesion
- easier initial implementation for ERP-style workflows
- enables future service extraction without re-architecture

## Consequences
- module boundaries must stay enforced
- integration points must remain clear
- later service extraction should be deliberate and not forced

## Open Questions
- OPEN QUESTION: Which modules are first candidates for extraction after MVP release?
