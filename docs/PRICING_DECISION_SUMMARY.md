# Centralized Pricing Authority - Decision Summary

**Date:** 2026-08-30  
**Decision Status:** ✅ CONFIRMED AND IMPLEMENTED  
**Scope:** VDesgo Pricing Model

---

## Executive Summary

VD Gıda is the **sole owner and authority** of all pricing and commercial terms in VDesgo.

Distributors and sales representatives cannot unilaterally change prices. All pricing is defined, managed, and enforced centrally through VDesgo's pricing engine.

This ensures consistency, prevents unauthorized discounting, and maintains centralized margin control across the entire distribution network.

---

## The Decision

**Before Confirmation:**
- Ambiguous: Could mean "rigid single price" OR "centrally managed flexible pricing"

**After Confirmation:**
- Clear: "Centralized pricing authority" = "VD Gıda defines ALL pricing structures, but can define flexible price rules"

**What Changed:**
- Not: rigid, inflexible, one-price-for-all
- Yes: centrally managed, with pre-defined flexibility

---

## What VD Gıda CAN Define

### 1. Standard List Price
```
Krutos 60g = 95 TL (default)
```

### 2. Volume-Based Pricing
```
Krutos 60g:
- 1-999 units: 95 TL
- 1000-4999 units: 93 TL
- 5000+ units: 90 TL
```

### 3. Distributor-Specific Pricing
```
Krutos 60g:
- Distributor A (coastal, high rent): 97 TL
- Distributor B (rural, low cost): 92 TL
- Distributor C (central): 95 TL
```

### 4. Customer-Specific Pricing
```
Krutos 60g:
- ABC Market (VIP customer): 88 TL
- XYZ Supermarket (regular): 95 TL
- Small Corner Store (low volume): 98 TL
```

### 5. Campaign Pricing
```
Campaign: "Summer 2026" (2026-06-01 to 2026-08-31)
Krutos 60g = 85 TL (override)
Auto-applied during campaign
```

### 6. Time-Limited Pricing
```
Krutos 60g:
- June: 95 TL
- July-August: 90 TL (seasonal)
- September: 95 TL
```

### 7. Approval-Based Discounts
```
Discount Policy (defined by VD Gıda):
- 0-5%: Automatic
- 5-10%: Manager approval
- 10-20%: Distributor executive approval
- 20%+: VD Gıda central approval
```

---

## What Distributors CANNOT Do

| Action | Status |
|--------|--------|
| Set own prices | ❌ CANNOT |
| Create own price list | ❌ CANNOT |
| Adjust pricing for competition | ❌ CANNOT |
| Offer customer-specific discounts | ❌ CANNOT (without VD Gıda approval) |
| Run independent campaigns | ❌ CANNOT (without VD Gıda approval) |
| Change discount thresholds | ❌ CANNOT |
| Override minimum prices | ❌ CANNOT (without formal approval) |

---

## What Sales Representatives CANNOT Do

| Action | Status |
|--------|--------|
| Negotiate price with customer | ❌ CANNOT |
| Offer personal discounts | ❌ CANNOT |
| Override system price | ❌ CANNOT (without formal approval) |
| Access price override authority | ❌ CANNOT (by default) |
| Change order price after submission | ❌ CANNOT |

---

## Price Application at Order Time

**When sales rep creates order for Customer ABC:**

```
Order Creation Flow:

Step 1: System looks up price
  ├─ Customer ABC has special price? → YES: 88 TL
  ├─ Active campaign? → YES: but non-applicable (not in product list)
  ├─ Distributor A has custom price? → YES: but overridden by customer price
  └─ Volume-based pricing applies? → Maybe (depends on quantity)

Step 2: System applies HIGHEST applicable price rule
  └─ RESULT: 88 TL (customer-specific)

Step 3: Display to sales rep
  └─ "Price: 88 TL (locked - customer special)"

Step 4: Sales rep cannot change
  └─ Price is READ-ONLY

Step 5: Order confirms at 88 TL
  └─ Price SNAPSHOT captured (immutable)

Step 6: If sales rep tries to negotiate
  └─ System REJECTS or requires formal approval

Step 7: If override approved (e.g., 85 TL)
  ├─ Approval requested (15% discount)
  ├─ Manager reviews and approves
  ├─ Override applied and AUDITED
  └─ Order proceeds at 85 TL (with full audit trail)
```

---

## Immutability & Historical Pricing

**Critical Rule: Price Snapshot**

```
Order 001 (created 2026-08-30 at 11:00)
├─ Item: Krutos 60g
├─ Quantity: 100
├─ Price at order time: 95 TL
├─ Total: 9,500 TL
└─ Snapshot: LOCKED & IMMUTABLE

Later (2026-09-15)
├─ VD Gıda changes price to 92 TL
├─ Order 001 STILL shows 95 TL (unchanged)
├─ New orders use 92 TL
└─ Old order preserved at original price
```

