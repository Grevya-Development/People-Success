import Link from "next/link";
import { Scale } from "lucide-react";
import { cn } from "cn";
import { EmptyState, Reveal, Section } from "@/components/page";
import { PersonCell } from "@/components/person";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { can, type RequestContext } from "@/server/auth/context";
import { balancesTable } from "@/server/services/time/leave-ledger";
import { listLeaveTypes } from "@/server/services/time/leave-types";
import { employeeFormLookups } from "@/server/services/employees/lookups";
import { todayIn } from "@/lib/format";
import { AdjustDialog } from "./adjust-dialog";
import { BalanceSearch } from "./balance-search";
import { dotClass } from "./tones";

export async function BalancesTab({ ctx, q, page }: { ctx: RequestContext; q?: string; page: number }) {
  const canAdjust = can(ctx, "leave.manage", "all");
  const [data, types, lookups] = await Promise.all([balancesTable(ctx, { q, page }), canAdjust ? listLeaveTypes(ctx) : Promise.resolve([]), canAdjust ? employeeFormLookups(ctx) : Promise.resolve(null)]);
  const today = todayIn();
  const typeOptions = types.filter((t) => t.isPaid).map((t) => ({ value: t.id, label: t.name, category: t.category }));
  if (!data.types.length) {
    return <EmptyState icon={Scale} title="No paid leave types" description="Add leave types in leave settings to start tracking balances." />;
  }
  return (
    <Reveal className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <BalanceSearch defaultValue={q ?? ""} />
        {canAdjust && lookups ? <AdjustDialog employees={lookups.managers} types={typeOptions} today={today} /> : null}
      </div>
      <Section>
        {data.rows.length ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-5">Employee</TableHead>
                  {data.types.map((t) => (
                    <TableHead key={t.id} className="text-right" title={t.name}>
                      <span className="inline-flex items-center gap-1.5">
                        <span className={cn("size-2 rounded-full", dotClass(t.color))} aria-hidden />
                        {t.code}
                      </span>
                    </TableHead>
                  ))}
                  <TableHead className="pr-5 text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="pl-5">
                      <PersonCell id={r.id} name={r.name} subtitle={[r.code, r.department].filter(Boolean).join(" · ")} href={`/leave/balances/${r.id}`} />
                    </TableCell>
                    {data.types.map((t) => {
                      const b = r.balances[t.id];
                      return (
                        <TableCell key={t.id} className="text-right tabular">
                          <span className={cn(b.balance < 0 && "text-danger")}>{b.balance}</span>
                          {b.pending ? <span className="block text-[10.5px] text-muted-foreground">{b.pending} pending</span> : null}
                        </TableCell>
                      );
                    })}
                    <TableCell className="pr-5 text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={`/leave/balances/${r.id}`}>Ledger</Link>
                        </Button>
                        {canAdjust && lookups ? (
                          <AdjustDialog
                            employees={lookups.managers}
                            types={typeOptions}
                            employeeId={r.id}
                            today={today}
                            trigger={
                              <Button variant="ghost" size="sm">
                                Adjust
                              </Button>
                            }
                          />
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <EmptyState className="m-4 border-0" icon={Scale} title={q ? "No matching employees" : "No active employees"} />
        )}
        {data.pageCount > 1 ? (
          <div className="flex items-center justify-between border-t px-4 py-2.5 text-sm text-muted-foreground">
            <span className="tabular">
              Page {data.page} of {data.pageCount} · {data.total} employees
            </span>
            <div className="flex gap-1">
              {data.page > 1 ? (
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/leave?tab=balances&page=${data.page - 1}${q ? `&q=${encodeURIComponent(q)}` : ""}`}>Previous</Link>
                </Button>
              ) : null}
              {data.page < data.pageCount ? (
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/leave?tab=balances&page=${data.page + 1}${q ? `&q=${encodeURIComponent(q)}` : ""}`}>Next</Link>
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </Section>
    </Reveal>
  );
}
