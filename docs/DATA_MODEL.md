# Data model

PostgreSQL 17 on Supabase. The schema is defined with Drizzle in `src/server/db/schema/*.ts` (snake_case columns) and shipped as SQL migrations in `supabase/migrations`. Security rules (RLS, triggers, constraints Drizzle can't express) live in the hand-written `*_security*.sql` migrations.

## Conventions

| Rule | Detail |
|---|---|
| Tenancy | Every business table has `tenant_id uuid not null` → `tenants`. RLS is enabled on all tables; policies require `tenant_id = app.current_tenant_id()`, which also re-checks active membership. New tables are not exposed to the Data API (`auto_expose_new_tables = false`). |
| Keys | `id uuid` (`gen_random_uuid()`); human codes (`EMP0001`, `REQ-0001`) come from `tenant_counters`, unique per tenant. |
| Time | `timestamptz` everywhere; business dates are `date` in the organization's time zone (default `Asia/Kolkata`). |
| Money | Integer **paise** (`bigint`), never floats. Formatting happens only in the UI/PDF. |
| Soft delete | `deleted_at` on records people may remove by mistake (e.g. employees, documents). Payroll, compensation, employment history, audit and ledgers are never deleted. |
| History | Changes to job, manager, compensation and statutory data create new dated rows (`employment_records`, `manager_relationships`, `compensation_records`) instead of overwriting. |
| Sensitive fields | PAN, Aadhaar, passport, bank account and integration secrets are AES-256-GCM encrypted at the application layer (`v1.` prefix) with only `last4` stored in clear. Kept in `employee_sensitive`, readable only with `employees.sensitive`. |
| Audit | `audit_logs` is append-only (a trigger blocks update/delete). Diffs redact sensitive keys. |

## Domains

| Domain | Tables |
|---|---|
| Identity & access | `tenants`, `users` (synced from `auth.users` by trigger), `memberships`, `roles`, `membership_roles`, `invitations` |
| Organization | `legal_entities`, `locations`, `business_units`, `cost_centers`, `departments`, `teams`, `job_families`, `grades`, `designations`, `positions` |
| People | `employees`, `employment_records`, `manager_relationships`, `compensation_records`, `employee_sensitive`, `employee_addresses`, `emergency_contacts`, `dependents`, `qualifications`, `skills`, `employee_skills`, `assets`, `asset_assignments`, `data_change_requests`, `custom_field_definitions`, `tenant_counters` |
| Platform | `audit_logs`, `jobs`, `notifications`, `notification_preferences`, `email_outbox`, `idempotency_keys`, `rate_limits`, `approval_policies`, `approval_requests`, `approval_steps`, `approval_delegations`, `tasks`, `comments` |
| Documents & policies | `documents`, `document_access_logs`, `document_templates`, `document_template_versions`, `policies`, `policy_acknowledgements` |
| Recruitment | `job_requisitions`, `job_openings`, `recruitment_stages`, `candidates`, `talent_pools`, `talent_pool_members`, `applications`, `application_events`, `scorecard_templates`, `interviews`, `interview_panelists`, `interview_feedback`, `offers`, `referral_reward_policies`, `referrals` |
| Lifecycle | `lifecycle_templates`, `lifecycle_template_tasks`, `lifecycle_plans`, `exit_cases` |
| Time & leave | `holiday_calendars`, `holidays`, `shifts`, `shift_assignments`, `attendance_policies`, `attendance_events`, `attendance_days`, `regularizations`, `projects`, `timesheets`, `timesheet_entries`, `leave_types`, `leave_policies`, `leave_transactions`, `leave_balances`, `leave_requests` |
| Payroll | `pay_components`, `salary_structures`, `statutory_rule_sets`, `payroll_periods`, `payroll_inputs`, `payroll_runs`, `payroll_run_employees`, `payroll_line_items`, `employee_loans`, `loan_repayments`, `payslips`, `disbursement_batches`, `disbursements`, `tax_declarations` |
| Expenses & benefits | `expense_categories`, `expense_claims`, `expense_items`, `benefit_plans`, `benefit_enrollments` |
| Talent | `rating_scales`, `competencies`, `review_templates`, `review_cycles`, `goals`, `goal_checkins`, `reviews`, `feedback_notes`, `improvement_plans`, `promotion_recommendations`, `courses`, `learning_paths`, `learning_assignments`, `learning_enrollments`, `surveys`, `survey_participants`, `survey_responses`, `recognitions`, `one_on_ones`, `career_plans`, `succession_plans`, `engagement_action_plans` |
| Service | `ticket_categories`, `tickets`, `ticket_messages`, `kb_articles`, `knowledge_chunks` (generated `tsvector` for full-text retrieval) |
| Automation & AI | `workflow_definitions`, `workflow_versions`, `workflow_runs`, `workflow_run_steps`, `integration_connections`, `integration_events`, `ai_agents`, `ai_executions`, `ai_tool_calls`, `ai_conversations`, `ai_messages`, `saved_reports` |

## Invariants enforced in the database

- **No cross-tenant access**: RLS on every table plus `app.current_tenant_id()` membership check; background jobs use `withSystem(fn, tenantId)`, which pins `app.tenant_id`.
- **Scoped permissions**: `app.has_perm(p)` requires the `:all` grant; per-employee rows use `app.can_access_employee(perm, employee_id)`, which resolves `self` / `team` (reporting subtree) / `all`.
- **No reporting loops**: triggers reject a manager or parent-department chain that cycles.
- **No overlapping assignments**: exclusion constraints (`btree_gist`) on dated ranges for `employment_records`, `compensation_records` and `shift_assignments`.
- **Locked payroll is immutable**: `guard_locked_payroll` triggers reject edits to runs, run employees and line items once a run is locked; corrections go through an adjustment run.
- **Leave is a ledger**: `leave_transactions` is append-only; `leave_balances` is a projection of it.
- **Audit is append-only**: update/delete on `audit_logs` raises.
- **Payslip visibility**: employees see their own payslip only after the run is published (`app.run_is_published`).
- **Sensitive tickets**: only the sensitive-case owners can read tickets in sensitive categories (`app.ticket_is_sensitive`).
- **Idempotency**: device punches (`source, external_id`), integration events (`provider, external_id`), API creates (`idempotency_keys`) and scheduled jobs (`dedupe_key`) are unique.

## Migrations

```bash
npm run db:generate      # drizzle-kit → supabase/migrations/<ts>_<name>.sql
npx supabase migration up   # apply locally
npx supabase db push        # apply to a linked project
```

Write RLS for every new table in a `*_security.sql` migration (`select app.enable_tenant_rls('<table>')` plus any scoped policies). Migrations are additive; destructive changes use expand → migrate → contract.
