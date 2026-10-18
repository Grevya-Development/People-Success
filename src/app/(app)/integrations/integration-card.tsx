"use client";

import { RelativeTime } from "@/components/relative-time";
import { useState, useTransition } from "react";
import { CheckCircle2, CircleDashed, PlugZap, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Spinner } from "@/components/ui/spinner";
import { StatusBadge } from "@/components/status-badge";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { IntegrationView } from "@/server/services/integrations";
import {
  integrationEventsAction,
  removeIntegrationAction,
  saveIntegrationAction,
  setIntegrationEnabledAction,
  verifyIntegrationAction,
} from "./actions";

const STATUS: Record<string, { label: string; tone: "neutral" | "success" | "warning" | "danger" | "info" }> = {
  not_configured: { label: "Not connected", tone: "neutral" },
  configured: { label: "Configured · not verified", tone: "warning" },
  verified: { label: "Verified", tone: "success" },
  error: { label: "Error", tone: "danger" },
  disabled: { label: "Disabled", tone: "neutral" },
};

type Event = { id: string; direction: string; eventType: string; status: string; error: string | null; createdAt: string };

export function IntegrationCard({ item }: { item: IntegrationView }) {
  const status = item.connection?.status ?? "not_configured";
  const s = STATUS[status] ?? STATUS.not_configured;
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(item.fields.map((f) => [f.key, f.value ?? ""])));
  const [events, setEvents] = useState<Event[] | null>(null);
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; error?: { message: string } }>, onOk?: () => void) =>
    start(async () => {
      const res = await fn();
      if (res.ok) onOk?.();
      else toast.error(res.error?.message ?? "Failed");
    });

  const loadEvents = () =>
    start(async () => {
      const res = await integrationEventsAction({ provider: item.key });
      if (res.ok) setEvents(res.data);
    });

  return (
    <article className="flex flex-col rounded-xl border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{item.category}</p>
          <h3 className="mt-0.5 text-sm font-semibold">{item.name}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>
        </div>
        {status === "verified" ? (
          <CheckCircle2 className="size-5 shrink-0 text-success" aria-hidden />
        ) : status === "error" ? (
          <TriangleAlert className="size-5 shrink-0 text-danger" aria-hidden />
        ) : (
          <CircleDashed className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        )}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <StatusBadge status={status} label={s.label} tone={s.tone} />
        {item.connection?.lastVerifiedAt ? (
          <span className="text-xs text-muted-foreground">checked <RelativeTime value={item.connection.lastVerifiedAt} /></span>
        ) : null}
      </div>
      {item.connection?.lastError ? <p className="mt-2 line-clamp-2 text-xs text-danger">{item.connection.lastError}</p> : null}
      <div className="mt-auto pt-4">
        <Sheet
          open={open}
          onOpenChange={(o) => {
            setOpen(o);
            if (o) loadEvents();
          }}
        >
          <SheetTrigger asChild>
            <Button size="sm" variant={status === "not_configured" ? "default" : "outline"}>
              <PlugZap /> {status === "not_configured" ? "Connect" : "Manage"}
            </Button>
          </SheetTrigger>
          <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
            <SheetHeader>
              <SheetTitle>{item.name}</SheetTitle>
              <SheetDescription>{item.description}</SheetDescription>
            </SheetHeader>
            <div className="space-y-6 px-4 pb-8">
              <section>
                <h4 className="text-xs font-medium text-muted-foreground uppercase">Setup</h4>
                <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
                  {item.setupSteps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
                <p className="mt-2 text-xs text-muted-foreground">Supports: {item.capabilities.join("; ")}</p>
              </section>

              {item.fields.length ? (
                <form
                  className="space-y-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    run(() => saveIntegrationAction({ provider: item.key, values }), () => toast.success("Saved. Run a test to verify."));
                  }}
                >
                  {item.fields.map((f) => (
                    <div key={f.key} className="space-y-1.5">
                      <Label htmlFor={`${item.key}-${f.key}`}>{f.label}</Label>
                      <Input
                        id={`${item.key}-${f.key}`}
                        type={f.secret ? "password" : "text"}
                        autoComplete="off"
                        placeholder={f.secret && f.saved ? "Saved. Leave blank to keep" : f.placeholder}
                        value={values[f.key] ?? ""}
                        onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                      />
                      {f.help ? <p className="text-xs text-muted-foreground">{f.help}</p> : null}
                    </div>
                  ))}
                  <div className="flex flex-wrap gap-2">
                    <Button type="submit" size="sm" disabled={pending}>
                      {pending ? <Spinner /> : null} Save credentials
                    </Button>
                    {item.canVerify && item.connection ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={pending || status === "disabled"}
                        onClick={() =>
                          run(
                            async () => {
                              const res = await verifyIntegrationAction({ provider: item.key });
                              if (res.ok) {
                                if (res.data.ok) toast.success(res.data.message);
                                else toast.error(res.data.message);
                                loadEvents();
                              }
                              return res;
                            },
                          )
                        }
                      >
                        Test connection
                      </Button>
                    ) : null}
                  </div>
                  {!item.canVerify ? (
                    <p className="text-xs text-muted-foreground">This provider needs an interactive consent flow, so it stays “configured” until its first successful sync.</p>
                  ) : null}
                </form>
              ) : (
                <p className="text-sm text-muted-foreground">No credentials are needed for this integration.</p>
              )}

              {item.connection ? (
                <section className="flex items-center justify-between rounded-lg border px-3 py-2.5">
                  <div>
                    <p className="text-sm font-medium">Enabled</p>
                    <p className="text-xs text-muted-foreground">Disabling stops all calls without deleting credentials.</p>
                  </div>
                  <Switch
                    checked={status !== "disabled"}
                    disabled={pending}
                    onCheckedChange={(v) => run(() => setIntegrationEnabledAction({ provider: item.key, enabled: v }), () => toast.success(v ? "Enabled" : "Disabled"))}
                    aria-label="Enable integration"
                  />
                </section>
              ) : null}

              {events ? (
                <section>
                  <h4 className="text-xs font-medium text-muted-foreground uppercase">Recent activity</h4>
                  {events.length ? (
                    <ul className="mt-2 divide-y rounded-lg border text-sm">
                      {events.map((e) => (
                        <li key={e.id} className="flex items-center gap-2 px-3 py-2">
                          <StatusBadge status={e.status === "succeeded" || e.status === "delivered" ? "done" : e.status === "failed" ? "failed" : "pending"} label={e.status} />
                          <span className="truncate">{e.eventType}</span>
                          <span className="ml-auto shrink-0 text-xs text-muted-foreground"><RelativeTime value={e.createdAt} /></span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-sm text-muted-foreground">No activity yet.</p>
                  )}
                </section>
              ) : null}

              {item.connection && item.fields.length ? (
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={pending}
                  onClick={() => run(() => removeIntegrationAction({ provider: item.key }), () => toast.success("Credentials removed"))}
                >
                  Remove credentials
                </Button>
              ) : null}
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </article>
  );
}
