# Engineering conventions

How code is organized in PeopleSuccess. Follow these so every module behaves the same way.

## Stack facts that differ from older Next.js

- **Next.js 16.4 with `cacheComponents` + `partialPrefetching`.** Any component that reads the session, cookies, headers, `searchParams` or does request-time DB work must render inside a `<Suspense>` boundary. Pages are a static frame (`<Page>`, `<PageHeader>`) plus `<Suspense fallback={<Skeleton/>}>` around async data components. Read bundled docs in `node_modules/next/dist/docs/` when unsure.
- `middleware.ts` is now `src/proxy.ts`.
- `params` and `searchParams` are Promises: `async function Data({ searchParams }: { searchParams: Promise<...> })`, and await them **inside** the Suspense-wrapped component, never in the page body.
- Typed route props: `PageProps<"/employees/[id]">`, `LayoutProps<"/">` (run `npx next typegen` before `tsc`).
- shadcn/ui is the `radix-nova` style; `cn` is imported from the `"cn"` package. Forms use `Field*` components (no `Form` component), see `src/components/forms/fields.tsx`.

## Layers

```
src/lib/                    shared, client-safe (permissions catalogue, validation schemas, formatting, navigation)
src/lib/validation/<mod>.ts Zod schemas used by BOTH client forms and server actions
src/server/db/schema/*.ts   Drizzle schema (snake_case casing). Changing it requires a migration (owner: lead).
src/server/services/<mod>/  domain services: business rules, authorization, transactions, audit
src/app/(app)/<mod>/        routes; `actions.ts` with "use server" wraps services via defineAction
src/components/             UI. Module-specific components may live next to the route.
```

### Request context and data access

