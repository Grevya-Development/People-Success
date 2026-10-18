import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { LifeBuoy, Plus } from "lucide-react";
import { EmptyState, ErrorState, Reveal } from "@/components/page";
import { Button } from "@/components/ui/button";
import type { RequestContext } from "@/server/auth/context";
import { logger } from "@/server/lib/logger";
import { listMyTickets, type TicketListItem } from "@/server/services/helpdesk/tickets";
import { TicketTable } from "./ticket-table";

export async function MyTickets({ ctx }: { ctx: RequestContext }) {
  let rows: TicketListItem[];
  try {
    rows = await listMyTickets(ctx);
  } catch (err) {
    unstable_rethrow(err);
    logger.error("helpdesk.my_tickets_failed", { err });
    return <ErrorState title="Could not load your tickets" />;
  }
  if (!rows.length) {
    return (
      <EmptyState
        icon={LifeBuoy}
        title="You haven't raised any tickets"
        description="Questions about payslips, leave, letters or policies? Raise a ticket and HR will reply here. You can also ask the HR assistant from the header."
        action={
          <Button asChild size="sm">
            <Link href="/helpdesk/new">
              <Plus data-icon="inline-start" /> Raise a ticket
            </Link>
          </Button>
        }
      />
    );
  }
  return (
    <Reveal>
      <TicketTable tickets={rows} agentView={false} />
    </Reveal>
  );
}
