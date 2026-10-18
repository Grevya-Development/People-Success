# PeopleSuccess by Grevya

A multi-tenant HR platform for Indian organizations. It covers recruitment through exit, attendance, leave, payroll, expenses, performance, learning, engagement, an HR helpdesk, workflows, analytics and governed AI assistants.

- **Stack:** Next.js 16 (App Router, Cache Components) · React 19 · TypeScript · Tailwind v4 + shadcn/ui · Supabase (Postgres 17, Auth, Storage) · Drizzle ORM · Vitest · Playwright
- **Security model:** every table has row-level security keyed to the organization. Permissions are scoped (`self` / `team` / `all`), sensitive identity and bank fields are encrypted, and every sensitive action is audited. See [docs/SECURITY.md](docs/SECURITY.md).

## Requirements

- Node.js 24 and npm (matches the Dockerfile and CI)
- Docker (for the local Supabase stack)
- macOS, Linux or WSL2

## Quick start (local)

```bash
npm ci
npx supabase start                 # Postgres, Auth, Storage, Mailpit (first run pulls images)
npx supabase status -o env         # copy the URL, publishable and secret keys
cp .env.example .env.local         # fill in the Supabase values
openssl rand -base64 32            # paste as APP_ENCRYPTION_KEY in .env.local
npx supabase migration up          # apply supabase/migrations
npm run dev                        # http://localhost:3100
npm run worker                     # background jobs (in a second terminal)
```

Local email (sign-up confirmations, invitations, notifications) lands in Mailpit at http://127.0.0.1:54324. Set `EMAIL_PROVIDER=smtp`, `SMTP_HOST=127.0.0.1` and `SMTP_PORT=54325` in `.env.local`.

**First use:** sign up, confirm the email from Mailpit, create your organization, then follow the setup checklist at `/setup`.

### Demo data

```bash
npm run seed:demo
```

This creates a separate organization flagged as **demo**, filled with synthetic people and activity. All names, identifiers and amounts are fictitious. The script prints the demo sign-in accounts.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js on port 3100 |
| `npm run worker` | Job runner: schedules, domain events, workflows, emails, report delivery |
| `npm run typecheck` | Route type generation + `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Unit tests (no services needed) |
| `npm run test:integration` | Integration tests against the local Supabase database |
| `npm run test:e2e` | Playwright browser tests (starts the dev server) |
| `npm run db:generate` | Generate a migration from schema changes (`src/server/db/schema`) |
| `npm run db:migration -- --name <x>` | Create an empty custom SQL migration (RLS, triggers) |
| `npx supabase migration up` | Apply pending migrations locally |
| `npm run check` | typecheck + lint + unit tests |

## Configuration

All variables are documented in [.env.example](.env.example). Secrets are read only on the server; only `NEXT_PUBLIC_*` values reach the browser.

| Area | Variables |
|---|---|
| Supabase | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `DATABASE_URL` |
| Encryption | `APP_ENCRYPTION_KEY` (32 bytes, base64). Back it up; losing it makes encrypted fields unreadable. |
| Email | `EMAIL_PROVIDER` (`smtp` / `resend` / `log`), `EMAIL_FROM`, SMTP or Resend settings |
| AI | `AI_PROVIDER` (`anthropic` / `openai` / `none`), API key, optional `AI_MODEL`. With `none`, AI features use rule-based fallbacks and say so. |
| Scheduler | `CRON_SECRET` for `/api/cron/tick` when you don't run the worker |

## Project layout

```
src/app/            routes: (auth), (app) modules, setup, careers, api (REST v1, webhooks, cron, exports)
src/components/     design system: shell, data table, forms, charts, page primitives
src/lib/            shared client-safe code: permissions, validation (zod), formatting, India helpers
src/server/         server-only code
  auth/             session, access loading, permission checks
  db/               Drizzle schema, client, withTenant / withSystem
  services/         domain logic per module (the only place business rules live)
  jobs/             Postgres job queue, schedules, handlers
  ai/               provider adapters, agent definitions, governed runner
  integrations/     provider catalogue and verification
  pdf/              payslips, letters, reports
supabase/           config, migrations, email templates
scripts/            worker, demo seed
tests/              unit, integration, e2e
docs/               architecture, data model, security, payroll, integrations, metrics, deployment
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md): request flow, tenancy, caching, jobs, AI governance
- [Data model](docs/DATA_MODEL.md): tables by domain and database-enforced invariants
- [Security](docs/SECURITY.md): threat model, RLS, encryption, audit, backup and recovery
- [Payroll](docs/PAYROLL.md): calculation order, statutory assumptions, verification checklist
- [Integrations](docs/INTEGRATIONS.md): providers, honest statuses, webhooks, REST API
- [Metrics](docs/METRICS.md): every dashboard number and its definition
- [Deployment](docs/DEPLOYMENT.md): Supabase project, Docker/Vercel, worker, CI/CD
- [Conventions](docs/CONVENTIONS.md): how to add a module, action, job, AI agent or report
- [Production readiness](docs/PRODUCTION_READINESS.md): what is verified, what is not, and go-live steps

## Important limitations

- **Statutory payroll rules (PF, ESI, Professional Tax, LWF, TDS) ship as editable, unverified rule sets.** Have a qualified payroll professional review them before running live payroll. See [docs/PAYROLL.md](docs/PAYROLL.md).
- Integrations show **Verified** only after a real call to the provider succeeds. Adapters without credentials stay *not connected*.
- E-signature is not claimed. Offers are accepted by click-through unless a signature provider confirms.
