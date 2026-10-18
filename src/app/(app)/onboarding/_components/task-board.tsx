"use client";

import Link from "next/link";
import { useId, useState, useTransition } from "react";
import { Ban, BellRing, CircleSlash, ExternalLink, Info, MoreHorizontal, RotateCcw, ShieldCheck, Upload, UserRoundCog, MessageSquareText, FileCheck2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { CheckboxField, FormError, SelectField, TextareaField, type Option } from "@/components/forms/fields";
import { ComboboxField } from "@/app/(app)/settings/_components/combobox-field";
import { formatDate, formatDateTime } from "@/lib/format";
import { ACCEPT_ATTRIBUTE, ALLOWED_FILE_TYPES, MAX_UPLOAD_BYTES } from "@/lib/validation/documents";
import { accessRevocationSchema, checkinSchema, reassignTaskSchema, waiveTaskSchema, OWNER_GROUPS } from "@/lib/validation/lifecycle";
import type { PlanTask } from "@/server/services/lifecycle/plans";
import {
  acknowledgeForTaskAction,
  confirmAccessRevocationAction,
  reassignTaskAction,
  recordCheckinAction,
  reopenTaskAction,
  sendReminderAction,
  setTaskStatusAction,
  uploadForTaskAction,
  waiveTaskAction,
} from "../actions";
import { ActionDialog } from "./action-dialog";
import { ownerLabel } from "./ui";

type BoardProps = {
  employeeId: string;
  tasks: PlanTask[];
  pendingPolicies: { id: string; title: string }[];
  canManage: boolean;
  isSubject: boolean;
  canConfirmAccess?: boolean;
  members?: Option[];
  /** Group rows under owner headings (plan page) or show a flat list (self-service). */
  grouped?: boolean;
};

export function TaskBoard(props: BoardProps) {
  const { tasks, grouped = true } = props;
  if (!grouped) {
    return (
      <ul className="divide-y">
        {tasks.map((t) => (
          <TaskRow key={t.id} task={t} {...props} />
        ))}
      </ul>
    );
  }
  const groups = OWNER_GROUPS.map((g) => ({ group: g, items: tasks.filter((t) => t.ownerGroup === g) })).filter((g) => g.items.length);
  return (
    <div className="divide-y">
      {groups.map(({ group, items }) => {
        const settled = items.filter((t) => t.status === "done" || t.status === "waived").length;
        return (
          <section key={group} aria-labelledby={`grp-${group}`}>
            <header className="flex items-center justify-between bg-muted/40 px-5 py-2">
              <h3 id={`grp-${group}`} className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {ownerLabel(group)}
              </h3>
              <span className="text-xs text-muted-foreground tabular">
                {settled}/{items.length} done
              </span>
            </header>
            <ul className="divide-y">
              {items.map((t) => (
                <TaskRow key={t.id} task={t} {...props} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function TaskRow({ task, employeeId, pendingPolicies, canManage, isSubject, canConfirmAccess, members = [] }: BoardProps & { task: PlanTask }) {
  const [pending, start] = useTransition();
  const [dialog, setDialog] = useState<null | "upload" | "checkin" | "waive" | "reassign" | "access">(null);
  const open = task.status === "open" || task.status === "in_progress" || task.status === "blocked";
  const done = task.status === "done";
  const waived = task.status === "waived";
  const run = (fn: () => Promise<{ ok: boolean; error?: { message: string } }>, success?: string) =>
    start(async () => {
      const res = await fn();
      if (res.ok) {
        if (success) toast.success(success);
      } else toast.error(res.error?.message ?? "Something went wrong");
    });
  const usesCheckbox = task.kind !== "checkin" && task.code !== "access_revocation";
  const profileHref = task.formTarget === "bank" ? `/employees/${employeeId}?tab=statutory` : `/employees/${employeeId}?tab=personal`;

  return (
    <li className={cn("flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-start", pending && "opacity-60")}>
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <div className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
          {waived ? (
            <CircleSlash className="size-4 text-muted-foreground" aria-label="Waived" />
          ) : usesCheckbox && task.canUpdate ? (
            <Checkbox
              checked={done}
              disabled={pending}
              onCheckedChange={(v) => run(() => setTaskStatusAction({ taskId: task.id, status: v === true ? "done" : "open" }), v === true ? "Task completed" : undefined)}
              aria-label={`Mark "${task.title}" as ${done ? "not done" : "done"}`}
            />
          ) : (
            <span
              aria-label={done ? "Done" : "Open"}
              className={cn("size-4 rounded-[4px] border", done ? "border-success bg-success" : "border-input")}
            />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className={cn("text-sm font-medium", (done || waived) && "text-muted-foreground line-through decoration-muted-foreground/40")}>
            {task.title}
            {!task.required ? <span className="ml-2 align-middle text-[11px] font-normal text-muted-foreground no-underline">Optional</span> : null}
          </p>
          <p className="mt-0.5 flex flex-wrap gap-x-1.5 text-xs text-muted-foreground">
            <span>{ownerLabel(task.ownerGroup)}</span>
            <span aria-hidden>·</span>
            {task.assigneeName ? <span>{task.assigneeName}</span> : <span className="text-warning">{task.assigneeNote ?? "Unassigned"}</span>}
            {task.dueOn ? (
              <>
                <span aria-hidden>·</span>
                <span className={cn(task.overdue && "font-medium text-danger")}>
                  {task.overdue ? "Overdue · " : "Due "}
                  {formatDate(task.dueOn)}
                </span>
              </>
            ) : null}
            {task.status === "in_progress" || task.status === "blocked" ? (
              <>
                <span aria-hidden>·</span>
                <span className={task.status === "blocked" ? "text-warning" : "text-info"}>{task.status === "blocked" ? "Blocked" : "In progress"}</span>
              </>
            ) : null}
          </p>
          {task.description ? <p className="mt-1 text-sm text-muted-foreground">{task.description}</p> : null}
          {open && task.missingEvidence ? (
            <p className="mt-1.5 flex items-start gap-1.5 text-xs text-muted-foreground">
              <Info className="mt-px size-3.5 shrink-0" aria-hidden /> {task.missingEvidence}
            </p>
          ) : null}
          {done && task.completedAt ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Done {formatDateTime(task.completedAt)}
              {task.completedByName ? ` by ${task.completedByName}` : " automatically"}
            </p>
          ) : null}
          {waived && task.waived ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Waived{task.waived.byName ? ` by ${task.waived.byName}` : ""}: {task.waived.reason}
            </p>
          ) : null}
          {task.confirmation ? (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-success">
              <ShieldCheck className="size-3.5" aria-hidden /> Confirmed{task.confirmation.byName ? ` by ${task.confirmation.byName}` : ""}: {task.confirmation.note}
            </p>
          ) : null}
          {task.checkin ? <CheckinNotes checkin={task.checkin} /> : null}
          {task.kind === "acknowledgement" && open && !task.policy && pendingPolicies.length ? (
            <ul className="mt-2 space-y-1.5">
              {pendingPolicies.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <Link href={`/documents/policies/${p.id}`} className="inline-flex items-center gap-1 hover:underline">
                    {p.title} <ExternalLink className="size-3" aria-hidden />
                  </Link>
                  {isSubject ? (
                    <Button size="xs" variant="outline" disabled={pending} onClick={() => run(() => acknowledgeForTaskAction({ taskId: task.id, policyId: p.id }), "Policy acknowledged")}>
                      <FileCheck2 /> Acknowledge
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1.5 pl-7 sm:pl-0">
        {task.kind === "document_upload" && open && task.canUpdate ? (
          <Button size="sm" variant="outline" onClick={() => setDialog("upload")}>
            <Upload /> Upload {task.documentLabel?.toLowerCase() ?? "document"}
          </Button>
        ) : null}
        {task.kind === "acknowledgement" && open && task.policy ? (
          <>
            <Button size="sm" variant="ghost" asChild>
              <Link href={`/documents/policies/${task.policy.id}`}>Read policy</Link>
            </Button>
            {isSubject ? (
              <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => acknowledgeForTaskAction({ taskId: task.id, policyId: task.policy!.id }), "Policy acknowledged")}>
                <FileCheck2 /> Acknowledge
              </Button>
            ) : null}
          </>
        ) : null}
        {task.kind === "form" && open && !task.code && (isSubject || canManage) ? (
          <Button size="sm" variant="outline" asChild>
            <Link href={profileHref}>
              Open profile <ExternalLink data-icon="inline-end" />
            </Link>
          </Button>
        ) : null}
        {task.kind === "checkin" && !waived && (task.canUpdate || isSubject) ? (
          <Button size="sm" variant="outline" onClick={() => setDialog("checkin")}>
            <MessageSquareText /> {isSubject ? "Add my note" : task.checkin?.manager ? "Update notes" : "Record check-in"}
          </Button>
        ) : null}
        {task.code === "access_revocation" && open && canConfirmAccess ? (
          <Button size="sm" variant="outline" onClick={() => setDialog("access")}>
            <ShieldCheck /> Confirm revocation
          </Button>
        ) : null}
        {(task.canUpdate && open) || canManage ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-sm" variant="ghost" aria-label={`More actions for "${task.title}"`} disabled={pending}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {task.canUpdate && open ? (
                <>
                  {task.status !== "in_progress" ? <DropdownMenuItem onSelect={() => run(() => setTaskStatusAction({ taskId: task.id, status: "in_progress" }))}>Mark in progress</DropdownMenuItem> : null}
                  {task.status !== "blocked" ? <DropdownMenuItem onSelect={() => run(() => setTaskStatusAction({ taskId: task.id, status: "blocked" }))}>Mark blocked</DropdownMenuItem> : null}
                  {task.status !== "open" ? <DropdownMenuItem onSelect={() => run(() => setTaskStatusAction({ taskId: task.id, status: "open" }))}>Mark open</DropdownMenuItem> : null}
                </>
              ) : null}
              {canManage && open ? (
                <>
                  {task.canUpdate ? <DropdownMenuSeparator /> : null}
                  {task.assigneeUserId ? (
                    <DropdownMenuItem onSelect={() => run(() => sendReminderAction({ taskId: task.id }), "Reminder sent")}>
                      <BellRing /> Send reminder
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem onSelect={() => setDialog("reassign")}>
                    <UserRoundCog /> Reassign
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setDialog("waive")}>
                    <Ban /> Waive…
                  </DropdownMenuItem>
                </>
              ) : null}
              {canManage && (done || waived) ? (
                <DropdownMenuItem onSelect={() => run(() => reopenTaskAction({ taskId: task.id }), "Task reopened")}>
                  <RotateCcw /> Reopen
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      {dialog === "upload" ? <UploadDialog task={task} onClose={() => setDialog(null)} /> : null}
      <ActionDialog
        open={dialog === "checkin"}
        onOpenChange={(o) => setDialog(o ? "checkin" : null)}
        title={task.title}
        description={isSubject ? "Share how your first weeks are going. Your manager sees this note." : "Capture how the new joiner is settling in. Recording your note completes the task."}
        schema={checkinSchema}
        defaultValues={{ taskId: task.id, settlingIn: (isSubject ? task.checkin?.employee?.settlingIn : task.checkin?.manager?.settlingIn) ?? 4, note: "", followUps: "" }}
        action={recordCheckinAction}
        submitLabel="Save check-in"
        successMessage="Check-in saved"
      >
        {(form) => (
          <>
            <SelectField
              control={form.control}
              name="settlingIn"
              label="Settling in"
              required
              options={[
                { value: "5", label: "5 · Thriving" },
                { value: "4", label: "4 · Going well" },
                { value: "3", label: "3 · Okay" },
                { value: "2", label: "2 · Struggling a bit" },
                { value: "1", label: "1 · Needs support" },
              ]}
            />
            <TextareaField control={form.control} name="note" label="Notes" required rows={4} />
            <TextareaField control={form.control} name="followUps" label="Follow-ups" rows={2} placeholder="Actions agreed, support needed…" />
          </>
        )}
      </ActionDialog>
      <ActionDialog
        open={dialog === "waive"}
        onOpenChange={(o) => setDialog(o ? "waive" : null)}
        title="Waive task"
        description="Waived tasks count as settled for completion. The reason is kept on the plan."
        schema={waiveTaskSchema}
        defaultValues={{ taskId: task.id, reason: "" }}
        action={waiveTaskAction}
        submitLabel="Waive task"
        successMessage="Task waived"
        destructive
      >
        {(form) => <TextareaField control={form.control} name="reason" label="Reason" required rows={3} />}
      </ActionDialog>
      <ActionDialog
        open={dialog === "reassign"}
        onOpenChange={(o) => setDialog(o ? "reassign" : null)}
        title="Reassign task"
        schema={reassignTaskSchema}
        defaultValues={{ taskId: task.id, assigneeUserId: task.assigneeUserId }}
        action={reassignTaskAction}
        submitLabel="Reassign"
        successMessage="Task reassigned"
      >
        {(form) => <ComboboxField control={form.control} name="assigneeUserId" label="Assignee" options={members} placeholder="Choose a member…" description="Clear to move the task to the unassigned queue." />}
      </ActionDialog>
      <ActionDialog
        open={dialog === "access"}
        onOpenChange={(o) => setDialog(o ? "access" : null)}
        title="Confirm access revocation"
        description="Confirm that email, SSO and tool accounts were disabled. This is recorded with your name."
        schema={accessRevocationSchema}
        defaultValues={{ taskId: task.id, note: "", confirm: false as unknown as true }}
        action={confirmAccessRevocationAction}
        submitLabel="Confirm revocation"
        successMessage="Access revocation confirmed"
      >
        {(form) => (
          <>
            <TextareaField control={form.control} name="note" label="What was revoked" required rows={3} placeholder="Google Workspace suspended, SSO disabled, VPN removed…" />
            <CheckboxField control={form.control} name="confirm" label="I confirm access has been revoked" />
          </>
        )}
      </ActionDialog>
    </li>
  );
}

function CheckinNotes({ checkin }: { checkin: NonNullable<PlanTask["checkin"]> }) {
  const entries = [
    ["Manager", checkin.manager],
    ["Employee", checkin.employee],
  ] as const;
  return (
    <div className="mt-2 grid gap-2 sm:grid-cols-2">
      {entries.map(([who, e]) =>
        e ? (
          <div key={who} className="rounded-lg border bg-muted/30 px-3 py-2 text-xs">
            <p className="font-medium">
              {who} · {e.settlingIn}/5 <span className="font-normal text-muted-foreground">· {formatDate(e.at)}</span>
            </p>
            <p className="mt-1 whitespace-pre-line text-muted-foreground">{e.note}</p>
            {e.followUps ? <p className="mt-1 text-muted-foreground">Follow-ups: {e.followUps}</p> : null}
          </div>
        ) : null,
      )}
    </div>
  );
}

function UploadDialog({ task, onClose }: { task: PlanTask; onClose: () => void }) {
  const id = useId();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState(task.title.replace(/^Upload\s+/i, "").replace(/^\w/, (c) => c.toUpperCase()));
  const [errors, setErrors] = useState<{ file?: string; title?: string }>({});
  const [rootError, setRootError] = useState<string>();
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const next: typeof errors = {};
    if (!file) next.file = "Choose a file";
    else if (file.size > MAX_UPLOAD_BYTES) next.file = "Files can be at most 25 MB";
    else if (!((file.name.split(".").pop()?.toLowerCase() ?? "") in ALLOWED_FILE_TYPES)) next.file = "This file type is not allowed";
    if (!title.trim()) next.title = "Enter a title";
    setErrors(next);
    if (Object.keys(next).length || !file) return;
    const fd = new FormData();
    fd.set("taskId", task.id);
    fd.set("title", title.trim());
    fd.set("file", file);
    start(async () => {
      try {
        const res = await uploadForTaskAction(fd);
        if (res.ok) {
          toast.success("Document uploaded");
          onClose();
        } else {
          setRootError(res.error.message);
          const fe = res.error.fieldErrors ?? {};
          setErrors({ file: fe.file?.[0], title: fe.title?.[0] });
        }
      } catch {
        setRootError("The upload could not be sent. The file may be too large, or the connection dropped.");
      }
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{task.title}</DialogTitle>
          <DialogDescription>
            Saved to the employee&apos;s documents as {task.documentLabel?.toLowerCase() ?? "a document"}. PDF or image, up to 25 MB.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate>
          <FieldGroup className="gap-4">
            <Field data-invalid={!!errors.file}>
              <FieldLabel htmlFor={`${id}-file`}>File</FieldLabel>
              <Input id={`${id}-file`} type="file" accept={ACCEPT_ATTRIBUTE} disabled={pending} aria-invalid={!!errors.file} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              {file && !errors.file ? <FieldDescription>{file.name}</FieldDescription> : null}
              <FieldError>{errors.file}</FieldError>
            </Field>
            <Field data-invalid={!!errors.title}>
              <FieldLabel htmlFor={`${id}-title`}>Title</FieldLabel>
              <Input id={`${id}-title`} value={title} maxLength={160} disabled={pending} aria-invalid={!!errors.title} onChange={(e) => setTitle(e.target.value)} />
              <FieldError>{errors.title}</FieldError>
            </Field>
            <FormError message={rootError} />
          </FieldGroup>
          <DialogFooter className="mt-5">
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner data-icon="inline-start" /> : <Upload data-icon="inline-start" />}
              {pending ? "Uploading…" : "Upload"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
