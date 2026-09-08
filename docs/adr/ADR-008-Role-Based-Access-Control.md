# ADR-008: Role Based Access Control

## Status
Accepted

## Context
Multiple user types and tenant hierarchies need controlled access to commercial, financial, and operational data.

## Decision
Use role-based access control (RBAC) with strict tenant-scoped authorization and policy checks in the backend.

## Rationale
- allows clean separation of user responsibilities
- enables distributor-specific access rules
- supports approval workflows and security review
- prevents frontend-only enforcement from becoming a security hole

## Consequences
- role permissions must be defined and reviewed at the tenant level
- business rules must be enforced in service or domain code
- authorization defects require explicit regression tests

## Open Questions
- OPEN QUESTION: Should approvals be stored as a generic workflow engine or as simple workflow tables specific to the initial modules?
