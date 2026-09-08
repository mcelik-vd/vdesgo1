# ADR-005: Vehicle as Mobile Warehouse

## Status
Accepted

## Context
The field sales process includes mobile stock handling, product transfer to vehicles, stock counting, and customer sales from a moving inventory location.

## Decision
Treat vehicles as mobile warehouses with their own inventory model and associated movement history.

## Rationale
- supports real field sales execution
- aligns with vehicle stock and count workflows
- enables stock transfers and distribution by route or rep

## Consequences
- inventory and sales logic must handle both fixed warehouse and vehicle inventory
- vehicle count differences and stock movement tracking must be built into the process
- mobile stock is not separate from the ERP inventory model

## Open Questions
- OPEN QUESTION: What is the exact stock transfer policy between warehouse and vehicle before field visits?
