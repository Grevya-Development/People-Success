import { unstable_rethrow } from "next/navigation";
import { Lock, Tags } from "lucide-react";
import { EmptyState, ErrorState, NoAccess, Reveal, Section } from "@/components/page";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { RequestContext } from "@/server/auth/context";
import { logger } from "@/server/lib/logger";
import { listTicketCategories, type TicketCategory } from "@/server/services/helpdesk/categories";
import { canManageHelpdesk } from "@/server/services/helpdesk/rules";
import { OWNER_ROLE_LABELS, type TicketCategoryInput } from "@/lib/validation/helpdesk";
import { CategoryDialog, SeedTicketCategoriesButton } from "./category-controls";

export async function HelpdeskSettings({ ctx }: { ctx: RequestContext }) {
  if (!canManageHelpdesk(ctx)) return <NoAccess />;
  let cats: TicketCategory[];
  try {
    cats = await listTicketCategories(ctx, { includeInactive: true });
  } catch (err) {
    unstable_rethrow(err);
    logger.error("helpdesk.categories_failed", { err });
    return <ErrorState title="Could not load categories" />;
  }
  if (!cats.length) {
    return (
      <EmptyState
        icon={Tags}
        title="No ticket categories"
        description="Add the defaults (payroll, leave, documents, IT, policies, a confidential grievance queue and other) with owners and SLAs, then adjust."
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <SeedTicketCategoriesButton variant="default" />
            <CategoryDialog />
          </div>
        }
      />
    );
  }
  return (
    <Reveal>
      <Section
        title="Ticket categories"
        description="Owners receive new tickets round-robin. Confidential categories are hidden from regular agents."
        actions={
          <>
            <SeedTicketCategoriesButton />
            <CategoryDialog />
          </>
        }
      >
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-5">Category</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead className="text-right">First response</TableHead>
              <TableHead className="text-right">Resolution</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-12 pr-5" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {cats.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="pl-5">
                  <span className="inline-flex items-center gap-1.5 font-medium">
                    {c.isSensitive ? <Lock className="size-3.5 text-muted-foreground" aria-label="Confidential" /> : null}
                    {c.name}
                  </span>
                  {c.description ? <p className="line-clamp-1 text-xs text-muted-foreground">{c.description}</p> : null}
                </TableCell>
                <TableCell className="text-muted-foreground">{OWNER_ROLE_LABELS[c.ownerRoleKey as keyof typeof OWNER_ROLE_LABELS] ?? c.ownerRoleKey}</TableCell>
                <TableCell className="text-right tabular">{c.firstResponseHours} h</TableCell>
                <TableCell className="text-right tabular">{c.resolutionHours} h</TableCell>
                <TableCell>
                  <StatusBadge status={c.isActive ? "active" : "inactive"} tone={c.isActive ? "success" : "neutral"} />
                </TableCell>
                <TableCell className="pr-5 text-right">
                  <CategoryDialog category={{ ...c, ownerRoleKey: c.ownerRoleKey as TicketCategoryInput["ownerRoleKey"] }} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>
    </Reveal>
  );
}
