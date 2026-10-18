import { Inbox } from "lucide-react";
import { EmptyState, Reveal } from "@/components/page";
import type { RequestContext } from "@/server/auth/context";
import { listLeaveRequests } from "@/server/services/time/leave-requests";
import { listLeaveTypes } from "@/server/services/time/leave-types";
import type { LeaveListQuery } from "@/lib/validation/time";
import { RequestFilters } from "./request-filters";
import { RequestsTable } from "./requests-table";

export async function RequestsTab({ ctx, query }: { ctx: RequestContext; query: LeaveListQuery }) {
  const [result, types] = await Promise.all([listLeaveRequests(ctx, query), listLeaveTypes(ctx, { includeInactive: true })]);
  const filtered = !!(query.status || query.leaveTypeId || query.from || query.to || query.q);
  return (
    <Reveal>
      <RequestFilters types={types.map((t) => ({ value: t.id, label: t.name }))} />
      <RequestsTable
        rows={result.rows.map((r) => ({
          id: r.id,
          employeeId: r.employeeId,
          employeeName: r.employeeName,
          employeeCode: r.employeeCode,
          typeName: r.typeName,
          typeColor: r.typeColor,
          startDate: r.startDate,
          endDate: r.endDate,
          startSession: r.startSession,
          endSession: r.endSession,
          days: r.days,
          status: r.status,
          createdAt: r.createdAt.toISOString(),
        }))}
        page={result.page}
        pageCount={result.pageCount}
        total={result.total}
        empty={
          <EmptyState
            className="m-4 border-0"
            icon={Inbox}
            title={filtered ? "No matching requests" : "No leave requests yet"}
            description={filtered ? "Try different filters." : "Requests from employees will appear here."}
          />
        }
      />
    </Reveal>
  );
}
