import Link from "next/link";
import { ArrowRight, Download } from "lucide-react";
import { cn } from "cn";
import { Reveal } from "@/components/page";
import { Button } from "@/components/ui/button";
import { requireContext } from "@/server/auth/context";
import { employeePanel, hrOperationsPanel, managerPanel, type PanelItem } from "@/server/services/analytics/dashboards";

function PanelGrid({ title, items }: { title: string; items: PanelItem[] }) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      <ul className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-3 xl:grid-cols-5">
        {items.map((i) => (
          <li key={i.key} className="bg-card">
            <Link href={i.href} className="group flex h-full flex-col justify-between gap-2 p-4 transition-colors hover:bg-muted/40">
              <span className="text-xs text-muted-foreground">{i.label}</span>
              <span className="flex items-end justify-between">
                {i.value !== null ? (
                  <span
                    className={cn(
                      "text-xl font-semibold tracking-tight",
                      i.tone === "danger" && i.value ? "text-danger" : i.tone === "warning" && i.value ? "text-warning" : "",
                    )}
                  >
                    {i.value}
                  </span>
                ) : (
                  <span className="text-sm font-medium">{i.hint ? i.hint.charAt(0).toUpperCase() + i.hint.slice(1) : null}</span>
                )}
                <ArrowRight className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export async function Panels() {
  const ctx = await requireContext();
  const [hr, manager, me] = await Promise.all([hrOperationsPanel(ctx), managerPanel(ctx), employeePanel(ctx)]);
  if (!hr && !manager && !me) return null;
  return (
    <Reveal className="space-y-8">
      {hr ? <PanelGrid title="HR operations" items={hr} /> : null}
      {manager ? <PanelGrid title="My team" items={manager} /> : null}
      {me ? (
        <section>
          <h2 className="mb-3 text-sm font-semibold">My workspace</h2>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-xl border bg-card p-5">
              <p className="text-xs text-muted-foreground">Profile completion</p>
              <p className="mt-1 text-xl font-semibold">{Math.round(me.profileCompletion * 100)}%</p>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(me.profileCompletion * 100)} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-full rounded-full bg-brand" style={{ width: `${me.profileCompletion * 100}%` }} />
              </div>
              {me.missing.length ? (
                <p className="mt-3 text-xs text-muted-foreground">
                  Missing: {me.missing.join(", ")}.{" "}
                  <Link href={`/employees/${ctx.employeeId}?tab=personal`} className="font-medium text-foreground underline-offset-4 hover:underline">
                    Complete profile
                  </Link>
                </p>
              ) : null}
            </div>
            <div className="rounded-xl border bg-card p-5">
              <p className="text-xs text-muted-foreground">Leave balances</p>
              {me.leave.length ? (
                <ul className="mt-2 space-y-1.5 text-sm">
                  {me.leave.map((l) => (
                    <li key={l.name} className="flex justify-between">
                      <span>{l.name}</span>
                      <span className="font-medium tabular">{l.balance} d</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">No leave balances yet.</p>
              )}
              <Link href="/leave" className="mt-3 inline-block text-xs font-medium underline-offset-4 hover:underline">
                Apply for leave
              </Link>
            </div>
            <div className="rounded-xl border bg-card p-5">
              <p className="text-xs text-muted-foreground">Pay and growth</p>
              {me.latestPayslip ? (
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="text-sm">Payslip · {me.latestPayslip.period}</span>
                  {me.latestPayslip.documentId ? (
                    <Button size="xs" variant="outline" asChild>
                      <a href={`/api/documents/${me.latestPayslip.documentId}/download`}>
                        <Download /> PDF
                      </a>
                    </Button>
                  ) : null}
                </div>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">No payslips published yet.</p>
              )}
              <ul className="mt-3 space-y-1 text-sm">
                <li className="flex justify-between">
                  <span>Learning to complete</span>
                  <Link href="/learning" className="font-medium hover:underline">
                    {me.learningDue}
                  </Link>
                </li>
                <li className="flex justify-between">
                  <span>Active goals</span>
                  <Link href="/performance" className="font-medium hover:underline">
                    {me.goalsActive}
                  </Link>
                </li>
                {me.attendanceThisMonth ? (
                  <li className="flex justify-between">
                    <span>Present days this month</span>
                    <span className="font-medium">{me.attendanceThisMonth.present}</span>
                  </li>
                ) : null}
              </ul>
            </div>
          </div>
        </section>
      ) : null}
    </Reveal>
  );
}
