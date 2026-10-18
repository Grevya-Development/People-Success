# Deployment

PeopleSuccess needs: a Supabase project (Postgres 17, Auth, Storage), the Next.js web app, and one background worker (or a scheduler calling `/api/cron/tick`).

## 1. Supabase project

1. Create a project in an Indian region (e.g. Mumbai, `ap-south-1`) for data residency.
2. Link and push the schema:
   ```bash
   npx supabase login
   npx supabase link --project-ref <ref>
   npx supabase db push          # applies supabase/migrations in order
   ```
3. Storage buckets `documents` and `generated` (private) are declared in `supabase/config.toml`; create them in the dashboard if `db push` did not (Storage → New bucket, *Public: off*).
4. Auth settings (dashboard → Authentication):
   - Site URL = your app URL; add `https://<app>/**` to redirect URLs.
   - Email templates: copy `supabase/templates/*.html` (they use `{{ .TokenHash }}` links to `/auth/confirm`).
   - Configure a production SMTP sender (Auth → SMTP) so auth emails are not rate-limited.
   - Enable TOTP MFA; optionally SAML SSO (Pro plan).
5. Enable Point-in-Time Recovery for production.

## 2. Environment

Set the variables in `.env.example` as secrets. Notes:

- `DATABASE_URL`: use the **transaction pooler** (`:6543`) for serverless platforms; the app disables prepared statements automatically. Long-lived servers can use the direct connection.
- `APP_ENCRYPTION_KEY`: generate once (`openssl rand -base64 32`) and store in a secrets manager. Losing it makes encrypted identity/bank fields unreadable.
- `EMAIL_PROVIDER=resend` (or `smtp`) and a verified sender domain.
- `AI_PROVIDER=anthropic` + `ANTHROPIC_API_KEY` to enable AI features (default model `claude-opus-5-5`); leave `none` to run rule-based only.
- `CRON_SECRET` if you use `/api/cron/tick`.

## 3. Web app

### Option A: Docker (any host)
```bash
docker build --target web -t peoplesuccess-web \
  --build-arg NEXT_PUBLIC_APP_URL=https://hr.example.com \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co \
  --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_... .
docker build --target worker -t peoplesuccess-worker .
docker compose up -d     # web on :3100 + worker, using .env
```
Health check: `GET /api/health` (database readiness).

### Option B: Vercel
- Import the repository; set the environment variables.
- Background work: add a Vercel Cron that calls `GET /api/cron/tick` every minute with `Authorization: Bearer $CRON_SECRET`, **or** run the worker container elsewhere (recommended for heavy payroll runs).

## 4. Worker

The worker runs schedules (accruals, attendance processing, escalations, reminders, report delivery, email retries) and processes domain events and workflow steps. Run exactly one or more instances; job claiming uses `SKIP LOCKED` and schedules are deduplicated, so multiple workers are safe.

```bash
npm run worker            # local
docker run --env-file .env peoplesuccess-worker
```

## 5. Post-deploy checklist

- `GET /api/health` returns `{ status: "ok" }`.
- Sign up the first owner, confirm the email, create the organization, complete `/setup`.
- Verify integrations from `/integrations` (each shows *Verified* only after a real test).
- Review and **verify statutory rule sets** in Payroll with a qualified payroll professional before running live payroll (see `docs/PAYROLL.md`).
- Configure backups for Storage buckets (see `docs/SECURITY.md`).

## CI/CD

`.github/workflows/ci.yml` runs lint, type check, unit tests, integration tests against a disposable local Supabase, the production build and Playwright E2E. Deploy only from green `main`; apply migrations (`supabase db push`) before rolling out the new web/worker versions. Migrations are additive by convention; destructive changes need a two-step (expand → migrate → contract) rollout.