**Why This Matters:**
- Customer knows exact total at order time
- Price changes don't affect past orders
- Fair to both customer and distributor
- Prevents disputes and confusion

---

## Audit & Compliance

**All Price Changes Are Fully Audited:**

```
Audit Record:
├─ entity_type: "price_list_item"
├─ entity_id: "krutos_60g"
├─ action_type: "price_change"
├─ old_value: "95 TL"
├─ new_value: "92 TL"
├─ reason: "Seasonal adjustment"
├─ actor_user_id: "vd_gida_admin_001"
├─ actor_role_id: "vd_gida_admin"
├─ timestamp: "2026-09-15 14:30:00"
├─ ip_address: "192.168.1.100"
└─ device_id: "admin_laptop_001"

Price Override Approval:
├─ entity_type: "order_item"
├─ entity_id: "order_001_item_001"
├─ action_type: "price_override_approved"
├─ override_discount: "15%"
├─ reason: "High-value customer retention"
├─ requested_by: "sales_rep_001"
├─ approved_by: "sales_manager_001"
├─ timestamp: "2026-08-30 11:15:00"
└─ audit_trail: COMPLETE
```

---

## Documents Updated

✅ **10 Documents Updated:**

1. ✅ `BUSINESS_DECISIONS_v1.md` - Decision 9 finalized with full details
2. ✅ `PRICING_RULES.md` - Complete overhaul: VD Gıda authority, price resolution engine, centralized governance
3. ✅ `PRODUCT_CONTRACT.md` - Products are VD Gıda owned, no distributor-specific products
4. ✅ `DISTRIBUTOR_MODEL.md` - Distributors do NOT manage pricing
5. ✅ `SALES_RULES.md` - Price is immutable at order time, centrally managed
6. ✅ `ROLE_PERMISSION_MATRIX.md` - Updated with price authority per role (VD Gıda = owner, others = view-only or request)
7. ✅ `BUSINESS_RULES.md` - Added comprehensive pricing rules section
8. ✅ `SECURITY_MODEL.md` - Price override authority and audit enforcement
9. ✅ `AUDIT_POLICY.md` - ALL price changes are audited (including overrides)
10. ✅ `DATABASE_DESIGN.md` - Added Pricing Domain with price snapshot fields

---

## Data Model Impact

### New Entities / Enhancements Needed

**1. Price Snapshot on Orders**
```sql
order_items:
├─ id
├─ order_id
├─ product_variant_id
├─ quantity
├─ unit_price (snapshotted, immutable)
├─ unit_price_source (from which rule)
├─ unit_price_timestamp
├─ override_discount_percentage (if any)
├─ override_approved_by
├─ override_approval_timestamp
├─ total_price
└─ created_at
```

**2. Price Override Approvals**
```sql
price_override_approvals:
├─ id
├─ tenant_id
├─ entity_type ('order_item', 'order', etc.)
├─ entity_id
├─ requested_price
├─ system_price
├─ discount_percentage
├─ approval_threshold ('manager', 'executive', 'central')
├─ requested_by (user_id)
├─ requested_at
├─ approved_by (user_id or NULL)
├─ approved_at
├─ rejected_by (user_id or NULL)
├─ rejected_at
├─ reason
├─ status ('pending', 'approved', 'rejected')
└─ audit_trail (JSON)
```

**3. Centralized Price Lists** (Already exists, clarified ownership)
```sql
price_lists:
├─ id
├─ tenant_id = 'VD_GIDA' (always)
├─ name
├─ type ('standard', 'distributor_specific', 'customer_specific', 'campaign')
├─ effective_from
├─ effective_to
├─ status
└─ created_by = 'VD_GIDA_SYSTEM'
```

**4. Price Audit Trail**
```sql
audit_logs:
├─ (existing)
├─ entity_type = 'pricing'
├─ action_type = 'price_change' | 'price_override_requested' | 'price_override_approved'
├─ old_value = '95.00 TL'
├─ new_value = '92.00 TL'
└─ (all immutable)
```

---

## Impact on Business Process

### Order Creation Workflow (Updated)

```
BEFORE (Ambiguous):
Sales Rep → Customer → Negotiate Price → Order Created → Payment

AFTER (Centralized):
Sales Rep → Customer → System Applies Price (auto) → Order Created (price locked) → 
  if override needed → Approval Workflow → Price Override Logged → Payment
```

### Discount Approval Workflow (New)

```
Sales Rep wants 15% discount (standard 95 → 80.75 TL)
  ↓
System checks: 15% > 10% threshold
  ↓
Requires: Distributor Executive Approval
  ↓
Executive reviews: Customer value? Competition? Margin?
  ↓
APPROVED → Override logged in audit, order proceeds at 80.75 TL
OR
REJECTED → Order proceeds at standard 95 TL
```

