# Architecture

PeopleSuccess by Grevya is a multi-tenant HR ERP built as a modular monolith: one Next.js application, one Postgres database (Supabase), a background worker, and shared domain services. Modules share one employee record and talk through services and domain events, not through copies of data.

```
 Browser ──► Next.js 16 (App Router, React 19)
              ├─ proxy.ts ............ session refresh, optimistic auth redirects, security headers
              ├─ Server Components ... read via services (streamed behind <Suspense>)
              ├─ Server Actions ...... mutations via defineAction (Zod + auth + error mapping)
              └─ Route Handlers ...... REST API /api/v1, downloads, exports, webhooks, cron
                      │
                      ▼
            Domain services (src/server/services/*)  ◄── authorization, rules, audit, events
                      │ ctx.db(tx => …)
                      ▼
            Postgres (Supabase) ── RLS per transaction ── Storage (private buckets) ── Auth
                      ▲
                      │ jobs table (SKIP LOCKED)
            Worker (scripts/worker.ts or /api/cron/tick): schedules, domain events,
            workflows, email delivery, accruals, reminders, escalations
```

## Key decisions

| Decision | Choice | Why |
|---|---|---|
| Framework | Next.js 16.4, App Router, `cacheComponents` + `partialPrefetching` | Static shells render instantly; data streams behind Suspense; one codebase for UI, API and jobs. |
| Database access | Drizzle ORM over a direct Postgres connection (`postgres` driver) | Typed SQL, migrations generated into `supabase/migrations`, no extra network hop compared with PostgREST. |
| Tenant isolation | Postgres RLS evaluated **per request transaction** | Every request runs as role `authenticated` with `request.jwt.claims`, `app.tenant_id` and `app.perms` set. A missing `where tenant_id = …` in code cannot leak data. |
| Authentication | Supabase Auth (email/password, confirmation, reset, TOTP MFA ready, SAML via Supabase) | Managed, standards-based; sessions verified locally with ES256 JWKS (`getClaims`). |
| Authorization | Permission catalogue + role templates, scoped grants `perm:self|team|all` | Least privilege with self-service and manager scopes; enforced in services and, for sensitive tables, again in RLS. |
| Background jobs | Postgres queue (`jobs`) with `FOR UPDATE SKIP LOCKED`, retries, dead letters | No Redis to operate; transactional outbox for domain events. |
| Money | Integer paise + currency column | No floating-point errors in payroll. |
| Sensitive data | AES-256-GCM application encryption for PAN, Aadhaar, passport, bank numbers, integration secrets | A database dump alone does not reveal them; only last 4 characters stored in clear. |
| Files | Supabase Storage private buckets, short-lived signed URLs after authorization, access logs | Nothing sensitive is publicly reachable. |
| AI | Provider adapter (Anthropic default `claude-opus-5-5`, OpenAI optional), governed `runAi` | Budgets, cost and prompt-version tracking, schema-validated outputs, deterministic fallbacks; AI never makes final HR or pay decisions. |
| PDFs | pdf-lib layout builder | Pure JS; runs in the app and the worker. |

## Request context and data access

`requireContext()` (pages) / `defineAction` (actions) / `apiContext()` (REST) resolve:

1. The session (Supabase JWT, verified locally).
2. The active tenant (cookie, last active, or first membership) and the user's roles → merged grants. Cached per user with `use cache` + tag invalidation on role or membership change.
3. `ctx.db(fn)` → `withTenant()` opens a transaction, sets the Postgres role and GUCs, runs `fn`, commits.

RLS helper functions (`app.current_tenant_id()`, `app.perm_scope()`, `app.can_access_employee()`) are evaluated once per statement (`(select …)` init-plan pattern) so policies stay fast.

Background jobs use `withSystem(fn, tenantId)` (RLS bypassed) and always filter by tenant explicitly. Jobs acting for a user (scheduled reports) use `contextForUser()` so the user's *current* permissions apply.

## Modules

| Module | Services | Routes |
|---|---|---|
| Identity, tenancy, roles | `auth/*`, `services/tenancy`, `services/users`, `services/settings` | `/login`, `/signup`, `/setup`, `/invite`, `/settings/*` |
| Employees | `services/employees` | `/employees`, `/api/v1/employees` |
| Organization | `services/organization` | `/organization` |
| Documents & policies | `services/documents` | `/documents`, `/api/documents/[id]/download` |
| Recruitment, offers, referrals | `services/recruitment` | `/recruitment`, `/referrals`, `/careers` (public), `/offers/respond` (public) |
| Onboarding, offboarding, exits | `services/lifecycle` | `/onboarding` |
| Attendance, timesheets, leave | `services/time` | `/attendance`, `/leave` |
| Payroll | `services/payroll`, `lib/payroll` (pure engine) | `/payroll` |
| Expenses, benefits | `services/expenses`, `services/benefits` | `/expenses` |
| Performance, learning, engagement | `services/talent` | `/performance`, `/learning`, `/engagement` |
| HR service desk, AI assistant | `services/helpdesk`, `services/assistant` | `/helpdesk`, header assistant panel |
| Approvals, tasks, notifications | `services/approvals`, `services/inbox`, `services/notifications` | `/inbox` |
| Workflows | `services/workflows` | `/workflows` |
| Integrations | `integrations/providers`, `services/integrations` | `/integrations`, `/developers` |
| AI agents | `ai/*`, `services/ai-admin` | `/agents` |
| Analytics & reports | `services/analytics`, `services/reports` | `/overview`, `/reports` |

## Cross-cutting engines

- **Approvals** (`services/approvals/engine.ts`): policy selection by subject type and conditions, approver resolution (manager, manager's manager, department head, role, user), delegation, self-approval prevention, escalation, and module handlers (`onApproved`, `onRejected`, `onCancelled`) that run in the deciding transaction.
- **Domain events** (`services/events.ts`): written to the job queue inside the business transaction (transactional outbox) and fanned out by the worker to subscribers (`onDomainEvent`).
- **Workflow engine** (`services/workflows`): versioned definitions triggered by events; idempotent runs keyed by the triggering event; steps (task, notify, email, approval, wait, wait-for-event, webhook, AI agent, escalate) with retries, timeouts, cancellation and run history.
- **Jobs & schedules** (`server/jobs`): `registerJobHandler`, `registerSchedule` (per-tenant or global; per-slot dedupe), stale-lock recovery, exponential backoff, dead letters.

## Performance practices

- Static app shell + streamed sections; client navigations reuse the shell.
- Session verification without network calls; access cached with tag invalidation.
- One round trip per section where possible (`Promise.all` inside a transaction), indexed predicates on every list (`tenant_id` composite indexes, trigram search indexes).
- Server-side pagination (50 rows) with window counts; URL-driven filters.
- Prepared statements on direct connections; automatically disabled behind the transaction pooler.

See also: [CONVENTIONS](./CONVENTIONS.md) · [DATA_MODEL](./DATA_MODEL.md) · [SECURITY](./SECURITY.md) · [DEPLOYMENT](./DEPLOYMENT.md) · [METRICS](./METRICS.md) · [INTEGRATIONS](./INTEGRATIONS.md) · [PAYROLL](./PAYROLL.md) · [PRODUCTION_READINESS](./PRODUCTION_READINESS.md)
