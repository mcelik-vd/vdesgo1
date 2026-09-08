# Module Map

## Core Modules
1. Organization
2. Users
3. Roles and Permissions
4. Distributor Management
5. Product Management
6. Category Management
7. Price Management
8. Discount Management
9. Campaign Management
10. Warehouse Management
11. Inventory Management
12. Vehicle Warehouse Management
13. Customer Management
14. CRM
15. Sales Representative Management
16. Order Management
17. Shipment Management
18. Purchase Management
19. Return Management
20. Payment and Collection
21. Credit and Risk
22. Targets
23. Bonus and Commission
24. Route Management
25. Field Visits
26. GPS
27. Notifications
28. Approvals
29. Reporting
30. Dashboard
31. Audit Log
32. Integrations
33. Mobile Synchronization
34. AI / Analytics

## Core Module Dependencies
- auth depends on tenants and users
- products depends on categories and prices
- inventory depends on warehouses and product variants
- orders depend on customers, product pricing, inventory, approvals
- payments depend on customers, orders, and accounts
- visits depend on customers, sales reps, GPS, and routes
- mobile sync depends on auth, orders, visits, devices, and operation logs

## MVP Focus
For the first MVP, prioritize:
- authentication and tenant
- users and roles
- distributors
- products
- warehouses
- inventory
- customers
- sales reps
- orders
- basic pricing
- reporting
- audit log

## Open Questions
- OPEN QUESTION: Which modules are compulsory for the first production release vs later phases?
- OPEN QUESTION: Should the field app be treated as a separate product or same codebase with app-specific flows?
- OPEN QUESTION: Which modules are expected to be the first candidate for service extraction?