---

## Open Questions RESOLVED

| Question | Previous Status | Resolution |
|----------|---|---|
| Are prices rigid or flexible? | ❓ OPEN | ✅ Flexible within VD Gıda's pre-defined rules |
| Who owns pricing? | ❓ OPEN | ✅ VD Gıda exclusively |
| Can distributors override? | ❓ OPEN | ✅ NO - without formal approval |
| Can sales reps negotiate? | ❓ OPEN | ✅ NO - system applies auto price |
| How are discounts handled? | ❓ OPEN | ✅ Approval-based workflow defined |
| Price retroactively changed? | ❓ OPEN | ✅ NO - snapshots immutable |
| Audit trail for prices? | ❓ OPEN | ✅ ALL price actions audited |

---

## Remaining Open Questions (NEW)

1. **Specific Discount Thresholds:** What exact % thresholds trigger which approval levels? (TBD by VD Gıda policy)
2. **Campaign Scheduling:** Who manages campaign calendar? VD Gıda or delegated?
3. **Volume Threshold Levels:** What are the exact volume tiers for volume-based pricing?
4. **Regional Pricing:** Are regional prices needed or just distributor-specific?
5. **Customer Segment Pricing:** Should pricing be by customer type (retail, wholesale, etc.) or individual?
6. **Price Review Cycle:** How often does VD Gıda review and adjust prices?
7. **Minimum Price Floor:** What is the absolute minimum price a distributor can sell at?
8. **Cost-Plus Margin:** Should pricing follow cost-plus model or market-based?

---

## RED Issues Resolved

| Issue | Previous | Resolution |
|-------|----------|-----------|
| CRITICAL-002: Product Ownership Conflict | 🔴 CRITICAL | ✅ RESOLVED: Products VD Gıda owned, distributors reference central catalog |
| CRITICAL-003: Customer Ownership | 🔴 CRITICAL | ✅ RESOLVED: Customers transferable between distributors, history preserved |
| CRITICAL-004: VD Gıda Central Authority | 🔴 CRITICAL | ✅ RESOLVED: VD Gıda has full visibility & pricing control |
| CRITICAL-009 (partial): Pricing Model | 🔴 CRITICAL | ✅ RESOLVED: Centralized pricing authority defined |

---

## YELLOW Issues Status

| Issue | Previous | Current Status |
|-------|----------|---|
| YELLOW-1: Pricing Ownership | ⚠️ YELLOW | ✅ RESOLVED |
| YELLOW-2: Discount Thresholds | ⚠️ YELLOW | 🟡 PARTIALLY (thresholds not yet specified) |
| YELLOW-3: Customer Pricing | ⚠️ YELLOW | ✅ RESOLVED (VD Gıda approves) |
| YELLOW-4: Campaign Management | ⚠️ YELLOW | 🟡 PARTIALLY (VD Gıda owns, details TBD) |
| YELLOW-5: Price Override Authority | ⚠️ YELLOW | ✅ RESOLVED (approval workflow) |

---

## Next Steps

### Immediate (Before DISCOVERY AUDIT v2)

1. **Specify Discount Thresholds** (Business decision needed)
   - Who decides: 0-5% auto, 5-10% manager, etc.?
   - Are thresholds same for all distributors?

2. **Define Volume Tiers** (Business decision needed)
   - What are the exact volume break points?
   - Who manages tier changes?

3. **Clarify Customer Segments** (Business decision needed)
   - Should pricing be by customer segment or individual?
   - Which segments exist?

4. **Confirm Price Review Cycle** (Business decision needed)
   - How often does VD Gıda review prices?
   - Automatic or manual?

### Before PostgreSQL Schema

- [ ] Implement DISCOVERY AUDIT v2 with updated documents
- [ ] Verify no RED issues remain
- [ ] Convert YELLOW issues to DECIDED or OPEN QUESTION
- [ ] Finalize remaining 4 business decisions above
- [ ] Begin Database Schema Design phase

---

## Summary

**Centralized Pricing Authority is a KEY ARCHITECTURAL DECISION** that:

✅ Prevents unauthorized discounting  
✅ Ensures consistent pricing across network  
✅ Maintains central margin control  
✅ Supports flexible pricing structures  
✅ Enables audit and compliance  
✅ Provides clear decision authority  
✅ Supports business growth and scaling  

This decision **fundamentally shapes VDesgo's pricing, sales, and approval workflows.**

---

**Status:** ✅ IMPLEMENTED IN DOCUMENTS  
**Ready for:** DISCOVERY AUDIT v2 → PostgreSQL Schema Design  
**Decision Authority:** VD Gıda  
**Last Updated:** 2026-08-30
