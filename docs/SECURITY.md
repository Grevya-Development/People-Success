# Security, privacy and backups

## Tenant isolation (defence in depth)

1. **Service layer**: every query runs through `ctx.db`, scoped to the signed-in user's active tenant.
2. **Database (RLS)**: all 144 public tables have row level security enabled and forced. The standard policy matches `tenant_id = (select app.current_tenant_id())`, and that function re-checks that the user is an active member of the tenant set for the transaction. A forged or wrong tenant id returns no rows.
3. **Data API**: the `anon` role has no grants. PostgREST cannot set `app.tenant_id`, so even a valid user JWT sees nothing through the Data API.
4. **Tests**: `tests/integration/rls.test.ts` proves cross-tenant reads, writes, updates and deletes are refused at the database, and that every public table has RLS enabled. Module tests repeat the check at the service level.

## Sensitive data

| Data | Protection |
|---|---|
| PAN, Aadhaar, passport, bank account numbers | AES-256-GCM application-level encryption (`APP_ENCRYPTION_KEY`), last 4 in clear, masked in UI, never logged, never in audit diffs. Readable only with `employees.sensitive.view` or by the employee (RLS restrictive policy). |
| Compensation | RLS `compensation_read` uses `app.can_access_employee('compensation.view', employee_id)` (self / team / all). Amounts are not written to audit logs. |
| Payroll results and payslips | Payroll-permission RLS; employees read only their own **published** results. Approved, locked and published runs are immutable (DB trigger); corrections use adjustment runs. |
| Reviews, 1:1s, improvement plans, succession | Participant/role-specific RLS policies. |
| Anonymous surveys | Responses never store the respondent; coarse group attributes only; results suppressed below the minimum group size. |
| Integration credentials | Encrypted; never returned to the browser. |
| Documents | Private buckets; downloads via 60-second signed URLs after an authorization check; every download logged; sensitive downloads audited. |

Correction requests that include identity or bank numbers store the requested values encrypted and drop them after the request is applied.

## Authentication & sessions

- Supabase Auth with email confirmation, password reset (no account enumeration), password policy (≥10 chars, letters + digits), secure password change, refresh-token rotation, TOTP MFA enabled in config.
- Sessions verified locally (`getClaims`, ES256 JWKS). The proxy refreshes tokens; authorization is always re-checked next to the data.
- Rate limits (Postgres fixed window): sign-in per IP and per email, sign-up and reset per IP/email, organization creation per user, public applications, REST API per user.

## Authorization

- Permission catalogue: `src/lib/permissions.ts`; grants are `permission:scope` with scope `self`, `team` (reporting subtree) or `all`.
- 13 built-in role templates seeded per tenant (owner, HR admin, HR manager, recruiter, hiring manager, interviewer, payroll admin, finance manager, department head, people manager, employee, contractor, auditor) plus the platform super-admin flag.
- Guard rails: the last owner cannot be removed or suspended; non-owners cannot grant permissions they do not hold; self-approval is prevented in the approvals engine.

## Application security

- Input validation with Zod on every action and API route; consistent error shape; internal errors are logged, never leaked.
- SQL via Drizzle parameterization; raw SQL uses tagged templates (parameters, not concatenation).
- React output encoding; Markdown renderer emits no HTML; CSV exports neutralize spreadsheet formulas.
- Security headers from the proxy (`X-Frame-Options: DENY`, `nosniff`, referrer policy, permissions policy). Server Actions carry Next.js CSRF protections (origin checks).
- Uploads: size limits, MIME allowlist with magic-byte sniffing, file-name sanitization, malware-scanner adapter (no-op locally; plug ClamAV in production).
- Webhooks: HMAC-SHA256 signatures, idempotent processing by external id.
- Logs: structured JSON with automatic scrubbing of passwords, tokens, identity and bank fields.

## Audit

`audit_logs` is append-only for every role (DB trigger). Business mutations write field-level diffs with sensitive values redacted, actor, IP and user agent where available. Exports and sensitive document downloads are audited.

## Privacy (India DPDP Act 2023)

The platform provides building blocks, not a compliance claim:

- Purpose-specific consent capture for candidates (careers page) with retention dates.
- Access logging, audit trails, export logs.
- Minimum-group-size aggregation and anonymous survey handling.
- Retention fields and legal hold on documents.

Before go-live, the organization must verify applicable obligations (notice, consent, data principal rights, breach notification, cross-border transfer, retention schedules) with qualified counsel, and configure retention/deletion workflows accordingly.

## Backups and recovery

- **Database**: use Supabase managed backups (daily on Pro; enable Point-in-Time Recovery for production). Test a restore into a staging project quarterly.
- **Storage**: buckets are not covered by database backups; replicate the `documents` and `generated` buckets (e.g. scheduled `rclone` sync to an encrypted bucket in another region).
- **Encryption key**: back up `APP_ENCRYPTION_KEY` in a secrets manager separately from database backups. Without it, encrypted identity/bank fields cannot be read. Key rotation requires a re-encryption job (`v1.` prefix in ciphertexts reserves room for versioned keys).
- **Recovery objectives** (recommended): RPO ≤ 5 minutes (PITR), RTO ≤ 4 hours.

## Security event logging

Failed sign-ins, rate-limit hits, permission denials (FORBIDDEN errors), integration verification failures and failed workflow runs are logged; failed runs also notify HR administrators. Ship logs to your observability stack and alert on spikes.
