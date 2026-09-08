# Project Vision

## Objective
VDesgo is a multi-tenant distribution ERP and field sales platform for VD Gıda and its distributors. It covers the operational chain from manufacturer to distributor to warehouse to vehicle to sales representative to customer to order to collection and reporting.

## Business Focus
This is not a generic retail app. It is a distribution operating system designed for:
- distributor management
- stock and warehouse control
- field sales execution
- customer tracking and CRM
- route-based sales activity
- collection and risk monitoring
- reporting and operational control

## Strategic Principle
The system must be built for real commercial reliability, not just data capture. Every commercial action must be traceable, authorized, auditable, and supported by transactional database rules.

## Target User Groups
- VD Gıda corporate control center
- distributor administrators
- warehouse staff
- sales managers
- sales representatives
- finance and collections teams
- customers and field agents in the mobile app

## Scope
The initial system prioritizes:
- tenant-aware auth and RBAC
- distributor and user hierarchy
- product and category master data
- warehouse and inventory movements
- vehicle/mobile warehouse logic
- customer, visit, and CRM flows
- order and pricing engine
- payments and collection risk
- reporting and operational dashboards

## Non-Goals for Phase 0
- building full AI features first
- forcing microservices upfront
- hardcoding business rules into the frontend
- exposing tenants to each other
- deleting financial records physically

## Design Principles
- PostgreSQL is the system of record
- PostGIS for GPS and geo operations
- modular monolith as the initial architecture
- strict tenant isolation in backend logic
- inventory movements instead of direct stock mutation
- audit logging for all critical actions
- test-first control for critical business rules

## Open Questions
- OPEN QUESTION: What exact distributor hierarchy and ownership model is required for shared operations between VD Gıda and each distributor?
- OPEN QUESTION: What is the official credit policy for new customers and distributors?
- OPEN QUESTION: Which payment collection methods are mandatory in MVP vs later phases?
- OPEN QUESTION: Which customers require strict GPS verification and which do not?
- OPEN QUESTION: What is the official stock reserve policy for vehicle stock vs central warehouse stock?
