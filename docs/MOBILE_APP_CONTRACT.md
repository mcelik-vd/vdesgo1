# Mobile App Contract

## Purpose
The mobile product, VDesgo Field, supports field sales execution, customer visits, route completion, order creation, payment capture, and stock counting.

## Primary User
- sales representative
- warehouse or vehicle operator
- route executor

## Core Screens
- dashboard
- map
- route
- customers
- nearby customers
- products
- orders
- campaigns
- payments
- new customer
- visits
- vehicle stock
- stock count
- performance
- settings

## Core Mobile Flows
1. Login
2. Dashboard load
3. Customer selection
4. Visit start
5. GPS validation
6. Order capture
7. Payment capture
8. Stock count / adjustment
9. Offline operation
10. Sync with server

## Offline Synchronization Requirements
- operations must be stored locally with operation metadata
- each operation should have local_operation_id, device_id, user_id, timestamp, operation_type, payload, sync_status, retry_count
- sync must support idempotence
- server-side validation must be required before final confirmation

## GPS Requirements
- GPS is collected only when required for a field activity
- customer distance is calculated from recorded customer location
- visit distance and timing are logged, not only the final status

## Open Questions
- OPEN QUESTION: Are all field sales operations required to be fully offline-capable or only critical functions?
- OPEN QUESTION: What is the exact time retention policy for GPS history and visit location records?
- OPEN QUESTION: Which mobile operations must be blocked until the server confirms data validity?
- OPEN QUESTION: If a promotion changes or is deactivated on the server while a device is offline
  with a stale cached version, is the promotion honored as of the offline transaction timestamp or
  re-evaluated against the server's current rules at sync time? (See `PROMOTION_RULES.md` §12 —
  same category of risk as stale offline price/stock.)
