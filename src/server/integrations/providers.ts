import { createHmac } from "node:crypto";
import nodemailer from "nodemailer";

/**
 * Integration provider catalogue. A provider is "verified" only when its
 * `verify` makes a real call that succeeds. Providers without an automated
 * check (OAuth-based ones need an interactive consent flow) can be saved but
 * stay "configured" until a successful sync proves them.
 */
export type CredentialField = { key: string; label: string; secret: boolean; placeholder?: string; help?: string };

export type VerifyResult = { ok: boolean; message: string };

export type ProviderDefinition = {
  key: string;
  name: string;
  category: "Email" | "Messaging" | "Calendar" | "E-signature" | "Background verification" | "Accounting" | "Payouts" | "Attendance devices" | "Identity & SSO" | "Learning" | "Job boards" | "Automation";
  description: string;
  credentials: CredentialField[];
  /** Real connectivity check. Undefined = cannot be verified automatically. */
  verify?: (creds: Record<string, string>) => Promise<VerifyResult>;
  setupSteps: string[];
  /** What PeopleSuccess does with it today. */
  capabilities: string[];
};

const withTimeout = (ms = 10_000) => AbortSignal.timeout(ms);

async function httpCheck(url: string, init: RequestInit, okText: string): Promise<VerifyResult> {
  try {
    const res = await fetch(url, { ...init, signal: withTimeout() });
    if (res.ok) return { ok: true, message: okText };
    return { ok: false, message: `Provider responded with HTTP ${res.status}. Check the credentials and permissions.` };
  } catch (err) {
    return { ok: false, message: `Could not reach the provider: ${err instanceof Error ? err.message : "network error"}` };
  }
}

