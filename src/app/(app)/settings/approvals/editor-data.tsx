import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { NoAccess, PageHeader, Reveal } from "@/components/page";
import { Skeleton } from "@/components/ui/skeleton";
import { requireContext } from "@/server/auth/context";
import { AppError } from "@/server/lib/errors";
import { canManagePolicies, getApprovalPolicyEditor, SUBJECT_TYPES, subjectLabel } from "@/server/services/settings/approval-policies";
import { conditionsFromJson } from "@/lib/validation/settings";
import { PolicyEditor, type PolicyFormValues } from "./policy-editor";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function BackLink() {
  return (
    <Link href="/settings/approvals" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="size-4" /> Approval policies
    </Link>
  );
}

/** Shared loader for the "new" and "edit" policy pages. */
export async function PolicyEditorData({ id, subject }: { id: string | null; subject?: string | null }) {
  const ctx = await requireContext();
  if (!canManagePolicies(ctx)) return <NoAccess />;
  if (id && !UUID.test(id)) return <NoAccess message="This policy does not exist." />;
  let data: Awaited<ReturnType<typeof getApprovalPolicyEditor>>;
  try {
    data = await getApprovalPolicyEditor(ctx, id);
  } catch (err) {
    if (err instanceof AppError && err.code === "NOT_FOUND") return <NoAccess message="This policy does not exist." />;
    throw err;
  }
  const p = data.policy;
  const subjectType = p?.subjectType ?? (subject && SUBJECT_TYPES.includes(subject) ? subject : null);
  if (!subjectType) return <NoAccess message="Choose a request type from the approval policies page." />;

  const values: PolicyFormValues = p
    ? {
        id: p.id,
        subjectType: p.subjectType,
        name: p.name,
        priority: p.priority,
        isActive: p.isActive,
        conditions: conditionsFromJson(p.conditions),
        steps: p.steps.map((s) => ({
          name: s.name,
          kind: s.approver.kind,
          roleKey: s.approver.kind === "role" ? s.approver.roleKey : undefined,
          userId: s.approver.kind === "user" ? s.approver.userId : null,
          escalateAfterHours: s.escalateAfterHours ? String(s.escalateAfterHours) : "",
        })),
      }
    : {
        subjectType,
        name: "",
        priority: 10,
        isActive: true,
        conditions: [],
        steps: [{ name: "Manager approval", kind: "manager", roleKey: undefined, userId: null, escalateAfterHours: "48" }],
      };

  return (
    <Reveal>
      <PageHeader
        title={p ? p.name : `New ${subjectLabel(subjectType).toLowerCase()} policy`}
        eyebrow={p ? `${subjectLabel(subjectType)} · version ${p.version}` : subjectLabel(subjectType)}
        description={p ? "Saving creates a new version. Requests already in progress keep the version they started with." : undefined}
      />
      <PolicyEditor values={values} roles={data.roles} members={data.members} subjectLabel={subjectLabel(subjectType)} />
    </Reveal>
  );
}

export function EditorSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-7 w-72" />
      <Skeleton className="h-36 rounded-xl" />
      <Skeleton className="h-48 rounded-xl" />
    </div>
  );
}
