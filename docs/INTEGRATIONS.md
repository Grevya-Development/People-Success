# Integrations

Integrations are configured per organization in **Integrations** (`/integrations`, permission `integrations.manage`). Credentials are encrypted (AES-256-GCM) and never sent to the browser. Statuses are honest:

- **Not connected**: no credentials.
- **Configured · not verified**: credentials saved; no successful real call yet.
- **Verified**: the provider's test call succeeded (time recorded).
- **Error**: the last test failed (message shown).
- **Disabled**: kept but not used.

Every test and outbound call is recorded in `integration_events` (visible under "Recent activity").

| Provider | Category | Verification | What it does today | Activation steps |
|---|---|---|---|---|
| Resend | Email | `GET /domains` with the API key | Delivers all platform email when `EMAIL_PROVIDER=resend` | Create API key, verify domain, set `EMAIL_PROVIDER`, `RESEND_API_KEY`, `EMAIL_FROM` |
| SMTP | Email | SMTP handshake + auth (`verify()`) | Delivers all email when `EMAIL_PROVIDER=smtp` | Host, port, user, password; allow the server IP |
| Outbound webhook | Automation | Signed `ping` POST must return 2xx | Workflow step "Call webhook" | HTTPS endpoint; verify `x-peoplesuccess-signature: sha256=<HMAC>` |
| Slack | Messaging | Posts a test message to the channel | Channel notifications | Incoming webhook URL |
| Microsoft Teams | Messaging | Posts a test message | Channel notifications | Teams workflow webhook URL |
| RazorpayX | Payouts | `GET /v1/contacts` with key id/secret | Credential check; payroll still produces bank files | API keys; go-live review before API payouts |
| Microsoft 365 | Calendar | Client-credentials token from Entra ID | Credential check; calendar adapter | App registration with Calendars.ReadWrite + admin consent |
| Google Workspace | Calendar | Needs interactive consent; stays *configured* until a sync succeeds | Adapter | OAuth client; consent flow |
| DocuSign / Leegality | E-signature | Adapter only | Offers are recorded as "accepted by click-through"; **no signature is claimed** without a provider confirmation | Provider account + webhook |
| AuthBridge | Background verification | Adapter only | – | API access + check packages |
| Zoho Books | Accounting | OAuth refresh-token exchange | Credential check; journal adapter | Server-based client (India DC), refresh token |
| Tally | Accounting | none needed | File export | – |
| Attendance devices | Devices | Signed webhook | Device-verified punches, idempotent by `externalId` | Save signing secret; POST to `/api/webhooks/attendance_device/<connection id>` |
| SAML SSO | Identity | IdP metadata reachable | SSO enforced by Supabase Auth | Enable SAML in Supabase (Pro), register the SP, map email domain |
| Job boards | Recruitment | none | Public careers page `/careers/<org>` | Share the URL |

## Webhook signature

```
x-peoplesuccess-signature: sha256=<hex(HMAC_SHA256(secret, raw_request_body))>
idempotency-key: wf:<run id>:<step key>
```

Verify the signature over the raw body with a constant-time comparison, and de-duplicate on the idempotency key.

## REST API

See `/developers` in the app and `GET /api/v1/openapi.json`. Authenticate with a Supabase access token for a dedicated integration user; select the organization with `X-Tenant-Id`; use `Idempotency-Key` on creates.