export const PROVIDERS: ProviderDefinition[] = [
  {
    key: "resend",
    name: "Resend",
    category: "Email",
    description: "Transactional email for invitations, notifications and offer letters.",
    credentials: [{ key: "apiKey", label: "API key", secret: true, placeholder: "re_…" }],
    verify: (c) => httpCheck("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${c.apiKey}` } }, "API key accepted by Resend."),
    setupSteps: ["Create an API key in Resend with sending access.", "Verify your sending domain in Resend.", "Set EMAIL_PROVIDER=resend and EMAIL_FROM in the server environment, or save the key here for verification."],
    capabilities: ["Delivery of all platform emails when EMAIL_PROVIDER=resend"],
  },
  {
    key: "smtp",
    name: "SMTP server",
    category: "Email",
    description: "Any SMTP relay (Google Workspace, Microsoft 365, SES, your own server).",
    credentials: [
      { key: "host", label: "Host", secret: false, placeholder: "smtp.example.com" },
      { key: "port", label: "Port", secret: false, placeholder: "587" },
      { key: "user", label: "Username", secret: false },
      { key: "password", label: "Password", secret: true },
    ],
    verify: async (c) => {
      try {
        const t = nodemailer.createTransport({ host: c.host, port: Number(c.port || 587), secure: Number(c.port) === 465, auth: c.user ? { user: c.user, pass: c.password } : undefined, connectionTimeout: 10_000 });
        await t.verify();
        return { ok: true, message: "SMTP server accepted the connection and credentials." };
      } catch (err) {
        return { ok: false, message: `SMTP check failed: ${err instanceof Error ? err.message : "error"}` };
      }
    },
    setupSteps: ["Get SMTP host, port and credentials from your provider.", "Allow the PeopleSuccess server IP if your relay restricts senders."],
    capabilities: ["Delivery of all platform emails when EMAIL_PROVIDER=smtp"],
  },
  {
    key: "webhook",
    name: "Outbound webhook",
    category: "Automation",
    description: "Send signed JSON events to your own systems from workflows.",
    credentials: [
      { key: "url", label: "Endpoint URL", secret: false, placeholder: "https://example.com/hooks/peoplesuccess" },
      { key: "secret", label: "Signing secret", secret: true, help: "Used for the x-peoplesuccess-signature HMAC-SHA256 header." },
    ],
    verify: async (c) => {
      if (!/^https:\/\//.test(c.url) && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(c.url)) return { ok: false, message: "Use an https:// URL." };
      const body = JSON.stringify({ event: "ping", sentAt: new Date().toISOString() });
      const sig = createHmac("sha256", c.secret).update(body).digest("hex");
      return httpCheck(c.url, { method: "POST", headers: { "content-type": "application/json", "x-peoplesuccess-signature": `sha256=${sig}` }, body }, "Endpoint accepted a signed ping event.");
    },
    setupSteps: ["Create an HTTPS endpoint that accepts POST JSON.", "Verify the x-peoplesuccess-signature header: HMAC-SHA256 of the raw body with your secret.", "Use the “Call webhook” step in Workflows."],
    capabilities: ["“Call webhook” workflow action"],
  },
  {
    key: "slack",
    name: "Slack",
    category: "Messaging",
    description: "Post notifications to a Slack channel through an incoming webhook.",
    credentials: [{ key: "webhookUrl", label: "Incoming webhook URL", secret: true, placeholder: "https://hooks.slack.com/services/…" }],
    verify: (c) =>
      /^https:\/\/hooks\.slack\.com\//.test(c.webhookUrl)
        ? httpCheck(c.webhookUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "PeopleSuccess connection test ✅" }) }, "Test message posted to Slack.")
        : Promise.resolve({ ok: false, message: "Use a hooks.slack.com incoming webhook URL." }),
    setupSteps: ["In Slack, create an app with Incoming Webhooks enabled.", "Add a webhook to the channel you want and paste its URL here.", "Testing posts a short message to that channel."],
    capabilities: ["Channel notifications (workflow notify steps can target Slack in a future release)"],
  },
  {
    key: "microsoft_teams",
    name: "Microsoft Teams",
    category: "Messaging",
    description: "Post notifications to a Teams channel through a workflow webhook.",
    credentials: [{ key: "webhookUrl", label: "Workflow webhook URL", secret: true }],
    verify: (c) =>
      /^https:\/\//.test(c.webhookUrl)
        ? httpCheck(c.webhookUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "PeopleSuccess connection test" }) }, "Test message accepted by Teams.")
        : Promise.resolve({ ok: false, message: "Use an https:// webhook URL." }),
    setupSteps: ["In Teams, add a “Post to a channel when a webhook request is received” workflow.", "Copy the generated URL here.", "Testing posts a short message."],
    capabilities: ["Channel notifications"],
  },
  {
    key: "razorpayx",
    name: "RazorpayX Payouts",
    category: "Payouts",
    description: "Verify API access for salary payouts. Payouts are still released by authorized staff.",
    credentials: [
      { key: "keyId", label: "Key ID", secret: false, placeholder: "rzp_live_…" },
      { key: "keySecret", label: "Key secret", secret: true },
    ],
    verify: (c) =>
      httpCheck("https://api.razorpay.com/v1/contacts?count=1", { headers: { Authorization: `Basic ${Buffer.from(`${c.keyId}:${c.keySecret}`).toString("base64")}` } }, "RazorpayX accepted the API keys."),
    setupSteps: ["Generate API keys in RazorpayX (Settings → Developer controls).", "Whitelist the server IP if required.", "Payroll currently generates bank files; API payouts require an explicit go-live review."],
    capabilities: ["Credential verification; bank transfer files from Payroll"],
  },
  {
    key: "google_workspace",
    name: "Google Workspace (Calendar)",
    category: "Calendar",
    description: "Create interview and onboarding calendar events.",
    credentials: [
      { key: "clientId", label: "OAuth client ID", secret: false },
      { key: "clientSecret", label: "OAuth client secret", secret: true },
    ],
    setupSteps: ["Create an OAuth client in Google Cloud with the Calendar API enabled.", "Add the PeopleSuccess redirect URL.", "Complete consent once a calendar sync is enabled; until a sync succeeds this stays “configured”."],
    capabilities: ["Adapter ready; calendar sync is not active until consent is completed"],
  },
  {
    key: "microsoft_365",
    name: "Microsoft 365 (Outlook calendar)",
    category: "Calendar",
    description: "Create interview and onboarding events in Outlook calendars.",
    credentials: [
      { key: "tenantId", label: "Directory (tenant) ID", secret: false },
      { key: "clientId", label: "Application (client) ID", secret: false },
      { key: "clientSecret", label: "Client secret", secret: true },
    ],
    verify: async (c) => {
      try {
        const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(c.tenantId)}/oauth2/v2.0/token`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, grant_type: "client_credentials", scope: "https://graph.microsoft.com/.default" }),
          signal: withTimeout(),
        });
        return res.ok ? { ok: true, message: "Microsoft identity platform issued an app token." } : { ok: false, message: `Token request failed (HTTP ${res.status}).` };
      } catch (err) {
        return { ok: false, message: `Could not reach Microsoft: ${err instanceof Error ? err.message : "error"}` };
      }
    },
    setupSteps: ["Register an app in Microsoft Entra ID with Calendars.ReadWrite application permission.", "Grant admin consent.", "Paste the IDs and a client secret here."],
    capabilities: ["Credential verification; calendar event creation adapter"],
  },
  {
    key: "docusign",
    name: "DocuSign",
    category: "E-signature",
    description: "Send offer letters and contracts for legally binding e-signature.",
    credentials: [
      { key: "integrationKey", label: "Integration key", secret: false },
      { key: "userId", label: "API user ID", secret: false },
      { key: "accountId", label: "Account ID", secret: false },
      { key: "privateKey", label: "RSA private key", secret: true },
    ],
    setupSteps: ["Create an integration key with JWT grant in DocuSign.", "Grant consent for the API user.", "Offers stay “accepted by click-through” until a signing provider confirms an envelope."],
    capabilities: ["Adapter interface; signatures are never claimed without provider confirmation"],
  },
  {
    key: "leegality",
    name: "Leegality",
    category: "E-signature",
    description: "Aadhaar eSign and e-stamping for Indian documents.",
    credentials: [{ key: "authToken", label: "Auth token", secret: true }],
    setupSteps: ["Obtain an API auth token from Leegality.", "Configure workflow templates in Leegality.", "Signing status is recorded only from provider webhooks."],
    capabilities: ["Adapter interface"],
  },
  {
    key: "authbridge",
    name: "AuthBridge",
    category: "Background verification",
    description: "Background verification checks for new hires.",
    credentials: [
      { key: "username", label: "Username", secret: false },
      { key: "apiKey", label: "API key", secret: true },
    ],
    setupSteps: ["Request API access from AuthBridge.", "Agree on check packages per role.", "Results are attached to the employee once the provider returns them."],
    capabilities: ["Adapter interface"],
  },
  {
    key: "tally",
    name: "Tally (journal export)",
    category: "Accounting",
    description: "Export payroll journals for import into Tally.",
    credentials: [],
    setupSteps: ["No credentials needed: export journals from a locked payroll run and import them in Tally."],
    capabilities: ["File-based export"],
  },
  {
    key: "zoho_books",
    name: "Zoho Books",
    category: "Accounting",
    description: "Post payroll and reimbursement journals.",
    credentials: [
      { key: "organizationId", label: "Organization ID", secret: false },
      { key: "refreshToken", label: "OAuth refresh token", secret: true },
      { key: "clientId", label: "Client ID", secret: false },
      { key: "clientSecret", label: "Client secret", secret: true },
    ],
    verify: async (c) => {
      try {
        const res = await fetch("https://accounts.zoho.in/oauth/v2/token", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ refresh_token: c.refreshToken, client_id: c.clientId, client_secret: c.clientSecret, grant_type: "refresh_token" }),
          signal: withTimeout(),
        });
        const json = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string };
        return json.access_token ? { ok: true, message: "Zoho issued an access token." } : { ok: false, message: `Zoho rejected the token request${json.error ? `: ${json.error}` : ""}.` };
      } catch (err) {
        return { ok: false, message: `Could not reach Zoho: ${err instanceof Error ? err.message : "error"}` };
      }
    },
    setupSteps: ["Create a server-based client in the Zoho API console (India data centre).", "Generate a refresh token with ZohoBooks.fullaccess.all scope.", "Paste the values here."],
    capabilities: ["Credential verification; journal posting adapter"],
  },
  {
    key: "attendance_device",
    name: "Biometric / attendance devices",
    category: "Attendance devices",
    description: "Receive punches from devices or middleware through a signed webhook.",
    credentials: [{ key: "signingSecret", label: "Signing secret", secret: true, help: "Devices sign the raw body with HMAC-SHA256." }],
    setupSteps: [
      "Save a signing secret here.",
      "Point your device middleware to POST /api/webhooks/attendance_device/<connection id> with JSON { events: [{ employeeCode, occurredAt, kind: \"in\"|\"out\", deviceId, externalId }] }.",
      "Sign the raw body with HMAC-SHA256 and send it as x-peoplesuccess-signature: sha256=<hex>.",
    ],
    capabilities: ["Device-verified attendance events (idempotent by externalId)"],
  },
  {
    key: "saml_sso",
    name: "SAML single sign-on",
    category: "Identity & SSO",
    description: "Sign in with Okta, Microsoft Entra ID or Google using SAML 2.0.",
    credentials: [{ key: "metadataUrl", label: "IdP metadata URL", secret: false }],
    verify: (c) => httpCheck(c.metadataUrl, { method: "GET" }, "Identity provider metadata is reachable."),
    setupSteps: ["Enable SAML SSO on the Supabase project (Pro plan feature).", "Register PeopleSuccess as a service provider in your IdP.", "Add the IdP metadata URL in Supabase Auth → SSO and map the email domain."],
    capabilities: ["Metadata reachability check; SSO is enforced by Supabase Auth"],
  },
  {
    key: "linkedin_jobs",
    name: "Job boards (XML feed)",
    category: "Job boards",
    description: "Share published openings with job boards through your public careers page.",
    credentials: [],
    setupSteps: ["Publish openings in Recruitment.", "Share your public careers URL (/careers/<your-company>) with job boards that crawl career pages."],
    capabilities: ["Public careers page"],
  },
];

export const providerDefinition = (key: string) => PROVIDERS.find((p) => p.key === key);
