# Security Model

## Authentication
- JWT-based authentication
- refresh token support
- device-aware session model for field app
- secure password hashing

## Authorization
- RBAC with tenant scope
- permission checks at backend service layer
- policy-based validation for discount, limits, and approvals
- **Price override authority centrally managed by VD Gıda**
- **Distributors cannot override prices without formal approval**
- **All price changes require audit logging**
- **Promotion override authority centrally managed by VD Gıda (same pattern as price override) —
  see `PROMOTION_RULES.md`**
- **Distributors/sales reps cannot create, edit, or override a promotion result without formal
  `promotion_override_requests` approval**

## Security Controls
- rate limiting
- CORS policy
- secure headers
- input validation
- SQL injection prevention via parameterized queries and ORM
- tenant isolation at database and application layer
- PostgreSQL RLS is the primary tenant-isolation enforcement layer for distributor-owned records;
  application checks are defense in depth. VD Gıda platform administrators receive controlled,
  audited cross-tenant read scope through a trusted database role or verified `platform_admin`
  claim. On-behalf-of distributor writes require explicit target `tenant_id`.

## GPS Privacy
- GPS must only be used for business need
- user consent and disclosure must exist
- storage duration must be time-limited and policy-based

## Audit Security
- critical operations must be logged
- audit logs are not modifiable through normal user actions
- user actions tied to IP, device, and timestamp

## Open Questions
- OPEN QUESTION: What is the approved retention period for GPS and visit logs?
- OPEN QUESTION: Which devices are considered trusted for field app authentication?
- OPEN QUESTION: Is there a formal policy for secret rotation and privileged access management?