- `requireContext()` (pages) / actions get `ctx` from `defineAction`. `ctx` has `tenantId`, `userId`, `employeeId`, `grants`.
- **All tenant data access goes through `ctx.db(async (tx) => ...)`.** It opens a transaction as the `authenticated` Postgres role with the tenant set; RLS enforces isolation. Never use the root `db` for tenant data inside request handling. `withSystem` is only for background jobs / signup and must filter by tenant explicitly.
- Authorization: coarse with `authorize(ctx, "perm", scope)` / `can(ctx, ...)`; record-level with `authorizeEmployee(ctx, perm, employeeId)` (self/team/all). Do both in services, not in components.
- Validate referenced ids by selecting them inside `ctx.db` (RLS hides other tenants' rows, so a missing row means invalid reference).
- Money: integer minor units (paise) + explicit currency. Never floats for money.
- Dates: `date` columns as `yyyy-MM-dd` strings. Effective-dated tables use `[effective_from, effective_to)`.

### Server Actions

```ts
"use server";
export const createThingAction = defineAction(
  { input: createThingSchema, permission: "things.manage", scope: "all" },
  async (ctx, input) => {
    const thing = await createThing(ctx, input);   // service does the work
    return { id: thing.id };                        // return small serializable data
  },
);
```

Return values become `ActionResult<T>` (`{ ok, data } | { ok: false, error }`). Use `revalidatePath`/`refresh()` after mutations where needed.

### Errors

Throw `AppError` (`src/server/lib/errors.ts`) with a user-facing message: `forbidden()`, `notFound("Employee")`, `invalidState("...")`, `validation("...", fieldErrors)`. Unknown errors are logged and shown as a generic message. Postgres constraint errors are translated automatically.

### Audit

Every mutation of business data writes `audit(tx, ctx, { action: "module.verb", entityType, entityId, changes: diff(before, after) })` inside the same transaction. `diff` redacts sensitive keys. Never log secrets, identity numbers, bank numbers or salaries to app logs.

### Approvals

Use the engine in `src/server/services/approvals/engine.ts`: `startApproval(tx, actor, {...})` and register a handler with `registerApprovalHandler(subjectType, { label, href, onApproved, onRejected })` in `src/server/services/<mod>/approval-handlers.ts`, then import it from `src/server/services/approvals/handlers.ts`. Default policies are seeded in `services/tenancy/provision.ts`.

### Notifications

`notify(tx, { tenantId, userIds, category, title, body, href, dedupeKey })`. Bodies must not contain confidential values.

### Domain events, background jobs and schedules

- Emit domain events inside the mutating transaction: `emitDomainEvent(tx, tenantId, "leave.requested", {...})` (`src/server/services/events.ts`, transactional outbox). Add new event names to `DomainEventType`.
- React to events: `onDomainEvent("employee.joined", async (tenantId, event) => {...})` from `src/server/jobs/registry.ts`. Subscribers must be idempotent (use unique keys / `onConflictDoNothing`).
- Background work: `registerJobHandler("leave.accrue", handler)`, enqueue with `enqueueJob(txOrDb, "type", { tenantId, payload, dedupeKey })`.
- Recurring work: `registerSchedule({ name, every: { dailyAtIst: "01:00" } | { minutes: 15 }, perTenant: true, jobType })`.
- Put registrations in `src/server/services/<mod>/jobs.ts` and add one `import "../services/<mod>/jobs";` line to `src/server/jobs/handlers.ts` (append only).
- Jobs run in system context (`withSystem(fn, tenantId)` – RLS bypassed): always filter by `tenantId` explicitly.
- Run locally with `npm run worker`; in serverless, `/api/cron/tick` with `CRON_SECRET`.

### AI

- Never call providers directly. Use `runAi(actor, { agentKey, task, system, messages, schema, fallback })` from `src/server/ai/run.ts`: it enforces agent enablement and monthly budget, records `ai_executions` (tokens, cost, prompt version), validates the Zod schema, and returns `{ source: "ai" | "rules", data }`. Always provide a deterministic `fallback`, and label rule-based results in the UI.
- Agents are defined in `src/server/ai/agents.ts` (guardrails included). AI never performs final hiring, compensation, payroll or employment decisions, and never uses protected characteristics.
- Default Claude model `claude-opus-5-5` (configurable via `AI_MODEL`); provider via `AI_PROVIDER=anthropic|openai|none`.

### Generated PDFs

- Build with `PdfBuilder` (`src/server/pdf/builder.ts`: `letterhead`, `grid`, `table`, `text`, `toBytes`), amounts via `formatInr(paise)`.
- Store with `storeGeneratedPdf(tx, {...})` (`src/server/pdf/store.ts`) → private `generated` bucket + `documents` row (download via `/api/documents/[id]/download`).

### Tasks

- Create tasks in the `tasks` table with `containerType`/`containerId` (e.g. "lifecycle_plan"). React to completion with `registerTaskHook(containerType, hook)` from `src/server/services/inbox.ts`.

## UI

- Page frame: `Page`, `PageHeader`, `Section`, `EmptyState`, `NoAccess`, `ErrorState`, `TableSkeleton`, `Reveal` from `src/components/page.tsx`.
- Forms: `useActionForm({ schema, defaultValues, action, onSuccess, successMessage })` + `TextField`/`SelectField`/`TextareaField`/`SwitchField`/`CheckboxField`.
- Dense tables use `src/components/ui/table.tsx`; numbers get `tabular` class. Status chips: `StatusBadge` in `src/components/status-badge.tsx`.
- Tokens: `bg-card`, `text-muted-foreground`, `border`, accent `text-brand`/`bg-brand-soft`, semantic `success|warning|danger|info` + `-soft`. No new colors, no gradients, no decorative illustrations.
- Every list has loading (skeleton), empty, error and permission-denied states. No inert buttons: if an action is not implemented, do not render it.
- Navigation entries live in `src/lib/navigation.ts` (`ready` flag) and the global "New" menu in `src/lib/quick-create.ts`.

## Tests

- Unit: `tests/unit/**/*.test.ts` (pure logic, e.g. payroll math). `npm test`.
- Integration: `tests/integration/**/*.test.ts` against local Supabase; create isolated tenants with `tests/helpers/fixtures.ts` (`createOwnedTenant`, `addMember`, `contextFor`). `npm run test:integration`. Do not run `supabase db reset` while others are working.
- E2E: Playwright in `tests/e2e`.

## Commands

`npm run dev` (port 3100) · `npm run typecheck` · `npm run lint` · `npm run test:integration` · `npm run db:generate` (lead only).
