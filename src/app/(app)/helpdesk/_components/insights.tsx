import { unstable_rethrow } from "next/navigation";
import { BarChart3 } from "lucide-react";
import { EmptyState, ErrorState, NoAccess, Reveal, Section } from "@/components/page";
import type { RequestContext } from "@/server/auth/context";
import { logger } from "@/server/lib/logger";
import { helpdeskInsights, type HelpdeskInsights } from "@/server/services/helpdesk/insights";
import { canManageHelpdesk, isHelpdeskAgent } from "@/server/services/helpdesk/rules";
import { formatNumber, formatPercent } from "@/lib/format";
import { BarRow, Stat, StatStrip } from "../../expenses/_components/shared";

const hours = (h: number | null) => (h == null ? "—" : h < 24 ? `${formatNumber(h, 1)} h` : `${formatNumber(h / 24, 1)} d`);

export async function Insights({ ctx }: { ctx: RequestContext }) {
  if (!isHelpdeskAgent(ctx)) return <NoAccess />;
  let s: HelpdeskInsights;
  try {
    s = await helpdeskInsights(ctx, 90);
  } catch (err) {
    unstable_rethrow(err);
    logger.error("helpdesk.insights_failed", { err });
    return <ErrorState title="Could not load insights" />;
  }
  if (!s.total) return <EmptyState icon={BarChart3} title="No tickets in the last 90 days" description="Volume, response times and SLA performance appear here once tickets come in." />;
  const max = Math.max(...s.byCategory.map((c) => c.total));
  return (
    <Reveal className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Tickets created in the last {s.days} days{canManageHelpdesk(ctx) ? "" : " (excluding confidential queues)"}. SLA times are calendar hours.
      </p>
      <StatStrip>
        <Stat label="Tickets" value={formatNumber(s.total)} hint={`${s.open} still open`} />
        <Stat label="Median first response" value={hours(s.medianFirstResponseHours)} />
        <Stat label="Median resolution" value={hours(s.medianResolutionHours)} />
        <Stat
          label="SLA breach rate"
          value={formatPercent(s.slaBreachRate)}
          tone={s.slaBreachRate && s.slaBreachRate > 0.2 ? "danger" : s.slaBreachRate ? "warning" : "success"}
          hint={`${s.firstResponseBreaches} response · ${s.resolutionBreaches} resolution`}
        />
      </StatStrip>
      <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
        <Section title="Volume by category">
          <ul className="px-5 py-3">
            {s.byCategory.map((c) => (
              <BarRow key={c.name} label={c.name} value={c.total} max={max} display={`${c.total}${c.open ? ` · ${c.open} open` : ""}`} />
            ))}
          </ul>
        </Section>
        <Section title="Quality">
          <dl className="divide-y text-sm">
            <div className="flex justify-between px-5 py-3">
              <dt className="text-muted-foreground">Average rating</dt>
              <dd className="tabular font-medium">{s.satisfaction.average == null ? "—" : `${s.satisfaction.average} / 5`}</dd>
            </div>
            <div className="flex justify-between px-5 py-3">
              <dt className="text-muted-foreground">Ratings received</dt>
              <dd className="tabular font-medium">{s.satisfaction.ratings}</dd>
            </div>
            <div className="flex justify-between px-5 py-3">
              <dt className="text-muted-foreground">AI-assisted replies</dt>
              <dd className="tabular font-medium">{s.aiAssistedReplies}</dd>
            </div>
          </dl>
        </Section>
      </div>
    </Reveal>
  );
}
