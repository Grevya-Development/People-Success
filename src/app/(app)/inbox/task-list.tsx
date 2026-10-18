"use client";

import Link from "next/link";
import { useTransition } from "react";
import { toast } from "sonner";
import { cn } from "cn";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDate, titleCase, todayIn } from "@/lib/format";
import type { InboxTask } from "@/server/services/inbox";
import { updateTaskAction } from "./actions";

export function TaskList({ items }: { items: InboxTask[] }) {
  const today = todayIn();
  return (
    <ul className="divide-y overflow-hidden rounded-xl border bg-card">
      {items.map((t) => (
        <TaskRow key={t.id} task={t} overdue={!!t.dueOn && t.dueOn < today} />
      ))}
    </ul>
  );
}

function TaskRow({ task, overdue }: { task: InboxTask; overdue: boolean }) {
  const [pending, start] = useTransition();
  const set = (status: "open" | "in_progress" | "blocked" | "done") =>
    start(async () => {
      const res = await updateTaskAction({ taskId: task.id, status });
      if (res.ok) {
        if (status === "done") toast.success("Task completed");
      } else toast.error(res.error.message);
    });

  return (
    <li className={cn("flex items-start gap-3 px-5 py-3.5", pending && "opacity-60")}>
      <Checkbox
        className="mt-0.5"
        checked={task.status === "done"}
        disabled={pending}
        onCheckedChange={(v) => set(v === true ? "done" : "open")}
        aria-label={`Mark "${task.title}" as done`}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{task.title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {titleCase(task.ownerGroup)}
          {task.subjectName && task.subjectEmployeeId ? (
            <>
              {" · "}
              <Link href={`/employees/${task.subjectEmployeeId}`} className="hover:underline">
                {task.subjectName}
              </Link>
            </>
          ) : null}
          {task.dueOn ? <span className={cn(overdue && "font-medium text-danger")}> · Due {formatDate(task.dueOn)}</span> : null}
        </p>
        {task.description ? <p className="mt-1 text-sm text-muted-foreground">{task.description}</p> : null}
      </div>
      <Select value={task.status} onValueChange={(v) => set(v as "open")} disabled={pending}>
        <SelectTrigger size="sm" className="w-32" aria-label="Task status">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="open">Open</SelectItem>
          <SelectItem value="in_progress">In progress</SelectItem>
          <SelectItem value="blocked">Blocked</SelectItem>
          <SelectItem value="done">Done</SelectItem>
        </SelectContent>
      </Select>
    </li>
  );
}
