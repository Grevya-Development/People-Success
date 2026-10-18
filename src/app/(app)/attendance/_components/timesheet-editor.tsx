"use client";

import { useMemo, useState, useTransition } from "react";
import { Plus, Save, Send, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { StatusBadge } from "@/components/status-badge";
import { recallTimesheetAction, saveTimesheetAction, submitTimesheetAction } from "../actions";

type Entry = { date: string; projectId: string | null; task: string | null; minutes: number };
type Row = { key: string; projectId: string | null; task: string; hours: string[] };

const NONE = "__none__";
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function addDays(d: string, n: number) {
  const t = Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

const toHours = (m: number) => (m ? String(Math.round((m / 60) * 100) / 100) : "");
const toMinutes = (h: string) => {
  const n = Number(h.replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 60) : 0;
};

function rowsFrom(entries: Entry[], weekStart: string): Row[] {
  const map = new Map<string, Row>();
  for (const e of entries) {
    const key = `${e.projectId ?? ""}|${e.task ?? ""}`;
    const row = map.get(key) ?? { key, projectId: e.projectId, task: e.task ?? "", hours: Array(7).fill("") };
    const idx = Math.round((Date.parse(e.date) - Date.parse(weekStart)) / 86_400_000);
    if (idx >= 0 && idx < 7) row.hours[idx] = toHours(toMinutes(row.hours[idx]) + e.minutes);
    map.set(key, row);
  }
  const rows = [...map.values()];
  return rows.length ? rows : [{ key: "new-0", projectId: null, task: "", hours: Array(7).fill("") }];
}

/** Weekly timesheet grid: rows are project + task, columns are days, cells are hours. */
export function TimesheetEditor({
  sheet,
  entries,
  projects,
  readOnly,
}: {
  sheet: { id: string | null; status: string; weekStart: string };
  entries: Entry[];
  projects: { value: string; label: string }[];
  readOnly?: boolean;
}) {
  const editable = !readOnly && (sheet.status === "draft" || sheet.status === "rejected");
  const [rows, setRows] = useState<Row[]>(() => rowsFrom(entries, sheet.weekStart));
  const [dirty, setDirty] = useState(false);
  const [sheetId, setSheetId] = useState(sheet.id);
  const [pending, start] = useTransition();
  const dates = useMemo(() => DAYS.map((_, i) => addDays(sheet.weekStart, i)), [sheet.weekStart]);

  const dayTotals = dates.map((_, i) => rows.reduce((s, r) => s + toMinutes(r.hours[i]), 0));
  const total = dayTotals.reduce((a, b) => a + b, 0);

  const update = (key: string, patch: Partial<Row>) => {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setDirty(true);
  };

  const payload = () =>
    rows.flatMap((r) =>
      r.hours
        .map((h, i) => ({ date: dates[i], projectId: r.projectId, task: r.task.trim() || null, minutes: toMinutes(h), isBillable: false, note: null }))
        .filter((e) => e.minutes > 0),
    );

  const save = (then?: (id: string) => Promise<void>) =>
    start(async () => {
      const res = await saveTimesheetAction({ timesheetId: sheetId, weekStart: sheet.weekStart, entries: payload() });
      if (!res.ok) {
        toast.error(res.error.message);
        return;
      }
      setDirty(false);
      setSheetId(res.data.id);
      if (then) await then(res.data.id);
      else toast.success("Timesheet saved");
    });

  const submit = () =>
    save(async (id) => {
      const res = await submitTimesheetAction({ id });
      if (res.ok) toast.success("Timesheet submitted for approval");
      else toast.error(res.error.message);
    });

  const recall = () =>
    start(async () => {
      if (!sheetId) return;
      const res = await recallTimesheetAction({ id: sheetId });
      if (res.ok) toast.success("Timesheet recalled to draft");
      else toast.error(res.error.message);
    });

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
              <th className="px-3 py-2 text-left font-medium">Project</th>
              <th className="px-3 py-2 text-left font-medium">Task</th>
              {dates.map((d, i) => (
                <th key={d} className="w-16 px-1 py-2 text-center font-medium">
                  {DAYS[i]}
                  <span className="block text-[10.5px] font-normal tabular">{d.slice(8)}</span>
                </th>
              ))}
              <th className="w-16 px-3 py-2 text-right font-medium">Total</th>
              {editable ? <th className="w-10" /> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const rowTotal = r.hours.reduce((s, h) => s + toMinutes(h), 0);
              return (
                <tr key={r.key} className="border-b last:border-0">
                  <td className="px-3 py-1.5">
                    {editable ? (
                      <Select value={r.projectId ?? NONE} onValueChange={(v) => update(r.key, { projectId: v === NONE ? null : v })}>
                        <SelectTrigger className="h-8 w-44" aria-label="Project">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>No project</SelectItem>
                          {projects.map((p) => (
                            <SelectItem key={p.value} value={p.value}>
                              {p.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      (projects.find((p) => p.value === r.projectId)?.label ?? (r.projectId ? "Project" : "No project"))
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    {editable ? (
                      <Input value={r.task} onChange={(e) => update(r.key, { task: e.target.value })} placeholder="Task" className="h-8 min-w-36" aria-label="Task" maxLength={200} />
                    ) : (
                      r.task || <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  {r.hours.map((h, i) => (
                    <td key={i} className="px-1 py-1.5 text-center">
                      {editable ? (
                        <Input
                          value={h}
                          inputMode="decimal"
                          aria-label={`${DAYS[i]} hours`}
                          className="h-8 w-14 text-center tabular"
                          onChange={(e) => update(r.key, { hours: r.hours.map((x, j) => (j === i ? e.target.value.replace(/[^0-9.,]/g, "") : x)) })}
                        />
                      ) : (
                        <span className="tabular">{h || "—"}</span>
                      )}
                    </td>
                  ))}
                  <td className="px-3 py-1.5 text-right font-medium tabular">{toHours(rowTotal) || "0"}</td>
                  {editable ? (
                    <td className="pr-2">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Remove row"
                        onClick={() => {
                          setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : [{ ...rs[0], projectId: null, task: "", hours: Array(7).fill("") }]));
                          setDirty(true);
                        }}
                      >
                        <Trash2 />
                      </Button>
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t bg-muted/30 text-xs">
              <td className="px-3 py-2 font-medium" colSpan={2}>
                Daily total (hours)
              </td>
              {dayTotals.map((m, i) => (
                <td key={i} className={m > 16 * 60 ? "px-1 py-2 text-center text-danger tabular" : "px-1 py-2 text-center tabular"}>
                  {toHours(m) || "0"}
                </td>
              ))}
              <td className="px-3 py-2 text-right font-semibold tabular">{toHours(total) || "0"}</td>
              {editable ? <td /> : null}
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <StatusBadge status={sheet.status} />
          {sheet.status === "submitted" ? "Locked while your manager reviews it." : sheet.status === "approved" ? "Approved." : sheet.status === "rejected" ? "Returned for changes. Edit and submit again." : dirty ? "Unsaved changes" : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {editable ? (
            <>
              <Button variant="ghost" size="sm" onClick={() => setRows((rs) => [...rs, { key: `new-${Date.now()}`, projectId: null, task: "", hours: Array(7).fill("") }])}>
                <Plus /> Add row
              </Button>
              <Button variant="outline" size="sm" disabled={pending || !dirty} onClick={() => save()}>
                {pending ? <Spinner /> : <Save />} Save
              </Button>
              <Button size="sm" disabled={pending || total === 0} onClick={submit}>
                <Send /> Submit
              </Button>
            </>
          ) : !readOnly && sheet.status === "submitted" ? (
            <Button variant="outline" size="sm" disabled={pending} onClick={recall}>
              {pending ? <Spinner /> : <Undo2 />} Recall
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
