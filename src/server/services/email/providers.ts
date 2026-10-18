import { createTransport, type Transporter } from "nodemailer";
import { env } from "../../env";
import { logger } from "../../lib/logger";

export type OutgoingEmail = {
  id: string;
  to: string;
  from: string;
  subject: string;
  html: string;
  text: string | null;
};

export interface EmailProvider {
  name: string;
  send(msg: OutgoingEmail): Promise<{ providerMessageId: string | null }>;
}

/** SMTP via nodemailer. Locally this delivers to the Mailpit inbox. */
export function smtpProvider(): EmailProvider {
  const e = env();
  const g = globalThis as unknown as { __psSmtp?: Transporter };
  const transport =
    g.__psSmtp ??
    createTransport({
      host: e.SMTP_HOST ?? "127.0.0.1",
      port: e.SMTP_PORT ?? 54325,
      secure: e.SMTP_PORT === 465,
      auth: e.SMTP_USER ? { user: e.SMTP_USER, pass: e.SMTP_PASSWORD ?? "" } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  g.__psSmtp = transport;
  return {
    name: "smtp",
    async send(msg) {
      const info = await transport.sendMail({
        from: msg.from,
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
        text: msg.text ?? undefined,
        headers: { "X-PeopleSuccess-Outbox-Id": msg.id },
      });
      return { providerMessageId: info.messageId ?? null };
    },
  };
}

/** Resend HTTP API. Uses the outbox id as idempotency key so retries never double-send. */
export function resendProvider(): EmailProvider {
  return {
    name: "resend",
    async send(msg) {
      const key = env().RESEND_API_KEY;
      if (!key) throw new Error("RESEND_API_KEY is not configured");
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "Idempotency-Key": msg.id,
        },
        body: JSON.stringify({
          from: msg.from,
          to: [msg.to],
          subject: msg.subject,
          html: msg.html,
          text: msg.text ?? undefined,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        const detail = (await res.text().catch(() => "")).slice(0, 300);
        throw new Error(`Resend responded ${res.status}: ${detail}`);
      }
      const data = (await res.json().catch(() => ({}))) as { id?: string };
      return { providerMessageId: data.id ?? null };
    },
  };
}

/** Development fallback: records that an email would be sent. Never logs bodies or recipients' content. */
export function logProvider(): EmailProvider {
  return {
    name: "log",
    async send(msg) {
      logger.info("email.log_provider", { outboxId: msg.id, subject: msg.subject, toDomain: msg.to.split("@")[1] ?? null });
      return { providerMessageId: null };
    },
  };
}

export function defaultProvider(): EmailProvider {
  switch (env().EMAIL_PROVIDER) {
    case "smtp":
      return smtpProvider();
    case "resend":
      return resendProvider();
    default:
      return logProvider();
  }
}
